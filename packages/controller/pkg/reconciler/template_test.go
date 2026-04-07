package reconciler

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const fixtureTemplateYAML = `version: humr.ai/v1
image: ghcr.io/myorg/code-guardian:latest
description: "Persistent agent for repo monitoring"
mounts:
  - path: /workspace
    persist: true
  - path: /home/agent
    persist: true
  - path: /tmp
    persist: false
init: |
  #!/bin/bash
  echo hello
env:
  - name: ACP_PORT
    value: "8080"
resources:
  requests:
    cpu: "250m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "2Gi"
securityContext:
  runAsNonRoot: true
  readOnlyRootFilesystem: false
`

// fakeGetter implements TemplateGetter for tests
type fakeGetter struct {
	cms map[string]*corev1.ConfigMap
}

func (f *fakeGetter) Get(name string) (*corev1.ConfigMap, error) {
	cm, ok := f.cms[name]
	if !ok {
		return nil, fmt.Errorf("not found: %s", name)
	}
	return cm, nil
}

func TestResolveTemplate(t *testing.T) {
	getter := &fakeGetter{cms: map[string]*corev1.ConfigMap{
		"code-guardian": {
			ObjectMeta: metav1.ObjectMeta{Name: "code-guardian", Namespace: "test-agents"},
			Data:       map[string]string{"spec.yaml": fixtureTemplateYAML},
		},
	}}
	resolver := NewTemplateResolver(getter)
	spec, err := resolver.Resolve("code-guardian")
	require.NoError(t, err)
	assert.Equal(t, "ghcr.io/myorg/code-guardian:latest", spec.Image)
	assert.Len(t, spec.Mounts, 3)
}

func TestResolveTemplate_NotFound(t *testing.T) {
	resolver := NewTemplateResolver(&fakeGetter{cms: map[string]*corev1.ConfigMap{}})
	_, err := resolver.Resolve("missing")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestResolveTemplate_NoSpecYAML(t *testing.T) {
	getter := &fakeGetter{cms: map[string]*corev1.ConfigMap{
		"bad-template": {
			ObjectMeta: metav1.ObjectMeta{Name: "bad-template", Namespace: "test-agents"},
			Data:       map[string]string{"other": "data"},
		},
	}}
	resolver := NewTemplateResolver(getter)
	_, err := resolver.Resolve("bad-template")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no spec.yaml")
}
