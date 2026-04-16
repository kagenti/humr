package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/robfig/cron/v3"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/reconciler"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

// Annotation key for trigger payload — when set alongside run-request,
// the controller passes this as the HUMR_TRIGGER env var on the Job.
const AnnTrigger = "humr.ai/trigger"

type Scheduler struct {
	client    kubernetes.Interface
	config    *config.Config
	cron      *cron.Cron
	schedules map[string]cron.EntryID
}

func New(client kubernetes.Interface, cfg *config.Config) *Scheduler {
	return &Scheduler{
		client:    client,
		config:    cfg,
		cron:      cron.New(),
		schedules: make(map[string]cron.EntryID),
	}
}

func (s *Scheduler) Start() { s.cron.Start() }
func (s *Scheduler) Stop()  { s.cron.Stop() }

func (s *Scheduler) SyncSchedule(cm *corev1.ConfigMap) error {
	name := cm.Name
	instanceName := cm.Labels["humr.ai/instance"]

	specYAML, ok := cm.Data["spec.yaml"]
	if !ok {
		return fmt.Errorf("schedule %s: no spec.yaml", name)
	}
	spec, err := types.ParseScheduleSpec(specYAML)
	if err != nil {
		return fmt.Errorf("schedule %s: %w", name, err)
	}

	// Remove existing entry if present
	if entryID, exists := s.schedules[name]; exists {
		s.cron.Remove(entryID)
		delete(s.schedules, name)
	}

	if !spec.Enabled {
		return nil
	}

	entryID, err := s.cron.AddFunc(spec.Cron, func() {
		ctx := context.Background()
		fireErr := s.fire(ctx, instanceName, name, spec)

		// Always write schedule status, even on failure
		now := time.Now().UTC().Format(time.RFC3339)
		nextRun := ""
		if eid, exists := s.schedules[name]; exists {
			entry := s.cron.Entry(eid)
			if !entry.Next.IsZero() {
				nextRun = entry.Next.UTC().Format(time.RFC3339)
			}
		}
		result := "success"
		if fireErr != nil {
			result = fireErr.Error()
			slog.Error("schedule fire failed", "schedule", name, "instance", instanceName, "error", fireErr)
		}
		if err := reconciler.WriteScheduleStatus(ctx, s.client, s.config.Namespace, name, types.NewScheduleStatus(now, nextRun, result)); err != nil {
			slog.Error("writing schedule status", "schedule", name, "error", err)
		}
	})
	if err != nil {
		return fmt.Errorf("schedule %s: invalid cron %q: %w", name, spec.Cron, err)
	}
	s.schedules[name] = entryID
	slog.Info("cron registered", "schedule", name, "cron", spec.Cron)
	return nil
}

func (s *Scheduler) RemoveSchedule(name string) {
	if entryID, exists := s.schedules[name]; exists {
		s.cron.Remove(entryID)
		delete(s.schedules, name)
	}
}

// fire sets the run-request + trigger annotations on the instance ConfigMap.
// The controller's reconciler picks this up, creates a Job with HUMR_TRIGGER
// env var, and the agent-runtime handles the trigger on startup.
func (s *Scheduler) fire(ctx context.Context, instanceName, scheduleName string, spec *types.ScheduleSpec) error {
	trigger := map[string]any{
		"type":      spec.Type,
		"task":      spec.Task,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"schedule":  scheduleName,
	}
	if len(spec.MCPServers) > 0 {
		trigger["mcpServers"] = spec.MCPServers
	}
	if spec.SessionMode != "" {
		trigger["sessionMode"] = spec.SessionMode
	}
	triggerJSON, err := json.Marshal(trigger)
	if err != nil {
		return fmt.Errorf("marshaling trigger: %w", err)
	}

	// Set run-request + trigger annotations on the instance ConfigMap
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		cm, err := s.client.CoreV1().ConfigMaps(s.config.Namespace).Get(ctx, instanceName, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("getting instance %s: %w", instanceName, err)
		}

		// If there's already an active job, skip — don't overlap
		if cm.Annotations != nil && cm.Annotations[reconciler.AnnActiveJob] != "" {
			slog.Warn("skipping trigger — instance already has active job", "instance", instanceName, "schedule", scheduleName)
			return nil
		}

		if cm.Annotations == nil {
			cm.Annotations = make(map[string]string)
		}
		cm.Annotations[reconciler.AnnRunRequest] = time.Now().UTC().Format(time.RFC3339)
		cm.Annotations[AnnTrigger] = string(triggerJSON)
		_, err = s.client.CoreV1().ConfigMaps(s.config.Namespace).Update(ctx, cm, metav1.UpdateOptions{})
		return err
	})
}
