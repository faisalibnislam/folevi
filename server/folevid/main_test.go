package main

import (
	"bytes"
	"net"
	"net/http"
	"net/http/httptest"
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

// "setup-url --if-needed" is what package scripts write to their logs: the address (it carries the setup code)
// only while the running server has no owner.
func TestSetupURLIfNeeded(t *testing.T) {
	answer := `{"kind":"folevi-server","needsSetup":true}`
	status := http.StatusOK
	web := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/folevi.json" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(answer))
	}))
	defer web.Close()
	_, port, _ := net.SplitHostPort(web.Listener.Addr().String())
	data := t.TempDir()
	if err := os.MkdirAll(filepath.Join(data, "secrets"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(data, "config.json"), []byte(`{"port":`+port+`,"bindAddress":"127.0.0.1"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(data, "secrets", "setup-token"), []byte("setup-code-123\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"FOLEVI_PORT", "FOLEVI_BIND", "FOLEVI_DATA"} {
		t.Setenv(k, "")
	}
	try := func(args ...string) (int, string) {
		var out, errb bytes.Buffer
		code := run(append([]string{"setup-url", "--data", data}, args...), &out, &errb)
		return code, out.String()
	}
	if code, out := try("--if-needed"); code != 0 || !strings.Contains(out, "/setup?token=setup-code-123") {
		t.Fatalf("no owner yet: exit %d, printed %q", code, out)
	}
	answer = `{"kind":"folevi-server","needsSetup":false}`
	if code, out := try("--if-needed"); code != exitNothingToDo || out != "" {
		t.Fatalf("already set up: exit %d, printed %q, want exit %d and nothing", code, out, exitNothingToDo)
	}
	// Without the flag it is the owner asking at a terminal: always printed.
	if code, out := try(); code != 0 || !strings.Contains(out, "setup-code-123") {
		t.Fatalf("plain setup-url: exit %d %q", code, out)
	}
	// Anything that is not the server's own answer is "not yet", and prints nothing.
	for _, bad := range []struct {
		status int
		body   string
	}{{http.StatusServiceUnavailable, "Folevi is starting"}, {http.StatusOK, "<html>starting</html>"}, {http.StatusOK, `{"kind":"folevi-server"}`}} {
		status, answer = bad.status, bad.body
		if code, out := try("--if-needed"); code != 1 || out != "" {
			t.Fatalf("answer %d %q: exit %d, printed %q, want exit 1 and nothing", bad.status, bad.body, code, out)
		}
	}
	web.Close()
	if code, out := try("--if-needed"); code != 1 || out != "" {
		t.Fatalf("server down: exit %d, printed %q", code, out)
	}
}
