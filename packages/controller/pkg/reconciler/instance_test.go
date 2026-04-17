package reconciler

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
		Namespace:           "test-agents",
		ReleaseNamespace:    "default",
		ReleaseName:         "humr",
		GatewayHost:         "humr-onecli",
		GatewayPort:         10255,
		WebPort:             10254,
		CACertInitImage:     "busybox:stable",
	}
	getter := &fakeGetter{cms: agents}
	r := NewInstanceReconciler(client, cfg, NewAgentResolver(getter))
	return r, client
}

func agentCM() *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "code-guardian", Namespace: "test-agents", UID: "agent-uid",
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

	// PVC created for /home/agent
	pvcs, err := client.CoreV1().PersistentVolumeClaims("test-agents").List(ctx, metav1.ListOptions{
		LabelSelector: "humr.ai/instance=my-instance",
	})
	require.NoError(t, err)
	require.Len(t, pvcs.Items, 1)
	assert.Equal(t, "home-agent-my-instance-0", pvcs.Items[0].Name)

	// NetworkPolicy created
	_, err = client.NetworkingV1().NetworkPolicies("test-agents").Get(ctx, "my-instance-egress", metav1.GetOptions{})
	require.NoError(t, err)

	// Status written as idle (Job model — no long-lived pod)
	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(ctx, "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["status.yaml"], "currentState: idle")
}

func TestReconcile_DesiredStateIgnored(t *testing.T) {
	// Both "running" and "hibernated" produce the same result: PVCs + NetworkPolicy, status=idle
	for _, state := range []string{"running", "hibernated"} {
		t.Run(state, func(t *testing.T) {
			cm := instanceCM(state)
			r, client := setupReconciler(t,
				map[string]*corev1.ConfigMap{"code-guardian": agentCM()},
				cm,
			)

			err := r.Reconcile(context.Background(), cm)
			require.NoError(t, err)

			updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
			assert.Contains(t, updated.Data["status.yaml"], "currentState: idle")
		})
	}
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

func TestReconcile_SetsAgentOwnerReference(t *testing.T) {
	cm := instanceCM("running")
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": agentCM()},
		cm,
	)

	require.NoError(t, r.Reconcile(context.Background(), cm))

	updated, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, updated.OwnerReferences, 1)
	ref := updated.OwnerReferences[0]
	assert.Equal(t, "ConfigMap", ref.Kind)
	assert.Equal(t, "code-guardian", ref.Name)
	assert.EqualValues(t, "agent-uid", ref.UID)
}

func TestReconcile_OwnerReferenceIdempotent(t *testing.T) {
	cm := instanceCM("running")
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": agentCM()},
		cm,
	)

	require.NoError(t, r.Reconcile(context.Background(), cm))
	require.NoError(t, r.Reconcile(context.Background(), cm))

	updated, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Len(t, updated.OwnerReferences, 1, "second reconcile must not duplicate owner reference")
}

func TestReconcile_PreservesExistingOwnerReferences(t *testing.T) {
	cm := instanceCM("running")
	cm.OwnerReferences = []metav1.OwnerReference{
		{APIVersion: "v1", Kind: "ConfigMap", Name: "other-owner", UID: "other-uid"},
	}
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": agentCM()},
		cm,
	)

	require.NoError(t, r.Reconcile(context.Background(), cm))

	updated, err := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, updated.OwnerReferences, 2)
	uids := []string{string(updated.OwnerReferences[0].UID), string(updated.OwnerReferences[1].UID)}
	assert.Contains(t, uids, "other-uid")
	assert.Contains(t, uids, "agent-uid")
}

func TestDelete_CleansPVCs(t *testing.T) {
	cm := instanceCM("running")
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "home-agent-my-instance-0",
			Namespace: "test-agents",
			Labels:    map[string]string{"humr.ai/instance": "my-instance"},
		},
	}
	r, client := setupReconciler(t,
		map[string]*corev1.ConfigMap{"code-guardian": agentCM()},
		cm, pvc,
	)

	ctx := context.Background()
	pvcs, err := client.CoreV1().PersistentVolumeClaims("test-agents").List(ctx, metav1.ListOptions{
		LabelSelector: "humr.ai/instance=my-instance",
	})
	require.NoError(t, err)
	assert.Len(t, pvcs.Items, 1)

	r.Delete(ctx, "my-instance")

	pvcs, err = client.CoreV1().PersistentVolumeClaims("test-agents").List(ctx, metav1.ListOptions{
		LabelSelector: "humr.ai/instance=my-instance",
	})
	require.NoError(t, err)
	assert.Empty(t, pvcs.Items)
}
