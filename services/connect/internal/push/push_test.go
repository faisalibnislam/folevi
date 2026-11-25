package push

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func p8(t *testing.T) (*ecdsa.PrivateKey, string) {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	der, _ := x509.MarshalPKCS8PrivateKey(k)
	return k, string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func verifyES256(t *testing.T, jwt string, pub *ecdsa.PublicKey) map[string]any {
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		t.Fatalf("jwt %q", jwt)
	}
	sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if len(sig) != 64 || !ecdsa.Verify(pub, sum[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("bad ES256 signature")
	}
	var header, claims map[string]any
	h, _ := base64.RawURLEncoding.DecodeString(parts[0])
	c, _ := base64.RawURLEncoding.DecodeString(parts[1])
	_ = json.Unmarshal(h, &header)
	_ = json.Unmarshal(c, &claims)
	if header["alg"] != "ES256" || header["kid"] != "KEY123" {
		t.Fatalf("header %v", header)
	}
	return claims
}

const apnsToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestAPNsOverHTTP2(t *testing.T) {
	key, pemText := p8(t)
	parsed, err := ParseP8(strings.ReplaceAll(pemText, "\n", `\n`))
	if err != nil || !parsed.Equal(key) {
		t.Fatalf("ParseP8: %v", err)
	}
	var calls atomic.Int32
	var gotPayload map[string]any
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.ProtoMajor != 2 {
			t.Errorf("APNs needs HTTP/2, got %s", r.Proto)
		}
		claims := verifyES256(t, strings.TrimPrefix(r.Header.Get("authorization"), "bearer "), &key.PublicKey)
		if claims["iss"] != "TEAM1" || r.Header.Get("apns-topic") != "com.folevi.ios" || r.Header.Get("apns-push-type") != "alert" || r.Header.Get("apns-collapse-id") != "c1" {
			t.Errorf("headers/claims wrong: %v %v", claims, r.Header)
		}
		switch strings.TrimPrefix(r.URL.Path, "/3/device/") {
		case apnsToken:
			b, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(b, &gotPayload)
			w.WriteHeader(200)
		default:
			w.WriteHeader(410)
			_, _ = w.Write([]byte(`{"reason":"Unregistered"}`))
		}
	}))
	srv.EnableHTTP2 = true
	srv.StartTLS()
	defer srv.Close()
	a := NewAPNs("KEY123", "TEAM1", "com.folevi.ios", parsed)
	a.ProductionURL, a.SandboxURL, a.Client = srv.URL, srv.URL, srv.Client()
	n := Notification{Platform: "apns", Token: apnsToken, Title: "Reminder", Body: "Buy milk", ThreadID: "note1", CollapseID: "c1", Data: map[string]string{"path": "/d/1", "kind": "reminder"}}
	if err := Validate(&n); err != nil {
		t.Fatal(err)
	}
	if res := a.Send(context.Background(), n); res.Outcome != Sent {
		t.Fatalf("send %+v", res)
	}
	aps := gotPayload["aps"].(map[string]any)
	if aps["alert"].(map[string]any)["title"] != "Reminder" || aps["thread-id"] != "note1" || gotPayload["path"] != "/d/1" {
		t.Fatalf("payload %v", gotPayload)
	}
	n.Token = strings.Repeat("f", 64)
	if res := a.Send(context.Background(), n); res.Outcome != Gone || res.Reason != "Unregistered" {
		t.Fatalf("gone %+v", res)
	}
}

func TestAPNsRefreshesExpiredProviderToken(t *testing.T) {
	key, _ := p8(t)
	var seen []string
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Header.Get("authorization"))
		if len(seen) == 1 {
			w.WriteHeader(403)
			_, _ = w.Write([]byte(`{"reason":"ExpiredProviderToken"}`))
			return
		}
		w.WriteHeader(200)
	}))
	srv.EnableHTTP2 = true
	srv.StartTLS()
	defer srv.Close()
	a := NewAPNs("KEY123", "TEAM1", "com.folevi.ios", key)
	a.ProductionURL, a.Client = srv.URL, srv.Client()
	clock := time.Now()
	a.Now = func() time.Time { clock = clock.Add(time.Second); return clock }
	if res := a.Send(context.Background(), Notification{Platform: "apns", Token: apnsToken, Title: "x", Environment: "production"}); res.Outcome != Sent {
		t.Fatalf("%+v", res)
	}
	if len(seen) != 2 || seen[0] == seen[1] {
		t.Fatal("expected a fresh JWT on retry")
	}
}

func TestFCM(t *testing.T) {
	rk, _ := rsa.GenerateKey(rand.Reader, 2048)
	der, _ := x509.MarshalPKCS8PrivateKey(rk)
	var tokenCalls atomic.Int32
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			tokenCalls.Add(1)
			_ = r.ParseForm()
			parts := strings.Split(r.Form.Get("assertion"), ".")
			sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
			sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
			if rsa.VerifyPKCS1v15(&rk.PublicKey, crypto.SHA256, sum[:], sig) != nil {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"access_token":"ya29.fake","expires_in":3600}`))
		case "/v1/projects/proj1/messages:send":
			if r.Header.Get("Authorization") != "Bearer ya29.fake" {
				w.WriteHeader(401)
				return
			}
			b, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(b, &got)
			msg := got["message"].(map[string]any)
			if msg["token"] == "gone-token-aaaaaaaaaaaaaaaa" {
				w.WriteHeader(404)
				_, _ = w.Write([]byte(`{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}`))
				return
			}
			_, _ = w.Write([]byte(`{"name":"projects/proj1/messages/1"}`))
		}
	}))
	defer srv.Close()
	acct, _ := json.Marshal(map[string]string{"client_email": "push@proj1.iam.gserviceaccount.com", "private_key": string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), "project_id": "proj1", "token_uri": srv.URL + "/token"})
	f, err := NewFCM(acct, "")
	if err != nil {
		t.Fatal(err)
	}
	f.BaseURL = srv.URL
	n := Notification{Platform: "fcm", Token: "device-token-aaaaaaaaaaaaaaaa", Title: "Hi", Body: "There", CollapseID: "c9", Data: map[string]string{"path": "/d/2"}}
	if err := Validate(&n); err != nil {
		t.Fatal(err)
	}
	if res := f.Send(context.Background(), n); res.Outcome != Sent {
		t.Fatalf("%+v", res)
	}
	msg := got["message"].(map[string]any)
	data := msg["data"].(map[string]any)
	if data["title"] != "Hi" || data["path"] != "/d/2" || msg["android"].(map[string]any)["collapse_key"] != "c9" {
		t.Fatalf("message %v", got)
	}
	n.Token = "gone-token-aaaaaaaaaaaaaaaa"
	if res := f.Send(context.Background(), n); res.Outcome != Gone || res.Reason != "UNREGISTERED" {
		t.Fatalf("%+v", res)
	}
	if tokenCalls.Load() != 1 {
		t.Fatalf("access token fetched %d times, want 1 (cached)", tokenCalls.Load())
	}
}

func TestValidate(t *testing.T) {
	bad := []Notification{
		{Platform: "sms", Token: apnsToken, Title: "x"},
		{Platform: "apns", Token: "XYZ", Title: "x"},
		{Platform: "apns", Token: apnsToken, Title: ""},
		{Platform: "apns", Token: apnsToken, Title: "x", Environment: "dev"},
		{Platform: "apns", Token: apnsToken, Title: "x", Data: map[string]string{"aps": "x"}},
		{Platform: "fcm", Token: "short", Title: "x"},
		{Platform: "fcm", Token: "device-token-aaaaaaaaaaaaaaaa", Title: "x", Data: map[string]string{"google.x": "1"}},
	}
	for i, n := range bad {
		if Validate(&n) == nil {
			t.Errorf("case %d accepted", i)
		}
	}
}
