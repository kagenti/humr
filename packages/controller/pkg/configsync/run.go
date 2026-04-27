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
	// https://humr-api.../api/instances/<name>/gh-enterprise/events
	EventsURL string
	// Token is the per-instance access token sent as Bearer auth.
	Token string
	// OutPath is where hosts.yml lives, typically /home/agent/.config/gh/hosts.yml.
	OutPath string
	// MinBackoff / MaxBackoff bound the reconnect delay (default 1s..30s).
	MinBackoff, MaxBackoff time.Duration
	// HTTPClient lets tests inject a transport. Defaults to http.DefaultClient
	// with no overall timeout (SSE is long-lived).
	HTTPClient *http.Client
}

type eventPayload struct {
	Connections []HostEntry `json:"connections"`
}

// Run holds an SSE connection to the api-server and merges incoming
// snapshot/upsert events into OutPath. Returns when ctx is canceled.
func Run(ctx context.Context, o Options) error {
	if o.EventsURL == "" {
		return errors.New("config-sync: --events-url is required")
	}
	if o.OutPath == "" {
		return errors.New("config-sync: --out is required")
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

	// healthyUptime is "long enough that the previous connection was clearly
	// working" — past this threshold we reset backoff so a once-per-day api-server
	// restart doesn't leave the sidecar reconnecting at MaxBackoff forever.
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
		// Sleep with backoff + jitter (skip jitter for tiny backoffs).
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
	return readSSE(resp.Body, o.OutPath)
}

// readSSE parses event-stream framing and applies each event to the file.
// Frames are separated by a blank line. We collect `event:` and `data:` lines
// and dispatch on a complete frame.
func readSSE(r io.Reader, outPath string) error {
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
				if err := dispatch(event, data.String(), outPath); err != nil {
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

func dispatch(event, data, outPath string) error {
	if event != "snapshot" && event != "upsert" {
		return nil
	}
	var p eventPayload
	if err := json.Unmarshal([]byte(data), &p); err != nil {
		return fmt.Errorf("decode %s: %w", event, err)
	}
	if len(p.Connections) == 0 {
		return nil
	}
	return apply(outPath, p.Connections)
}

func apply(outPath string, conns []HostEntry) error {
	existing, err := os.ReadFile(outPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	merged, changed, err := Merge(existing, conns)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	dir := filepath.Dir(outPath)
	if err := os.MkdirAll(dir, 0o777); err != nil {
		return err
	}
	// MkdirAll honors umask, which strips group/other write on most distros.
	// Force 0o777 so a non-root agent container sharing this volume can still
	// create sibling files (gh CLI writes state.yml, hosts.yml.lock, etc.).
	if err := os.Chmod(dir, 0o777); err != nil {
		return err
	}
	tmp := outPath + ".tmp"
	// 0o666 so a non-root agent can also edit hosts.yml in place — fill-if-missing
	// preserves their changes on the next sync.
	if err := os.WriteFile(tmp, merged, 0o666); err != nil {
		return err
	}
	if err := os.Rename(tmp, outPath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	slog.Info("config-sync wrote hosts.yml", "path", outPath, "hosts", len(conns))
	return nil
}
