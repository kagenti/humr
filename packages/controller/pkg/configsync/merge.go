// Package configsync renders the agent pod's gh CLI hosts.yml from
// github-enterprise app connections, on the "fill-if-missing" rule:
// new hosts get full entries; existing host entries are never destructively
// rewritten.
package configsync

import (
	"bytes"

	"gopkg.in/yaml.v3"
)

// HostEntry is one connection as seen on the wire (snapshot/upsert event payload).
type HostEntry struct {
	Host     string `json:"host"`
	Username string `json:"username,omitempty"`
}

// Merge applies fill-if-missing upserts of conns into existing hosts.yml content.
// For each connection: absent host gets a full entry (oauth_token, git_protocol,
// user); present host gets only the fields that are currently missing.
// Never deletes, never overwrites a present field.
//
// Returns the new content and whether anything actually changed. When unchanged,
// the original bytes are returned verbatim so the caller can skip the write.
func Merge(existing []byte, conns []HostEntry) ([]byte, bool, error) {
	var doc yaml.Node
	if len(bytes.TrimSpace(existing)) > 0 {
		if err := yaml.Unmarshal(existing, &doc); err != nil {
			return nil, false, err
		}
	}
	if doc.Kind == 0 {
		doc.Kind = yaml.DocumentNode
	}
	if len(doc.Content) == 0 {
		doc.Content = []*yaml.Node{{Kind: yaml.MappingNode}}
	}
	root := doc.Content[0]
	if root.Kind != yaml.MappingNode {
		// Existing file was something other than a mapping (e.g. `null` or a
		// list). Treat as empty and rebuild — gh CLI couldn't have used it anyway.
		root.Kind = yaml.MappingNode
		root.Content = nil
		root.Tag = ""
	}

	changed := false
	for _, c := range conns {
		if c.Host == "" {
			continue
		}
		_, hostNode := findKey(root, c.Host)
		if hostNode == nil {
			entry := &yaml.Node{Kind: yaml.MappingNode}
			setIfMissing(entry, "oauth_token", "humr:sentinel")
			setIfMissing(entry, "git_protocol", "https")
			if c.Username != "" {
				setIfMissing(entry, "user", c.Username)
			}
			root.Content = append(root.Content,
				&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: c.Host},
				entry,
			)
			changed = true
			continue
		}
		if hostNode.Kind != yaml.MappingNode {
			continue
		}
		if setIfMissing(hostNode, "oauth_token", "humr:sentinel") {
			changed = true
		}
		if setIfMissing(hostNode, "git_protocol", "https") {
			changed = true
		}
		if c.Username != "" && setIfMissing(hostNode, "user", c.Username) {
			changed = true
		}
	}

	if !changed {
		return existing, false, nil
	}

	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(4)
	if err := enc.Encode(&doc); err != nil {
		return nil, false, err
	}
	_ = enc.Close()
	return buf.Bytes(), true, nil
}

func findKey(m *yaml.Node, key string) (*yaml.Node, *yaml.Node) {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return m.Content[i], m.Content[i+1]
		}
	}
	return nil, nil
}

func setIfMissing(m *yaml.Node, key, value string) bool {
	if _, v := findKey(m, key); v != nil {
		return false
	}
	m.Content = append(m.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key},
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value},
	)
	return true
}
