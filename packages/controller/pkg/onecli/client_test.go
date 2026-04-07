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
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/agents":
			assert.Equal(t, "Bearer oc_test_key", r.Header.Get("Authorization"))

			var body map[string]string
			json.NewDecoder(r.Body).Decode(&body)
			assert.Equal(t, "my-agent", body["name"])
			assert.Equal(t, "instance-123", body["identifier"])

			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]any{
				"id":   "agent-id-1",
				"name": "my-agent",
			})
		case r.Method == "PATCH" && r.URL.Path == "/api/agents/agent-id-1/secret-mode":
			var body map[string]string
			json.NewDecoder(r.Body).Decode(&body)
			assert.Equal(t, "all", body["mode"])
			json.NewEncoder(w).Encode(map[string]any{"success": true})
		case r.Method == "GET" && r.URL.Path == "/api/agents":
			json.NewEncoder(w).Encode([]map[string]any{{
				"id":          "agent-id-1",
				"name":        "my-agent",
				"identifier":  "instance-123",
				"accessToken": "at_abc123",
				"secretMode":  "all",
			}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "oc_test_key")
	agent, err := c.CreateAgent(context.Background(), "my-agent", "instance-123", "all")
	require.NoError(t, err)
	assert.Equal(t, "agent-id-1", agent.ID)
	assert.Equal(t, "at_abc123", agent.AccessToken)
}

func TestDeleteAgent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "GET" && r.URL.Path == "/api/agents":
			json.NewEncoder(w).Encode([]map[string]any{{
				"id": "agent-id-1", "identifier": "my-template",
			}})
		case r.Method == "DELETE" && r.URL.Path == "/api/agents/agent-id-1":
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "oc_test_key")
	err := c.DeleteAgent(context.Background(), "my-template")
	assert.NoError(t, err)
}

func TestDeleteAgent_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// List returns empty — identifier not found
		json.NewEncoder(w).Encode([]map[string]any{})
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "oc_test_key")
	err := c.DeleteAgent(context.Background(), "missing")
	assert.NoError(t, err) // not found is not an error for delete
}

func TestCreateAgent_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "oc_test_key")
	_, err := c.CreateAgent(context.Background(), "my-agent", "instance-123", "selective")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "500")
}
