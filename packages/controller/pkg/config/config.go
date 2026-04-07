package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Namespace       string // Agent workload namespace
	ReleaseName     string // Helm release name
	OneCLIURL       string // OneCLI web API base URL
	OneCLIAPIKey    string // OneCLI API key
	GatewayHost     string // OneCLI gateway K8s service host
	GatewayPort     int    // OneCLI gateway port
	LeaseName       string // Leader election lease name
	PodName         string // This pod's name (from downward API)
	CACertConfigMap      string // ConfigMap name for CA cert (derived)
	AgentImagePullPolicy string // ImagePullPolicy for agent pods (default: IfNotPresent)
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
		Namespace:    envOrDefault("HUMR_AGENT_NAMESPACE", "humr-agents"),
		ReleaseName:  release,
		OneCLIURL:    os.Getenv("ONECLI_URL"),
		OneCLIAPIKey: os.Getenv("ONECLI_API_KEY"),
		GatewayHost:  envOrDefault("ONECLI_GATEWAY_HOST", release+"-onecli"),
		GatewayPort:  envOrDefaultInt("ONECLI_GATEWAY_PORT", 10255),
		LeaseName:    envOrDefault("HUMR_LEASE_NAME", release+"-controller"),
		PodName:      podName,
	}
	cfg.CACertConfigMap = release + "-onecli-ca-cert"
	cfg.AgentImagePullPolicy = envOrDefault("AGENT_IMAGE_PULL_POLICY", "IfNotPresent")
	return cfg, nil
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
