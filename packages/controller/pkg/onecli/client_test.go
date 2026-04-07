package onecli

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateAgent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "/api/agents", r.URL.Path)
		assert.Equal(t, "Bearer oc_test_key", r.Header.Get("Authorization"))

		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)
		assert.Equal(t, "my-agent", body["name"])
		assert.Equal(t, "instance-123", body["identifier"])

		json.NewEncoder(w).Encode(map[string]any{
			"id":          "agent-id-1",
			"name":        "my-agent",
			"identifier":  "instance-123",
			"accessToken": "at_abc123",
		})
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "oc_test_key")
	agent, err := c.CreateAgent(context.Background(), "my-agent", "instance-123")
	require.NoError(t, err)
	assert.Equal(t, "agent-id-1", agent.ID)
	assert.Equal(t, "at_abc123", agent.AccessToken)
}

func TestDeleteAgent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "DELETE", r.Method)
		assert.Equal(t, "/api/agents/agent-id-1", r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "oc_test_key")
	err := c.DeleteAgent(context.Background(), "agent-id-1")
	assert.NoError(t, err)
}

func TestDeleteAgent_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "oc_test_key")
	err := c.DeleteAgent(context.Background(), "missing")
	assert.NoError(t, err) // 404 is not an error for delete
}

func TestCreateAgent_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "oc_test_key")
	_, err := c.CreateAgent(context.Background(), "my-agent", "instance-123")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "500")
}
