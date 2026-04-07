package reconciler

import (
	"context"
	"fmt"
	"log/slog"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/onecli"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

// TemplateGetter abstracts how templates are looked up — informer lister in prod, map in tests.
type TemplateGetter interface {
	Get(name string) (*corev1.ConfigMap, error)
}

type TemplateResolver struct {
	getter TemplateGetter
}

func NewTemplateResolver(getter TemplateGetter) *TemplateResolver {
	return &TemplateResolver{getter: getter}
}

func (r *TemplateResolver) Resolve(name string) (*types.TemplateSpec, error) {
	cm, err := r.getter.Get(name)
	if err != nil {
		return nil, fmt.Errorf("template %q not found: %w", name, err)
	}
	specYAML, ok := cm.Data["spec.yaml"]
	if !ok {
		return nil, fmt.Errorf("template %q has no spec.yaml", name)
	}
	return types.ParseTemplateSpec(specYAML)
}

// TemplateTokenSecretName returns the K8s Secret name that stores the OneCLI access token for a template.
func TemplateTokenSecretName(templateName string) string {
	return "humr-template-" + templateName + "-token"
}

// TemplateReconciler registers templates as agents in OneCLI and stores their access tokens.
type TemplateReconciler struct {
	client kubernetes.Interface
	config *config.Config
	onecli onecli.Client
}

func NewTemplateReconciler(client kubernetes.Interface, cfg *config.Config, oc onecli.Client) *TemplateReconciler {
	return &TemplateReconciler{client: client, config: cfg, onecli: oc}
}

// Reconcile registers the template as an agent in OneCLI and stores the access token in a Secret.
func (r *TemplateReconciler) Reconcile(ctx context.Context, cm *corev1.ConfigMap) error {
	name := cm.Name

	// Check if token Secret already exists — if so, the agent is already registered.
	secretName := TemplateTokenSecretName(name)
	_, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err == nil {
		return nil // already registered
	}
	if !errors.IsNotFound(err) {
		return fmt.Errorf("checking token secret: %w", err)
	}

	// Parse template spec to get secretMode.
	secretMode := "selective"
	if specYAML, ok := cm.Data["spec.yaml"]; ok {
		if tmpl, err := types.ParseTemplateSpec(specYAML); err == nil && tmpl.SecretMode != "" {
			secretMode = tmpl.SecretMode
		}
	}

	// Register template as agent in OneCLI.
	agent, err := r.onecli.CreateAgent(ctx, name, name, secretMode)
	if err != nil {
		return fmt.Errorf("registering template %q in OneCLI: %w", name, err)
	}
	slog.Info("registered template in OneCLI", "template", name, "agentID", agent.ID)

	// Store the access token in a Secret so instance pods can use it for proxy auth.
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      secretName,
			Namespace: r.config.Namespace,
			Labels: map[string]string{
				"humr.ai/type":     "template-token",
				"humr.ai/template": name,
			},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(cm, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Type: corev1.SecretTypeOpaque,
		StringData: map[string]string{
			"access-token": agent.AccessToken,
		},
	}
	if _, err := r.client.CoreV1().Secrets(r.config.Namespace).Create(ctx, secret, metav1.CreateOptions{}); err != nil {
		return fmt.Errorf("creating token secret: %w", err)
	}
	slog.Info("created template token secret", "template", name, "secret", secretName)
	return nil
}

// Delete removes the OneCLI agent for a template.
func (r *TemplateReconciler) Delete(ctx context.Context, name string) {
	r.onecli.DeleteAgent(ctx, name)
}
