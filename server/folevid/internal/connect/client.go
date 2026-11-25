// Package connect is folevid's side of Folevi Connect (CONTRACT §9): registration, addresses, link codes,
// the DNS-01 certificate for <id>.folevi.app, the reachability check, the relay tunnel and diagnostics.
// Nothing here runs until the owner turns Connect on.
package connect

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client calls the Connect API.
type Client struct {
	BaseURL string        // https://connect.folevi.com (with or without /v1)
	Token   func() string // the server's connect token ("" before registration)
	HTTP    *http.Client
}

// APIError is a non-2xx answer.
type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string { return fmt.Sprintf("connect: HTTP %d: %s", e.Status, e.Body) }

func (c *Client) base() string {
	b := strings.TrimRight(c.BaseURL, "/")
	b = strings.TrimSuffix(b, "/v1")
	return b + "/v1"
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base()+path, body)
	if err != nil {
		return err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if c.Token != nil {
		if t := c.Token(); t != "" {
			req.Header.Set("Authorization", "Bearer "+t)
		}
	}
	hc := c.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode/100 != 2 {
		msg := strings.TrimSpace(string(data))
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return &APIError{Status: resp.StatusCode, Body: msg}
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

// Registration is the answer to POST /v1/servers.
type Registration struct {
	ServerID string `json:"serverId"`
	Token    string `json:"token"`
}

// Register creates the server's Connect entry. publicKey is the Ed25519 public key, base64.
func (c *Client) Register(ctx context.Context, name, version, publicKey string) (Registration, error) {
	var r Registration
	err := c.do(ctx, http.MethodPost, "/servers", map[string]string{"name": name, "version": version, "publicKey": publicKey}, &r)
	if err == nil && (r.ServerID == "" || r.Token == "") {
		err = fmt.Errorf("connect: registration answer is missing serverId or token")
	}
	return r, err
}

// Patch is PATCH /v1/servers/{id}.
type Patch struct {
	Name       string   `json:"name,omitempty"`
	Version    string   `json:"version,omitempty"`
	LANIPs     []string `json:"lanIps,omitempty"`
	PublicPort int      `json:"publicPort,omitempty"`
}

// Update sends the server's name, version and addresses.
func (c *Client) Update(ctx context.Context, id string, p Patch) error {
	return c.do(ctx, http.MethodPatch, "/servers/"+url.PathEscape(id), p, nil)
}

// LinkCode is the answer to POST /v1/servers/{id}/link-codes.
type LinkCode struct {
	Code       string `json:"code"`
	ApproveURL string `json:"approveUrl"`
}

// NewLinkCode asks for a code the owner approves in their Folevi account (valid 10 minutes).
func (c *Client) NewLinkCode(ctx context.Context, id string) (LinkCode, error) {
	var l LinkCode
	err := c.do(ctx, http.MethodPost, "/servers/"+url.PathEscape(id)+"/link-codes", map[string]string{}, &l)
	return l, err
}

// ServerState is GET /v1/servers/{id}.
type ServerState struct {
	Linked       bool     `json:"linked"`
	OwnerAccount string   `json:"ownerAccount,omitempty"`
	Hostname     string   `json:"hostname"`
	LANHostnames []string `json:"lanHostnames"`
	Reachable    *bool    `json:"reachable,omitempty"`
}

// State reads the server's Connect entry.
func (c *Client) State(ctx context.Context, id string) (ServerState, error) {
	var s ServerState
	err := c.do(ctx, http.MethodGet, "/servers/"+url.PathEscape(id), nil, &s)
	return s, err
}

// SetACME sets the DNS-01 TXT value for _acme-challenge.<label>.<id>.folevi.app ("@" for the bare name).
func (c *Client) SetACME(ctx context.Context, id, label, value string) error {
	return c.do(ctx, http.MethodPut, "/servers/"+url.PathEscape(id)+"/acme/"+url.PathEscape(label), map[string]string{"value": value}, nil)
}

// DeleteACME removes it.
func (c *Client) DeleteACME(ctx context.Context, id, label, value string) error {
	return c.do(ctx, http.MethodDelete, "/servers/"+url.PathEscape(id)+"/acme/"+url.PathEscape(label), map[string]string{"value": value}, nil)
}

// Reachability is POST /v1/servers/{id}/reachability.
type Reachability struct {
	Reachable bool   `json:"reachable"`
	PublicIP  string `json:"publicIp"`
}

// CheckReachable asks Connect to connect back to the public port.
func (c *Client) CheckReachable(ctx context.Context, id string, port int) (Reachability, error) {
	var r Reachability
	err := c.do(ctx, http.MethodPost, "/servers/"+url.PathEscape(id)+"/reachability", map[string]int{"port": port}, &r)
	return r, err
}

// UploadDiagnostics sends redacted logs and returns the reference to give support.
func (c *Client) UploadDiagnostics(ctx context.Context, text string) (string, error) {
	var r struct {
		Reference string `json:"reference"`
	}
	err := c.do(ctx, http.MethodPost, "/diagnostics", map[string]string{"text": text}, &r)
	return r.Reference, err
}
