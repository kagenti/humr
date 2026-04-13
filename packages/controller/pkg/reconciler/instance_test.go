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
)

func setupReconciler(t *testing.T, agents map[string]*corev1.ConfigMap, objects ...runtime.Object) (*InstanceReconciler, *fake.Clientset) {
	t.Helper()
	client := fake.NewSimpleClientset(objects...)
	cfg := &config.Config{
		Namespace:        "test-agents",
		ReleaseNamespace: "default",
		ReleaseName:      "humr",
		GatewayHost:      "humr-onecli",
		GatewayPort:      10255,
		WebPort:          10254,
	}
	getter := &fakeGetter{cms: agents}
	r := NewInstanceReconciler(client, cfg, NewAgentResolver(getter))
	return r, client
}

func agentCM() *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "code-guardian", Namespace: "test-agents",
			Labels: map[string]string{"humr.ai/type": "agent"},
		},
		Data: map[string]string{"spec.yaml": fixtureAgentYAML},
	}
}

func instanceCM(desiredState string) *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-instance", Namespace: "test-agents", UID: "uid-1",
			Labels: map[string]string{
				"humr.ai/type":  "agent-instance",
				"humr.ai/agent": "code-guardian",
			},
		},
		Data: map[string]string{
			"spec.yaml": fmt.Sprintf("version: humr.ai/v1\ndesiredState: %s\nagentId: code-guardian\n", desiredState),
		},
	}
}

func TestReconcile_CreateResources(t *testing.T) {
	cm := instanceCM("running")
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": agentCM()},
		cm,
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)

	ctx := context.Background()

	// StatefulSet created with replicas=1
	ss, err := client.AppsV1().StatefulSets("test-agents").Get(ctx, "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, int32(1), *ss.Spec.Replicas)

	// Proxy URL uses $(ONECLI_ACCESS_TOKEN) interpolation from Secret
	envMap := envToMap(ss.Spec.Template.Spec.Containers[0].Env)
	assert.Contains(t, envMap["HTTPS_PROXY"], "$(ONECLI_ACCESS_TOKEN)@")

	// Service created
	svc, err := client.CoreV1().Services("test-agents").Get(ctx, "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, corev1.ClusterIPNone, svc.Spec.ClusterIP)

	// NetworkPolicy created
	_, err = client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, "my-instance-egress", metav1.GetOptions{})
	require.NoError(t, err)

	// Status written
	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(ctx, "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "currentState: running")
}

func TestReconcile_Hibernate(t *testing.T) {
	cm := instanceCM("hibernated")
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": agentCM()},
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
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": agentCM()},
		cm, existingSS,
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)

	ss, _ := client.AppsV1().StatefulSets("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Equal(t, int32(1), *ss.Spec.Replicas)
}

func TestReconcile_AgentNotFound(t *testing.T) {
	cm := instanceCM("running")
	cm.Labels["humr.ai/agent"] = "missing"
	r, client := setupReconciler(t,
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
	r, _ := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": agentCM()},
		cm,
	)

	err := r.Reconcile(context.Background(), cm)
	require.NoError(t, err)
	// Second reconcile should not error
	err = r.Reconcile(context.Background(), cm)
	require.NoError(t, err)
}

func TestDelete_CleansPVCs(t *testing.T) {
	cm := instanceCM("running")
	// Pre-create PVCs that would have been created by the StatefulSet controller
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "workspace-my-instance-0",
			Namespace: "test-agents",
			Labels:    map[string]string{"humr.ai/instance": "my-instance"},
		},
	}
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": agentCM()},
		cm, pvc,
	)

	// Verify PVC exists before deletion
	ctx := context.Background()
	pvcs, err := client.CoreV1().PersistentVolumeClaims("test-agents").List(ctx, metav1.ListOptions{
		LabelSelector: "humr.ai/instance=my-instance",
	})
	require.NoError(t, err)
	assert.Len(t, pvcs.Items, 1)

	// Delete instance — should clean up PVCs
	r.Delete(ctx, "my-instance")

	pvcs, err = client.CoreV1().PersistentVolumeClaims("test-agents").List(ctx, metav1.ListOptions{
		LabelSelector: "humr.ai/instance=my-instance",
	})
	require.NoError(t, err)
	assert.Empty(t, pvcs.Items)
}

func int32Ptr(i int32) *int32 { return &i }
