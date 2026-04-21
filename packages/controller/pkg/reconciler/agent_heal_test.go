package reconciler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kagenti/humr/packages/controller/pkg/config"
)

const (
	healAgentName = "claude-code"
	healNamespace = "humr-agents"
	healToken     = "aoc_test-token-123"
)

func healTokenSecret(agent, token string) *corev1.Secret {
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      AgentTokenSecretName(agent),
			Namespace: healNamespace,
		},
		Data: map[string][]byte{"access-token": []byte(token)},
	}
}

func healAgentCM(name, statusYAML string) *corev1.ConfigMap {
	data := map[string]string{"spec.yaml": "version: humr.ai/v1\nimage: foo"}
	if statusYAML != "" {
		data["status.yaml"] = statusYAML
	}
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: healNamespace,
			Labels:    map[string]string{"humr.ai/owner": "user-x"},
		},
		Data: data,
	}
}

func TestHealAgentStatus_writesHashWhenStatusMissing(t *testing.T) {
	cm := healAgentCM(healAgentName, "")
	secret := healTokenSecret(healAgentName, healToken)
	client := fake.NewSimpleClientset(cm, secret)
	r := &AgentReconciler{client: client, config: &config.Config{Namespace: healNamespace}}

	err := r.healAgentStatus(context.Background(), cm, healAgentName, secret)
	require.NoError(t, err)

	updated, err := client.CoreV1().ConfigMaps(healNamespace).Get(context.Background(), healAgentName, metav1.GetOptions{})
	require.NoError(t, err)

	expected := sha256.Sum256([]byte(healToken))
	assert.Contains(t, updated.Data["status.yaml"], "accessTokenHash: "+hex.EncodeToString(expected[:]))
}

func TestHealAgentStatus_skipsWhenHashAlreadyPresent(t *testing.T) {
	originalStatus := "accessTokenHash: already-set\n"
	cm := healAgentCM(healAgentName, originalStatus)
	secret := healTokenSecret(healAgentName, healToken)
	client := fake.NewSimpleClientset(cm, secret)
	r := &AgentReconciler{client: client, config: &config.Config{Namespace: healNamespace}}

	err := r.healAgentStatus(context.Background(), cm, healAgentName, secret)
	require.NoError(t, err)

	updated, err := client.CoreV1().ConfigMaps(healNamespace).Get(context.Background(), healAgentName, metav1.GetOptions{})
	require.NoError(t, err)
	assert.Equal(t, originalStatus, updated.Data["status.yaml"])
}

func TestHealAgentStatus_errorsOnMissingAccessToken(t *testing.T) {
	cm := healAgentCM(healAgentName, "")
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: AgentTokenSecretName(healAgentName), Namespace: healNamespace},
		Data:       map[string][]byte{},
	}
	client := fake.NewSimpleClientset(cm, secret)
	r := &AgentReconciler{client: client, config: &config.Config{Namespace: healNamespace}}

	err := r.healAgentStatus(context.Background(), cm, healAgentName, secret)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no access-token")
}
