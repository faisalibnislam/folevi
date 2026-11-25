package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"filippo.io/age"

	"github.com/faisalibnislam/folevi/server/folevid/internal/backup"
	"github.com/faisalibnislam/folevi/server/folevid/internal/config"
	"github.com/faisalibnislam/folevi/server/folevid/internal/control"
	"github.com/faisalibnislam/folevi/server/folevid/internal/secrets"
)

const fakeWeb = `const http = require("http");
http.createServer((req, res) => {
  res.setHeader("content-type", "text/plain");
  res.end("web ok " + process.env.FOLEVI_PUBLIC_URL + " " + process.env.FOLEVI_EDITION + " " + req.url);
}).listen(Number(process.env.PORT), process.env.HOSTNAME);
process.on("SIGTERM", () => process.exit(0));
`

const fakeCLI = `const fs = require("fs");
const args = process.argv.slice(2);
if (!process.env.CONVEX_SELF_HOSTED_URL || !process.env.CONVEX_SELF_HOSTED_ADMIN_KEY) { console.error("no target"); process.exit(3); }
if (process.env.CONVEX_DEPLOYMENT) { console.error("stray CONVEX_DEPLOYMENT"); process.exit(4); }
fs.appendFileSync(process.env.FAKE_CLI_LOG, args.join(" ") + "\n");
if (args[0] === "export") {
  const p = args[args.indexOf("--path") + 1];
  fs.writeFileSync(p, "FAKE-EXPORT");
}
console.log("Deployed Convex functions (fake) admin " + process.env.CONVEX_SELF_HOSTED_ADMIN_KEY);
`

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func writeFile(t *testing.T, path, content string, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatal(err)
	}
}

// TestIntegration runs folevid with a fake backend, a fake web server and a fake Convex CLI: first start,
// deploy, proxy routes, control API, crash restart, backup, restore, a second start that skips the deploy,
// and a clean stop.
func TestIntegration(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	root := t.TempDir()
	bundle := filepath.Join(root, "bundle")
	build := exec.Command("go", "build", "-o", filepath.Join(bundle, "bin", "convex-backend"), "./testdata/fakebackend")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build fake backend: %v\n%s", err, out)
	}
	writeFile(t, filepath.Join(bundle, "VERSION"), "9.9.9\n", 0o644)
	writeFile(t, filepath.Join(bundle, "web", "server.js"), fakeWeb, 0o644)
	writeFile(t, filepath.Join(bundle, "functions", "node_modules", "convex", "bin", "main.js"), fakeCLI, 0o644)
	writeFile(t, filepath.Join(bundle, "functions", "convex", "notes.ts"), "export const x = 1;\n", 0o644)

	data := filepath.Join(root, "d")
	if err := os.MkdirAll(data, 0o750); err != nil {
		t.Fatal(err)
	}
	cfg := config.Default()
	cfg.Port, cfg.HTTPSPort, cfg.ControlPort = freePort(t), freePort(t), freePort(t)
	cfg.Internal = config.Internal{WebPort: freePort(t), BackendPort: freePort(t), SitePort: freePort(t)}
	off := false
	cfg.MDNS = &off
	cfg.PublicURL = "http://folevi.test:" + strconv.Itoa(cfg.Port)
	b, _ := json.Marshal(cfg)
	writeFile(t, filepath.Join(data, "config.json"), string(b), 0o600)

	cliLog := filepath.Join(root, "cli.log")
	record := filepath.Join(root, "backend.json")
	t.Setenv("FAKE_CLI_LOG", cliLog)
	t.Setenv("FAKE_BACKEND_RECORD", record)
	t.Setenv("CONVEX_DEPLOYMENT", "prod:should-never-be-used")

	stderr := &syncBuf{}
	start := func() (*App, context.CancelFunc, chan error) {
		a, err := New(Options{DataDir: data, BundleDir: bundle, BuildVersion: "dev", Stderr: stderr})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() { done <- a.Run(ctx) }()
		return a, cancel, done
	}
	a, cancel, done := start()
	public := "http://127.0.0.1:" + strconv.Itoa(cfg.Port)
	ctl := "http://127.0.0.1:" + strconv.Itoa(cfg.ControlPort)

	waitFor(t, 20*time.Second, func() bool {
		body, code := get(t, public+"/documents", "")
		return code == 200 && strings.HasPrefix(body, "web ok")
	})

	// Secrets exist with private modes.
	sec := &secrets.Store{Dir: filepath.Join(data, "secrets")}
	serverSecret, _ := sec.Get(secrets.ServerSecret)
	if serverSecret == "" {
		t.Fatal("no server secret")
	}
	if st, _ := os.Stat(sec.Path(secrets.AdminKey)); st == nil || st.Mode().Perm() != 0o600 {
		t.Fatal("admin key missing or not 600")
	}

	// Routes.
	if body, _ := get(t, public+"/documents", ""); body != "web ok http://folevi.test:"+strconv.Itoa(cfg.Port)+" server /documents" {
		t.Fatalf("web: %q", body)
	}
	if body, code := get(t, public+"/convex/version", ""); code != 200 || body != "fake" {
		t.Fatalf("convex: %d %q", code, body)
	}
	if body, code := get(t, public+"/convex-site/api/auth/convex/jwks", ""); code != 200 || !strings.Contains(body, "k1") {
		t.Fatalf("site: %d %q", code, body)
	}

	// Backend flags and environment.
	var rec struct {
		Args []string `json:"args"`
		Env  []string `json:"env"`
	}
	rb, _ := os.ReadFile(record)
	_ = json.Unmarshal(rb, &rec)
	args := strings.Join(rec.Args, " ")
	for _, want := range []string{"--convex-origin " + cfg.PublicURL + "/convex", "--convex-site " + cfg.PublicURL + "/convex-site",
		"--disable-beacon", "--redact-logs-to-client", "--interface 127.0.0.1", "--local-storage " + filepath.Join(data, "convex", "storage")} {
		if !strings.Contains(args, want) {
			t.Errorf("backend args missing %q: %s", want, args)
		}
	}
	envs := strings.Join(rec.Env, "\n")
	for _, want := range []string{"TMPDIR=" + filepath.Join(data, "tmp"), "APPLICATION_MAX_CONCURRENT_QUERIES="} {
		if !strings.Contains(envs, want) {
			t.Errorf("backend env missing %q", want)
		}
	}

	// Deploy: env set through the admin API, deploy run twice on first start (JWKS), never --prod.
	waitFor(t, 10*time.Second, func() bool { return a.cfg.Get().Deployed.Version == "9.9.9" })
	cl, _ := os.ReadFile(cliLog)
	if n := strings.Count(string(cl), "deploy --yes --typecheck=disable --codegen=disable"); n != 2 {
		t.Fatalf("want 2 deploys, got %d:\n%s", n, cl)
	}
	if strings.Contains(string(cl), "--prod") {
		t.Fatal("--prod used")
	}
	fakeEnv := readEnv(t, filepath.Join(data, "convex", "fake-env.json"))
	for k, want := range map[string]string{"FOLEVI_EDITION": "server", "FOLEVI_ENV": "production", "SITE_URL": cfg.PublicURL,
		"FOLEVI_APP_URL": cfg.PublicURL, "FOLEVI_SERVER_VERSION": "9.9.9", "FOLEVI_SERVER_SECRET": serverSecret,
		"FOLEVI_JWKS": `{"keys":[{"kty":"RSA","kid":"k1","n":"abc","e":"AQAB"}]}`} {
		if fakeEnv[k] != want {
			t.Errorf("convex env %s = %q, want %q", k, fakeEnv[k], want)
		}
	}
	setup, _ := sec.Get(secrets.SetupToken)
	if fakeEnv["FOLEVI_SETUP_TOKEN_HASH"] != secrets.SHA256Hex(setup) {
		t.Error("setup token hash wrong")
	}

	// Control API.
	if _, code := get(t, ctl+"/v1/status", "wrong"); code != 401 {
		t.Fatalf("control without the secret: %d", code)
	}
	body, code := get(t, ctl+"/v1/status", serverSecret)
	var st control.Status
	_ = json.Unmarshal([]byte(body), &st)
	if code != 200 || st.Version != "9.9.9" || len(st.Services) != 3 || st.Memory.TotalBytes == 0 || st.Memory.Profile == "" {
		t.Fatalf("status: %d %s", code, body)
	}

	// Crash restart: kill the web process; it comes back.
	webPID := a.web.Status().PID
	_ = syscall.Kill(webPID, syscall.SIGKILL)
	waitFor(t, 15*time.Second, func() bool {
		s := a.web.Status()
		return s.Restarts == 1 && s.State == "running" && s.PID != webPID
	})
	waitFor(t, 10*time.Second, func() bool { _, code := get(t, public+"/", ""); return code == 200 })

	// Backup and restore through the API.
	body, code = post(t, ctl+"/v1/backups?wait=1", serverSecret)
	var bk struct{ ID string }
	_ = json.Unmarshal([]byte(body), &bk)
	if code != 200 || !strings.HasSuffix(bk.ID, "-manual") {
		t.Fatalf("backup: %d %s", code, body)
	}
	// Backups are encrypted with secrets/backup-key.
	raw, err := os.ReadFile(filepath.Join(data, "backups", bk.ID+".zip.age"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(raw), "age-encryption.org/v1\n") {
		t.Fatal("backup is not encrypted")
	}
	body, _ = get(t, ctl+"/v1/backups", serverSecret)
	if !strings.Contains(body, bk.ID) || !strings.Contains(body, `"encrypted":true`) {
		t.Fatalf("list: %s", body)
	}
	backupKey, _ := sec.Get(secrets.BackupKey)
	body, code = get(t, ctl+"/v1/backups/key", serverSecret)
	var bkKey struct{ Key, Recipient string }
	_ = json.Unmarshal([]byte(body), &bkKey)
	if code != 200 || backupKey == "" || bkKey.Key != backupKey || !strings.HasPrefix(bkKey.Recipient, "age1") {
		t.Fatalf("backup key: %d", code)
	}
	if _, code = get(t, ctl+"/v1/backups/key", ""); code != 401 {
		t.Fatalf("backup key without the secret: %d", code)
	}
	// A backup encrypted on another server: refused without its key (422), restored with it, and that key then
	// becomes this server's backup key.
	otherKey, _ := backup.NewKey()
	otherIdent, _ := age.ParseX25519Identity(otherKey)
	foreign := backup.NewID(time.Now().Add(-48*time.Hour), backup.KindManual)
	encZip, _ := os.ReadFile(filepath.Join(data, "backups", bk.ID+".zip.age"))
	{
		// Re-encrypt this server's backup to the other key, as if the other server had made it.
		r, err := age.Decrypt(bytes.NewReader(encZip), mustIdent(t, backupKey))
		if err != nil {
			t.Fatal(err)
		}
		var buf bytes.Buffer
		w, _ := age.Encrypt(&buf, otherIdent.Recipient())
		_, _ = io.Copy(w, r)
		_ = w.Close()
		if err := os.WriteFile(filepath.Join(data, "backups", foreign+".zip.age"), buf.Bytes(), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if body, code = post(t, ctl+"/v1/backups/"+foreign+"/restore", serverSecret); code != 422 {
		t.Fatalf("restore of a foreign backup without its key: %d %s", code, body)
	}
	if body, code = sendBody(t, "POST", ctl+"/v1/backups/"+foreign+"/restore", serverSecret, `{"key":"not-a-key"}`); code != 400 {
		t.Fatalf("restore with a malformed key: %d %s", code, body)
	}
	if body, code = sendBody(t, "POST", ctl+"/v1/backups/"+foreign+"/restore", serverSecret, `{"key":"`+otherKey+`"}`); code != 200 {
		t.Fatalf("restore with the other server's key: %d %s", code, body)
	}
	if now, _ := sec.Get(secrets.BackupKey); now != otherKey {
		t.Fatal("the key used for the restore did not become the backup key")
	}
	// A typed key that is not needed (this server's own key opens the backup) is not adopted.
	_ = sec.Set(secrets.BackupKey, backupKey)
	if body, code = sendBody(t, "POST", ctl+"/v1/backups/"+bk.ID+"/restore", serverSecret, `{"key":"`+otherKey+`"}`); code != 200 {
		t.Fatalf("restore with an unneeded key: %d %s", code, body)
	}
	if now, _ := sec.Get(secrets.BackupKey); now != backupKey {
		t.Fatal("an unneeded typed key replaced the backup key")
	}
	if body, code = post(t, ctl+"/v1/backups/"+bk.ID+"/restore", serverSecret); code != 200 {
		t.Fatalf("restore: %d %s", code, body)
	}
	cl, _ = os.ReadFile(cliLog)
	if !strings.Contains(string(cl), "import --replace-all --yes --format zip") {
		t.Fatalf("no import:\n%s", cl)
	}
	waitFor(t, 15*time.Second, func() bool { _, code := get(t, public+"/", ""); return code == 200 })

	// Logs are redacted: the fake CLI printed the admin key.
	adminKey, _ := sec.Get(secrets.AdminKey)
	logText, _ := os.ReadFile(filepath.Join(data, "logs", "folevid.log"))
	if !strings.Contains(string(logText), "Deployed Convex functions (fake)") {
		t.Fatal("CLI output not logged")
	}
	if strings.Contains(string(logText), adminKey) || strings.Contains(stderr.String(), adminKey) {
		t.Fatal("admin key leaked into the logs")
	}
	if strings.Contains(string(logText), backupKey) || strings.Contains(string(logText), otherKey) {
		t.Fatal("a backup key leaked into the logs")
	}
	if strings.Contains(string(logText), serverSecret) {
		t.Fatal("server secret leaked into the logs")
	}

	// Clean stop: children go away.
	backendPID := a.backend.Status().PID
	webPID = a.web.Status().PID
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("did not stop")
	}
	for _, pid := range []int{backendPID, webPID} {
		if syscall.Kill(pid, 0) == nil {
			t.Fatalf("pid %d still running", pid)
		}
	}

	// Second start with the same bundle: no new deploy.
	before, _ := os.ReadFile(cliLog)
	a, cancel, done = start()
	waitFor(t, 20*time.Second, func() bool { _, code := get(t, public+"/", ""); return code == 200 })
	after, _ := os.ReadFile(cliLog)
	if strings.Count(string(after), "deploy ") != strings.Count(string(before), "deploy ") {
		t.Fatalf("redeployed on a plain restart:\n%s", after)
	}
	cancel()
	<-done
	_ = a
}

func readEnv(t *testing.T, path string) map[string]string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	m := map[string]string{}
	_ = json.Unmarshal(b, &m)
	return m
}

func waitFor(t *testing.T, d time.Duration, f func() bool) {
	t.Helper()
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		if f() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("timed out after %s", d)
}

var client = &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{Proxy: nil}}

func get(t *testing.T, url, bearer string) (string, int) {
	return send(t, "GET", url, bearer)
}

func post(t *testing.T, url, bearer string) (string, int) {
	return send(t, "POST", url, bearer)
}

func send(t *testing.T, method, url, bearer string) (string, int) {
	return sendBody(t, method, url, bearer, "")
}

func sendBody(t *testing.T, method, url, bearer, body string) (string, int) {
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err.Error(), 0
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return string(b), resp.StatusCode
}

type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) { s.mu.Lock(); defer s.mu.Unlock(); return s.b.Write(p) }

func (s *syncBuf) String() string { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

func TestMemoryProfile(t *testing.T) {
	gb := uint64(1 << 30)
	for _, c := range []struct {
		set   string
		total uint64
		want  string
	}{{"", 2 * gb, "tiny"}, {"auto", 2*gb - 100<<20, "tiny"}, {"", 4 * gb, "low"}, {"", 8*gb - 200<<20, "high"},
		{"", 32 * gb, "high"}, {"low", 32 * gb, "low"}, {"", 0, "low"}} {
		if got := MemoryProfile(c.set, c.total); got != c.want {
			t.Errorf("MemoryProfile(%q, %d) = %s, want %s", c.set, c.total, got, c.want)
		}
	}
	env, heap := Knobs("tiny")
	if heap != 192 || !strings.Contains(strings.Join(env, " "), "APPLICATION_MAX_CONCURRENT_NODE_ACTIONS=1") {
		t.Fatal(env, heap)
	}
}

func TestLoaderWrap(t *testing.T) {
	dir := t.TempDir()
	b := Bundle{Dir: dir}
	if p, args := b.Wrap("/x/node", "a"); p != "/x/node" || len(args) != 1 {
		t.Fatal(p, args)
	}
	writeFile(t, filepath.Join(dir, "runtime", "lib", "ld-linux-aarch64.so.1"), "", 0o755)
	p, args := b.Wrap("/x/node", "a")
	if p != filepath.Join(dir, "runtime", "lib", "ld-linux-aarch64.so.1") ||
		fmt.Sprint(args) != fmt.Sprint([]string{"--library-path", filepath.Join(dir, "runtime", "lib"), "/x/node", "a"}) {
		t.Fatal(p, args)
	}
	writeFile(t, filepath.Join(dir, "runtime", "node", "bin", "node"), "", 0o755)
	shim, err := b.nodeShim(filepath.Join(dir, "shim"))
	if err != nil || shim == "" {
		t.Fatal(err)
	}
	s, _ := os.ReadFile(filepath.Join(shim, "node"))
	if !strings.Contains(string(s), "--library-path") {
		t.Fatal(string(s))
	}
}

// TestPatchedRunsDirectly: a program whose ELF interpreter is inside the bundle (patchelf'd for QNAP) is not
// wrapped; one using the system loader is.
func TestPatchedRunsDirectly(t *testing.T) {
	sys, err := exec.LookPath("ls")
	if err != nil || ELFInterp(sys) == "" {
		t.Skip("no dynamically linked ls")
	}
	dir := t.TempDir()
	b := Bundle{Dir: dir}
	loader := filepath.Join(dir, "runtime", "lib", "ld-linux-x86-64.so.2")
	writeFile(t, loader, "", 0o755)
	if p, _ := b.Wrap(sys); p != loader {
		t.Fatalf("system program not wrapped: %s", p)
	}
	patchelf, err := exec.LookPath("patchelf")
	if err != nil {
		t.Skip("patchelf not installed")
	}
	prog := filepath.Join(dir, "bin", "prog")
	data, _ := os.ReadFile(sys)
	writeFile(t, prog, string(data), 0o755)
	if out, err := exec.Command(patchelf, "--set-interpreter", loader, prog).CombinedOutput(); err != nil {
		t.Fatalf("patchelf: %v %s", err, out)
	}
	if p, _ := b.Wrap(prog); p != prog {
		t.Fatalf("patched program wrapped: %s", p)
	}
}

func mustIdent(t *testing.T, key string) *age.X25519Identity {
	t.Helper()
	id, err := age.ParseX25519Identity(key)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
