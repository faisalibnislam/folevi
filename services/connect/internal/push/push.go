// Package push is the Folevi push relay: Apple (APNs, token-based JWT over HTTP/2) and Google (FCM HTTP v1 with a
// service account). Apple and Google only accept Folevi's own keys for the App Store and Play builds, so servers
// send through here. Nothing in this package logs a device token, a title, a body or any data value.
package push

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Notification is one notice for one device.
type Notification struct {
	Platform    string            `json:"platform"`              // "apns" or "fcm"
	Token       string            `json:"token"`                 // device token, never logged
	Environment string            `json:"environment,omitempty"` // APNs: "production" (default) or "sandbox"
	Title       string            `json:"title"`
	Body        string            `json:"body"`
	Data        map[string]string `json:"data,omitempty"`
	CollapseID  string            `json:"collapseId,omitempty"`
	ThreadID    string            `json:"threadId,omitempty"`
}

// Outcome is what a send came to.
type Outcome string

const (
	Sent   Outcome = "sent"
	Gone   Outcome = "gone"   // the token is no longer valid; the server should forget it
	Busy   Outcome = "busy"   // the provider is overloaded or unreachable; try later
	Failed Outcome = "failed" // refused for another reason
)

// Result is an Outcome plus the provider's short reason code (BadDeviceToken, UNREGISTERED...).
type Result struct {
	Outcome Outcome
	Reason  string
}

// Sender delivers to one platform.
type Sender interface {
	Send(ctx context.Context, n Notification) Result
}

var (
	apnsTokenRe = regexp.MustCompile(`^[0-9a-f]{64,200}$`)
	fcmTokenRe  = regexp.MustCompile(`^[A-Za-z0-9_:\-.]{20,1000}$`)
	dataKeyRe   = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,31}$`)
)

var reservedKeys = map[string]bool{"aps": true, "from": true, "notification": true, "message_type": true, "collapse_key": true, "title": true, "body": true, "threadId": true, "collapseId": true}

// Validate checks a notification before it is sent.
func Validate(n *Notification) error {
	switch n.Platform {
	case "apns":
		if !apnsTokenRe.MatchString(n.Token) {
			return errors.New("token")
		}
		if n.Environment == "" {
			n.Environment = "production"
		}
		if n.Environment != "production" && n.Environment != "sandbox" {
			return errors.New("environment")
		}
	case "fcm":
		if !fcmTokenRe.MatchString(n.Token) {
			return errors.New("token")
		}
	default:
		return errors.New("platform")
	}
	if len(n.Title) > 400 || len(n.Body) > 1000 || n.Title == "" {
		return errors.New("title or body")
	}
	if len(n.CollapseID) > 64 || len(n.ThreadID) > 64 {
		return errors.New("collapseId or threadId")
	}
	if len(n.Data) > 16 {
		return errors.New("data has too many keys")
	}
	size := 0
	for k, v := range n.Data {
		if !dataKeyRe.MatchString(k) || reservedKeys[k] || strings.HasPrefix(k, "google") || strings.HasPrefix(k, "gcm") {
			return fmt.Errorf("data key")
		}
		size += len(k) + len(v)
	}
	if size > 2048 {
		return errors.New("data too large")
	}
	return nil
}

// Truncate cuts s to at most n bytes without splitting a UTF-8 character.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && n < len(s) && (s[n]&0xC0) == 0x80 {
		n--
	}
	return s[:n]
}
