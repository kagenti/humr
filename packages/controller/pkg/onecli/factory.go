package onecli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Factory creates per-user OneCLI Clients via Keycloak token exchange (impersonation).
type Factory interface {
	ClientForOwner(ctx context.Context, owner string) (Client, error)
}

// TokenExchangeConfig holds configuration for the Keycloak token exchange factory.
type TokenExchangeConfig struct {
	OneCLIBaseURL    string
	KeycloakTokenURL string // e.g. http://humr-keycloak:8080/realms/humr/protocol/openid-connect/token
	ClientID         string // e.g. humr-controller
	ClientSecret     string
	OneCLIAudience   string // e.g. onecli
}

type cachedToken struct {
	accessToken string
	expiresAt   time.Time
}

// TokenExchangeFactory creates per-user OneCLI clients by exchanging Keycloak
// service account credentials for user-scoped tokens via RFC 8693 impersonation.
type TokenExchangeFactory struct {
	config TokenExchangeConfig
	http   *http.Client

	mu    sync.RWMutex
	cache map[string]cachedToken
}

func NewTokenExchangeFactory(cfg TokenExchangeConfig) *TokenExchangeFactory {
	return &TokenExchangeFactory{
		config: cfg,
		http:   &http.Client{Timeout: 10 * time.Second},
		cache:  make(map[string]cachedToken),
	}
}

const tokenMargin = 30 * time.Second

// getServiceAccountToken obtains a token for the controller's service account via client_credentials.
func (f *TokenExchangeFactory) getServiceAccountToken(ctx context.Context) (string, error) {
	f.mu.RLock()
	if ct, ok := f.cache["__service_account__"]; ok && time.Now().Before(ct.expiresAt.Add(-tokenMargin)) {
		f.mu.RUnlock()
		return ct.accessToken, nil
	}
	f.mu.RUnlock()

	params := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {f.config.ClientID},
		"client_secret": {f.config.ClientSecret},
	}

	token, expiresIn, err := f.postToken(ctx, params)
	if err != nil {
		return "", fmt.Errorf("service account token: %w", err)
	}

	f.mu.Lock()
	f.cache["__service_account__"] = cachedToken{accessToken: token, expiresAt: time.Now().Add(expiresIn)}
	f.mu.Unlock()

	return token, nil
}

// exchangeToken performs a two-step token exchange:
// 1. Get service account token via client_credentials
// 2. Exchange it for a user-scoped token via RFC 8693 with requested_subject (impersonation)
func (f *TokenExchangeFactory) exchangeToken(ctx context.Context, owner string) (string, error) {
	// Check cache (read lock).
	f.mu.RLock()
	if ct, ok := f.cache[owner]; ok && time.Now().Before(ct.expiresAt.Add(-tokenMargin)) {
		f.mu.RUnlock()
		return ct.accessToken, nil
	}
	f.mu.RUnlock()

	// Step 1: get service account token.
	saToken, err := f.getServiceAccountToken(ctx)
	if err != nil {
		return "", err
	}

	// Step 2: exchange with impersonation.
	params := url.Values{
		"grant_type":           {"urn:ietf:params:oauth:grant-type:token-exchange"},
		"client_id":            {f.config.ClientID},
		"client_secret":        {f.config.ClientSecret},
		"subject_token":        {saToken},
		"subject_token_type":   {"urn:ietf:params:oauth:token-type:access_token"},
		"requested_subject":    {owner},
		"requested_token_type": {"urn:ietf:params:oauth:token-type:access_token"},
		"audience":             {f.config.OneCLIAudience},
	}

	token, expiresIn, err := f.postToken(ctx, params)
	if err != nil {
		return "", fmt.Errorf("token exchange for owner %q: %w", owner, err)
	}

	// Cache (write lock).
	f.mu.Lock()
	f.cache[owner] = cachedToken{accessToken: token, expiresAt: time.Now().Add(expiresIn)}
	f.mu.Unlock()

	return token, nil
}

// postToken sends a token request and parses the response.
func (f *TokenExchangeFactory) postToken(ctx context.Context, params url.Values) (string, time.Duration, error) {
	req, err := http.NewRequestWithContext(ctx, "POST", f.config.KeycloakTokenURL,
		strings.NewReader(params.Encode()))
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := f.http.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", 0, fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", 0, fmt.Errorf("decoding token response: %w", err)
	}

	expiresIn := time.Duration(result.ExpiresIn) * time.Second
	if expiresIn == 0 {
		expiresIn = 5 * time.Minute
	}

	return result.AccessToken, expiresIn, nil
}

// ClientForOwner returns a OneCLI Client authenticated as the given user
// via Keycloak impersonation token exchange.
func (f *TokenExchangeFactory) ClientForOwner(ctx context.Context, owner string) (Client, error) {
	token, err := f.exchangeToken(ctx, owner)
	if err != nil {
		return nil, err
	}
	return NewHTTPClient(f.config.OneCLIBaseURL, token), nil
}

// InvalidateToken removes a cached token for the given owner (e.g. after a 401).
func (f *TokenExchangeFactory) InvalidateToken(owner string) {
	f.mu.Lock()
	delete(f.cache, owner)
	f.mu.Unlock()
}

// NoopFactory returns NoopClients — used when OneCLI is not configured.
type NoopFactory struct{}

func (n *NoopFactory) ClientForOwner(_ context.Context, _ string) (Client, error) {
	return &NoopClient{}, nil
}
