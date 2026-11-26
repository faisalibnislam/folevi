// Package convex talks to the local Convex backend: readiness, environment variables (over its HTTP API, so
// their values never appear in a process list) and the Convex CLI for deploy, export and import. The admin key
// goes to the CLI through its environment. The one secret that does appear in a process list is the instance
// secret, on the backend's own command line (see backendCommand in package app).
package convex

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/faisalibnislam/folevi/server/folevid/internal/supervisor"
)

// Client is the backend's admin HTTP API.
type Client struct {
	URL      string // http://127.0.0.1:3510
	AdminKey string
	HTTP     *http.Client
}

func (c *Client) http() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{Proxy: nil}}
}

// Ready reports whether GET /version answers 200.
func (c *Client) Ready(ctx context.Context) bool {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.URL+"/version", nil)
	resp, err := c.http().Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// WaitReady polls Ready until it succeeds or ctx ends.
func (c *Client) WaitReady(ctx context.Context) error {
	for {
		if c.Ready(ctx) {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("backend did not become ready: %w", ctx.Err())
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func (c *Client) post(ctx context.Context, path string, body any, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Convex "+c.AdminKey)
	resp, err := c.http().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode/100 != 2 {
		msg := string(data)
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return fmt.Errorf("%s: %s: %s", path, resp.Status, msg)
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

// SetEnv sets Convex environment variables in one call. An empty value deletes the variable.
func (c *Client) SetEnv(ctx context.Context, vars map[string]string) error {
	names := make([]string, 0, len(vars))
	for k := range vars {
		names = append(names, k)
	}
	sort.Strings(names)
	type change struct {
		Name  string  `json:"name"`
		Value *string `json:"value"`
	}
	changes := make([]change, 0, len(names))
	for _, n := range names {
		v := vars[n]
		ch := change{Name: n}
		if v != "" {
			ch.Value = &v
		}
		changes = append(changes, ch)
	}
	return c.post(ctx, "/api/update_environment_variables", map[string]any{"changes": changes}, nil)
}

// GetEnv reads one Convex environment variable ("" when unset).
func (c *Client) GetEnv(ctx context.Context, name string) (string, error) {
	var res struct {
		Status       string `json:"status"`
		ErrorMessage string `json:"errorMessage"`
		Value        *struct {
			Value string `json:"value"`
		} `json:"value"`
	}
	err := c.post(ctx, "/api/query", map[string]any{
		"path": "_system/cli/queryEnvironmentVariables:get", "args": map[string]string{"name": name}, "format": "json",
	}, &res)
	if err != nil {
		return "", err
	}
	if res.Status != "success" {
		return "", fmt.Errorf("query env: %s", res.ErrorMessage)
	}
	if res.Value == nil {
		return "", nil
	}
	return res.Value.Value, nil
}

// FetchJWKS reads the Better Auth JWKS from the backend's HTTP actions port.
func FetchJWKS(ctx context.Context, siteURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, siteURL+"/api/auth/convex/jwks", nil)
	if err != nil {
		return "", err
	}
	resp, err := (&http.Client{Timeout: 20 * time.Second, Transport: &http.Transport{Proxy: nil}}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("jwks: %s", resp.Status)
	}
	var probe struct {
		Keys []json.RawMessage `json:"keys"`
	}
	if err := json.Unmarshal(b, &probe); err != nil || len(probe.Keys) == 0 {
		return "", errors.New("jwks: no keys in the answer")
	}
	// Compact it, so the stored value does not change with whitespace.
	var buf bytes.Buffer
	if err := json.Compact(&buf, b); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// CLI runs the Convex CLI from the bundle's functions folder with the bundle's Node.
type CLI struct {
	Node         Exec   // how to run node (may go through the private loader)
	FunctionsDir string // bundle/functions
	URL          string
	AdminKey     string
	Env          []string // PATH, TMPDIR and so on
	Output       io.Writer
}

// Exec turns a program and its arguments into a command (adds the private loader when there is one).
type Exec func(program string, args ...string) (string, []string)

// Run runs `convex <args>`. It refuses --prod: there is no cloud deployment here.
func (c *CLI) Run(ctx context.Context, args ...string) error {
	for _, a := range args {
		if a == "--prod" || strings.HasPrefix(a, "--prod=") {
			return errors.New("refusing --prod")
		}
	}
	main := filepath.Join(c.FunctionsDir, "node_modules", "convex", "bin", "main.js")
	if _, err := os.Stat(main); err != nil {
		return fmt.Errorf("the bundle has no Convex CLI: %w", err)
	}
	path, argv := c.Node("node", append([]string{main}, args...)...)
	env := supervisor.Environ(
		[]string{"CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"},
		append(append([]string{}, c.Env...),
			"CONVEX_SELF_HOSTED_URL="+c.URL,
			"CONVEX_SELF_HOSTED_ADMIN_KEY="+c.AdminKey,
			"CI=1", "NO_COLOR=1", "CONVEX_AGENT_MODE=", "npm_config_update_notifier=false")...)
	out := c.Output
	if out == nil {
		out = io.Discard
	}
	return supervisor.RunOnce(ctx, supervisor.Command{Path: path, Args: argv, Env: env, Dir: c.FunctionsDir}, out)
}

// Deploy pushes the functions. Code generation is off because the bundle may be read-only and already
// carries convex/_generated.
func (c *CLI) Deploy(ctx context.Context) error {
	return c.Run(ctx, "deploy", "--yes", "--typecheck=disable", "--codegen=disable")
}

// Export writes a snapshot ZIP (data and stored files) to path.
func (c *CLI) Export(ctx context.Context, path string) error {
	return c.Run(ctx, "export", "--include-file-storage", "--path", path)
}

// Import replaces everything in the deployment with a snapshot ZIP.
func (c *CLI) Import(ctx context.Context, path string) error {
	return c.Run(ctx, "import", "--replace-all", "--yes", "--format", "zip", path)
}
