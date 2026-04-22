package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kagenti/humr/packages/controller/pkg/types"
)

var testForkOwnerCM = &corev1.ConfigMap{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "fork-abc",
		Namespace: "test-agents",
		UID:       "fork-uid-123",
	},
}

var testForkSpec = &types.ForkSpec{
	Version:     types.SpecVersion,
	Instance:    "my-instance",
	ForeignSub:  "kc|user-42",
	SessionID:   "sess-1",
	AccessToken: "onecli-foreign-token",
}

var testForkInstance = &types.InstanceSpec{
	Version:      types.SpecVersion,
	DesiredState: "running",
	AgentName:    "my-agent",
	Env:          []types.EnvVar{{Name: "GITHUB_ORG", Value: "alpha"}},
}

func TestBuildForkJob_BasicShape(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil)

	require.NotNil(t, job)
	assert.Equal(t, "fork-abc", job.Name)
	assert.Equal(t, "test-agents", job.Namespace)
	assert.Equal(t, "agent-fork-job", job.Labels["humr.ai/type"])
	assert.Equal(t, "fork-abc", job.Labels["humr.ai/fork-id"])
	assert.Equal(t, "my-instance", job.Labels["humr.ai/instance"])

	require.Len(t, job.OwnerReferences, 1)
	assert.Equal(t, "fork-uid-123", string(job.OwnerReferences[0].UID))
	assert.True(t, *job.OwnerReferences[0].Controller)
}

func TestBuildForkJob_LifecycleGuarantees(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil)

	require.NotNil(t, job.Spec.BackoffLimit)
	assert.Equal(t, int32(0), *job.Spec.BackoffLimit)

	require.NotNil(t, job.Spec.TTLSecondsAfterFinished)
	assert.Equal(t, int32(60), *job.Spec.TTLSecondsAfterFinished)

	assert.Equal(t, corev1.RestartPolicyNever, job.Spec.Template.Spec.RestartPolicy)
}

func TestBuildForkJob_ForeignTokenInlined(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil)

	require.Len(t, job.Spec.Template.Spec.Containers, 1)
	c := job.Spec.Template.Spec.Containers[0]

	var tokenEnv *corev1.EnvVar
	for i := range c.Env {
		if c.Env[i].Name == "ONECLI_ACCESS_TOKEN" {
			tokenEnv = &c.Env[i]
			break
		}
	}
	require.NotNil(t, tokenEnv, "ONECLI_ACCESS_TOKEN missing from fork env")
	assert.Equal(t, "onecli-foreign-token", tokenEnv.Value)
	assert.Nil(t, tokenEnv.ValueFrom, "fork token must be inlined, not SecretKeyRef")
}

func TestBuildForkJob_ForkMetadataEnv(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil)
	c := job.Spec.Template.Spec.Containers[0]

	env := envMap(c.Env)
	assert.Equal(t, "fork-abc", env["HUMR_FORK_ID"])
	assert.Equal(t, "kc|user-42", env["HUMR_FOREIGN_SUB"])
	assert.Equal(t, "my-instance", env["ADK_INSTANCE_ID"])
}

func TestBuildForkJob_MountsInstancePVC_NotVolumeClaimTemplate(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil)

	podSpec := job.Spec.Template.Spec

	var persistentVol *corev1.Volume
	for i := range podSpec.Volumes {
		if podSpec.Volumes[i].Name == "home-agent" {
			persistentVol = &podSpec.Volumes[i]
			break
		}
	}
	require.NotNil(t, persistentVol, "home-agent volume missing")
	require.NotNil(t, persistentVol.PersistentVolumeClaim, "home-agent volume must reference an existing PVC")
	assert.Equal(t, "home-agent-my-instance-0", persistentVol.PersistentVolumeClaim.ClaimName)
	assert.Nil(t, persistentVol.EmptyDir)
}

func TestBuildForkJob_CACertInitContainer(t *testing.T) {
	job := BuildForkJob("fork-abc", testForkSpec, testForkInstance, testAgent, testConfig, testForkOwnerCM, nil)

	initNames := make([]string, 0, len(job.Spec.Template.Spec.InitContainers))
	for _, ic := range job.Spec.Template.Spec.InitContainers {
		initNames = append(initNames, ic.Name)
	}
	assert.Contains(t, initNames, "fetch-ca-cert")
}

func TestBuildForkJob_InheritsInstanceEnvAndSecretRef(t *testing.T) {
	instance := &types.InstanceSpec{
		Version:      types.SpecVersion,
		DesiredState: "running",
		Env:          []types.EnvVar{{Name: "FOO", Value: "bar"}},
		SecretRef:    "my-extra-secret",
	}
	job := BuildForkJob("fork-abc", testForkSpec, instance, testAgent, testConfig, testForkOwnerCM, nil)
	c := job.Spec.Template.Spec.Containers[0]

	assert.Equal(t, "bar", envMap(c.Env)["FOO"])
	require.Len(t, c.EnvFrom, 1)
	require.NotNil(t, c.EnvFrom[0].SecretRef)
	assert.Equal(t, "my-extra-secret", c.EnvFrom[0].SecretRef.Name)
}

func envMap(envs []corev1.EnvVar) map[string]string {
	m := map[string]string{}
	for _, e := range envs {
		m[e.Name] = e.Value
	}
	return m
}
