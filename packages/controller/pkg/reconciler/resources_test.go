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
	Namespace:       "test-agents",
	ReleaseName:     "humr",
	GatewayHost:     "humr-onecli",
	GatewayPort:     10255,
	CACertConfigMap: "humr-onecli-ca-cert",
}

var testTemplate = &types.TemplateSpec{
	Image: "ghcr.io/myorg/agent:latest",
	Mounts: []types.Mount{
		{Path: "/workspace", Persist: true},
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

// --- StatefulSet tests ---

func TestBuildStatefulSet_Running(t *testing.T) {
	instance := &types.InstanceSpec{
		DesiredState: "running",
		Env:          []types.EnvVar{{Name: "GITHUB_ORG", Value: "alpha"}},
		SecretRef:    "my-secrets",
	}
	ss := BuildStatefulSet("my-instance", instance, testTemplate, testConfig, testOwnerCM)

	require.NotNil(t, ss)
	assert.Equal(t, "my-instance", ss.Name)
	assert.Equal(t, "test-agents", ss.Namespace)
	assert.Equal(t, int32(1), *ss.Spec.Replicas)

	// Owner reference
	require.Len(t, ss.OwnerReferences, 1)
	assert.Equal(t, "cm-uid-123", string(ss.OwnerReferences[0].UID))

	// Labels
	assert.Equal(t, "my-instance", ss.Spec.Template.Labels["humr.ai/instance"])

	// Container
	require.Len(t, ss.Spec.Template.Spec.Containers, 1)
	c := ss.Spec.Template.Spec.Containers[0]
	assert.Equal(t, "ghcr.io/myorg/agent:latest", c.Image)
	assert.Equal(t, int32(8080), c.Ports[0].ContainerPort)
	assert.Equal(t, "acp", c.Ports[0].Name)

	// Probes
	assert.Equal(t, "/healthz", c.ReadinessProbe.HTTPGet.Path)
	assert.Equal(t, int32(5), c.ReadinessProbe.InitialDelaySeconds)
	assert.Equal(t, int32(5), c.ReadinessProbe.PeriodSeconds)
	assert.Equal(t, "/healthz", c.LivenessProbe.HTTPGet.Path)
	assert.Equal(t, int32(15), c.LivenessProbe.InitialDelaySeconds)

	// Platform env vars
	envMap := envToMap(c.Env)
	assert.Equal(t, "humr-onecli:10255", envMap["HTTPS_PROXY"])
	assert.Equal(t, "humr-onecli:10255", envMap["HTTP_PROXY"])
	assert.Equal(t, "/etc/humr/ca/ca.crt", envMap["SSL_CERT_FILE"])
	assert.Equal(t, "/etc/humr/ca/ca.crt", envMap["NODE_EXTRA_CA_CERTS"])
	assert.Equal(t, "my-instance", envMap["ADK_INSTANCE_ID"])
	// Template env
	assert.Equal(t, "8080", envMap["ACP_PORT"])
	// Instance env
	assert.Equal(t, "alpha", envMap["GITHUB_ORG"])

	// EnvFrom secretRef
	require.Len(t, c.EnvFrom, 1)
	assert.Equal(t, "my-secrets", c.EnvFrom[0].SecretRef.LocalObjectReference.Name)

	// Resources
	assert.Equal(t, resource.MustParse("250m"), *c.Resources.Requests.Cpu())
	assert.Equal(t, resource.MustParse("2Gi"), *c.Resources.Limits.Memory())

	// Security context
	assert.True(t, *ss.Spec.Template.Spec.SecurityContext.RunAsNonRoot)
}

func TestBuildStatefulSet_Hibernated(t *testing.T) {
	instance := &types.InstanceSpec{DesiredState: "hibernated"}
	ss := BuildStatefulSet("my-instance", instance, testTemplate, testConfig, testOwnerCM)
	assert.Equal(t, int32(0), *ss.Spec.Replicas)
}

func TestBuildStatefulSet_InitContainer(t *testing.T) {
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildStatefulSet("my-instance", instance, testTemplate, testConfig, testOwnerCM)
	require.Len(t, ss.Spec.Template.Spec.InitContainers, 1)
	ic := ss.Spec.Template.Spec.InitContainers[0]
	assert.Equal(t, "ghcr.io/myorg/agent:latest", ic.Image)
	assert.Equal(t, []string{"sh", "-c", testTemplate.Init}, ic.Command)
}

func TestBuildStatefulSet_NoInitWhenEmpty(t *testing.T) {
	tmpl := *testTemplate
	tmpl.Init = ""
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildStatefulSet("my-instance", instance, &tmpl, testConfig, testOwnerCM)
	assert.Empty(t, ss.Spec.Template.Spec.InitContainers)
}

func TestBuildStatefulSet_Volumes(t *testing.T) {
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildStatefulSet("my-instance", instance, testTemplate, testConfig, testOwnerCM)

	// 2 PVCs (workspace, home-agent)
	assert.Len(t, ss.Spec.VolumeClaimTemplates, 2)
	assert.Equal(t, "workspace", ss.Spec.VolumeClaimTemplates[0].Name)
	assert.Equal(t, "home-agent", ss.Spec.VolumeClaimTemplates[1].Name)

	// EmptyDir for /tmp + ConfigMap for CA cert
	volNames := make(map[string]bool)
	for _, v := range ss.Spec.Template.Spec.Volumes {
		volNames[v.Name] = true
	}
	assert.True(t, volNames["tmp"])
	assert.True(t, volNames["ca-cert"])

	// Volume mounts on container
	c := ss.Spec.Template.Spec.Containers[0]
	mountPaths := make(map[string]string)
	for _, m := range c.VolumeMounts {
		mountPaths[m.MountPath] = m.Name
	}
	assert.Equal(t, "workspace", mountPaths["/workspace"])
	assert.Equal(t, "home-agent", mountPaths["/home/agent"])
	assert.Equal(t, "tmp", mountPaths["/tmp"])
	assert.Equal(t, "ca-cert", mountPaths["/etc/humr/ca"])
}

func TestBuildStatefulSet_NoSecretRef(t *testing.T) {
	instance := &types.InstanceSpec{DesiredState: "running"}
	ss := BuildStatefulSet("my-instance", instance, testTemplate, testConfig, testOwnerCM)
	assert.Empty(t, ss.Spec.Template.Spec.Containers[0].EnvFrom)
}

// --- Service tests ---

func TestBuildService(t *testing.T) {
	svc := BuildService("my-instance", testConfig, testOwnerCM)
	assert.Equal(t, "my-instance", svc.Name)
	assert.Equal(t, "test-agents", svc.Namespace)
	assert.Equal(t, corev1.ClusterIPNone, svc.Spec.ClusterIP)
	assert.Equal(t, int32(8080), svc.Spec.Ports[0].Port)
	assert.Equal(t, "acp", svc.Spec.Ports[0].Name)
	assert.Equal(t, "my-instance", svc.Spec.Selector["humr.ai/instance"])
	require.Len(t, svc.OwnerReferences, 1)
}

// --- NetworkPolicy tests ---

func TestBuildNetworkPolicy(t *testing.T) {
	np := BuildNetworkPolicy("my-instance", testConfig, testOwnerCM)
	assert.Equal(t, "my-instance-egress", np.Name)
	assert.Equal(t, "test-agents", np.Namespace)
	assert.Equal(t, "my-instance", np.Spec.PodSelector.MatchLabels["humr.ai/instance"])
	require.Len(t, np.OwnerReferences, 1)

	// Egress rules: gateway + DNS
	require.Len(t, np.Spec.Egress, 2)

	// Ingress: allow ACP port
	require.Len(t, np.Spec.Ingress, 1)
	assert.Equal(t, int32(8080), np.Spec.Ingress[0].Ports[0].Port.IntVal)
}

func envToMap(envs []corev1.EnvVar) map[string]string {
	m := make(map[string]string)
	for _, e := range envs {
		m[e.Name] = e.Value
	}
	return m
}
