package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"
	"gopkg.in/yaml.v3"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/onecli"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

const ForkPodReadyTimeout = 120 * time.Second

type ForkReconciler struct {
	client   kubernetes.Interface
	config   *config.Config
	resolver *AgentResolver
	factory  onecli.Factory
	now      func() time.Time
}

func NewForkReconciler(client kubernetes.Interface, cfg *config.Config, resolver *AgentResolver, factory onecli.Factory) *ForkReconciler {
	return &ForkReconciler{client: client, config: cfg, resolver: resolver, factory: factory, now: time.Now}
}

func (r *ForkReconciler) Reconcile(ctx context.Context, cm *corev1.ConfigMap) error {
	forkName := cm.Name

	currentPhase := readForkPhase(cm)
	if currentPhase == types.ForkPhaseFailed || currentPhase == types.ForkPhaseCompleted {
		return nil
	}

	specYAML, ok := cm.Data["spec.yaml"]
	if !ok {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, "no spec.yaml in ConfigMap")
	}
	forkSpec, err := types.ParseForkSpec(specYAML)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, err.Error())
	}

	instanceCM, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, forkSpec.Instance, metav1.GetOptions{})
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("instance %q not found: %v", forkSpec.Instance, err))
	}
	instanceSpecYAML, ok := instanceCM.Data["spec.yaml"]
	if !ok {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("instance %q has no spec.yaml", forkSpec.Instance))
	}
	instanceSpec, err := types.ParseInstanceSpec(instanceSpecYAML)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("parsing instance %q: %v", forkSpec.Instance, err))
	}

	agentName := instanceCM.Labels["humr.ai/agent"]
	if agentName == "" {
		agentName = instanceSpec.AgentName
	}
	_, agentSpec, err := r.resolver.Resolve(agentName)
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, err.Error())
	}

	connectorEnvs := r.collectForeignConnectorEnvs(ctx, forkSpec.ForkAgentIdentifier, forkSpec.ForeignSub)

	desired := BuildForkJob(forkName, forkSpec, instanceSpec, agentSpec, r.config, cm, connectorEnvs)

	if err := r.applyForkJob(ctx, desired); err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("applying job: %v", err))
	}

	job, err := r.client.BatchV1().Jobs(r.config.Namespace).Get(ctx, forkName, metav1.GetOptions{})
	if err != nil {
		return r.setForkFailed(ctx, forkName, types.ForkReasonOrchestrationFailed, fmt.Sprintf("reading job: %v", err))
	}

	if isJobFailed(job) {
		return r.setForkFailed(ctx, forkName, types.ForkReasonPodNotReady, jobFailureReason(job))
	}

	pod, _ := r.findForkPod(ctx, forkName)
	if pod != nil && isPodReady(*pod) && pod.Status.PodIP != "" {
		return WriteForkStatus(ctx, r.client, r.config.Namespace, forkName,
			types.NewForkStatus(types.ForkPhaseReady, forkName, pod.Status.PodIP, nil))
	}

	if age := r.now().Sub(cm.CreationTimestamp.Time); age > ForkPodReadyTimeout {
		return r.setForkFailed(ctx, forkName, types.ForkReasonTimeout,
			fmt.Sprintf("pod not Ready after %s", ForkPodReadyTimeout))
	}

	if currentPhase == "" {
		return WriteForkStatus(ctx, r.client, r.config.Namespace, forkName,
			types.NewForkStatus(types.ForkPhasePending, forkName, "", nil))
	}
	return nil
}

func (r *ForkReconciler) Delete(_ context.Context, name string) {
	slog.Info("fork configmap deleted; job is GC'd via owner reference", "fork", name)
}

func (r *ForkReconciler) setForkFailed(ctx context.Context, name, reason, detail string) error {
	status := types.NewForkStatus(types.ForkPhaseFailed, "", "", &types.ForkError{Reason: reason, Detail: detail})
	if err := WriteForkStatus(ctx, r.client, r.config.Namespace, name, status); err != nil {
		slog.Error("writing fork failed status", "fork", name, "error", err)
	}
	return fmt.Errorf("fork %s: %s: %s", name, reason, detail)
}

func (r *ForkReconciler) applyForkJob(ctx context.Context, desired *batchv1.Job) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		_, err := r.client.BatchV1().Jobs(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.BatchV1().Jobs(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		return err
	})
}

func (r *ForkReconciler) findForkPod(ctx context.Context, forkName string) (*corev1.Pod, error) {
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: fmt.Sprintf("%s=%s", ForkLabelForkID, forkName),
	})
	if err != nil {
		return nil, err
	}
	for i := range pods.Items {
		p := pods.Items[i]
		if p.DeletionTimestamp == nil {
			return &p, nil
		}
	}
	return nil, nil
}

func (r *ForkReconciler) collectForeignConnectorEnvs(ctx context.Context, forkAgentIdentifier, foreignSub string) []corev1.EnvVar {
	if r.factory == nil {
		return nil
	}
	oc, err := r.factory.ClientForOwner(ctx, foreignSub)
	if err != nil {
		slog.Warn("could not get OneCLI client for foreign user; skipping connector envs", "forkAgent", forkAgentIdentifier, "sub", foreignSub, "error", err)
		return nil
	}
	secrets, err := oc.ListSecretsForAgent(ctx, forkAgentIdentifier)
	if err != nil {
		slog.Warn("could not list secrets for fork agent under foreign user; skipping connector envs", "forkAgent", forkAgentIdentifier, "sub", foreignSub, "error", err)
		return nil
	}
	return envMappingsToEnvVars(secrets)
}

func readForkPhase(cm *corev1.ConfigMap) string {
	statusYAML, ok := cm.Data["status.yaml"]
	if !ok {
		return ""
	}
	var s types.ForkStatus
	if err := yaml.Unmarshal([]byte(statusYAML), &s); err != nil {
		return ""
	}
	return s.Phase
}

func isPodReady(pod corev1.Pod) bool {
	for _, c := range pod.Status.Conditions {
		if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

func isJobFailed(job *batchv1.Job) bool {
	for _, c := range job.Status.Conditions {
		if c.Type == batchv1.JobFailed && c.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

func jobFailureReason(job *batchv1.Job) string {
	for _, c := range job.Status.Conditions {
		if c.Type == batchv1.JobFailed && c.Status == corev1.ConditionTrue {
			if c.Message != "" {
				return c.Message
			}
			return c.Reason
		}
	}
	return "job failed"
}
