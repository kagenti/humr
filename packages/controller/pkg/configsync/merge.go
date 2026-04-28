// Package configsync materializes pod-files declared by api-server producers
// in the agent pod from SSE events. Generic over file paths and merge modes;
// see docs/adrs/DRAFT-pod-files-push.md.
package configsync

import (
	"bytes"

	"gopkg.in/yaml.v3"
)

// Fragment is one connection's contribution to a file, deserialized from JSON.
// Shape depends on the file's merge mode (for yaml-fill-if-missing it's a
// top-level YAML mapping).
type Fragment = map[string]any

// MergeYAMLFillIfMissing applies fragments to existing YAML content using the
// fill-if-missing rule: new top-level keys are added; existing keys whose
// value is a mapping have their missing fields filled. Never overwrites a
// present field; never deletes anything.
//
// Returns the new content and whether anything actually changed. When
// unchanged, the original bytes are returned verbatim so the caller can skip
// the write entirely.
func MergeYAMLFillIfMissing(existing []byte, fragments []Fragment) ([]byte, bool, error) {
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
		// Existing file was something other than a mapping (`null`, list,
		// scalar). Treat as empty and rebuild — the merge target needs a
		// mapping at the top level.
		root.Kind = yaml.MappingNode
		root.Content = nil
		root.Tag = ""
	}

	changed := false
	for _, f := range fragments {
		for key, value := range f {
			if key == "" {
				continue
			}
			if mergeKey(root, key, value) {
				changed = true
			}
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

// mergeKey upserts (key, value) into root with fill-if-missing semantics.
// Returns true if a write actually happened.
func mergeKey(root *yaml.Node, key string, value any) bool {
	_, existing := findKey(root, key)
	if existing == nil {
		// Key absent — add the full value.
		root.Content = append(root.Content,
			&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key},
			toNode(value),
		)
		return true
	}
	// Key present and the new value is a mapping → fill missing children.
	asMap, ok := value.(map[string]any)
	if !ok || existing.Kind != yaml.MappingNode {
		return false
	}
	changed := false
	for k, v := range asMap {
		if _, child := findKey(existing, k); child != nil {
			continue
		}
		existing.Content = append(existing.Content,
			&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: k},
			toNode(v),
		)
		changed = true
	}
	return changed
}

func findKey(m *yaml.Node, key string) (*yaml.Node, *yaml.Node) {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return m.Content[i], m.Content[i+1]
		}
	}
	return nil, nil
}

// toNode converts a JSON-decoded value to a yaml.Node. yaml.v3 round-trips
// most shapes via Marshal/Unmarshal; we use that to avoid hand-walking nested
// types. Errors here would only come from non-marshalable values, which
// shouldn't appear in JSON-sourced fragments.
func toNode(v any) *yaml.Node {
	b, err := yaml.Marshal(v)
	if err != nil {
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!null"}
	}
	var n yaml.Node
	if err := yaml.Unmarshal(b, &n); err != nil || len(n.Content) == 0 {
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!null"}
	}
	return n.Content[0]
}
