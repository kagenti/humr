package reconciler

import (
	"context"
	"fmt"

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
	// agent is removed.
	if err := r.ensureAgentOwnerReference(ctx, cm, agentCM); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("setting agent owner reference: %v", err))
	}

	// Build desired resources — PVCs + NetworkPolicy only.
	// Jobs are created on demand by the API server, not by the controller.
	pvcs := BuildPVCs(name, agentSpec, r.config, cm)
	np := BuildNetworkPolicy(name, r.config, cm)

	if err := r.applyPVCs(ctx, pvcs); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying pvcs: %v", err))
	}
	if err := r.applyNetworkPolicy(ctx, np); err != nil {
		return r.setError(ctx, name, fmt.Sprintf("applying networkpolicy: %v", err))
	}

	return WriteInstanceStatus(ctx, r.client, r.config.Namespace, name, types.NewInstanceStatus("idle", ""))
}

// ensureAgentOwnerReference adds a non-controller OwnerReference from the
// instance CM to the agent CM if one is not already present. This lets K8s
// garbage collection cascade-delete instances when their agent is removed.
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
	// PVCs have owner references too, but we clean them up explicitly
	// as a safety net (same as before).
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

// applyPVCs creates PVCs if they don't already exist. Idempotent.
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
		// PVC already exists — nothing to update (PVC specs are immutable)
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
