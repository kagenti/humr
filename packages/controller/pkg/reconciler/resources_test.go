package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

var testConfig = &config.Config{
	Namespace:        "test-agents",
	ReleaseNamespace: "default",
	ReleaseName:      "humr",
	GatewayHost:      "humr-onecli",
	GatewayPort:      10255,
	WebPort:          10254,
	CACertInitImage:  "busybox:stable",
}

var testAgent = &types.AgentSpec{
	Image: "ghcr.io/myorg/agent:latest",
	Mounts: []types.Mount{
		{Path: "/home/agent", Persist: true},
		{Path: "/tmp", Persist: false},
	},
	Init: "#!/bin/bash\necho hello",
	Env:  []types.EnvVar{{Name: "ACP_PORT", Value: "8080"}},
	Resources: types.ResourceSpec{
		Requests: map[string]string{"cpu": "250m", "memory": "512Mi"},
		Limits:   map[string]string{"cpu": "1", "memory": "2Gi"},
	},
	SecurityContext: &types.SecurityContext{
		RunAsNonRoot:           boolPtr(true),
		ReadOnlyRootFilesystem: boolPtr(false),
	},
}

var testOwnerCM = &corev1.ConfigMap{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "my-instance",
		Namespace: "test-agents",
		UID:       "cm-uid-123",
	},
}

func boolPtr(b bool) *bool { return &b }

// --- PVC tests ---

func TestBuildPVCs_PersistentMount(t *testing.T) {
	pvcs := BuildPVCs("my-instance", testAgent, testConfig, testOwnerCM)

	// Only 1 PVC — /home/agent is persistent, /tmp is not
	require.Len(t, pvcs, 1)
	pvc := pvcs[0]

	assert.Equal(t, "home-agent-my-instance-0", pvc.Name)
	assert.Equal(t, "test-agents", pvc.Namespace)
	assert.Equal(t, "my-instance", pvc.Labels["humr.ai/instance"])

	// Owner reference
	require.Len(t, pvc.OwnerReferences, 1)
	assert.Equal(t, "cm-uid-123", string(pvc.OwnerReferences[0].UID))

	// Storage
	assert.Equal(t, resource.MustParse("10Gi"), pvc.Spec.Resources.Requests[corev1.ResourceStorage])
	assert.Contains(t, pvc.Spec.AccessModes, corev1.ReadWriteOnce)
}

func TestBuildPVCs_NoPersistentMounts(t *testing.T) {
	agent := &types.AgentSpec{
		Image: "test:latest",
		Mounts: []types.Mount{
			{Path: "/tmp", Persist: false},
		},
	}
	pvcs := BuildPVCs("my-instance", agent, testConfig, testOwnerCM)
	assert.Empty(t, pvcs)
}

func TestBuildPVCs_MultiplePersistent(t *testing.T) {
	agent := &types.AgentSpec{
		Image: "test:latest",
		Mounts: []types.Mount{
			{Path: "/home/agent", Persist: true},
			{Path: "/workspace", Persist: true},
			{Path: "/tmp", Persist: false},
		},
	}
	pvcs := BuildPVCs("inst", agent, testConfig, testOwnerCM)
	require.Len(t, pvcs, 2)
	assert.Equal(t, "home-agent-inst-0", pvcs[0].Name)
	assert.Equal(t, "workspace-inst-0", pvcs[1].Name)
}

// --- NetworkPolicy tests ---

func TestBuildNetworkPolicy(t *testing.T) {
	np := BuildNetworkPolicy("my-instance", testConfig, testOwnerCM)
	assert.Equal(t, "my-instance-egress", np.Name)
	assert.Equal(t, "test-agents", np.Namespace)
	assert.Equal(t, "my-instance", np.Spec.PodSelector.MatchLabels["humr.ai/instance"])
	require.Len(t, np.OwnerReferences, 1)

	// Egress rules: OneCLI + API Server + DNS
	require.Len(t, np.Spec.Egress, 3)

	// OneCLI rule targets OneCLI pods in the release namespace (gateway + web ports)
	onecliRule := np.Spec.Egress[0]
	require.Len(t, onecliRule.To, 1)
	assert.Equal(t, "onecli", onecliRule.To[0].PodSelector.MatchLabels["app.kubernetes.io/component"])
	require.NotNil(t, onecliRule.To[0].NamespaceSelector, "OneCLI egress rule must include namespaceSelector for cross-namespace access")
	assert.Equal(t, "default", onecliRule.To[0].NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"])
	require.Len(t, onecliRule.Ports, 2, "should allow both gateway and web ports")
	assert.Equal(t, int32(10255), onecliRule.Ports[0].Port.IntVal)
	assert.Equal(t, int32(10254), onecliRule.Ports[1].Port.IntVal)

	// API Server rule allows agent-runtime to reach internal session endpoints
	apiRule := np.Spec.Egress[1]
	require.Len(t, apiRule.To, 1)
	assert.Equal(t, "apiserver", apiRule.To[0].PodSelector.MatchLabels["app.kubernetes.io/component"])
	require.NotNil(t, apiRule.To[0].NamespaceSelector, "API Server egress rule must include namespaceSelector for cross-namespace access")
	assert.Equal(t, "default", apiRule.To[0].NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"])
	require.Len(t, apiRule.Ports, 1)
	assert.Equal(t, int32(4000), apiRule.Ports[0].Port.IntVal)

	// Ingress: allow ACP port
	require.Len(t, np.Spec.Ingress, 1)
	assert.Equal(t, int32(8080), np.Spec.Ingress[0].Ports[0].Port.IntVal)
}
