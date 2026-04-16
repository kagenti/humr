package scheduler

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/reconciler"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

var testCfg = &config.Config{Namespace: "test-agents"}

func scheduleCM(name, instanceName string, enabled bool) *corev1.ConfigMap {
	enabledStr := "true"
	if !enabled {
		enabledStr = "false"
	}
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "test-agents",
			Labels: map[string]string{
				"humr.ai/type":     "agent-schedule",
				"humr.ai/instance": instanceName,
			},
		},
		Data: map[string]string{
			"spec.yaml": "version: humr.ai/v1\ntype: cron\ncron: \"*/5 * * * *\"\ntask: check repo\nenabled: " + enabledStr + "\n",
		},
	}
}

func TestSyncSchedule_Enabled(t *testing.T) {
	cm := scheduleCM("my-schedule", "my-instance", true)
	client := fake.NewSimpleClientset(cm)
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	err := s.SyncSchedule(cm)
	require.NoError(t, err)
	assert.Contains(t, s.schedules, "my-schedule")
}

func TestSyncSchedule_Disabled(t *testing.T) {
	cm := scheduleCM("my-schedule", "my-instance", false)
	client := fake.NewSimpleClientset(cm)
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	err := s.SyncSchedule(cm)
	require.NoError(t, err)
	assert.NotContains(t, s.schedules, "my-schedule")
}

func TestSyncSchedule_UpdateReplacesEntry(t *testing.T) {
	cm := scheduleCM("my-schedule", "my-instance", true)
	client := fake.NewSimpleClientset(cm)
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	s.SyncSchedule(cm)
	firstEntry := s.schedules["my-schedule"]

	s.SyncSchedule(cm)
	secondEntry := s.schedules["my-schedule"]

	assert.NotEqual(t, firstEntry, secondEntry)
}

func TestRemoveSchedule(t *testing.T) {
	cm := scheduleCM("my-schedule", "my-instance", true)
	client := fake.NewSimpleClientset(cm)
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	s.SyncSchedule(cm)
	assert.Contains(t, s.schedules, "my-schedule")

	s.RemoveSchedule("my-schedule")
	assert.NotContains(t, s.schedules, "my-schedule")
}

func TestRemoveSchedule_NonExistent(t *testing.T) {
	s := New(fake.NewSimpleClientset(), testCfg)
	s.RemoveSchedule("nope") // should not panic
}

func TestFire_SetsRunRequestAndTrigger(t *testing.T) {
	instanceCm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-instance", Namespace: "test-agents",
			Labels: map[string]string{"humr.ai/type": "agent-instance"},
		},
		Data: map[string]string{
			"spec.yaml": "version: humr.ai/v1\ndesiredState: running\n",
		},
	}
	client := fake.NewSimpleClientset(instanceCm)
	s := New(client, testCfg)

	spec := &types.ScheduleSpec{Type: "cron", Cron: "*/5 * * * *", Task: "check repo", Enabled: true, SessionMode: "continuous"}
	err := s.fire(context.Background(), "my-instance", "my-schedule", spec)
	require.NoError(t, err)

	// Verify run-request annotation was set
	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.NotEmpty(t, updated.Annotations[reconciler.AnnRunRequest])

	// Verify trigger annotation was set with correct payload
	triggerJSON := updated.Annotations[AnnTrigger]
	assert.NotEmpty(t, triggerJSON)
	var trigger map[string]any
	require.NoError(t, json.Unmarshal([]byte(triggerJSON), &trigger))
	assert.Equal(t, "check repo", trigger["task"])
	assert.Equal(t, "my-schedule", trigger["schedule"])
	assert.Equal(t, "continuous", trigger["sessionMode"])
}

func TestFire_SkipsWhenActiveJob(t *testing.T) {
	instanceCm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-instance", Namespace: "test-agents",
			Labels:      map[string]string{"humr.ai/type": "agent-instance"},
			Annotations: map[string]string{reconciler.AnnActiveJob: "my-instance-abc123"},
		},
		Data: map[string]string{
			"spec.yaml": "version: humr.ai/v1\ndesiredState: running\n",
		},
	}
	client := fake.NewSimpleClientset(instanceCm)
	s := New(client, testCfg)

	spec := &types.ScheduleSpec{Type: "cron", Task: "check repo", Enabled: true}
	err := s.fire(context.Background(), "my-instance", "my-schedule", spec)
	require.NoError(t, err)

	// run-request should NOT be set
	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Empty(t, updated.Annotations[reconciler.AnnRunRequest])
}
