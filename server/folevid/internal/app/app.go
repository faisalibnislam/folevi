// Package app wires folevid together: secrets, config, the two child services, the public proxy, the control
// API, deploys, backups, mDNS and Folevi Connect.
package app

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	stdlog "log"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/faisalibnislam/folevi/server/folevid/internal/backup"
	"github.com/faisalibnislam/folevi/server/folevid/internal/config"
	"github.com/faisalibnislam/folevi/server/folevid/internal/connect"
	"github.com/faisalibnislam/folevi/server/folevid/internal/control"
	"github.com/faisalibnislam/folevi/server/folevid/internal/convex"
	"github.com/faisalibnislam/folevi/server/folevid/internal/logs"
	"github.com/faisalibnislam/folevi/server/folevid/internal/netx"
	"github.com/faisalibnislam/folevi/server/folevid/internal/proxy"
	"github.com/faisalibnislam/folevi/server/folevid/internal/secrets"
	"github.com/faisalibnislam/folevi/server/folevid/internal/supervisor"
	"github.com/faisalibnislam/folevi/server/folevid/internal/sysinfo"
)

// InstanceName is the backend's instance name (it is part of the admin key).
const InstanceName = "folevi-server"

// ConfigError is a bad configuration (exit code 2).
type ConfigError struct{ Err error }

func (e *ConfigError) Error() string { return e.Err.Error() }
func (e *ConfigError) Unwrap() error { return e.Err }

// Options start an App.
type Options struct {
	DataDir      string
	BundleDir    string
	BuildVersion string // folevid's own version, used when the bundle has no VERSION
	Stderr       io.Writer
	Getenv       func(string) string
}

// App is a running folevid.
type App struct {
	opts    Options
	data    string
	bundle  Bundle
	version string
	cfg     *config.File
	sec     *secrets.Store
	red     *logs.Redactor
	log     *slog.Logger
	files   map[string]*logs.RotatingFile
	tmpDir  string
	pathEnv string

	backend *supervisor.Service
	web     *supervisor.Service
	conv    *convex.Client
	bk      *backup.Manager

	started  time.Time
	starting atomic.Bool
	ctx      context.Context

	originMu sync.Mutex
	origin   string

	deployMu sync.Mutex

	cert     atomic.Pointer[tls.Certificate]
	httpsMu  sync.Mutex
	httpsSrv *http.Server
	servers  []*http.Server

	remote remoteState

	diskMu     sync.Mutex
	diskAt     time.Time
	diskBytes  uint64
	lastNightly time.Time
}

// New prepares the data folder, secrets and config. It does not start anything.
func New(opts Options) (*App, error) {
	if opts.Getenv == nil {
		opts.Getenv = os.Getenv
	}
	if opts.Stderr == nil {
		opts.Stderr = os.Stderr
	}
	if opts.DataDir == "" || opts.BundleDir == "" {
		return nil, &ConfigError{errors.New("--data and --bundle are required")}
	}
	data, err := filepath.Abs(opts.DataDir)
	if err != nil {
		return nil, &ConfigError{err}
	}
	bdir, err := filepath.Abs(opts.BundleDir)
	if err != nil {
		return nil, &ConfigError{err}
	}
	a := &App{opts: opts, data: data, bundle: Bundle{Dir: bdir}, files: map[string]*logs.RotatingFile{}}
	a.version = a.bundle.Version()
	if a.version == "" {
		a.version = opts.BuildVersion
	}
	for _, d := range []string{"convex/storage", "backups", "logs", "tmp"} {
		if err := os.MkdirAll(filepath.Join(data, d), 0o750); err != nil {
			return nil, err
		}
	}
	_ = os.Chmod(filepath.Join(data, "backups"), 0o700)
	a.tmpDir = filepath.Join(data, "tmp")
	if v := opts.Getenv("FOLEVI_TMPDIR"); v != "" {
		a.tmpDir = v
		if err := os.MkdirAll(v, 0o750); err != nil {
			return nil, err
		}
	}
	if len(a.tmpDir) > 80 {
		return nil, &ConfigError{fmt.Errorf("the temp folder %s is %d characters; the backend needs 80 or fewer "+
			"(set FOLEVI_TMPDIR to a shorter folder)", a.tmpDir, len(a.tmpDir))}
	}
	if a.sec, err = secrets.Open(data); err != nil {
		return nil, err
	}
	a.red = logs.NewRedactor()
	if err := a.openLogs(); err != nil {
		return nil, err
	}
	if a.cfg, err = config.Load(data, opts.Getenv); err != nil {
		return nil, &ConfigError{err}
	}
	c := a.cfg.Get()
	if err := c.ApplyEnv(opts.Getenv); err != nil {
		return nil, &ConfigError{err}
	}
	if err := c.Validate(); err != nil {
		return nil, &ConfigError{err}
	}
	return a, nil
}

func (a *App) openLogs() error {
	for _, n := range []string{"folevid", "backend", "web"} {
		f, err := logs.OpenRotating(filepath.Join(a.data, "logs", n+".log"), logs.DefaultMaxBytes, logs.DefaultFiles)
		if err != nil {
			return err
		}
		a.files[n] = f
	}
	out := &logs.LineWriter{Out: io.MultiWriter(a.files["folevid"], a.opts.Stderr), Redactor: a.red}
	level := slog.LevelInfo
	if a.opts.Getenv("FOLEVI_DEBUG") == "1" {
		level = slog.LevelDebug
	}
	a.log = slog.New(slog.NewTextHandler(out, &slog.HandlerOptions{Level: level}))
	return nil
}

// Logger is folevid's logger.
func (a *App) Logger() *slog.Logger { return a.log }

// EnsureSecrets creates missing secrets (the admin key through the backend's keygen) and arms the redactor.
func (a *App) EnsureSecrets() error {
	keygen := func(inst string) (string, error) {
		if _, err := os.Stat(a.bundle.Backend()); err != nil {
			return "", fmt.Errorf("no backend program at %s", a.bundle.Backend())
		}
		path, args := a.bundle.Wrap(a.bundle.Backend(), "keygen", "admin-key", "--instance-name", InstanceName, "--instance-secret", inst)
		cmd := exec.Command(path, args...)
		cmd.Env = a.backendEnv()
		cmd.Dir = a.tmpDir
		out, err := cmd.Output()
		if err != nil {
			return "", fmt.Errorf("keygen failed: %s", a.red.Redact(errText(err)))
		}
		return lastLine(string(out)), nil
	}
	err := a.sec.EnsureAll(keygen)
	a.red.Set(a.sec.Values())
	return err
}

func errText(err error) string {
	var ee *exec.ExitError
	if errors.As(err, &ee) && len(ee.Stderr) > 0 {
		s := strings.TrimSpace(string(ee.Stderr))
		if len(s) > 300 {
			s = s[len(s)-300:]
		}
		return err.Error() + ": " + s
	}
	return err.Error()
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

// Origin is the public origin in use.
func (a *App) Origin() string {
	a.originMu.Lock()
	defer a.originMu.Unlock()
	if a.origin == "" {
		a.origin = a.computeOrigin()
	}
	return a.origin
}

// computeOrigin works out the public origin: the owner's fixed URL, their own domain, the Connect name when a
// certificate exists, else http://<LAN address>:<port>.
func (a *App) computeOrigin() string {
	c := a.cfg.Get()
	if c.PublicURL != "" {
		if o, err := config.NormalizeOrigin(c.PublicURL); err == nil {
			return o
		}
	}
	if d := strings.TrimSpace(c.Remote.CustomDomain); d != "" {
		return "https://" + d
	}
	if c.Remote.ConnectEnabled && c.Connect.Hostname != "" {
		if cert := a.cert.Load(); cert != nil && !connect.NeedsRenewal(cert, c.Connect.Hostname, time.Now().Add(29*24*time.Hour)) {
			return "https://" + c.Connect.Hostname
		}
	}
	host := sysinfo.PrimaryLANIP()
	if c.Port == 80 {
		return "http://" + host
	}
	return "http://" + net.JoinHostPort(host, strconv.Itoa(c.Port))
}

// memoryKnobs are the backend's concurrency settings (Phase 0 §5): the low profile by default, a larger one
// on machines with 8 GB or more.
func (a *App) memoryKnobs() (env []string, nodeHeapMB int) {
	profile := a.cfg.Get().MemoryProfile
	if profile == "" || profile == "auto" {
		total, _ := sysinfo.Memory()
		profile = "low"
		if total >= 8<<30-256<<20 { // "8 GB" machines report a little less
			profile = "high"
		}
	}
	if profile == "high" {
		return []string{"APPLICATION_MAX_CONCURRENT_QUERIES=16", "APPLICATION_MAX_CONCURRENT_MUTATIONS=16",
			"APPLICATION_MAX_CONCURRENT_V8_ACTIONS=16", "APPLICATION_MAX_CONCURRENT_NODE_ACTIONS=8",
			"ISOLATE_IDLE_TIMEOUT_SECONDS=120"}, 1024
	}
	return []string{"APPLICATION_MAX_CONCURRENT_QUERIES=4", "APPLICATION_MAX_CONCURRENT_MUTATIONS=4",
		"APPLICATION_MAX_CONCURRENT_V8_ACTIONS=4", "APPLICATION_MAX_CONCURRENT_NODE_ACTIONS=2",
		"ISOLATE_IDLE_TIMEOUT_SECONDS=30"}, 384
}

// pathWithNode is PATH with our Node first (through the loader shim when there is a private glibc).
func (a *App) pathWithNode() string {
	if a.pathEnv != "" {
		return a.pathEnv
	}
	first := a.bundle.NodeBinDir()
	if !a.bundle.HasBundledNode() {
		first = filepath.Dir(a.bundle.Node())
	}
	if shim, err := a.bundle.nodeShim(filepath.Join(a.tmpDir, "shim")); err == nil && shim != "" {
		first = shim
	}
	sys := a.opts.Getenv("PATH")
	if sys == "" {
		sys = "/usr/local/bin:/usr/bin:/bin"
	}
	a.pathEnv = first + string(os.PathListSeparator) + sys
	return a.pathEnv
}

func (a *App) backendEnv() []string {
	knobs, _ := a.memoryKnobs()
	extra := append([]string{"TMPDIR=" + a.tmpDir, "PATH=" + a.pathWithNode(), "DISABLE_BEACON=1"}, knobs...)
	return supervisor.Environ([]string{"NODE_OPTIONS", "INSTANCE_SECRET"}, extra...)
}

func (a *App) internalURL(port int) string { return "http://127.0.0.1:" + strconv.Itoa(port) }

func (a *App) backendCommand() (supervisor.Command, error) {
	if _, err := os.Stat(a.bundle.Backend()); err != nil {
		return supervisor.Command{}, fmt.Errorf("no backend program: %w", err)
	}
	inst, err := a.sec.MustGet(secrets.InstanceSecret)
	if err != nil {
		return supervisor.Command{}, err
	}
	c := a.cfg.Get()
	origin := a.Origin()
	path, args := a.bundle.Wrap(a.bundle.Backend(),
		filepath.Join(a.data, "convex", "convex.sqlite3"),
		"--db", "sqlite",
		"--interface", "127.0.0.1",
		"--port", strconv.Itoa(c.Internal.BackendPort),
		"--site-proxy-port", strconv.Itoa(c.Internal.SitePort),
		"--convex-origin", origin+"/convex",
		"--convex-site", origin+"/convex-site",
		"--instance-name", InstanceName,
		"--instance-secret", inst,
		"--local-storage", filepath.Join(a.data, "convex", "storage"),
		"--disable-beacon",
		"--redact-logs-to-client",
	)
	return supervisor.Command{Path: path, Args: args, Env: a.backendEnv(), Dir: filepath.Join(a.data, "convex")}, nil
}

func (a *App) webCommand() (supervisor.Command, error) {
	server := a.bundle.Path("web", "server.js")
	if _, err := os.Stat(server); err != nil {
		return supervisor.Command{}, fmt.Errorf("no web server: %w", err)
	}
	serverSecret, err := a.sec.MustGet(secrets.ServerSecret)
	if err != nil {
		return supervisor.Command{}, err
	}
	c := a.cfg.Get()
	_, heap := a.memoryKnobs()
	path, args := a.bundle.Wrap(a.bundle.Node(), server)
	env := supervisor.Environ([]string{"NODE_OPTIONS", "NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_CONVEX_SITE_URL"},
		"PORT="+strconv.Itoa(c.Internal.WebPort),
		"HOSTNAME=127.0.0.1",
		"NODE_ENV=production",
		"NEXT_TELEMETRY_DISABLED=1",
		"NODE_OPTIONS=--max-old-space-size="+strconv.Itoa(heap),
		"PATH="+a.pathWithNode(),
		"TMPDIR="+a.tmpDir,
		"FOLEVI_EDITION=server",
		"FOLEVI_PUBLIC_URL="+a.Origin(),
		"FOLEVI_INTERNAL_CONVEX_URL="+a.internalURL(c.Internal.BackendPort),
		"FOLEVI_INTERNAL_CONVEX_SITE_URL="+a.internalURL(c.Internal.SitePort),
		"FOLEVI_SERVER_SECRET="+serverSecret,
		"FOLEVI_CONTROL_URL="+a.internalURL(c.ControlPort),
		"FOLEVI_SERVER_VERSION="+a.version,
	)
	return supervisor.Command{Path: path, Args: args, Env: env, Dir: a.bundle.Path("web")}, nil
}

func (a *App) childOutput(name string) io.Writer {
	return &logs.LineWriter{Out: a.files[name], Redactor: a.red}
}

// Run starts everything and blocks until ctx ends, then stops everything cleanly.
func (a *App) Run(ctx context.Context) error {
	a.ctx = ctx
	a.started = time.Now()
	a.starting.Store(true)
	if err := a.EnsureSecrets(); err != nil {
		return err
	}
	c := a.cfg.Get()
	a.log.Info("folevid starting", "version", a.version, "data", a.data, "bundle", a.bundle.Dir, "loader", a.bundle.Loader() != "")
	if cert, err := connect.CertStore{Dir: a.sec.Path(secrets.TLSDir)}.Load(); err == nil && cert != nil {
		a.cert.Store(cert)
	}
	a.log.Info("public address", "origin", a.Origin())

	a.conv = &convex.Client{URL: a.internalURL(c.Internal.BackendPort)}
	a.conv.AdminKey, _ = a.sec.Get(secrets.AdminKey)
	a.bk = &backup.Manager{
		Dir: filepath.Join(a.data, "backups"), TmpDir: a.tmpDir, Version: a.version, Snap: a.snapshotter(),
		Secrets: a.portableSecrets, SetSecrets: a.restorePortableSecrets,
	}
	a.backend = supervisor.New(supervisor.Spec{Name: "backend", Build: a.backendCommand, Output: a.childOutput("backend"), Log: a.log})
	a.web = supervisor.New(supervisor.Spec{Name: "web", Build: a.webCommand, Output: a.childOutput("web"), Log: a.log})

	if err := a.listen(); err != nil {
		a.shutdownServers()
		return err
	}
	if a.cert.Load() != nil {
		if err := a.startHTTPS(); err != nil {
			a.log.Error("https listener", "err", err)
		}
	}

	a.backend.Start()
	readyCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	err := a.conv.WaitReady(readyCtx)
	cancel()
	if err != nil && ctx.Err() == nil {
		a.log.Error("backend did not start; still trying", "err", err)
	}
	if ctx.Err() == nil && err == nil {
		a.afterBackendReady(ctx, c)
	}
	a.web.Start()
	a.starting.Store(false)
	if ctx.Err() == nil {
		a.log.Info("folevid is up", "origin", a.Origin(), "port", c.Port)
	}

	var wg sync.WaitGroup
	bg, stopBG := context.WithCancel(ctx)
	for _, f := range []func(context.Context){a.scheduleLoop, a.mdnsLoop, a.remoteLoop} {
		wg.Add(1)
		go func(f func(context.Context)) { defer wg.Done(); f(bg) }(f)
	}

	<-ctx.Done()
	a.log.Info("stopping")
	stopBG()
	wg.Wait()
	a.shutdownServers()
	a.web.Stop()
	a.backend.Stop()
	a.remote.cleanup()
	a.log.Info("stopped")
	for _, f := range a.files {
		f.Close()
	}
	return nil
}

// afterBackendReady takes the pre-update backup when the bundle version changed, then deploys.
func (a *App) afterBackendReady(ctx context.Context, c config.Config) {
	if c.LastVersion != "" && c.LastVersion != a.version {
		a.log.Info("new version, taking a pre-update backup", "from", c.LastVersion, "to", a.version)
		if a.bk.TryLock() {
			_, err := a.createBackup(ctx, backup.KindPreUpdate)
			a.bk.Unlock()
			if err != nil {
				a.log.Error("pre-update backup failed", "err", err)
			}
		}
	}
	for attempt := 1; attempt <= 3 && ctx.Err() == nil; attempt++ {
		err := a.ensureDeployed(ctx, false)
		if err == nil {
			break
		}
		a.log.Error("deploy failed", "attempt", attempt, "err", a.red.Redact(err.Error()))
		select {
		case <-ctx.Done():
		case <-time.After(time.Duration(attempt*5) * time.Second):
		}
	}
	_ = a.cfg.Update(func(c *config.Config) error { c.LastVersion = a.version; return nil })
}

func (a *App) listen() error {
	c := a.cfg.Get()
	bind := c.BindAddress
	if bind == "" {
		bind = "0.0.0.0"
	}
	public := &http.Server{
		Addr:              net.JoinHostPort(bind, strconv.Itoa(c.Port)),
		Handler:           a.proxyHandler("http"),
		ReadHeaderTimeout: 30 * time.Second,
		ErrorLog:          slogErrorLog(a.log),
	}
	ctl := &http.Server{
		Addr:              net.JoinHostPort("127.0.0.1", strconv.Itoa(c.ControlPort)),
		Handler:           control.Handler(a, func() string { v, _ := a.sec.Get(secrets.ServerSecret); return v }, a.log),
		ReadHeaderTimeout: 10 * time.Second,
		ErrorLog:          slogErrorLog(a.log),
	}
	for _, s := range []*http.Server{public, ctl} {
		ln, err := net.Listen("tcp", s.Addr)
		if err != nil {
			return fmt.Errorf("listen %s: %w", s.Addr, err)
		}
		a.servers = append(a.servers, s)
		go func(s *http.Server, ln net.Listener) {
			if err := s.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
				a.log.Error("server stopped", "addr", s.Addr, "err", err)
			}
		}(s, ln)
	}
	return nil
}

func (a *App) proxyHandler(scheme string) http.Handler {
	c := a.cfg.Get()
	return proxy.New(&proxy.Targets{
		Web:      mustURL(a.internalURL(c.Internal.WebPort)),
		Convex:   mustURL(a.internalURL(c.Internal.BackendPort)),
		Site:     mustURL(a.internalURL(c.Internal.SitePort)),
		Scheme:   scheme,
		Logger:   a.log,
		Starting: func() bool { return a.starting.Load() },
	})
}

// startHTTPS starts the :8443 listener (once a certificate exists). The certificate is read per handshake,
// so renewals take effect without a restart.
func (a *App) startHTTPS() error {
	a.httpsMu.Lock()
	defer a.httpsMu.Unlock()
	if a.httpsSrv != nil {
		return nil
	}
	c := a.cfg.Get()
	bind := c.BindAddress
	if bind == "" {
		bind = "0.0.0.0"
	}
	srv := &http.Server{
		Addr:              net.JoinHostPort(bind, strconv.Itoa(c.HTTPSPort)),
		Handler:           a.proxyHandler("https"),
		ReadHeaderTimeout: 30 * time.Second,
		ErrorLog:          slogErrorLog(a.log),
		TLSConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
				if c := a.cert.Load(); c != nil {
					return c, nil
				}
				return nil, errors.New("no certificate")
			},
		},
	}
	ln, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		return err
	}
	a.httpsSrv = srv
	a.servers = append(a.servers, srv)
	go func() {
		if err := srv.ServeTLS(ln, "", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
			a.log.Error("https server stopped", "err", err)
		}
	}()
	a.log.Info("https listener started", "addr", srv.Addr)
	return nil
}

func (a *App) httpsRunning() bool {
	a.httpsMu.Lock()
	defer a.httpsMu.Unlock()
	return a.httpsSrv != nil
}

func (a *App) shutdownServers() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	a.httpsMu.Lock()
	servers := append([]*http.Server(nil), a.servers...)
	a.httpsMu.Unlock()
	for _, s := range servers {
		_ = s.Shutdown(ctx)
	}
}

// reconfigureOrigin restarts the backend and web when the public origin changed, and redeploys.
func (a *App) reconfigureOrigin(ctx context.Context) {
	a.originMu.Lock()
	next := a.computeOrigin()
	changed := next != a.origin
	a.origin = next
	a.originMu.Unlock()
	if !changed {
		return
	}
	a.log.Info("public address changed, restarting services", "origin", next)
	a.backend.Restart()
	rctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	time.Sleep(500 * time.Millisecond)
	if err := a.conv.WaitReady(rctx); err != nil {
		a.log.Error("backend did not come back", "err", err)
		return
	}
	if err := a.ensureDeployed(ctx, false); err != nil {
		a.log.Error("deploy after address change failed", "err", a.red.Redact(err.Error()))
	}
	a.web.Restart()
	a.announceAgain()
}

func mustURL(s string) *url.URL {
	u, err := url.Parse(s)
	if err != nil {
		panic(err)
	}
	return u
}

func slogErrorLog(l *slog.Logger) *stdlog.Logger { return slog.NewLogLogger(l.Handler(), slog.LevelWarn) }
