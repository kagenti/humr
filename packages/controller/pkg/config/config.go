package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Namespace        string // Agent workload namespace
	ReleaseNamespace string // Helm release namespace (where controller/OneCLI run)
	ReleaseName      string // Helm release name
	OneCLIURL        string // OneCLI web API base URL
	OneCLIAPIKey     string // OneCLI API key
	GatewayHost      string // OneCLI gateway K8s service host (short name)
	GatewayPort      int    // OneCLI gateway port
	WebPort          int    // OneCLI web API port (for container-config endpoint)
	LeaseName        string // Leader election lease name
	PodName          string // This pod's name (from downward API)
	AgentImagePullPolicy string        // ImagePullPolicy for agent pods (default: IfNotPresent)
	IdleTimeout          time.Duration // Idle timeout before auto-hibernation (0 = disabled, default: 1h)
}

func LoadFromEnv() (*Config, error) {
	release := os.Getenv("HUMR_RELEASE_NAME")
	if release == "" {
		return nil, fmt.Errorf("required env var HUMR_RELEASE_NAME is not set")
	}

	podName := os.Getenv("POD_NAME")
	if podName == "" {
		return nil, fmt.Errorf("required env var POD_NAME is not set")
	}

	cfg := &Config{
		Namespace:        envOrDefault("HUMR_AGENT_NAMESPACE", "humr-agents"),
		ReleaseNamespace: envOrDefault("HUMR_RELEASE_NAMESPACE", "default"),
		ReleaseName:      release,
		OneCLIURL:        os.Getenv("ONECLI_URL"),
		OneCLIAPIKey:     os.Getenv("ONECLI_API_KEY"),
		GatewayHost:      envOrDefault("ONECLI_GATEWAY_HOST", release+"-onecli"),
		GatewayPort:      envOrDefaultInt("ONECLI_GATEWAY_PORT", 10255),
		WebPort:          envOrDefaultInt("ONECLI_WEB_PORT", 10254),
		LeaseName:        envOrDefault("HUMR_LEASE_NAME", release+"-controller"),
		PodName:          podName,
	}
	cfg.AgentImagePullPolicy = envOrDefault("AGENT_IMAGE_PULL_POLICY", "IfNotPresent")
	cfg.IdleTimeout = envOrDefaultDuration("HUMR_IDLE_TIMEOUT", 1*time.Hour)
	return cfg, nil
}

// GatewayFQDN returns the fully-qualified DNS name for the OneCLI gateway service.
// Required because agent pods run in a different namespace than the gateway.
func (c *Config) GatewayFQDN() string {
	return fmt.Sprintf("%s.%s.svc.cluster.local", c.GatewayHost, c.ReleaseNamespace)
}

// WebURL returns the HTTP URL for the OneCLI web API (used by init containers to fetch CA cert).
func (c *Config) WebURL() string {
	return fmt.Sprintf("http://%s:%d", c.GatewayFQDN(), c.WebPort)
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envOrDefaultInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envOrDefaultDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
