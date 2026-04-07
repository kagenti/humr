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
	CreateAgent(ctx context.Context, name, identifier string) (*Agent, error)
	DeleteAgent(ctx context.Context, agentID string) error
}

type Agent struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Identifier  string `json:"identifier"`
	AccessToken string `json:"accessToken"`
}

type httpClient struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func NewHTTPClient(baseURL, apiKey string) Client {
	return &httpClient{baseURL: baseURL, apiKey: apiKey, http: &http.Client{}}
}

func (c *httpClient) CreateAgent(ctx context.Context, name, identifier string) (*Agent, error) {
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

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("creating agent: status %d: %s", resp.StatusCode, string(respBody))
	}

	var agent Agent
	if err := json.NewDecoder(resp.Body).Decode(&agent); err != nil {
		return nil, fmt.Errorf("decoding agent response: %w", err)
	}
	return &agent, nil
}

func (c *httpClient) DeleteAgent(ctx context.Context, agentID string) error {
	req, err := http.NewRequestWithContext(ctx, "DELETE", c.baseURL+"/api/agents/"+agentID, nil)
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

func (n *NoopClient) CreateAgent(_ context.Context, name, _ string) (*Agent, error) {
	return &Agent{ID: "noop", Name: name}, nil
}

func (n *NoopClient) DeleteAgent(_ context.Context, _ string) error { return nil }
