package configsync

import (
	"strings"
	"testing"
)

// hostFragment is a tiny helper for the github-enterprise shape used in tests:
// a single top-level host key whose value is a mapping of fields.
func hostFragment(host string, fields map[string]any) Fragment {
	return Fragment{host: fields}
}

func TestMergeYAML_EmptyExistingAddsFullEntry(t *testing.T) {
	out, changed, err := MergeYAMLFillIfMissing(nil, []Fragment{
		hostFragment("ghe.example.com", map[string]any{
			"oauth_token": "humr:sentinel",
			"git_protocol": "https",
			"user":        "alice",
		}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected changed=true")
	}
	for _, s := range []string{"ghe.example.com:", "oauth_token: humr:sentinel", "git_protocol: https", "user: alice"} {
		if !strings.Contains(string(out), s) {
			t.Errorf("output missing %q:\n%s", s, out)
		}
	}
}

func TestMergeYAML_NoFragmentsNoChange(t *testing.T) {
	in := []byte("github.com:\n    user: bob\n")
	out, changed, err := MergeYAMLFillIfMissing(in, nil)
	if err != nil {
		t.Fatal(err)
	}
	if changed || string(out) != string(in) {
		t.Errorf("nothing to merge → unchanged; got changed=%v", changed)
	}
}

func TestMergeYAML_NeverOverwritesPresentFields(t *testing.T) {
	in := []byte("ghe.example.com:\n    user: previous-user\n")
	out, _, err := MergeYAMLFillIfMissing(in, []Fragment{
		hostFragment("ghe.example.com", map[string]any{"user": "new-user", "oauth_token": "humr:sentinel"}),
	})
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	if !strings.Contains(s, "user: previous-user") {
		t.Errorf("must preserve existing user; got:\n%s", s)
	}
	if strings.Contains(s, "user: new-user") {
		t.Errorf("must not introduce new value for present field; got:\n%s", s)
	}
	if !strings.Contains(s, "oauth_token: humr:sentinel") {
		t.Errorf("must add missing oauth_token; got:\n%s", s)
	}
}

func TestMergeYAML_NeverDeletesUnrelatedKeys(t *testing.T) {
	in := []byte("old.example.com:\n    user: ghost\n")
	out, _, err := MergeYAMLFillIfMissing(in, []Fragment{
		hostFragment("ghe.example.com", map[string]any{"user": "alice"}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), "old.example.com:") {
		t.Errorf("must preserve unrelated host; got:\n%s", out)
	}
}

func TestMergeYAML_ExistingNonMappingRootRebuilds(t *testing.T) {
	in := []byte("null\n")
	out, changed, err := MergeYAMLFillIfMissing(in, []Fragment{
		hostFragment("ghe.example.com", map[string]any{"user": "alice"}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected changed=true")
	}
	if !strings.Contains(string(out), "ghe.example.com:") {
		t.Errorf("non-mapping root should be rebuilt; got:\n%s", out)
	}
}
