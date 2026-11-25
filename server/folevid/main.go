// folevid is Folevi Server's supervisor: it runs the Convex backend and the web app, serves them on one port,
// deploys the functions, takes backups and handles remote access. See README.md and
// docs/self-hosting/CONTRACT.md.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/faisalibnislam/folevi/server/folevid/internal/app"
	"github.com/faisalibnislam/folevi/server/folevid/internal/backup"
	"github.com/faisalibnislam/folevi/server/folevid/internal/config"
	"github.com/faisalibnislam/folevi/server/folevid/internal/control"
	"github.com/faisalibnislam/folevi/server/folevid/internal/secrets"
	"github.com/faisalibnislam/folevi/server/folevid/internal/sysinfo"
)

// version is set at build time (-ldflags "-X main.version=...").
var version = "dev"

const usage = `folevid, the Folevi Server supervisor

Usage:
  folevid run --data <dir> --bundle <dir>    start everything (stops cleanly on SIGTERM)
  folevid version                            print the version
  folevid setup-url --data <dir>             print the first-setup address
  folevid backup --data <dir>                take a backup now (folevid must be running)
  folevid restore <id> --data <dir> [--key-file <file>]
                                             restore a backup (folevid must be running); --key-file holds
                                             the backup key of the server that made it, if not this one
  folevid healthcheck --data <dir>           exit 0 when the backend and web app are running

Defaults: --data from FOLEVI_DATA, --bundle from FOLEVI_BUNDLE or the folder above bin/folevid.
Exit codes: 0 clean, 1 error, 2 bad configuration.
`

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	cmd, rest := args[0], args[1:]
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	fs.SetOutput(stderr)
	data := fs.String("data", os.Getenv("FOLEVI_DATA"), "data folder")
	bundle := fs.String("bundle", os.Getenv("FOLEVI_BUNDLE"), "bundle folder")
	keyFile := fs.String("key-file", "", "restore: file with the backup key of the server that made the backup")
	var positional []string
	// Allow flags after positional arguments (folevid restore <id> --data x).
	for len(rest) > 0 {
		if err := fs.Parse(rest); err != nil {
			return 2
		}
		rest = fs.Args()
		if len(rest) > 0 {
			positional = append(positional, rest[0])
			rest = rest[1:]
		}
	}
	if *bundle == "" {
		*bundle = defaultBundle()
	}
	switch cmd {
	case "version", "--version", "-v":
		fmt.Fprintln(stdout, versionString(*bundle))
		return 0
	case "help", "--help", "-h":
		fmt.Fprint(stdout, usage)
		return 0
	case "run":
		return cmdRun(*data, *bundle, stderr)
	case "setup-url":
		return cmdSetupURL(*data, stdout, stderr)
	case "backup":
		return cmdBackup(*data, stdout, stderr)
	case "restore":
		if len(positional) != 1 {
			fmt.Fprintln(stderr, "usage: folevid restore <id> --data <dir> [--key-file <file>]")
			return 2
		}
		return cmdRestore(*data, positional[0], *keyFile, stdout, stderr)
	case "healthcheck":
		return cmdHealth(*data, stdout, stderr)
	}
	fmt.Fprintf(stderr, "unknown command %q\n\n%s", cmd, usage)
	return 2
}

func defaultBundle() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if r, err := filepath.EvalSymlinks(exe); err == nil {
		exe = r
	}
	return filepath.Dir(filepath.Dir(exe))
}

func versionString(bundle string) string {
	v := version
	if bundle != "" {
		if b, err := os.ReadFile(filepath.Join(bundle, "VERSION")); err == nil && len(b) > 0 {
			return fmt.Sprintf("folevid %s (bundle %s)", version, string(trimNL(b)))
		}
	}
	return "folevid " + v
}

func trimNL(b []byte) []byte {
	for len(b) > 0 && (b[len(b)-1] == '\n' || b[len(b)-1] == '\r' || b[len(b)-1] == ' ') {
		b = b[:len(b)-1]
	}
	return b
}

func cmdRun(data, bundle string, stderr io.Writer) int {
	if data == "" {
		fmt.Fprintln(stderr, "folevid run: --data is required")
		return 2
	}
	a, err := app.New(app.Options{DataDir: data, BundleDir: bundle, BuildVersion: version, Stderr: stderr})
	if err != nil {
		return reportErr(stderr, err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	if err := a.Run(ctx); err != nil {
		a.Logger().Error("folevid stopped with an error", "err", err)
		return reportErr(stderr, err)
	}
	return 0
}

func reportErr(stderr io.Writer, err error) int {
	fmt.Fprintln(stderr, "folevid:", err)
	var ce *app.ConfigError
	if errors.As(err, &ce) {
		return 2
	}
	return 1
}

func loadLocal(data string) (config.Config, *secrets.Store, error) {
	if data == "" {
		return config.Config{}, nil, &app.ConfigError{Err: errors.New("--data is required")}
	}
	if _, err := os.Stat(filepath.Join(data, "config.json")); err != nil {
		return config.Config{}, nil, &app.ConfigError{Err: fmt.Errorf("%s has no config.json; has folevid run there yet?", data)}
	}
	f, err := config.Load(data, os.Getenv)
	if err != nil {
		return config.Config{}, nil, &app.ConfigError{Err: err}
	}
	sec := &secrets.Store{Dir: filepath.Join(data, "secrets")}
	return f.Get(), sec, nil
}

func cmdSetupURL(data string, stdout, stderr io.Writer) int {
	c, sec, err := loadLocal(data)
	if err != nil {
		return reportErr(stderr, err)
	}
	tok, err := sec.MustGet(secrets.SetupToken)
	if err != nil {
		return reportErr(stderr, err)
	}
	host := net.JoinHostPort(sysinfo.PrimaryLANIP(), strconv.Itoa(c.Port))
	fmt.Fprintf(stdout, "http://%s/setup?token=%s\n", host, url.QueryEscape(tok))
	return 0
}

// callControl calls the running folevid's control API.
func callControl(data, method, path string, timeout time.Duration, out any) error {
	return callControlBody(data, method, path, timeout, nil, out)
}

// callControlBody is callControl with a JSON request body (nil for none).
func callControlBody(data, method, path string, timeout time.Duration, in, out any) error {
	c, sec, err := loadLocal(data)
	if err != nil {
		return err
	}
	secret, err := sec.MustGet(secrets.ServerSecret)
	if err != nil {
		return err
	}
	var rd io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, "http://"+net.JoinHostPort("127.0.0.1", strconv.Itoa(c.ControlPort))+path, rd)
	req.Header.Set("Authorization", "Bearer "+secret)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := (&http.Client{Timeout: timeout, Transport: &http.Transport{Proxy: nil}}).Do(req)
	if err != nil {
		return fmt.Errorf("folevid is not running (control API: %v)", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &e)
		return fmt.Errorf("%s %s: %s %s", method, path, resp.Status, e.Error)
	}
	if out != nil {
		return json.Unmarshal(body, out)
	}
	return nil
}

func cmdBackup(data string, stdout, stderr io.Writer) int {
	var res struct {
		ID string `json:"id"`
	}
	if err := callControl(data, http.MethodPost, "/v1/backups?wait=1", 6*time.Hour, &res); err != nil {
		return reportErr(stderr, err)
	}
	fmt.Fprintln(stdout, res.ID)
	return 0
}

func cmdRestore(data, id, keyFile string, stdout, stderr io.Writer) int {
	if !backup.ValidID(id) {
		fmt.Fprintf(stderr, "folevid: %q is not a backup id (for example 20261125T030000Z-nightly)\n", id)
		return 2
	}
	// The key comes from a file, never the command line, so it stays out of the process list.
	var body any
	if keyFile != "" {
		b, err := os.ReadFile(keyFile)
		if err != nil {
			return reportErr(stderr, err)
		}
		if _, err := backup.ParseKey(string(b)); err != nil {
			fmt.Fprintf(stderr, "folevid: %s: %v\n", keyFile, err)
			return 2
		}
		body = control.RestoreRequest{Key: strings.TrimSpace(string(b))}
	}
	if err := callControlBody(data, http.MethodPost, "/v1/backups/"+id+"/restore", 6*time.Hour, body, nil); err != nil {
		return reportErr(stderr, err)
	}
	fmt.Fprintln(stdout, "restored", id)
	return 0
}

func cmdHealth(data string, stdout, stderr io.Writer) int {
	var st control.Status
	if err := callControl(data, http.MethodGet, "/v1/status", 10*time.Second, &st); err != nil {
		return reportErr(stderr, err)
	}
	ok := true
	for _, s := range st.Services {
		fmt.Fprintf(stdout, "%s: %s\n", s.Name, s.State)
		if s.State != "running" {
			ok = false
		}
	}
	if !ok {
		return 1
	}
	// Running is not enough: both must answer through the public port.
	c, _, err := loadLocal(data)
	if err != nil {
		return reportErr(stderr, err)
	}
	host := c.BindAddress
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	base := "http://" + net.JoinHostPort(host, strconv.Itoa(c.Port))
	hc := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: nil},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, chk := range []struct {
		name, path string
		ok         func(int) bool
	}{
		{"backend answers", "/convex/version", func(code int) bool { return code == http.StatusOK }},
		{"web answers", "/", func(code int) bool { return code > 0 && code < 500 }},
	} {
		code := 0
		if resp, err := hc.Get(base + chk.path); err == nil {
			code = resp.StatusCode
			resp.Body.Close()
		}
		fmt.Fprintf(stdout, "%s: %d\n", chk.name, code)
		if !chk.ok(code) {
			return 1
		}
	}
	return 0
}
