package configsync

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Options configure the sidecar's main loop.
type Options struct {
	// EventsURL is the api-server SSE endpoint, e.g.
	// https://humr-api.../api/instances/<name>/pod-files/events
	EventsURL string
	// Token is the per-instance access token sent as Bearer auth.
	Token string
	// AgentHome is the agent container's HOME (e.g. /home/agent). The sidecar
	// refuses to write any file whose path doesn't resolve under this prefix —
	// defense-in-depth against a buggy or compromised api-server payload.
	AgentHome string
	// MinBackoff / MaxBackoff bound the reconnect delay (default 1s..30s).
	MinBackoff, MaxBackoff time.Duration
	// HTTPClient lets tests inject a transport. Defaults to http.DefaultClient
	// with no overall timeout (SSE is long-lived).
	HTTPClient *http.Client
}

// Mode identifies how the sidecar merges fragments into a file.
type Mode string

const (
	ModeYAMLFillIfMissing Mode = "yaml-fill-if-missing"
)

// FileSpec is one managed file as it travels on the wire.
type FileSpec struct {
	Path      string     `json:"path"`
	Mode      Mode       `json:"mode"`
	Fragments []Fragment `json:"fragments"`
}

type eventPayload struct {
	Files []FileSpec `json:"files"`
}

// Run holds an SSE connection to the api-server and applies incoming
// snapshot/upsert events. Returns when ctx is canceled.
func Run(ctx context.Context, o Options) error {
	if o.EventsURL == "" {
		return errors.New("config-sync: --events-url is required")
	}
	if o.AgentHome == "" {
		return errors.New("config-sync: --agent-home is required")
	}
	if o.MinBackoff <= 0 {
		o.MinBackoff = time.Second
	}
	if o.MaxBackoff <= 0 {
		o.MaxBackoff = 30 * time.Second
	}
	httpClient := o.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{}
	}

	// healthyUptime: long enough that the previous connection was clearly
	// working — past this we reset backoff so a once-per-day api-server
	// restart doesn't pin reconnects at MaxBackoff forever.
	const healthyUptime = 30 * time.Second

	backoff := o.MinBackoff
	for {
		start := time.Now()
		err := stream(ctx, httpClient, o)
		if ctx.Err() != nil {
			return nil
		}
		if err != nil {
			slog.Warn("config-sync stream ended", "error", err)
		}
		if time.Since(start) > healthyUptime {
			backoff = o.MinBackoff
		}
		var jitter time.Duration
		if window := int64(backoff / 5); window > 0 {
			jitter = time.Duration(rand.Int64N(window))
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(backoff + jitter):
		}
		backoff *= 2
		if backoff > o.MaxBackoff {
			backoff = o.MaxBackoff
		}
	}
}

// stream opens one SSE connection and processes events until it ends.
func stream(ctx context.Context, hc *http.Client, o Options) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, o.EventsURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	if o.Token != "" {
		req.Header.Set("Authorization", "Bearer "+o.Token)
	}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	slog.Info("config-sync connected", "url", o.EventsURL)
	return readSSE(resp.Body, o.AgentHome)
}

// readSSE parses event-stream framing and dispatches each event.
func readSSE(r io.Reader, agentHome string) error {
	br := bufio.NewReader(r)
	var event string
	var data strings.Builder
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			// Partial frame at EOF (server crashed mid-flush) is intentionally
			// dropped — the next reconnect re-snapshots, so partial state never
			// reaches the file.
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			if event != "" || data.Len() > 0 {
				if err := dispatch(event, data.String(), agentHome); err != nil {
					slog.Warn("config-sync dispatch failed", "error", err)
				}
			}
			event = ""
			data.Reset()
			continue
		}
		switch {
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(line[len("event:"):])
		case strings.HasPrefix(line, "data:"):
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimSpace(line[len("data:"):]))
		}
	}
}

func dispatch(event, data, agentHome string) error {
	if event != "snapshot" && event != "upsert" {
		return nil
	}
	var p eventPayload
	if err := json.Unmarshal([]byte(data), &p); err != nil {
		return fmt.Errorf("decode %s: %w", event, err)
	}
	for _, file := range p.Files {
		if err := applyFile(file, agentHome); err != nil {
			slog.Warn("config-sync apply failed", "path", file.Path, "error", err)
		}
	}
	return nil
}

// applyFile dispatches on file.Mode and writes the result if anything changed.
// Refuses to write paths outside agentHome — defense-in-depth against a buggy
// or compromised api-server payload.
func applyFile(file FileSpec, agentHome string) error {
	if len(file.Fragments) == 0 {
		return nil
	}
	home := strings.TrimRight(filepath.Clean(agentHome), "/")
	clean := filepath.Clean(file.Path)
	if home == "" || !strings.HasPrefix(clean, home+"/") {
		return fmt.Errorf("refusing to write %q: path must be under agent home %q", file.Path, agentHome)
	}
	existing, err := os.ReadFile(file.Path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	var merged []byte
	var changed bool
	switch file.Mode {
	case ModeYAMLFillIfMissing:
		merged, changed, err = MergeYAMLFillIfMissing(existing, file.Fragments)
	default:
		return fmt.Errorf("unknown merge mode %q", file.Mode)
	}
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	dir := filepath.Dir(file.Path)
	if err := os.MkdirAll(dir, 0o777); err != nil {
		return err
	}
	// MkdirAll honors umask, which strips group/other write on most distros.
	// Force 0o777 so a non-root agent container sharing this volume can
	// create sibling files (gh CLI writes state.yml, hosts.yml.lock, etc.).
	if err := os.Chmod(dir, 0o777); err != nil {
		return err
	}
	tmp := file.Path + ".tmp"
	// 0o666 so a non-root agent can also edit in place — fill-if-missing
	// preserves their changes on the next sync.
	if err := os.WriteFile(tmp, merged, 0o666); err != nil {
		return err
	}
	if err := os.Rename(tmp, file.Path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	slog.Info("config-sync wrote file", "path", file.Path, "fragments", len(file.Fragments))
	return nil
}
