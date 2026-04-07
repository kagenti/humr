package reconciler

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/onecli"
)

type mockOneCLI struct {
	created []string
	deleted []string
}

func (m *mockOneCLI) CreateAgent(_ context.Context, _, identifier string) (*onecli.Agent, error) {
	m.created = append(m.created, identifier)
	return &onecli.Agent{ID: "agent-" + identifier, AccessToken: "token-" + identifier}, nil
}

func (m *mockOneCLI) DeleteAgent(_ context.Context, agentID string) error {
	m.deleted = append(m.deleted, agentID)
	return nil
}

func setupReconciler(t *testing.T, templates map[string]*corev1.ConfigMap, objects ...runtime.Object) (*InstanceReconciler, *fake.Clientset, *mockOneCLI) {
	t.Helper()
	client := fake.NewSimpleClientset(objects...)
	cfg := &config.Config{
		Namespace:       "test-agents",
		ReleaseName:     "humr",
		GatewayHost:     "humr-onecli",
		GatewayPort:     10255,
		CACertConfigMap: "humr-onecli-ca-cert",
	}
	getter := &fakeGetter{cms: templates}
	mock := &mockOneCLI{}
	r := NewInstanceReconciler(client, cfg, mock, NewTemplateResolver(getter))
	return r, client, mock
}

func templateCM() *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "code-guardian", Namespace: "test-agents",
			Labels: map[string]string{"humr.ai/type": "agent-template"},
		},
		Data: map[string]string{"spec.yaml": fixtureTemplateYAML},
	}
}

func instanceCM(desiredState string) *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-instance", Namespace: "test-agents", UID: "uid-1",
			Labels: map[string]string{
				"humr.ai/type":     "agent-instance",
				"humr.ai/template": "code-guardian",
			},
		},
		Data: map[string]string{
			"spec.yaml": fmt.Sprintf("version: humr.ai/v1\ndesiredState: %s\ntemplateName: code-guardian\n", desiredState),
		},
	}
}

func TestReconcile_CreateResources(t *testing.T) {
	cm := instanceCM("running")
	r, client, mock := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": templateCM()},
		cm,
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)

	ctx := context.Background()

	// StatefulSet created with replicas=1
	ss, err := client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *ss.Spec.Replicas)

	// Service created
	svc, err := client.CoreV1().Services("test-agents").Get(ctx, "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, corev1.ClusterIPNone, svc.Spec.ClusterIP)

	// NetworkPolicy created
	_, err = client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, "my-instance-egress", metav1.GetOptions{})
	require.NoError(t, err)

	// OneCLI agent created
	assert.Contains(t, mock.created, "my-instance")

	// Status written
	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(ctx, "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "currentState: running")
}

func TestReconcile_Hibernate(t *testing.T) {
	cm := instanceCM("hibernated")
	r, client, _ := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": templateCM()},
		cm,
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)

	ss, _ := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Equal(t, int32(0), *ss.Spec.Replicas)

	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "currentState: hibernated")
}

func TestReconcile_UpdateReplicas(t *testing.T) {
	cm := instanceCM("running")
	existingSS := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "my-instance", Namespace: "test-agents"},
		Spec:       appsv1.StatefulSetSpec{Replicas: int32Ptr(0)},
	}
	r, client, _ := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": templateCM()},
		cm, existingSS,
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)

	ss, _ := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Equal(t, int32(1), *ss.Spec.Replicas)
}

func TestReconcile_TemplateNotFound(t *testing.T) {
	cm := instanceCM("running")
	cm.Labels["humr.ai/template"] = "missing"
	r, client, _ := setupReconciler(t,
		map[string]*corev1.ConfigMap{},
		cm,
	)

	err := r.Reconcile(context.Background(), cm)
	assert.Error(t, err)

	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "currentState: error")
}

func TestReconcile_Idempotent(t *testing.T) {
	cm := instanceCM("running")
	r, _, _ := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": templateCM()},
		cm,
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)
	// Second reconcile should not error
	err = r.Reconcile(context.Background(), cm)
	require.NoError(t, err)
}

func TestDelete_CleansUpOneCLI(t *testing.T) {
	cm := instanceCM("running")
	r, _, mock := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": templateCM()},
		cm,
	)

	r.Delete(context.Background(), "my-instance")
	assert.Contains(t, mock.deleted, "agent-my-instance")
}

func int32Ptr(i int32) *int32 { return &i }
