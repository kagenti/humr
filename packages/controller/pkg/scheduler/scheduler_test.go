package scheduler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kagenti/humr/packages/controller/pkg/config"
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

func TestSyncSchedule_IdempotentWhenSpecUnchanged(t *testing.T) {
	cm := scheduleCM("my-schedule", "my-instance", true)
	client := fake.NewSimpleClientset(cm)
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	require.NoError(t, s.SyncSchedule(cm))
	firstEntry := s.schedules["my-schedule"]

	// Re-syncing the same spec (e.g. on an informer resync or a status-only
	// write) must be a no-op: the registered cron entry stays the same.
	require.NoError(t, s.SyncSchedule(cm))
	secondEntry := s.schedules["my-schedule"]
	assert.Equal(t, firstEntry, secondEntry, "identical spec must not replace the cron entry")
}

func TestSyncSchedule_ReplacesEntryWhenSpecChanges(t *testing.T) {
	cm := scheduleCM("my-schedule", "my-instance", true)
	client := fake.NewSimpleClientset(cm)
	s := New(client, testCfg)
	s.Start()
	defer s.Stop()

	require.NoError(t, s.SyncSchedule(cm))
	firstEntry := s.schedules["my-schedule"]

	// Mutate the cron expression and re-sync: the entry should be replaced.
	cm.Data["spec.yaml"] = "version: humr.ai/v1\ntype: cron\ncron: \"*/10 * * * *\"\ntask: check repo\nenabled: true\n"
	require.NoError(t, s.SyncSchedule(cm))
	secondEntry := s.schedules["my-schedule"]
	assert.NotEqual(t, firstEntry, secondEntry, "changed spec must replace the cron entry")
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

func TestFire_RunningInstance(t *testing.T) {
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

	spec := &types.ScheduleSpec{Type: "cron", Cron: "*/5 * * * *", Task: "check repo", Enabled: true}
	err := s.fire(context.Background(), "my-instance", "my-schedule", spec)
	require.NoError(t, err)

	// Verify instance is still running (not touched by fire)
	instance, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, instance.Data["spec.yaml"], "desiredState: running")
}

func TestWakeIfHibernated_WakesInstance(t *testing.T) {
	instanceCm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-instance", Namespace: "test-agents",
			Labels: map[string]string{"humr.ai/type": "agent-instance"},
		},
		Data: map[string]string{
			"spec.yaml": "version: humr.ai/v1\ndesiredState: hibernated\n",
		},
	}
	client := fake.NewSimpleClientset(instanceCm)
	s := New(client, testCfg)

	woke, err := s.wakeIfHibernated(context.Background(), "my-instance")
	require.NoError(t, err)
	assert.True(t, woke)

	// Verify instance is now running
	updated, _ := client.CoreV1().ConfigMaps("test-agents").Get(context.Background(), "my-instance", metav1.GetOptions{})
	assert.Contains(t, updated.Data["spec.yaml"], "desiredState: running")
	assert.Contains(t, updated.Annotations, "humr.ai/last-activity")
}

func TestWakeIfHibernated_SkipsRunning(t *testing.T) {
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

	woke, err := s.wakeIfHibernated(context.Background(), "my-instance")
	require.NoError(t, err)
	assert.False(t, woke)
}

func TestPollUntilReady_ReadyImmediately(t *testing.T) {
	called := 0
	ok := pollUntilReady(context.Background(), func(ctx context.Context) bool {
		called++
		return true
	}, 10*time.Millisecond, 100*time.Millisecond, time.Second)
	assert.True(t, ok)
	assert.Equal(t, 1, called, "should exit on first iteration without polling again")
}

func TestPollUntilReady_EventuallyReady(t *testing.T) {
	called := 0
	ok := pollUntilReady(context.Background(), func(ctx context.Context) bool {
		called++
		return called >= 3
	}, 10*time.Millisecond, 100*time.Millisecond, time.Second)
	assert.True(t, ok)
	assert.Equal(t, 3, called)
}

func TestPollUntilReady_Timeout(t *testing.T) {
	called := 0
	start := time.Now()
	ok := pollUntilReady(context.Background(), func(ctx context.Context) bool {
		called++
		return false
	}, 10*time.Millisecond, 30*time.Millisecond, 100*time.Millisecond)
	elapsed := time.Since(start)
	assert.False(t, ok)
	assert.GreaterOrEqual(t, called, 2, "should poll at least a few times before giving up")
	assert.GreaterOrEqual(t, elapsed, 100*time.Millisecond, "should honor the deadline")
	assert.Less(t, elapsed, 500*time.Millisecond, "should not run much past the deadline")
}

func TestPollUntilReady_ContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()
	start := time.Now()
	ok := pollUntilReady(ctx, func(ctx context.Context) bool {
		return false
	}, 100*time.Millisecond, time.Second, 10*time.Second)
	elapsed := time.Since(start)
	assert.False(t, ok)
	assert.Less(t, elapsed, 500*time.Millisecond, "should return quickly on ctx cancel, well before the 10s timeout")
}

func TestWaitForPodReady_PodReady(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "my-instance-0", Namespace: "test-agents"},
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{
				{Type: corev1.PodReady, Status: corev1.ConditionTrue},
			},
		},
	}
	client := fake.NewSimpleClientset(pod)
	s := New(client, testCfg)

	ok := s.waitForPodReady(context.Background(), "my-instance")
	assert.True(t, ok)
}
