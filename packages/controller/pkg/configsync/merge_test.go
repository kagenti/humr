package configsync

import (
	"strings"
	"testing"
)

func TestMerge_EmptyExistingAddsFullEntry(t *testing.T) {
	out, changed, err := Merge(nil, []HostEntry{{Host: "ghe.example.com", Username: "alice"}})
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected changed=true")
	}
	want := []string{"ghe.example.com:", "oauth_token: humr:sentinel", "git_protocol: https", "user: alice"}
	for _, s := range want {
		if !strings.Contains(string(out), s) {
			t.Errorf("output missing %q:\n%s", s, out)
		}
	}
}

func TestMerge_NoConnsNoChange(t *testing.T) {
	in := []byte("github.com:\n    user: bob\n")
	out, changed, err := Merge(in, nil)
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatal("expected changed=false")
	}
	if string(out) != string(in) {
		t.Errorf("output should be unchanged when nothing to merge; got:\n%s", out)
	}
}

func TestMerge_NewHostPreservesExisting(t *testing.T) {
	in := []byte("github.com:\n    user: bob\n    custom: keep-me\n")
	out, changed, err := Merge(in, []HostEntry{{Host: "ghe.example.com", Username: "alice"}})
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected changed=true")
	}
	for _, s := range []string{"github.com:", "user: bob", "custom: keep-me", "ghe.example.com:", "oauth_token: humr:sentinel"} {
		if !strings.Contains(string(out), s) {
			t.Errorf("output missing %q:\n%s", s, out)
		}
	}
}

func TestMerge_ExistingHostAllFieldsPresentNoChange(t *testing.T) {
	in := []byte("ghe.example.com:\n    oauth_token: real-token\n    git_protocol: ssh\n    user: alice\n")
	out, changed, err := Merge(in, []HostEntry{{Host: "ghe.example.com", Username: "alice"}})
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatal("expected changed=false (all fields present)")
	}
	if string(out) != string(in) {
		t.Errorf("output should be byte-identical; got:\n%s", out)
	}
}

func TestMerge_ExistingHostFillsMissingFieldsOnly(t *testing.T) {
	in := []byte("ghe.example.com:\n    oauth_token: real-token\n")
	out, changed, err := Merge(in, []HostEntry{{Host: "ghe.example.com", Username: "alice"}})
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected changed=true (missing fields filled)")
	}
	s := string(out)
	if !strings.Contains(s, "oauth_token: real-token") {
		t.Errorf("must preserve user-set oauth_token; got:\n%s", s)
	}
	if !strings.Contains(s, "git_protocol: https") {
		t.Errorf("must add missing git_protocol; got:\n%s", s)
	}
	if !strings.Contains(s, "user: alice") {
		t.Errorf("must add missing user; got:\n%s", s)
	}
}

func TestMerge_NoUsernameOmitsUserField(t *testing.T) {
	out, changed, err := Merge(nil, []HostEntry{{Host: "ghe.example.com"}})
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected changed=true")
	}
	if strings.Contains(string(out), "user:") {
		t.Errorf("user field should be omitted when username empty; got:\n%s", out)
	}
}

func TestMerge_EmptyHostSkipped(t *testing.T) {
	out, changed, err := Merge(nil, []HostEntry{{Host: "", Username: "alice"}})
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatalf("empty host should be skipped; out=%s", out)
	}
}

func TestMerge_NeverOverwritesExistingField(t *testing.T) {
	in := []byte("ghe.example.com:\n    user: previous-user\n")
	out, _, err := Merge(in, []HostEntry{{Host: "ghe.example.com", Username: "new-user"}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), "user: previous-user") {
		t.Errorf("must preserve existing user field; got:\n%s", out)
	}
	if strings.Contains(string(out), "user: new-user") {
		t.Errorf("must not introduce new value for present field; got:\n%s", out)
	}
}

func TestMerge_NeverDeletesUnrelatedHosts(t *testing.T) {
	in := []byte("old.example.com:\n    user: ghost\n")
	// Upsert a different host; "old.example.com" not in conns list.
	out, changed, err := Merge(in, []HostEntry{{Host: "ghe.example.com", Username: "alice"}})
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected changed=true")
	}
	if !strings.Contains(string(out), "old.example.com:") {
		t.Errorf("must never delete unrelated host; got:\n%s", out)
	}
}
