package connect

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
)

func TestDNSLabel(t *testing.T) {
	p := &DNSProvider{Hostname: "abcdefghij.folevi.app"}
	cases := map[string]string{
		"abcdefghij.folevi.app":              "@",
		"*.abcdefghij.folevi.app":            "@",
		"ABCDEFGHIJ.folevi.app.":             "@",
		"192-168-1-20.abcdefghij.folevi.app": "192-168-1-20",
	}
	for in, want := range cases {
		if got, err := p.Label(in); err != nil || got != want {
			t.Errorf("Label(%q) = %q %v", in, got, err)
		}
	}
	if _, err := p.Label("evil.example.com"); err == nil {
		t.Error("foreign domain accepted")
	}
}

type fakeConnect struct {
	mu   sync.Mutex
	acme map[string]string
	auth []string
}

func (f *fakeConnect) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.auth = append(f.auth, r.Header.Get("Authorization"))
	f.mu.Unlock()
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	switch {
	case r.Method == "POST" && r.URL.Path == "/v1/servers":
		if body["publicKey"] == "" || body["name"] == "" {
			http.Error(w, "bad", 400)
			return
		}
		_, _ = io.WriteString(w, `{"serverId":"abcdefghij","token":"tok-123456789"}`) // gitleaks:allow
	case r.Method == "PATCH" && r.URL.Path == "/v1/servers/abcdefghij":
		w.WriteHeader(204)
	case r.Method == "GET" && r.URL.Path == "/v1/servers/abcdefghij":
		_, _ = io.WriteString(w, `{"linked":true,"hostname":"abcdefghij.folevi.app","lanHostnames":["192-168-1-20.abcdefghij.folevi.app"]}`)
	case r.Method == "POST" && r.URL.Path == "/v1/servers/abcdefghij/link-codes":
		_, _ = io.WriteString(w, `{"code":"K7M2-Q9","approveUrl":"https://app.folevi.com/connect/approve?code=K7M2-Q9"}`)
	case strings.HasPrefix(r.URL.Path, "/v1/servers/abcdefghij/acme/"):
		label := strings.TrimPrefix(r.URL.Path, "/v1/servers/abcdefghij/acme/")
		f.mu.Lock()
		if r.Method == "PUT" {
			f.acme[label] = body["value"].(string)
		} else {
			delete(f.acme, label)
		}
		f.mu.Unlock()
		w.WriteHeader(204)
	case r.URL.Path == "/v1/servers/abcdefghij/reachability":
		_, _ = io.WriteString(w, `{"reachable":true,"publicIp":"203.0.113.9"}`)
	case r.URL.Path == "/v1/diagnostics":
		if !strings.Contains(body["text"].(string), "hello") {
			http.Error(w, "bad", 400)
			return
		}
		_, _ = io.WriteString(w, `{"reference":"D-42"}`)
	default:
		http.Error(w, "not found", 404)
	}
}

func TestClient(t *testing.T) {
	fc := &fakeConnect{acme: map[string]string{}}
	srv := httptest.NewServer(fc)
	defer srv.Close()
	token := ""
	c := &Client{BaseURL: srv.URL + "/v1/", Token: func() string { return token }}
	ctx := context.Background()
	reg, err := c.Register(ctx, "Home", "1.0.0", "cHVi")
	if err != nil || reg.ServerID != "abcdefghij" {
		t.Fatal(reg, err)
	}
	token = reg.Token
	if err := c.Update(ctx, reg.ServerID, Patch{LANIPs: []string{"192.168.1.20"}}); err != nil {
		t.Fatal(err)
	}
	st, err := c.State(ctx, reg.ServerID)
	if err != nil || !st.Linked || st.Hostname != "abcdefghij.folevi.app" {
		t.Fatal(st, err)
	}
	lc, err := c.NewLinkCode(ctx, reg.ServerID)
	if err != nil || lc.Code != "K7M2-Q9" {
		t.Fatal(lc, err)
	}
	r, err := c.CheckReachable(ctx, reg.ServerID, 443)
	if err != nil || !r.Reachable {
		t.Fatal(r, err)
	}
	ref, err := c.UploadDiagnostics(ctx, "hello")
	if err != nil || ref != "D-42" {
		t.Fatal(ref, err)
	}
	p := &DNSProvider{Client: c, ServerID: "abcdefghij", Hostname: "abcdefghij.folevi.app"}
	if err := p.Present("abcdefghij.folevi.app", "tok", "keyauth"); err != nil {
		t.Fatal(err)
	}
	if fc.acme["@"] == "" {
		t.Fatal("acme value not set")
	}
	if err := p.CleanUp("abcdefghij.folevi.app", "tok", "keyauth"); err != nil {
		t.Fatal(err)
	}
	if len(fc.acme) != 0 {
		t.Fatal("acme value not removed")
	}
	if fc.auth[0] != "" || fc.auth[1] != "Bearer tok-123456789" {
		t.Fatalf("auth headers %q", fc.auth[:2])
	}
	if _, err := c.State(ctx, "zzz"); err == nil {
		t.Fatal("404 not an error")
	}
}

// TestRelay plays the relay: it accepts the tunnel WebSocket, opens a yamux stream as a visitor would, and
// checks the bytes reach the local "HTTPS" listener and come back.
func TestRelay(t *testing.T) {
	local, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer local.Close()
	go func() {
		for {
			c, err := local.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				b := make([]byte, 5)
				_, _ = io.ReadFull(c, b)
				_, _ = c.Write(append([]byte("echo:"), b...))
			}()
		}
	}()
	got := make(chan string, 1)
	relaySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok-1" {
			http.Error(w, "no", 401)
			return
		}
		ws, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		conn := websocket.NetConn(r.Context(), ws, websocket.MessageBinary)
		cfg := yamux.DefaultConfig()
		cfg.LogOutput = io.Discard
		sess, err := yamux.Client(conn, cfg)
		if err != nil {
			return
		}
		st, err := sess.Open()
		if err != nil {
			return
		}
		_, _ = st.Write([]byte("PROXY TCP4 203.0.113.7 10.0.0.1 51234 443\r\nhello"))
		b := make([]byte, 10)
		_, _ = io.ReadFull(st, b)
		got <- string(b)
		<-r.Context().Done()
	}))
	defer relaySrv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := &Relay{URL: "ws" + strings.TrimPrefix(relaySrv.URL, "http") + "/v1/tunnel", Token: func() string { return "tok-1" },
		Target: local.Addr().String(), Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	go r.Run(ctx)
	select {
	case s := <-got:
		if s != "echo:hello" {
			t.Fatalf("got %q", s)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no answer through the tunnel")
	}
	if !r.Connected() {
		t.Fatal("not marked connected")
	}
}

func TestReadProxyHeader(t *testing.T) {
	a, b := net.Pipe()
	go func() {
		_, _ = a.Write([]byte("PROXY TCP4 203.0.113.7 10.0.0.1 51234 443\r\n\x16\x03\x01rest"))
		a.Close()
	}()
	c, err := ReadProxyHeader(b)
	if err != nil {
		t.Fatal(err)
	}
	if c.RemoteAddr().String() != "203.0.113.7:51234" {
		t.Fatalf("remote %s", c.RemoteAddr())
	}
	rest, _ := io.ReadAll(c)
	if string(rest) != "\x16\x03\x01rest" {
		t.Fatalf("rest %q", rest)
	}
	for _, bad := range []string{"GET / HTTP/1.1\r\n", "PROXY TCP4 x y z w\r\n", "PROXY TCP4 1.2.3.4 5.6.7.8 1 2"} {
		a, b := net.Pipe()
		go func() { _, _ = a.Write([]byte(bad)); a.Close() }()
		if _, err := ReadProxyHeader(b); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
}

func TestReachHandler(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(nil)
	h := ReachHandler(func() string { return "abcdefghij" }, func() (ed25519.PrivateKey, error) { return priv, nil })
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", ReachPath+"?nonce=n1", nil))
	var body struct{ Signature string }
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	sig, _ := base64.StdEncoding.DecodeString(body.Signature)
	if !ed25519.Verify(priv.Public().(ed25519.PublicKey), ReachMessage("abcdefghij", "n1"), sig) {
		t.Fatal("bad signature")
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", ReachPath, nil))
	if rec.Code != 404 {
		t.Fatal("no nonce answered")
	}
}
