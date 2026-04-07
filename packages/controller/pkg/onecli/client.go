package onecli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type Client interface {
	CreateAgent(ctx context.Context, name, identifier, secretMode string) (*Agent, error)
	DeleteAgent(ctx context.Context, identifier string) error
}

type Agent struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Identifier  string `json:"identifier"`
	AccessToken string `json:"accessToken"`
	SecretMode  string `json:"secretMode"`
}

type httpClient struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func NewHTTPClient(baseURL, apiKey string) Client {
	return &httpClient{baseURL: baseURL, apiKey: apiKey, http: &http.Client{}}
}

// FetchAPIKey retrieves the API key from the OneCLI web API.
// The /api/user/api-key endpoint requires no authentication.
func FetchAPIKey(ctx context.Context, baseURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", baseURL+"/api/user/api-key", nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
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

// NoopClient does nothing — used when OneCLI is not configured.
type NoopClient struct{}

func (n *NoopClient) CreateAgent(_ context.Context, name, _, secretMode string) (*Agent, error) {
	return &Agent{ID: "noop", Name: name, SecretMode: secretMode}, nil
}

func (n *NoopClient) DeleteAgent(_ context.Context, _ string) error { return nil }
