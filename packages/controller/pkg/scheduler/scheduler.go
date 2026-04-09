package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/robfig/cron/v3"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	restclient "k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/reconciler"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

type Scheduler struct {
	client    kubernetes.Interface
	config    *config.Config
	cron      *cron.Cron
	schedules map[string]cron.EntryID
	restCfg   *restclient.Config // nil in tests
}

func New(client kubernetes.Interface, cfg *config.Config) *Scheduler {
	return &Scheduler{
		client:    client,
		config:    cfg,
		cron:      cron.New(),
		schedules: make(map[string]cron.EntryID),
	}
}

func (s *Scheduler) WithRESTConfig(cfg *restclient.Config) *Scheduler {
	s.restCfg = cfg
	return s
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
		if err := s.fire(ctx, instanceName, name, spec); err != nil {
			slog.Error("schedule fire failed", "schedule", name, "instance", instanceName, "error", err)
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
	triggerJSON, _ := json.Marshal(trigger)
	filename := fmt.Sprintf("/workspace/.triggers/%d.json", time.Now().UnixMilli())

	podName := instanceName + "-0"
	cmd := []string{"sh", "-c", fmt.Sprintf("mkdir -p /workspace/.triggers && cat > %s << 'TRIGGER_EOF'\n%s\nTRIGGER_EOF", filename, string(triggerJSON))}

	if s.restCfg != nil {
		req := s.client.CoreV1().RESTClient().Post().
			Resource("pods").
			Name(podName).
			Namespace(s.config.Namespace).
			SubResource("exec").
			VersionedParams(&corev1.PodExecOptions{
				Container: "agent",
				Command:   cmd,
				Stdout:    true,
				Stderr:    true,
			}, scheme.ParameterCodec)

		exec, err := remotecommand.NewSPDYExecutor(s.restCfg, "POST", req.URL())
		if err != nil {
			return fmt.Errorf("exec into %s: %w", podName, err)
		}
		if err := exec.StreamWithContext(ctx, remotecommand.StreamOptions{
			Stdout: io.Discard,
			Stderr: io.Discard,
		}); err != nil {
			return fmt.Errorf("exec stream to %s: %w", podName, err)
		}
	}
	slog.Info("trigger delivered", "pod", podName, "file", filename)

	// Update last-activity annotation on instance ConfigMap
	if err := patchLastActivity(ctx, s.client, s.config.Namespace, instanceName); err != nil {
		slog.Warn("failed to update last-activity", "instance", instanceName, "error", err)
	}

	// Update schedule status
	now := time.Now().UTC().Format(time.RFC3339)
	nextRun := ""
	if entryID, exists := s.schedules[scheduleName]; exists {
		entry := s.cron.Entry(entryID)
		if !entry.Next.IsZero() {
			nextRun = entry.Next.UTC().Format(time.RFC3339)
		}
	}
	if err := reconciler.WriteScheduleStatus(ctx, s.client, s.config.Namespace, scheduleName, types.NewScheduleStatus(now, nextRun, "success")); err != nil {
		return fmt.Errorf("writing status for %s: %w", scheduleName, err)
	}
	return nil
}

func patchLastActivity(ctx context.Context, client kubernetes.Interface, namespace, instanceName string) error {
	cm, err := client.CoreV1().ConfigMaps(namespace).Get(ctx, instanceName, metav1.GetOptions{})
	if err != nil {
		return err
	}
	if cm.Annotations == nil {
		cm.Annotations = make(map[string]string)
	}
	cm.Annotations["humr.ai/last-activity"] = time.Now().UTC().Format(time.RFC3339)
	_, err = client.CoreV1().ConfigMaps(namespace).Update(ctx, cm, metav1.UpdateOptions{})
	return err
}
