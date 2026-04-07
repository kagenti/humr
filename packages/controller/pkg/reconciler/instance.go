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

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

type InstanceReconciler struct {
	client   kubernetes.Interface
	config   *config.Config
	resolver *TemplateResolver
}

func NewInstanceReconciler(client kubernetes.Interface, cfg *config.Config, resolver *TemplateResolver) *InstanceReconciler {
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

	// Resolve template — prefer label, fall back to spec field
	templateName := cm.Labels["humr.ai/template"]
	if templateName == "" {
		templateName = instanceSpec.TemplateName
	}
	tmplSpec, err := r.resolver.Resolve(templateName)
	if err != nil {
		return r.setError(ctx, name, err.Error())
	}

	// Build desired resources
	ss := BuildStatefulSet(name, instanceSpec, tmplSpec, r.config, templateName, cm)
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

func (r *InstanceReconciler) Delete(_ context.Context, _ string) {
	// Owner references handle cascade deletion of StatefulSet, Service, NetworkPolicy.
	// OneCLI agent cleanup is handled by TemplateReconciler.
}

func (r *InstanceReconciler) setError(ctx context.Context, name, msg string) error {
	WriteInstanceStatus(ctx, r.client, r.config.Namespace, name, types.NewInstanceStatus("error", msg))
	return fmt.Errorf("instance %s: %s", name, msg)
}

func (r *InstanceReconciler) applyStatefulSet(ctx context.Context, desired *appsv1.StatefulSet) error {
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
