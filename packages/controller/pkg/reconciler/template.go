package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/onecli"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

const mcpSecretPrefix = "__humr_mcp:"

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

// Reconcile registers the template as an agent in OneCLI, stores the access token,
// and syncs MCP server secrets to the agent.
func (r *TemplateReconciler) Reconcile(ctx context.Context, cm *corev1.ConfigMap) error {
	name := cm.Name
	// Parse template spec.
	var tmpl *types.TemplateSpec
	if specYAML, ok := cm.Data["spec.yaml"]; ok {
		var err error
		tmpl, err = types.ParseTemplateSpec(specYAML)
		if err != nil {
			return fmt.Errorf("parsing template %q: %w", name, err)
		}
	}

	// Ensure agent is registered in OneCLI (one-time).
	agent, err := r.ensureAgent(ctx, cm, name, tmpl)
	if err != nil {
		return err
	}

	// Sync MCP secrets to agent (every reconcile).
	if agent != nil && tmpl != nil && len(tmpl.MCPServers) > 0 {
		if err := r.syncMCPSecrets(ctx, agent.ID, tmpl); err != nil {
			slog.Error("failed to sync MCP secrets", "template", name, "error", err)
			// Non-fatal — agent still works, just without MCP credential injection.
		}
	}

	return nil
}

// ensureAgent registers the template as an agent in OneCLI if not already done.
func (r *TemplateReconciler) ensureAgent(ctx context.Context, cm *corev1.ConfigMap, name string, tmpl *types.TemplateSpec) (*onecli.Agent, error) {
	secretName := TemplateTokenSecretName(name)
	_, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err == nil {
		// Already registered — look up the agent to get its ID for secret syncing.
		agent, err := r.onecli.CreateAgent(ctx, name, name, "selective")
		if err != nil {
			slog.Warn("cannot reach OneCLI for agent lookup, skipping MCP sync", "template", name, "error", err)
			return nil, nil
		}
		return agent, nil
	}
	if !errors.IsNotFound(err) {
		return nil, fmt.Errorf("checking token secret: %w", err)
	}

	secretMode := "selective"
	if tmpl != nil && tmpl.SecretMode != "" {
		secretMode = tmpl.SecretMode
	}

	agent, err := r.onecli.CreateAgent(ctx, name, name, secretMode)
	if err != nil {
		return nil, fmt.Errorf("registering template %q in OneCLI: %w", name, err)
	}
	slog.Info("registered template in OneCLI", "template", name, "agentID", agent.ID)

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
		return nil, fmt.Errorf("creating token secret: %w", err)
	}
	slog.Info("created template token secret", "template", name, "secret", secretName)
	return agent, nil
}

// syncMCPSecrets ensures that OneCLI secrets matching the template's HTTP MCP servers
// are linked to the template's agent. This allows the gateway to inject auth tokens
// for MCP server requests.
func (r *TemplateReconciler) syncMCPSecrets(ctx context.Context, agentID string, tmpl *types.TemplateSpec) error {
	// Collect hostnames from template's HTTP MCP servers.
	wantHosts := make(map[string]bool)
	for _, s := range tmpl.MCPServers {
		if s.Type == "http" && s.URL != "" {
			if u, err := url.Parse(s.URL); err == nil {
				wantHosts[u.Hostname()] = true
			}
		}
	}
	if len(wantHosts) == 0 {
		return nil
	}

	// List all OneCLI secrets, find __humr_mcp: ones matching wanted hosts.
	allSecrets, err := r.onecli.ListSecrets(ctx)
	if err != nil {
		return fmt.Errorf("listing secrets: %w", err)
	}

	var mcpSecretIDs []string
	for _, s := range allSecrets {
		if !strings.HasPrefix(s.Name, mcpSecretPrefix) {
			continue
		}
		hostname := strings.TrimPrefix(s.Name, mcpSecretPrefix)
		if wantHosts[hostname] {
			mcpSecretIDs = append(mcpSecretIDs, s.ID)
		}
	}

	if len(mcpSecretIDs) == 0 {
		return nil
	}

	// Get current agent secrets, merge in MCP secret IDs.
	current, err := r.onecli.GetAgentSecrets(ctx, agentID)
	if err != nil {
		return fmt.Errorf("getting agent secrets: %w", err)
	}

	// Build merged set.
	seen := make(map[string]bool, len(current))
	for _, id := range current {
		seen[id] = true
	}
	changed := false
	for _, id := range mcpSecretIDs {
		if !seen[id] {
			current = append(current, id)
			changed = true
		}
	}

	if !changed {
		return nil
	}

	if err := r.onecli.SetAgentSecrets(ctx, agentID, current); err != nil {
		return fmt.Errorf("setting agent secrets: %w", err)
	}
	slog.Info("synced MCP secrets to agent", "agentID", agentID, "mcpSecrets", len(mcpSecretIDs))
	return nil
}

// Delete removes the OneCLI agent for a template.
func (r *TemplateReconciler) Delete(ctx context.Context, name string) {
	r.onecli.DeleteAgent(ctx, name)
}
