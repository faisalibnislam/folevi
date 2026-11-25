package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestCrossCompile builds the static binaries the bundle ships (linux amd64 and arm64, no cgo). The owner's
// test NAS, a Synology DS223, is ARM64.
func TestCrossCompile(t *testing.T) {
	if testing.Short() {
		t.Skip("short")
	}
	for _, arch := range []string{"arm64", "amd64"} {
		out := filepath.Join(t.TempDir(), "folevid-"+arch)
		cmd := exec.Command("go", "build", "-trimpath", "-ldflags", "-s -w", "-o", out, ".")
		cmd.Env = append(os.Environ(), "GOOS=linux", "GOARCH="+arch, "CGO_ENABLED=0")
		if b, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%s: %v\n%s", arch, err, b)
		}
		f, err := os.ReadFile(out)
		if err != nil || len(f) < 20 || string(f[1:4]) != "ELF" {
			t.Fatalf("%s: not an ELF file", arch)
		}
		machine := uint16(f[18]) | uint16(f[19])<<8
		want := map[string]uint16{"arm64": 183, "amd64": 62}[arch]
		if machine != want {
			t.Fatalf("%s: ELF machine %d", arch, machine)
		}
	}
}

func TestCommands(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run([]string{"version"}, &out, &errb); code != 0 || !strings.HasPrefix(out.String(), "folevid ") {
		t.Fatalf("version: %d %q", code, out.String())
	}
	if code := run([]string{"nope"}, &out, &errb); code != 2 {
		t.Fatalf("unknown command: %d", code)
	}
	t.Setenv("FOLEVI_DATA", "")
	if code := run([]string{"run"}, &out, &errb); code != 2 {
		t.Fatalf("run without data: %d", code)
	}
	if code := run([]string{"restore", "../x", "--data", t.TempDir()}, &out, &errb); code != 2 {
		t.Fatalf("bad restore id: %d", code)
	}
	if code := run([]string{"healthcheck", "--data", t.TempDir()}, &out, &errb); code != 2 {
		t.Fatalf("healthcheck on an empty folder: %d", code)
	}
}
