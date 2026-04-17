package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

// Annotation keys for the Job lifecycle protocol.
const (
	AnnRunRequest = "humr.ai/run-request" // API server sets this to request a Job
	AnnActiveJob  = "humr.ai/active-job"  // Controller sets this to the running Job name
	AnnPodIP      = "humr.ai/pod-ip"      // Controller sets this when the pod is ready
)

type InstanceReconciler struct {
	client   kubernetes.Interface
	config   *config.Config
	resolver *AgentResolver
}

func NewInstanceReconciler(client kubernetes.Interface, cfg *config.Config, resolver *AgentResolver) *InstanceReconciler {
	return &InstanceReconciler{client: client, config: cfg, resolver: resolver}
}

func (r *InstanceReconciler) Reconcile(ctx context.Context, cm *corev1.ConfigMap) error {
	name := cm.Name

	specYAML, ok := cm.Data["spec.yaml"]
	if !ok {
		return r.setError(ctx, name, "no spec.yaml in ConfigMap")
	}
	instanceSpec, err := types.ParseInstanceSpec(specYAML)
	if err != nil {
		return r.setError(ctx, name, err.Error())
	}

	// Resolve agent — prefer label, fall back to spec field
	agentName := cm.Labels["humr.ai/agent"]
	if agentName == "" {
		agentName = instanceSpec.AgentName
	}
	agentCM, agentSpec, err := r.resolver.Resolve(agentName)
	if err != nil {
		return r.setError(ctx, name, err.Error())
	}

	// Ensure the instance CM has an OwnerReference to its agent CM.
	if err := r.ensureAgentOwnerReference(ctx, cm, agentCM); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("setting agent owner reference: %v", err))
	}

	// Infrastructure: PVCs + NetworkPolicy
	pvcs := BuildPVCs(name, agentSpec, r.config, cm)
	np := BuildNetworkPolicy(name, r.config, cm)

	if err := r.applyPVCs(ctx, pvcs); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying pvcs: %v", err))
	}
	if err := r.applyNetworkPolicy(ctx, np); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying networkpolicy: %v", err))
	}

	// --- Job lifecycle protocol ---
	annotations := cm.Annotations
	if annotations == nil {
		annotations = map[string]string{}
	}

	activeJobName := annotations[AnnActiveJob]
	runRequest := annotations[AnnRunRequest]

	// If there's an active Job, check its status
	if activeJobName != "" {
		job, err := r.client.BatchV1().Jobs(r.config.Namespace).Get(ctx, activeJobName, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			// Job was cleaned up (TTL) — clear annotations
			slog.Info("active job disappeared, clearing", "instance", name, "job", activeJobName)
			r.clearJobAnnotations(ctx, name)
			return WriteInstanceStatus(ctx, r.client, r.config.Namespace, name, types.NewInstanceStatus("idle", ""))
		}
		if err != nil {
			return r.setError(ctx, name, fmt.Sprintf("checking active job: %v", err))
		}

		if isJobFinished(job) {
			slog.Info("active job finished", "instance", name, "job", activeJobName)
			r.clearJobAnnotations(ctx, name)
			return WriteInstanceStatus(ctx, r.client, r.config.Namespace, name, types.NewInstanceStatus("idle", ""))
		}

		// Job is still running — update pod IP if not yet set
		if annotations[AnnPodIP] == "" {
			if ip := r.getJobPodIP(ctx, activeJobName); ip != "" {
				r.patchAnnotation(ctx, name, AnnPodIP, ip)
			}
		}
		return WriteInstanceStatus(ctx, r.client, r.config.Namespace, name, types.NewInstanceStatus("active", ""))
	}

	// If there's a run-request and no active Job, create one
	if runRequest != "" {
		slog.Info("creating job for run-request", "instance", name, "request", runRequest)

		// If a trigger payload is present, pass it as HUMR_TRIGGER env var
		var extraEnv []corev1.EnvVar
		if trigger := annotations["humr.ai/trigger"]; trigger != "" {
			extraEnv = append(extraEnv, corev1.EnvVar{Name: "HUMR_TRIGGER", Value: trigger})
		}
		job := BuildJob(name, instanceSpec, agentSpec, r.config, agentName, extraEnv)
		created, err := r.client.BatchV1().Jobs(r.config.Namespace).Create(ctx, job, metav1.CreateOptions{})
		if err != nil {
			return r.setError(ctx, name, fmt.Sprintf("creating job: %v", err))
		}

		// Write active-job annotation and clear run-request + trigger
		jobName := created.Name
		r.patchAnnotations(ctx, name, map[string]*string{
			AnnActiveJob:      &jobName,
			AnnPodIP:          nil,
			AnnRunRequest:     nil,
			"humr.ai/trigger": nil,
		})
		slog.Info("job created", "instance", name, "job", created.Name)
		return WriteInstanceStatus(ctx, r.client, r.config.Namespace, name, types.NewInstanceStatus("active", ""))
	}

	// No active job, no request — idle
	return WriteInstanceStatus(ctx, r.client, r.config.Namespace, name, types.NewInstanceStatus("idle", ""))
}

func (r *InstanceReconciler) ensureAgentOwnerReference(ctx context.Context, instanceCM, agentCM *corev1.ConfigMap) error {
	for _, ref := range instanceCM.OwnerReferences {
		if ref.UID == agentCM.UID {
			return nil
		}
	}
	desired := metav1.OwnerReference{
		APIVersion: "v1",
		Kind:       "ConfigMap",
		Name:       agentCM.Name,
		UID:        agentCM.UID,
	}
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		current, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, instanceCM.Name, metav1.GetOptions{})
		if err != nil {
			return err
		}
		for _, ref := range current.OwnerReferences {
			if ref.UID == agentCM.UID {
				return nil
			}
		}
		current.OwnerReferences = append(current.OwnerReferences, desired)
		_, err = r.client.CoreV1().ConfigMaps(r.config.Namespace).Update(ctx, current, metav1.UpdateOptions{})
		return err
	})
}

func (r *InstanceReconciler) Delete(ctx context.Context, name string) {
	// Owner references handle cascade deletion of NetworkPolicy.
	// PVCs have owner references too, but we clean them up explicitly as a safety net.
	r.deletePVCs(ctx, name)
}

func (r *InstanceReconciler) deletePVCs(ctx context.Context, instanceName string) {
	pvcs, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx,
		metav1.ListOptions{LabelSelector: "humr.ai/instance=" + instanceName},
	)
	if err != nil {
		fmt.Printf("WARN: failed to list PVCs for instance %s: %v\n", instanceName, err)
		return
	}
	for _, pvc := range pvcs.Items {
		if err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).Delete(ctx, pvc.Name, metav1.DeleteOptions{}); err != nil {
			fmt.Printf("WARN: failed to delete PVC %s for instance %s: %v\n", pvc.Name, instanceName, err)
		}
	}
}

func (r *InstanceReconciler) setError(ctx context.Context, name, msg string) error {
	WriteInstanceStatus(ctx, r.client, r.config.Namespace, name, types.NewInstanceStatus("error", msg))
	return fmt.Errorf("instance %s: %s", name, msg)
}

func (r *InstanceReconciler) applyPVCs(ctx context.Context, pvcs []*corev1.PersistentVolumeClaim) error {
	for _, pvc := range pvcs {
		_, err := r.client.CoreV1().PersistentVolumeClaims(pvc.Namespace).Get(ctx, pvc.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.CoreV1().PersistentVolumeClaims(pvc.Namespace).Create(ctx, pvc, metav1.CreateOptions{})
			if err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (r *InstanceReconciler) applyNetworkPolicy(ctx context.Context, desired *networkingv1.NetworkPolicy) error {
	_, err := r.client.NetworkingV1().NetworkPolicies(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		_, err = r.client.NetworkingV1().NetworkPolicies(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
		return err
	}
	return err
}

// getJobPodIP returns the pod IP for a Job's pod, or "" if not ready.
func (r *InstanceReconciler) getJobPodIP(ctx context.Context, jobName string) string {
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: "job-name=" + jobName,
	})
	if err != nil || len(pods.Items) == 0 {
		return ""
	}
	pod := &pods.Items[0]
	for _, c := range pod.Status.Conditions {
		if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
			return pod.Status.PodIP
		}
	}
	return ""
}

func (r *InstanceReconciler) patchAnnotation(ctx context.Context, name, key, value string) {
	r.patchAnnotations(ctx, name, map[string]*string{key: &value})
}

// patchAnnotations uses JSON merge patch. Nil values remove keys.
func (r *InstanceReconciler) patchAnnotations(ctx context.Context, name string, anns map[string]*string) {
	patch := map[string]any{"metadata": map[string]any{"annotations": anns}}
	patchBytes, err := json.Marshal(patch)
	if err != nil {
		slog.Error("marshaling annotation patch", "instance", name, "error", err)
		return
	}
	_, err = r.client.CoreV1().ConfigMaps(r.config.Namespace).Patch(
		ctx, name, k8stypes.MergePatchType, patchBytes, metav1.PatchOptions{},
	)
	if err != nil {
		slog.Error("patching annotations", "instance", name, "error", err)
	}
}

func (r *InstanceReconciler) clearJobAnnotations(ctx context.Context, name string) {
	r.patchAnnotations(ctx, name, map[string]*string{
		AnnActiveJob:       nil,
		AnnPodIP:           nil,
		AnnRunRequest:      nil,
		"humr.ai/trigger":  nil,
	})
}

func isJobFinished(job *batchv1.Job) bool {
	for _, c := range job.Status.Conditions {
		if (c.Type == batchv1.JobComplete || c.Type == batchv1.JobFailed) && c.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}
