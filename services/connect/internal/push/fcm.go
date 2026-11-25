package push

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// ServiceAccount is the part of a Firebase service account JSON file FCM needs.
type ServiceAccount struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	ProjectID   string `json:"project_id"`
	TokenURI    string `json:"token_uri"`
}

// FCM sends through Firebase Cloud Messaging's HTTP v1 API.
type FCM struct {
	Account ServiceAccount
	Key     *rsa.PrivateKey // never logged
	BaseURL string          // "https://fcm.googleapis.com"
	Client  *http.Client
	Now     func() time.Time

	mu      sync.Mutex
	access  string // never logged
	accessT time.Time
}

const fcmScope = "https://www.googleapis.com/auth/firebase.messaging"

// NewFCM parses a service account JSON document.
func NewFCM(serviceAccountJSON []byte, projectOverride string) (*FCM, error) {
	var acct ServiceAccount
	if err := json.Unmarshal(serviceAccountJSON, &acct); err != nil {
		return nil, errors.New("fcm: service account is not JSON")
	}
	if projectOverride != "" {
		acct.ProjectID = projectOverride
	}
	if acct.ClientEmail == "" || acct.PrivateKey == "" || acct.ProjectID == "" {
		return nil, errors.New("fcm: service account is missing client_email, private_key or project_id")
	}
	if acct.TokenURI == "" {
		acct.TokenURI = "https://oauth2.googleapis.com/token"
	}
	block, _ := pem.Decode([]byte(strings.ReplaceAll(acct.PrivateKey, `\n`, "\n")))
	if block == nil {
		return nil, errors.New("fcm: private_key is not PEM")
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("fcm: private_key is not PKCS#8")
	}
	rk, ok := k.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("fcm: private_key is not RSA")
	}
	return &FCM{Account: acct, Key: rk, BaseURL: "https://fcm.googleapis.com", Client: &http.Client{Timeout: 10 * time.Second}, Now: time.Now}, nil
}

func (f *FCM) assertion(now time.Time) (string, error) {
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT"})
	claims, _ := json.Marshal(map[string]any{"iss": f.Account.ClientEmail, "scope": fcmScope, "aud": f.Account.TokenURI, "iat": now.Unix(), "exp": now.Add(time.Hour).Unix()})
	input := b64url(header) + "." + b64url(claims)
	sum := sha256.Sum256([]byte(input))
	sig, err := rsa.SignPKCS1v15(rand.Reader, f.Key, crypto.SHA256, sum[:])
	if err != nil {
		return "", err
	}
	return input + "." + b64url(sig), nil
}

// accessToken is the OAuth token for FCM, kept 50 minutes.
func (f *FCM) accessToken(ctx context.Context, fresh bool) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := f.Now()
	if !fresh && f.access != "" && now.Sub(f.accessT) < 50*time.Minute {
		return f.access, nil
	}
	a, err := f.assertion(now)
	if err != nil {
		return "", err
	}
	form := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"}, "assertion": {a}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, f.Account.TokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := f.Client.Do(req)
	if err != nil {
		return "", errors.New("fcm: token endpoint unreachable")
	}
	defer res.Body.Close()
	var body struct {
		AccessToken string `json:"access_token"`
	}
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode != http.StatusOK || json.Unmarshal(raw, &body) != nil || body.AccessToken == "" {
		return "", errors.New("fcm: token refused")
	}
	f.access, f.accessT = body.AccessToken, now
	return f.access, nil
}

// fcmMessage is data only, so the app draws the notification itself (as the cloud's FCM sender does).
func fcmMessage(n Notification) ([]byte, error) {
	data := map[string]string{"title": truncate(n.Title, 200), "body": truncate(n.Body, 500)}
	if n.ThreadID != "" {
		data["threadId"] = n.ThreadID
	}
	if n.CollapseID != "" {
		data["collapseId"] = n.CollapseID
	}
	for k, v := range n.Data {
		data[k] = v
	}
	android := map[string]any{"priority": "HIGH", "ttl": "3600s"}
	if n.CollapseID != "" {
		android["collapse_key"] = n.CollapseID
	}
	return json.Marshal(map[string]any{"message": map[string]any{"token": n.Token, "data": data, "android": android}})
}

// fcmErrorCode reads FCM's error code (UNREGISTERED...) from an error body.
func fcmErrorCode(raw []byte) string {
	var b struct {
		Error struct {
			Status  string `json:"status"`
			Details []struct {
				ErrorCode string `json:"errorCode"`
			} `json:"details"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &b) != nil {
		return ""
	}
	for _, d := range b.Error.Details {
		if d.ErrorCode != "" {
			return d.ErrorCode
		}
	}
	return b.Error.Status
}

func (f *FCM) Send(ctx context.Context, n Notification) Result {
	body, err := fcmMessage(n)
	if err != nil {
		return Result{Outcome: Failed, Reason: "payload"}
	}
	endpoint := strings.TrimRight(f.BaseURL, "/") + "/v1/projects/" + url.PathEscape(f.Account.ProjectID) + "/messages:send"
	fresh := false
	for attempt := 0; attempt < 2; attempt++ {
		tok, err := f.accessToken(ctx, fresh)
		if err != nil {
			return Result{Outcome: Busy, Reason: "oauth"}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			return Result{Outcome: Failed, Reason: "request"}
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Content-Type", "application/json")
		res, err := f.Client.Do(req)
		if err != nil {
			return Result{Outcome: Busy, Reason: "unreachable"}
		}
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 16<<10))
		res.Body.Close()
		code := fcmErrorCode(raw)
		switch {
		case res.StatusCode == http.StatusOK:
			return Result{Outcome: Sent}
		case res.StatusCode == http.StatusNotFound, code == "UNREGISTERED", code == "SENDER_ID_MISMATCH", res.StatusCode == http.StatusBadRequest && code == "INVALID_ARGUMENT":
			return Result{Outcome: Gone, Reason: code}
		case res.StatusCode == http.StatusUnauthorized && !fresh:
			fresh = true
			continue
		case res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500 || code == "UNAVAILABLE" || code == "INTERNAL" || code == "QUOTA_EXCEEDED":
			return Result{Outcome: Busy, Reason: code}
		default:
			return Result{Outcome: Failed, Reason: code}
		}
	}
	return Result{Outcome: Failed, Reason: "oauth"}
}
