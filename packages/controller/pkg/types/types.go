package types

import (
	"fmt"
	"strings"

	"github.com/robfig/cron/v3"
	"gopkg.in/yaml.v3"
)

const SpecVersion = "humr.ai/v1"

// --- Template ---

type TemplateSpec struct {
	Version         string           `yaml:"version"`
	Image           string           `yaml:"image"`
	Description     string           `yaml:"description,omitempty"`
	Mounts          []Mount          `yaml:"mounts,omitempty"`
	Init            string           `yaml:"init,omitempty"`
	Env             []EnvVar         `yaml:"env,omitempty"`
	Resources       ResourceSpec     `yaml:"resources,omitempty"`
	SecurityContext *SecurityContext  `yaml:"securityContext,omitempty"`
}

type Mount struct {
	Path    string `yaml:"path"`
	Persist bool   `yaml:"persist"`
}

type EnvVar struct {
	Name  string `yaml:"name"`
	Value string `yaml:"value"`
}

type ResourceSpec struct {
	Requests map[string]string `yaml:"requests,omitempty"`
	Limits   map[string]string `yaml:"limits,omitempty"`
}

type SecurityContext struct {
	RunAsNonRoot           *bool `yaml:"runAsNonRoot,omitempty"`
	ReadOnlyRootFilesystem *bool `yaml:"readOnlyRootFilesystem,omitempty"`
}

// --- Instance ---

type InstanceSpec struct {
	Version      string   `yaml:"version"`
	DesiredState string   `yaml:"desiredState"`
	TemplateName string   `yaml:"templateName,omitempty"`
	Env          []EnvVar `yaml:"env,omitempty"`
	SecretRef    string   `yaml:"secretRef,omitempty"`
	Description  string   `yaml:"description,omitempty"`
}

type InstanceStatus struct {
	Version      string `yaml:"version"`
	CurrentState string `yaml:"currentState"`
	Error        string `yaml:"error,omitempty"`
}

// --- Schedule ---

type ScheduleSpec struct {
	Version string `yaml:"version"`
	Type    string `yaml:"type"`
	Cron    string `yaml:"cron"`
	Task    string `yaml:"task,omitempty"`
	Enabled bool   `yaml:"enabled"`
}

type ScheduleStatus struct {
	Version    string `yaml:"version"`
	LastRun    string `yaml:"lastRun,omitempty"`
	NextRun    string `yaml:"nextRun,omitempty"`
	LastResult string `yaml:"lastResult,omitempty"`
}

// --- Parsing + Validation ---

func ParseTemplateSpec(data string) (*TemplateSpec, error) {
	var spec TemplateSpec
	if err := yaml.Unmarshal([]byte(data), &spec); err != nil {
		return nil, fmt.Errorf("parsing template spec: %w", err)
	}
	if err := validateVersion(spec.Version); err != nil {
		return nil, fmt.Errorf("template spec: %w", err)
	}
	if spec.Image == "" {
		return nil, fmt.Errorf("template spec: image is required")
	}
	for _, m := range spec.Mounts {
		if !strings.HasPrefix(m.Path, "/") {
			return nil, fmt.Errorf("template spec: mount path %q must be absolute", m.Path)
		}
	}
	return &spec, nil
}

func ParseInstanceSpec(data string) (*InstanceSpec, error) {
	var spec InstanceSpec
	if err := yaml.Unmarshal([]byte(data), &spec); err != nil {
		return nil, fmt.Errorf("parsing instance spec: %w", err)
	}
	if err := validateVersion(spec.Version); err != nil {
		return nil, fmt.Errorf("instance spec: %w", err)
	}
	if spec.DesiredState == "" {
		return nil, fmt.Errorf("instance spec: desiredState is required")
	}
	if spec.DesiredState != "running" && spec.DesiredState != "hibernated" {
		return nil, fmt.Errorf("instance spec: desiredState must be 'running' or 'hibernated', got %q", spec.DesiredState)
	}
	return &spec, nil
}

func ParseScheduleSpec(data string) (*ScheduleSpec, error) {
	var spec ScheduleSpec
	if err := yaml.Unmarshal([]byte(data), &spec); err != nil {
		return nil, fmt.Errorf("parsing schedule spec: %w", err)
	}
	if err := validateVersion(spec.Version); err != nil {
		return nil, fmt.Errorf("schedule spec: %w", err)
	}
	if spec.Cron != "" {
		if _, err := cron.ParseStandard(spec.Cron); err != nil {
			return nil, fmt.Errorf("schedule spec: invalid cron %q: %w", spec.Cron, err)
		}
	}
	return &spec, nil
}

func validateVersion(v string) error {
	if v == "" {
		return fmt.Errorf("version is required (expected %q)", SpecVersion)
	}
	if v != SpecVersion {
		return fmt.Errorf("unsupported version %q (expected %q)", v, SpecVersion)
	}
	return nil
}

// SanitizeMountName converts a mount path to a K8s-safe volume name.
// "/workspace" -> "workspace", "/home/agent" -> "home-agent"
func SanitizeMountName(path string) string {
	name := strings.TrimPrefix(path, "/")
	return strings.ReplaceAll(name, "/", "-")
}

// NewInstanceStatus creates a status with the current version.
func NewInstanceStatus(state, errMsg string) *InstanceStatus {
	return &InstanceStatus{Version: SpecVersion, CurrentState: state, Error: errMsg}
}

// NewScheduleStatus creates a status with the current version.
func NewScheduleStatus(lastRun, nextRun, result string) *ScheduleStatus {
	return &ScheduleStatus{Version: SpecVersion, LastRun: lastRun, NextRun: nextRun, LastResult: result}
}
