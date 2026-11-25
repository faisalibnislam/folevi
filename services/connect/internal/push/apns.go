package push

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// APNs sends through Apple's provider API with a token (.p8 key) JWT, over HTTP/2.
type APNs struct {
	KeyID         string
	TeamID        string
	BundleID      string
	Key           *ecdsa.PrivateKey // never logged
	ProductionURL string            // "https://api.push.apple.com"
	SandboxURL    string            // "https://api.sandbox.push.apple.com"
	Client        *http.Client
	Now           func() time.Time

	mu    sync.Mutex
	jwt   string
	jwtAt time.Time
}

// ParseP8 reads Apple's .p8 key: PEM as downloaded, with "\n" written out, or just the base64 body.
func ParseP8(raw string) (*ecdsa.PrivateKey, error) {
	text := strings.TrimSpace(strings.ReplaceAll(raw, `\n`, "\n"))
	var der []byte
	if block, _ := pem.Decode([]byte(text)); block != nil {
		der = block.Bytes
	} else {
		b, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(text), ""))
		if err != nil {
			return nil, errors.New("apns key: not PEM or base64")
		}
		der = b
	}
	k, err := x509.ParsePKCS8PrivateKey(der)
	if err != nil {
		return nil, errors.New("apns key: not a PKCS#8 key")
	}
	ec, ok := k.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("apns key: not an EC key")
	}
	return ec, nil
}

// NewAPNs builds the sender; HTTP/2 is negotiated by the standard client over TLS.
func NewAPNs(keyID, teamID, bundleID string, key *ecdsa.PrivateKey) *APNs {
	return &APNs{KeyID: keyID, TeamID: teamID, BundleID: bundleID, Key: key,
		ProductionURL: "https://api.push.apple.com", SandboxURL: "https://api.sandbox.push.apple.com",
		Client: &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{ForceAttemptHTTP2: true, MaxIdleConnsPerHost: 4, IdleConnTimeout: 5 * time.Minute}},
		Now:    time.Now}
}

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// token is the provider JWT, kept 50 minutes (Apple refuses ones older than an hour and dislikes more than one
// new one every 20 minutes).
func (a *APNs) token(fresh bool) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.Now()
	if !fresh && a.jwt != "" && now.Sub(a.jwtAt) < 50*time.Minute {
		return a.jwt, nil
	}
	header, _ := json.Marshal(map[string]string{"alg": "ES256", "kid": a.KeyID})
	claims, _ := json.Marshal(map[string]any{"iss": a.TeamID, "iat": now.Unix()})
	input := b64url(header) + "." + b64url(claims)
	sum := sha256.Sum256([]byte(input))
	r, s, err := ecdsa.Sign(rand.Reader, a.Key, sum[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	a.jwt, a.jwtAt = input+"."+b64url(sig), now
	return a.jwt, nil
}

// Payload is the JSON Apple delivers: an alert with title and body, thread grouping, and the server's data
// keys at the top level (as the iOS app reads them).
func apnsPayload(n Notification) ([]byte, error) {
	aps := map[string]any{
		"alert":           map[string]string{"title": truncate(n.Title, 200), "body": truncate(n.Body, 500)},
		"sound":           "default",
		"mutable-content": 1,
	}
	if n.ThreadID != "" {
		aps["thread-id"] = n.ThreadID
	}
	if c := n.Data["category"]; c != "" {
		aps["category"] = c
	}
	out := map[string]any{"aps": aps}
	for k, v := range n.Data {
		if k != "category" {
			out[k] = v
		}
	}
	return json.Marshal(out)
}

func (a *APNs) Send(ctx context.Context, n Notification) Result {
	payload, err := apnsPayload(n)
	if err != nil {
		return Result{Outcome: Failed, Reason: "payload"}
	}
	base := a.ProductionURL
	if n.Environment == "sandbox" {
		base = a.SandboxURL
	}
	fresh := false
	for attempt := 0; attempt < 2; attempt++ {
		jwt, err := a.token(fresh)
		if err != nil {
			return Result{Outcome: Failed, Reason: "jwt"}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/3/device/"+n.Token, bytes.NewReader(payload))
		if err != nil {
			return Result{Outcome: Failed, Reason: "request"}
		}
		req.Header.Set("authorization", "bearer "+jwt)
		req.Header.Set("apns-push-type", "alert")
		req.Header.Set("apns-topic", a.BundleID)
		req.Header.Set("apns-priority", "10")
		req.Header.Set("apns-expiration", strconv.FormatInt(a.Now().Add(time.Hour).Unix(), 10))
		req.Header.Set("content-type", "application/json")
		if n.CollapseID != "" {
			req.Header.Set("apns-collapse-id", n.CollapseID)
		}
		res, err := a.Client.Do(req)
		if err != nil {
			return Result{Outcome: Busy, Reason: "unreachable"}
		}
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 8<<10))
		res.Body.Close()
		var body struct {
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(raw, &body)
		switch {
		case res.StatusCode == http.StatusOK:
			return Result{Outcome: Sent}
		case res.StatusCode == http.StatusGone, body.Reason == "BadDeviceToken", body.Reason == "Unregistered", body.Reason == "DeviceTokenNotForTopic":
			return Result{Outcome: Gone, Reason: body.Reason}
		case res.StatusCode == http.StatusForbidden && (body.Reason == "ExpiredProviderToken" || body.Reason == "InvalidProviderToken") && !fresh:
			fresh = true
			continue
		case res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500:
			return Result{Outcome: Busy, Reason: body.Reason}
		default:
			return Result{Outcome: Failed, Reason: body.Reason}
		}
	}
	return Result{Outcome: Failed, Reason: "provider_token"}
}
