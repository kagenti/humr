package scheduler

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/robfig/cron/v3"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/reconciler"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

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

	if entryID, exists := s.schedules[name]; exists {
		s.cron.Remove(entryID)
		delete(s.schedules, name)
	}

	if !spec.Enabled {
		return nil
	}

	entryID, err := s.cron.AddFunc(spec.Cron, func() {
		ctx := context.Background()
		// TODO(#12): create one-shot Job directly with HUMR_TRIGGER env var
		slog.Warn("cron trigger not yet implemented for one-shot model", "schedule", name, "instance", instanceName)

		now := "TODO"
		nextRun := ""
		if eid, exists := s.schedules[name]; exists {
			entry := s.cron.Entry(eid)
			if !entry.Next.IsZero() {
				nextRun = entry.Next.UTC().Format("2006-01-02T15:04:05Z")
			}
		}
		if err := reconciler.WriteScheduleStatus(ctx, s.client, s.config.Namespace, name, types.NewScheduleStatus(now, nextRun, "not implemented")); err != nil {
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
