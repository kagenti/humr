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
	}, dir)
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
	}, dir)
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
	}, dir)
	if err == nil {
		t.Fatal("expected error on unknown mode")
	}
}

// Defense-in-depth: a buggy or compromised api-server payload pointing
// outside agentHome must be refused before any file is written. Each
// case names a fresh path; we assert both the refusal *and* that no
// write reached the filesystem.
func TestApplyFile_RejectsPathsOutsideAgentHome(t *testing.T) {
	home := t.TempDir()
	other := t.TempDir()
	cases := map[string]string{
		"absolute outside home":   filepath.Join(other, "evil.yml"),
		"traversal back into etc": filepath.Join(home, "..", filepath.Base(other), "evil.yml"),
		"sibling of home prefix":  home + "X/evil.yml",
	}
	for name, path := range cases {
		t.Run(name, func(t *testing.T) {
			err := applyFile(FileSpec{
				Path:      path,
				Mode:      ModeYAMLFillIfMissing,
				Fragments: []Fragment{{"k": "v"}},
			}, home)
			if err == nil {
				t.Fatalf("expected refusal, got nil; %q under %q should be rejected", path, home)
			}
			if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
				t.Fatalf("path %q exists after rejected write", path)
			}
		})
	}

	// Path == home itself must also be rejected — otherwise the rename in
	// applyFile would replace the home directory with a regular file.
	t.Run("home itself", func(t *testing.T) {
		err := applyFile(FileSpec{
			Path:      home,
			Mode:      ModeYAMLFillIfMissing,
			Fragments: []Fragment{{"k": "v"}},
		}, home)
		if err == nil {
			t.Fatal("expected refusal when writing to agent home itself")
		}
		info, statErr := os.Stat(home)
		if statErr != nil || !info.IsDir() {
			t.Fatalf("home %q is no longer a directory after rejected write", home)
		}
	})
}

func TestReadSSE_ParsesAndAppliesFrames(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "hosts.yml")
	frame1 := `{"files":[{"path":"` + out + `","mode":"yaml-fill-if-missing","fragments":[{"x.example.com":{"user":"u"}}]}]}`
	frame2 := `{"files":[{"path":"` + out + `","mode":"yaml-fill-if-missing","fragments":[{"y.example.com":{"user":"v"}}]}]}`
	stream := "event: snapshot\ndata: " + frame1 + "\n\n" +
		"event: upsert\ndata: " + frame2 + "\n\n"

	if err := readSSE(strings.NewReader(stream), dir); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(out)
	for _, want := range []string{"x.example.com:", "y.example.com:", "user: u", "user: v"} {
		if !strings.Contains(string(b), want) {
			t.Errorf("output missing %q:\n%s", want, b)
		}
	}
}
