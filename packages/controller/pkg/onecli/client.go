package onecli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

type Client interface {
	CreateAgent(ctx context.Context, name, identifier, secretMode string) (*Agent, error)
	DeleteAgent(ctx context.Context, identifier string) error
	CreateSecret(ctx context.Context, input CreateSecretInput) (*Secret, error)
	DeleteSecret(ctx context.Context, id string) error
	ListSecrets(ctx context.Context) ([]Secret, error)
	GetAgentSecrets(ctx context.Context, agentID string) ([]string, error)
	SetAgentSecrets(ctx context.Context, agentID string, secretIDs []string) error
	// ListSecretsForAgent returns the secrets an agent has access to. For
	// agents with secretMode="all", this is every secret in the account; for
	// "selective", only the explicitly granted ones.
	ListSecretsForAgent(ctx context.Context, identifier string) ([]Secret, error)
}

type Agent struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Identifier  string `json:"identifier"`
	AccessToken string `json:"accessToken"`
	SecretMode  string `json:"secretMode"`
}

type Secret struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Type        string          `json:"type"`
	HostPattern string          `json:"hostPattern"`
	Metadata    *SecretMetadata `json:"metadata,omitempty"`
}

type InjectionConfig struct {
	HeaderName  string `json:"headerName"`
	ValueFormat string `json:"valueFormat,omitempty"`
}

// DefaultEnvPlaceholder is the literal value that OneCLI's gateway recognizes
// and swaps for the real credential on matching outbound requests.
const DefaultEnvPlaceholder = "humr:sentinel"

// EnvMapping declares a pod env var to inject for any instance with access to
// this secret.
type EnvMapping struct {
	EnvName     string `json:"envName"`
	Placeholder string `json:"placeholder"`
}

// SecretMetadata is the type-specific metadata OneCLI stores alongside a
// secret. Client-settable keys: EnvMappings. Server-owned keys: AuthMode
// (anthropic only).
type SecretMetadata struct {
	AuthMode    string       `json:"authMode,omitempty"`
	EnvMappings []EnvMapping `json:"envMappings,omitempty"`
}

type CreateSecretInput struct {
	Name            string           `json:"name"`
	Type            string           `json:"type"`
	Value           string           `json:"value"`
	HostPattern     string           `json:"hostPattern"`
	InjectionConfig *InjectionConfig `json:"injectionConfig,omitempty"`
	Metadata        *SecretMetadata  `json:"metadata,omitempty"`
}

type httpClient struct {
	baseURL string
	apiKey  string
	http    *http.Client
	mu      sync.Mutex
}

// NewHTTPClient creates a client. If apiKey is empty, it will be fetched
// from OneCLI on first use — so the controller can start before OneCLI is ready.
func NewHTTPClient(baseURL, apiKey string) Client {
	return &httpClient{baseURL: baseURL, apiKey: apiKey, http: &http.Client{Timeout: 10 * time.Second}}
}

func (c *httpClient) ensureAPIKey(ctx context.Context) error {
	if c.apiKey != "" {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.apiKey != "" {
		return nil // fetched by another goroutine
	}
	key, err := fetchAPIKey(ctx, c.http, c.baseURL)
	if err != nil {
		return fmt.Errorf("OneCLI not ready: %w", err)
	}
	c.apiKey = key
	return nil
}

// FetchAPIKey retrieves the API key from the OneCLI web API (uses http.DefaultClient).
// The /api/user/api-key endpoint requires no authentication.
func FetchAPIKey(ctx context.Context, baseURL string) (string, error) {
	return fetchAPIKey(ctx, http.DefaultClient, baseURL)
}

func fetchAPIKey(ctx context.Context, client *http.Client, baseURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", baseURL+"/api/user/api-key", nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetching API key: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("fetching API key: status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		APIKey string `json:"apiKey"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding API key response: %w", err)
	}
	return result.APIKey, nil
}

func (c *httpClient) CreateAgent(ctx context.Context, name, identifier, secretMode string) (*Agent, error) {
	if err := c.ensureAPIKey(ctx); err != nil {
		return nil, err
	}
	body, _ := json.Marshal(map[string]string{"name": name, "identifier": identifier})
	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/api/agents", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("creating agent: %w", err)
	}
	defer resp.Body.Close()

	// 409 = agent with this identifier already exists — find it in the list.
	if resp.StatusCode == http.StatusConflict {
		return c.findAgentByIdentifier(ctx, identifier)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("creating agent: status %d: %s", resp.StatusCode, string(respBody))
	}

	var created Agent
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		return nil, fmt.Errorf("decoding agent response: %w", err)
	}

	// Set secret mode — POST doesn't accept this field.
	if err := c.setSecretMode(ctx, created.ID, secretMode); err != nil {
		return nil, fmt.Errorf("setting secret mode: %w", err)
	}

	// POST response doesn't include the access token — fetch via list.
	return c.findAgentByID(ctx, created.ID)
}

func (c *httpClient) setSecretMode(ctx context.Context, agentID, mode string) error {
	body, _ := json.Marshal(map[string]string{"mode": mode})
	req, err := http.NewRequestWithContext(ctx, "PATCH", c.baseURL+"/api/agents/"+agentID+"/secret-mode", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("PATCH secret-mode: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("PATCH secret-mode: status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

func (c *httpClient) listAgents(ctx context.Context) ([]Agent, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/api/agents", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("listing agents: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("listing agents: status %d: %s", resp.StatusCode, string(respBody))
	}

	var agents []Agent
	if err := json.NewDecoder(resp.Body).Decode(&agents); err != nil {
		return nil, fmt.Errorf("decoding agents list: %w", err)
	}
	return agents, nil
}

func (c *httpClient) findAgentByID(ctx context.Context, agentID string) (*Agent, error) {
	agents, err := c.listAgents(ctx)
	if err != nil {
		return nil, err
	}
	for _, a := range agents {
		if a.ID == agentID {
			return &a, nil
		}
	}
	return nil, fmt.Errorf("agent %s not found", agentID)
}

func (c *httpClient) findAgentByIdentifier(ctx context.Context, identifier string) (*Agent, error) {
	agents, err := c.listAgents(ctx)
	if err != nil {
		return nil, err
	}
	for _, a := range agents {
		if a.Identifier == identifier {
			return &a, nil
		}
	}
	return nil, fmt.Errorf("agent with identifier %q not found", identifier)
}

// DeleteAgent deletes an agent by identifier (looks up the UUID first).
func (c *httpClient) DeleteAgent(ctx context.Context, identifier string) error {
	if err := c.ensureAPIKey(ctx); err != nil {
		return err
	}
	agent, err := c.findAgentByIdentifier(ctx, identifier)
	if err != nil {
		return nil // agent doesn't exist, nothing to delete
	}

	req, err := http.NewRequestWithContext(ctx, "DELETE", c.baseURL+"/api/agents/"+agent.ID, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("deleting agent: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusOK {
		return nil
	}
	respBody, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("deleting agent: status %d: %s", resp.StatusCode, string(respBody))
}

func (c *httpClient) CreateSecret(ctx context.Context, input CreateSecretInput) (*Secret, error) {
	if err := c.ensureAPIKey(ctx); err != nil {
		return nil, err
	}
	body, _ := json.Marshal(input)
	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/api/secrets", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("creating secret: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("creating secret: status %d: %s", resp.StatusCode, string(respBody))
	}

	var created Secret
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		return nil, fmt.Errorf("decoding secret response: %w", err)
	}
	return &created, nil
}

func (c *httpClient) DeleteSecret(ctx context.Context, id string) error {
	if err := c.ensureAPIKey(ctx); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "DELETE", c.baseURL+"/api/secrets/"+id, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("deleting secret: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNotFound {
		return nil
	}
	respBody, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("deleting secret: status %d: %s", resp.StatusCode, string(respBody))
}

func (c *httpClient) ListSecrets(ctx context.Context) ([]Secret, error) {
	if err := c.ensureAPIKey(ctx); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/api/secrets", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("listing secrets: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("listing secrets: status %d: %s", resp.StatusCode, string(respBody))
	}

	var secrets []Secret
	if err := json.NewDecoder(resp.Body).Decode(&secrets); err != nil {
		return nil, fmt.Errorf("decoding secrets list: %w", err)
	}
	return secrets, nil
}

func (c *httpClient) GetAgentSecrets(ctx context.Context, agentID string) ([]string, error) {
	if err := c.ensureAPIKey(ctx); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/api/agents/"+agentID+"/secrets", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("getting agent secrets: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("getting agent secrets: status %d: %s", resp.StatusCode, string(respBody))
	}

	var ids []string
	if err := json.NewDecoder(resp.Body).Decode(&ids); err != nil {
		return nil, fmt.Errorf("decoding agent secrets: %w", err)
	}
	return ids, nil
}

func (c *httpClient) ListSecretsForAgent(ctx context.Context, identifier string) ([]Secret, error) {
	if err := c.ensureAPIKey(ctx); err != nil {
		return nil, err
	}
	agent, err := c.findAgentByIdentifier(ctx, identifier)
	if err != nil {
		return nil, err
	}
	allSecrets, err := c.ListSecrets(ctx)
	if err != nil {
		return nil, err
	}
	if agent.SecretMode == "all" {
		return allSecrets, nil
	}
	grantedIDs, err := c.GetAgentSecrets(ctx, agent.ID)
	if err != nil {
		return nil, err
	}
	grant := make(map[string]struct{}, len(grantedIDs))
	for _, id := range grantedIDs {
		grant[id] = struct{}{}
	}
	filtered := make([]Secret, 0, len(grantedIDs))
	for _, s := range allSecrets {
		if _, ok := grant[s.ID]; ok {
			filtered = append(filtered, s)
		}
	}
	return filtered, nil
}

func (c *httpClient) SetAgentSecrets(ctx context.Context, agentID string, secretIDs []string) error {
	if err := c.ensureAPIKey(ctx); err != nil {
		return err
	}
	body, _ := json.Marshal(map[string][]string{"secretIds": secretIDs})
	req, err := http.NewRequestWithContext(ctx, "PUT", c.baseURL+"/api/agents/"+agentID+"/secrets", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("setting agent secrets: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("setting agent secrets: status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// NoopClient does nothing — used when OneCLI is not configured.
type NoopClient struct{}

func (n *NoopClient) CreateAgent(_ context.Context, name, _, secretMode string) (*Agent, error) {
	return &Agent{ID: "noop", Name: name, SecretMode: secretMode}, nil
}

func (n *NoopClient) DeleteAgent(_ context.Context, _ string) error { return nil }

func (n *NoopClient) CreateSecret(_ context.Context, _ CreateSecretInput) (*Secret, error) {
	return &Secret{ID: "noop"}, nil
}

func (n *NoopClient) DeleteSecret(_ context.Context, _ string) error { return nil }

func (n *NoopClient) ListSecrets(_ context.Context) ([]Secret, error) { return nil, nil }

func (n *NoopClient) GetAgentSecrets(_ context.Context, _ string) ([]string, error) {
	return nil, nil
}

func (n *NoopClient) SetAgentSecrets(_ context.Context, _ string, _ []string) error { return nil }

func (n *NoopClient) ListSecretsForAgent(_ context.Context, _ string) ([]Secret, error) {
	return nil, nil
}
