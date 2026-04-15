package reconciler

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/types"
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

	// Ensure the instance CM has an OwnerReference to its agent CM so that
	// K8s garbage collection cascade-deletes orphaned instances when the
	// agent is removed. Idempotent — skips if already set.
	if err := r.ensureAgentOwnerReference(ctx, cm, agentCM); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("setting agent owner reference: %v", err))
	}

	// Build desired resources
	ss := BuildStatefulSet(name, instanceSpec, agentSpec, r.config, agentName, cm)
	svc := BuildService(name, r.config, cm)
	np := BuildNetworkPolicy(name, r.config, cm)

	if err := r.applyStatefulSet(ctx, ss); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying statefulset: %v", err))
	}
	if err := r.applyService(ctx, svc); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying service: %v", err))
	}
	if err := r.applyNetworkPolicy(ctx, np); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying networkpolicy: %v", err))
	}

	state := instanceSpec.DesiredState
	if state == "" {
		state = "running"
	}
	return WriteInstanceStatus(ctx, r.client, r.config.Namespace, name, types.NewInstanceStatus(state, ""))
}

// ensureAgentOwnerReference adds a non-controller OwnerReference from the
// instance CM to the agent CM if one is not already present. This lets K8s
// garbage collection cascade-delete instances when their agent is removed.
// It is safe to leave BlockOwnerDeletion=false and Controller=false — other
// OwnerReferences on the instance CM (if any) are preserved.
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
	// Owner references handle cascade deletion of StatefulSet, Service, NetworkPolicy.
	// OneCLI agent cleanup is handled by AgentReconciler.
	//
	// PVCs created via VolumeClaimTemplates are intentionally NOT deleted by
	// Kubernetes when the StatefulSet is removed (to prevent data loss).
	// We clean them up explicitly on instance removal.
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

func (r *InstanceReconciler) applyStatefulSet(ctx context.Context, desired *appsv1.StatefulSet) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := r.client.AppsV1().StatefulSets(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.AppsV1().StatefulSets(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		existing.Spec.Replicas = desired.Spec.Replicas
		existing.Spec.Template = desired.Spec.Template
		_, err = r.client.AppsV1().StatefulSets(desired.Namespace).Update(ctx, existing, metav1.UpdateOptions{})
		return err
	})
}

func (r *InstanceReconciler) applyService(ctx context.Context, desired *corev1.Service) error {
	_, err := r.client.CoreV1().Services(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		_, err = r.client.CoreV1().Services(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
		return err
	}
	return err
}

func (r *InstanceReconciler) applyNetworkPolicy(ctx context.Context, desired *networkingv1.NetworkPolicy) error {
	_, err := r.client.NetworkingV1().NetworkPolicies(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		_, err = r.client.NetworkingV1().NetworkPolicies(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
		return err
	}
	return err
}
