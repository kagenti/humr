package configsync

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApply_CreatesFileAndDirs(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "deep", "nested", "hosts.yml")
	if err := apply(out, []HostEntry{{Host: "ghe.example.com", Username: "alice"}}); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "ghe.example.com:") {
		t.Errorf("missing host:\n%s", b)
	}
	if !strings.Contains(string(b), "user: alice") {
		t.Errorf("missing user:\n%s", b)
	}
}

func TestApply_NoChangeNoWrite(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "hosts.yml")
	in := []byte("ghe.example.com:\n    oauth_token: humr:sentinel\n    git_protocol: https\n    user: alice\n")
	if err := os.WriteFile(out, in, 0o644); err != nil {
		t.Fatal(err)
	}
	stat0, _ := os.Stat(out)
	if err := apply(out, []HostEntry{{Host: "ghe.example.com", Username: "alice"}}); err != nil {
		t.Fatal(err)
	}
	stat1, _ := os.Stat(out)
	if stat0.ModTime() != stat1.ModTime() {
		t.Errorf("file mtime changed but no merge change expected")
	}
}

func TestDispatch_HandlesSnapshotAndUpsert(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "hosts.yml")
	if err := dispatch("snapshot", `{"connections":[{"host":"a.example.com","username":"u"}]}`, out); err != nil {
		t.Fatal(err)
	}
	if err := dispatch("upsert", `{"connections":[{"host":"b.example.com","username":"v"}]}`, out); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(out)
	for _, want := range []string{"a.example.com:", "b.example.com:", "user: u", "user: v"} {
		if !strings.Contains(string(b), want) {
			t.Errorf("output missing %q:\n%s", want, b)
		}
	}
}

func TestDispatch_IgnoresUnknownEvent(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "hosts.yml")
	if err := dispatch("delete", `{"connections":[{"host":"a.example.com"}]}`, out); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Fatal("unknown events must not write the file")
	}
}

func TestReadSSE_ParsesFrames(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "hosts.yml")
	stream := "event: snapshot\ndata: {\"connections\":[{\"host\":\"x.example.com\",\"username\":\"u\"}]}\n\n" +
		"event: upsert\ndata: {\"connections\":[{\"host\":\"y.example.com\"}]}\n\n"
	if err := readSSE(strings.NewReader(stream), out); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(out)
	for _, want := range []string{"x.example.com:", "y.example.com:", "user: u"} {
		if !strings.Contains(string(b), want) {
			t.Errorf("output missing %q:\n%s", want, b)
		}
	}
}
