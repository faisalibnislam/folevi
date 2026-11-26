// Package mail sends Folevi Mail through Resend's HTTP API. The API key is never logged, and neither is any
// message's subject, body or recipient.
package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Message is one email.
type Message struct {
	From    string
	To      string
	ReplyTo string
	Subject string
	HTML    string
	Text    string
	Tag     string
}

// Sender sends one message and returns the provider's id.
type Sender interface {
	Send(ctx context.Context, m Message) (string, error)
}

// ErrBusy means the provider asked us to slow down (try again later).
var ErrBusy = errors.New("mail provider busy")

// Resend is a Sender on https://api.resend.com.
type Resend struct {
	BaseURL string
	APIKey  string // never logged
	Client  *http.Client
}

func NewResend(apiKey string) *Resend {
	return &Resend{BaseURL: "https://api.resend.com", APIKey: apiKey, Client: &http.Client{Timeout: 20 * time.Second}}
}

type resendTag struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type resendBody struct {
	From    string      `json:"from"`
	To      []string    `json:"to"`
	Subject string      `json:"subject"`
	HTML    string      `json:"html,omitempty"`
	Text    string      `json:"text,omitempty"`
	ReplyTo string      `json:"reply_to,omitempty"`
	Tags    []resendTag `json:"tags,omitempty"`
}

func (r *Resend) Send(ctx context.Context, m Message) (string, error) {
	if r.APIKey == "" {
		return "", errors.New("mail: no provider key")
	}
	body := resendBody{From: m.From, To: []string{m.To}, Subject: m.Subject, HTML: m.HTML, Text: m.Text, ReplyTo: m.ReplyTo}
	if m.Tag != "" {
		body.Tags = []resendTag{{Name: "category", Value: m.Tag}}
	}
	b, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(r.BaseURL, "/")+"/emails", bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+r.APIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := r.Client.Do(req)
	if err != nil {
		return "", fmt.Errorf("mail: provider unreachable")
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500 {
		return "", ErrBusy
	}
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("mail: provider refused (status %d)", res.StatusCode)
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || out.ID == "" {
		return "", errors.New("mail: provider answered without an id")
	}
	return out.ID, nil
}

// FromHeader builds the From header for a server's mail: "Folevi Server (<name>)" <address>. The server picks
// its own name, so it never stands alone as the sender: the fixed label comes first and the name goes in
// brackets, made safe for a header (no quotes, brackets, control characters or line breaks, at most 40
// characters). With nothing left it is just "Folevi Server".
func FromHeader(name, address string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r < 0x20 || r == 0x7f:
			b.WriteByte(' ')
		case r == '"', r == '<', r == '>', r == '\\', r == ',', r == ';', r == ':', r == '@', r == '(', r == ')', r == '[', r == ']':
			continue
		default:
			b.WriteRune(r)
		}
	}
	clean := strings.Join(strings.Fields(b.String()), " ")
	if rs := []rune(clean); len(rs) > 40 {
		clean = strings.TrimSpace(string(rs[:40]))
	}
	display := "Folevi Server"
	if clean != "" && !strings.EqualFold(clean, display) {
		display += " (" + clean + ")"
	}
	return `"` + display + `" <` + address + `>`
}
