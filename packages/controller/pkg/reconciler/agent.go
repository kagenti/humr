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

// AgentGetter abstracts how agents are looked up — informer lister in prod, map in tests.
type AgentGetter interface {
	Get(name string) (*corev1.ConfigMap, error)
}

type AgentResolver struct {
	getter AgentGetter
}

func NewAgentResolver(getter AgentGetter) *AgentResolver {
	return &AgentResolver{getter: getter}
}

func (r *AgentResolver) Resolve(name string) (*types.AgentSpec, error) {
	cm, err := r.getter.Get(name)
	if err != nil {
		return nil, fmt.Errorf("agent %q not found: %w", name, err)
	}
	specYAML, ok := cm.Data["spec.yaml"]
	if !ok {
		return nil, fmt.Errorf("agent %q has no spec.yaml", name)
	}
	return types.ParseAgentSpec(specYAML)
}

// AgentTokenSecretName returns the K8s Secret name that stores the OneCLI access token for an agent.
func AgentTokenSecretName(agentName string) string {
	return "humr-agent-" + agentName + "-token"
}

// AgentReconciler registers agents in OneCLI and stores their access tokens.
type AgentReconciler struct {
	client  kubernetes.Interface
	config  *config.Config
	factory onecli.Factory
}

func NewAgentReconciler(client kubernetes.Interface, cfg *config.Config, factory onecli.Factory) *AgentReconciler {
	return &AgentReconciler{client: client, config: cfg, factory: factory}
}

// Reconcile registers the agent in OneCLI, stores the access token,
// and syncs MCP server secrets to the agent.
func (r *AgentReconciler) Reconcile(ctx context.Context, cm *corev1.ConfigMap) error {
	name := cm.Name
	owner := cm.Labels["humr.ai/owner"]
	if owner == "" {
		return fmt.Errorf("agent %q has no humr.ai/owner label", name)
	}

	oc, err := r.factory.ClientForOwner(ctx, owner)
	if err != nil {
		return fmt.Errorf("getting OneCLI client for owner %q: %w", owner, err)
	}

	var agentSpec *types.AgentSpec
	if specYAML, ok := cm.Data["spec.yaml"]; ok {
		agentSpec, err = types.ParseAgentSpec(specYAML)
		if err != nil {
			return fmt.Errorf("parsing agent %q: %w", name, err)
		}
	}

	// Ensure agent is registered in OneCLI (one-time).
	agent, err := r.ensureAgent(ctx, cm, name, agentSpec, oc)
	if err != nil {
		return err
	}

	// Sync MCP secrets to agent (every reconcile).
	if agent != nil && agentSpec != nil && len(agentSpec.MCPServers) > 0 {
		if err := r.syncMCPSecrets(ctx, agent.ID, agentSpec, oc); err != nil {
			slog.Error("failed to sync MCP secrets", "agent", name, "error", err)
			// Non-fatal — agent still works, just without MCP credential injection.
		}
	}

	return nil
}

// ensureAgent registers the agent in OneCLI if not already done.
func (r *AgentReconciler) ensureAgent(ctx context.Context, cm *corev1.ConfigMap, name string, agentSpec *types.AgentSpec, oc onecli.Client) (*onecli.Agent, error) {
	displayName := name
	if agentSpec != nil && agentSpec.Name != "" {
		displayName = agentSpec.Name
	}

	secretName := AgentTokenSecretName(name)
	_, err := r.client.CoreV1().Secrets(r.config.Namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err == nil {
		// Already registered — look up the agent to get its ID for secret syncing.
		agent, err := oc.CreateAgent(ctx, displayName, name, "selective")
		if err != nil {
			slog.Warn("cannot reach OneCLI for agent lookup, skipping MCP sync", "agent", name, "error", err)
			return nil, nil
		}
		return agent, nil
	}
	if !errors.IsNotFound(err) {
		return nil, fmt.Errorf("checking token secret: %w", err)
	}

	secretMode := "selective"
	if agentSpec != nil && agentSpec.SecretMode != "" {
		secretMode = agentSpec.SecretMode
	}

	agent, err := oc.CreateAgent(ctx, displayName, name, secretMode)
	if err != nil {
		return nil, fmt.Errorf("registering agent %q in OneCLI: %w", name, err)
	}
	slog.Info("registered agent in OneCLI", "agent", name, "agentID", agent.ID)

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      secretName,
			Namespace: r.config.Namespace,
			Labels: map[string]string{
				"humr.ai/type":  "agent-token",
				"humr.ai/agent": name,
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
	slog.Info("created agent token secret", "agent", name, "secret", secretName)
	return agent, nil
}

// syncMCPSecrets ensures that OneCLI secrets matching the agent's HTTP MCP servers
// are linked to the agent. This allows the gateway to inject auth tokens
// for MCP server requests.
func (r *AgentReconciler) syncMCPSecrets(ctx context.Context, agentID string, agentSpec *types.AgentSpec, oc onecli.Client) error {
	// Collect hostnames from agent's HTTP MCP servers.
	wantHosts := make(map[string]bool)
	for _, s := range agentSpec.MCPServers {
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
	allSecrets, err := oc.ListSecrets(ctx)
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
	current, err := oc.GetAgentSecrets(ctx, agentID)
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

	if err := oc.SetAgentSecrets(ctx, agentID, current); err != nil {
		return fmt.Errorf("setting agent secrets: %w", err)
	}
	slog.Info("synced MCP secrets to agent", "agentID", agentID, "mcpSecrets", len(mcpSecretIDs))
	return nil
}

// Delete removes the OneCLI agent for the given owner.
func (r *AgentReconciler) Delete(ctx context.Context, name string, owner string) {
	if owner == "" {
		slog.Warn("cannot delete OneCLI agent: no owner", "agent", name)
		return
	}
	oc, err := r.factory.ClientForOwner(ctx, owner)
	if err != nil {
		slog.Error("cannot get OneCLI client for delete", "agent", name, "owner", owner, "error", err)
		return
	}
	oc.DeleteAgent(ctx, name)
}
