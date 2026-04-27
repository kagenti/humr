package configsync

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplyFile_CreatesFileAndDirs(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "deep", "nested", "hosts.yml")
	err := applyFile(FileSpec{
		Path: out,
		Mode: ModeYAMLFillIfMissing,
		Fragments: []Fragment{
			{"ghe.example.com": map[string]any{"oauth_token": "humr:sentinel", "user": "alice"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "ghe.example.com:") || !strings.Contains(string(b), "user: alice") {
		t.Errorf("output missing expected content:\n%s", b)
	}
}

func TestApplyFile_NoChangeNoWrite(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "hosts.yml")
	in := []byte("ghe.example.com:\n    oauth_token: humr:sentinel\n    user: alice\n")
	if err := os.WriteFile(out, in, 0o644); err != nil {
		t.Fatal(err)
	}
	stat0, _ := os.Stat(out)
	err := applyFile(FileSpec{
		Path: out,
		Mode: ModeYAMLFillIfMissing,
		Fragments: []Fragment{
			{"ghe.example.com": map[string]any{"oauth_token": "humr:sentinel", "user": "alice"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	stat1, _ := os.Stat(out)
	if stat0.ModTime() != stat1.ModTime() {
		t.Errorf("file mtime changed but no merge change expected")
	}
}

func TestApplyFile_UnknownModeReturnsError(t *testing.T) {
	dir := t.TempDir()
	err := applyFile(FileSpec{
		Path:      filepath.Join(dir, "x"),
		Mode:      Mode("nonsense"),
		Fragments: []Fragment{{"k": "v"}},
	})
	if err == nil {
		t.Fatal("expected error on unknown mode")
	}
}

func TestReadSSE_ParsesAndAppliesFrames(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "hosts.yml")
	frame1 := `{"files":[{"path":"` + out + `","mode":"yaml-fill-if-missing","fragments":[{"x.example.com":{"user":"u"}}]}]}`
	frame2 := `{"files":[{"path":"` + out + `","mode":"yaml-fill-if-missing","fragments":[{"y.example.com":{"user":"v"}}]}]}`
	stream := "event: snapshot\ndata: " + frame1 + "\n\n" +
		"event: upsert\ndata: " + frame2 + "\n\n"

	if err := readSSE(strings.NewReader(stream)); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(out)
	for _, want := range []string{"x.example.com:", "y.example.com:", "user: u", "user: v"} {
		if !strings.Contains(string(b), want) {
			t.Errorf("output missing %q:\n%s", want, b)
		}
	}
}
