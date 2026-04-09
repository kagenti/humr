package config

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadFromEnv_AllSet(t *testing.T) {
	setEnv(t, map[string]string{
		"HUMR_AGENT_NAMESPACE":  "test-agents",
		"HUMR_RELEASE_NAMESPACE": "custom-ns",
		"HUMR_RELEASE_NAME":     "my-release",
		"ONECLI_URL":            "http://onecli:10254",
		"ONECLI_API_KEY":        "oc_test_key",
		"ONECLI_GATEWAY_HOST":   "my-release-onecli",
		"ONECLI_GATEWAY_PORT":   "9999",
		"HUMR_LEASE_NAME":       "custom-lease",
		"POD_NAME":              "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "test-agents", cfg.Namespace)
	assert.Equal(t, "custom-ns", cfg.ReleaseNamespace)
	assert.Equal(t, "my-release", cfg.ReleaseName)
	assert.Equal(t, "http://onecli:10254", cfg.OneCLIURL)
	assert.Equal(t, "oc_test_key", cfg.OneCLIAPIKey)
	assert.Equal(t, "my-release-onecli", cfg.GatewayHost)
	assert.Equal(t, 9999, cfg.GatewayPort)
	assert.Equal(t, 10254, cfg.WebPort)
	assert.Equal(t, "custom-lease", cfg.LeaseName)
	assert.Equal(t, "controller-0", cfg.PodName)
	assert.Equal(t, "my-release-onecli.custom-ns.svc.cluster.local", cfg.GatewayFQDN())
	assert.Equal(t, "http://my-release-onecli.custom-ns.svc.cluster.local:10254", cfg.WebURL())
}

func TestLoadFromEnv_Defaults(t *testing.T) {
	setEnv(t, map[string]string{
		"HUMR_RELEASE_NAME": "humr",
		"POD_NAME":          "controller-0",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "humr-agents", cfg.Namespace)
	assert.Equal(t, "default", cfg.ReleaseNamespace)
	assert.Equal(t, 10255, cfg.GatewayPort)
	assert.Equal(t, 10254, cfg.WebPort)
	assert.Equal(t, "humr-controller", cfg.LeaseName)
	assert.Equal(t, "humr-onecli", cfg.GatewayHost)
	assert.Equal(t, "humr-onecli.default.svc.cluster.local", cfg.GatewayFQDN())
	assert.Equal(t, "http://humr-onecli.default.svc.cluster.local:10254", cfg.WebURL())
	assert.Equal(t, 1*time.Hour, cfg.IdleTimeout)
}

func TestLoadFromEnv_IdleTimeout(t *testing.T) {
	setEnv(t, map[string]string{
		"HUMR_RELEASE_NAME": "humr",
		"POD_NAME":          "controller-0",
		"HUMR_IDLE_TIMEOUT": "30m",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, 30*time.Minute, cfg.IdleTimeout)
}

func TestLoadFromEnv_IdleTimeoutDisabled(t *testing.T) {
	setEnv(t, map[string]string{
		"HUMR_RELEASE_NAME": "humr",
		"POD_NAME":          "controller-0",
		"HUMR_IDLE_TIMEOUT": "0s",
	})
	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, time.Duration(0), cfg.IdleTimeout)
}

func TestLoadFromEnv_MissingRequired(t *testing.T) {
	setEnv(t, map[string]string{})
	_, err := LoadFromEnv()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "HUMR_RELEASE_NAME")
}

func TestLoadFromEnv_MissingPodName(t *testing.T) {
	setEnv(t, map[string]string{
		"HUMR_RELEASE_NAME": "humr",
	})
	_, err := LoadFromEnv()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "POD_NAME")
}

func setEnv(t *testing.T, vars map[string]string) {
	t.Helper()
	for _, key := range []string{
		"HUMR_AGENT_NAMESPACE", "HUMR_RELEASE_NAMESPACE", "HUMR_RELEASE_NAME",
		"ONECLI_URL", "ONECLI_API_KEY",
		"ONECLI_GATEWAY_HOST", "ONECLI_GATEWAY_PORT",
		"HUMR_LEASE_NAME", "POD_NAME", "HUMR_IDLE_TIMEOUT",
	} {
		os.Unsetenv(key)
		t.Cleanup(func() { os.Unsetenv(key) })
	}
	for k, v := range vars {
		t.Setenv(k, v)
	}
}
