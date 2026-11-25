package dns

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

// Cloudflare is a Provider on Cloudflare's v4 API for one zone. The token needs Zone.DNS edit on that zone only.
type Cloudflare struct {
	BaseURL string // "https://api.cloudflare.com/client/v4"
	ZoneID  string
	Token   string // never logged
	Client  *http.Client
}

func NewCloudflare(zoneID, token string) *Cloudflare {
	return &Cloudflare{BaseURL: "https://api.cloudflare.com/client/v4", ZoneID: zoneID, Token: token, Client: &http.Client{Timeout: 15 * time.Second}}
}

type cfRecord struct {
	ID      string `json:"id,omitempty"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	Content string `json:"content"`
	TTL     int    `json:"ttl"`
	Proxied bool   `json:"proxied"`
}

type cfEnvelope struct {
	Success bool            `json:"success"`
	Result  json.RawMessage `json:"result"`
	Errors  []struct {
		Code int `json:"code"`
	} `json:"errors"`
}

func (c *Cloudflare) do(ctx context.Context, method, path string, body any) (json.RawMessage, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.BaseURL, "/")+"/zones/"+url.PathEscape(c.ZoneID)+path, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cloudflare: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	var env cfEnvelope
	if err := json.Unmarshal(raw, &env); err != nil || !env.Success || res.StatusCode >= 300 {
		code := 0
		if len(env.Errors) > 0 {
			code = env.Errors[0].Code
		}
		return nil, fmt.Errorf("cloudflare: %s %s refused (status %d, code %d)", method, strings.SplitN(path, "?", 2)[0], res.StatusCode, code)
	}
	return env.Result, nil
}

func (c *Cloudflare) List(ctx context.Context, name string) ([]Record, error) {
	q := url.Values{"name": {name}, "per_page": {"100"}}
	raw, err := c.do(ctx, http.MethodGet, "/dns_records?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	var rs []cfRecord
	if err := json.Unmarshal(raw, &rs); err != nil {
		return nil, err
	}
	out := make([]Record, 0, len(rs))
	for _, r := range rs {
		out = append(out, Record{ID: r.ID, Name: r.Name, Type: r.Type, Content: r.Content, TTL: r.TTL})
	}
	return out, nil
}

func (c *Cloudflare) Create(ctx context.Context, r Record) error {
	ttl := r.TTL
	if ttl < 60 {
		ttl = 60
	}
	content := r.Content
	if r.Type == "TXT" {
		content = `"` + content + `"`
	}
	_, err := c.do(ctx, http.MethodPost, "/dns_records", cfRecord{Name: r.Name, Type: r.Type, Content: content, TTL: ttl})
	return err
}

func (c *Cloudflare) Delete(ctx context.Context, id string) error {
	_, err := c.do(ctx, http.MethodDelete, "/dns_records/"+url.PathEscape(id), nil)
	return err
}
