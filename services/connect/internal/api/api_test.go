package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"folevi.com/connect/internal/ai"
	"folevi.com/connect/internal/config"
	"folevi.com/connect/internal/dns"
	"folevi.com/connect/internal/mail"
	"folevi.com/connect/internal/push"
	"folevi.com/connect/internal/relay"
	"folevi.com/connect/internal/store"
	"folevi.com/connect/internal/testutil"
)

type fakeMail struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (f *fakeMail) Send(_ context.Context, m mail.Message) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, m)
	return "re-1", nil
}

type fakePush struct {
	mu   sync.Mutex
	sent []push.Notification
}

func (f *fakePush) Send(_ context.Context, n push.Notification) push.Result {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, n)
	if strings.HasPrefix(n.Token, "ffff") {
		return push.Result{Outcome: push.Gone, Reason: "Unregistered"}
	}
	return push.Result{Outcome: push.Sent}
}

type env struct {
	t     *testing.T
	api   *API
	srv   *httptest.Server
	st    *store.SQLite
	dns   *dns.Memory
	logs  *testutil.LogBuffer
	mail  *fakeMail
	apns  *fakePush
	clock time.Time
	mu    sync.Mutex
}

var baseEnv = map[string]string{
	"CONNECT_SERVICE_KEY":         "svc-key-secret",
	"CONNECT_ADMIN_KEY":           "admin-key-secret",
	"CONNECT_RELAY_IPV4":          "198.51.100.10",
	"UNSPLASH_ACCESS_KEY":         "unsplash-secret",
	"CONNECT_REACH_ALLOW_PRIVATE": "true",
	"CONNECT_REACH_TIMEOUT":       "3s",
}

func newEnv(t *testing.T, extra map[string]string, deps func(*Deps)) *env {
	t.Helper()
	vars := map[string]string{}
	for k, v := range baseEnv {
		vars[k] = v
	}
	for k, v := range extra {
		vars[k] = v
	}
	cfg, err := config.Load(func(k string) string { return vars[k] })
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.OpenSQLite(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	log, logs := testutil.Logger()
	mem := dns.NewMemory()
	e := &env{t: t, st: st, dns: mem, logs: logs, mail: &fakeMail{}, apns: &fakePush{}, clock: time.Now()}
	d := Deps{Config: cfg, Store: st, DNS: &dns.Manager{Provider: mem, Names: dns.Names{Zone: cfg.Zone}, TTL: 60}, Mail: e.mail, APNs: e.apns, Log: log,
		Now: func() time.Time { e.mu.Lock(); defer e.mu.Unlock(); return e.clock }}
	var a *API
	d.Relay = relay.New(relay.Config{}, dns.Names{Zone: cfg.Zone}, func(ctx context.Context, tok string) (string, error) { return a.TunnelAuth(ctx, tok) }, st, log)
	if deps != nil {
		deps(&d)
	}
	a = New(d)
	e.api = a
	e.srv = httptest.NewServer(a.Handler())
	t.Cleanup(e.srv.Close)
	return e
}

func (e *env) advance(d time.Duration) {
	e.mu.Lock()
	e.clock = e.clock.Add(d)
	e.mu.Unlock()
}

type resp struct {
	status int
	body   []byte
	header http.Header
}

func (r resp) json(t *testing.T) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(r.body, &m); err != nil {
		t.Fatalf("not JSON (%d): %s", r.status, r.body)
	}
	return m
}

func (e *env) do(method, path, token string, body any, headers ...string) resp {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		if s, ok := body.(string); ok {
			rd = strings.NewReader(s)
		} else {
			b, _ := json.Marshal(body)
			rd = bytes.NewReader(b)
		}
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return resp{status: res.StatusCode, body: b, header: res.Header}
}

type registered struct {
	id, token string
	key       ed25519.PrivateKey
}

func (e *env) register(name string) registered {
	e.t.Helper()
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	r := e.do("POST", "/v1/servers", "", map[string]string{"name": name, "version": "1.0.0", "publicKey": base64.StdEncoding.EncodeToString(pub)})
	if r.status != 201 {
		e.t.Fatalf("register %d %s", r.status, r.body)
	}
	m := r.json(e.t)
	return registered{id: m["serverId"].(string), token: m["token"].(string), key: priv}
}

func (e *env) link(s registered, user string) {
	e.t.Helper()
	code := e.do("POST", "/v1/servers/"+s.id+"/link-codes", s.token, nil).json(e.t)["code"].(string)
	if r := e.do("POST", "/v1/link-codes/"+code+"/approve", "svc-key-secret", nil, "X-Folevi-User", user); r.status != 200 {
		e.t.Fatalf("approve %d %s", r.status, r.body)
	}
}

func (e *env) noSecretsLogged(secrets ...string) {
	e.t.Helper()
	logs := e.logs.String()
	for _, s := range secrets {
		if s != "" && strings.Contains(logs, s) {
			e.t.Fatalf("log contains %q:\n%s", s, logs)
		}
	}
}

func (e *env) records(name string) []string {
	rs, _ := e.dns.List(context.Background(), name)
	var out []string
	for _, r := range rs {
		out = append(out, r.Type+" "+r.Content)
	}
	return out
}

// ---------------------------------------------------------------- tests

func TestRegisterAndAuth(t *testing.T) {
	e := newEnv(t, map[string]string{"CONNECT_REGISTER_PER_IP_HOURLY": "3"}, nil)
	if r := e.do("POST", "/v1/servers", "", map[string]string{"name": "x", "version": "1", "publicKey": "short"}); r.status != 400 {
		t.Fatalf("bad key: %d", r.status)
	}
	a := e.register("Smith family")
	b := e.register("Other")
	if !regexp.MustCompile(`^[a-z2-7]{10}$`).MatchString(a.id) || !strings.HasPrefix(a.token, "fct_") {
		t.Fatalf("id %q token prefix", a.id)
	}
	if r := e.do("POST", "/v1/servers", "", map[string]string{"name": "x", "version": "1", "publicKey": base64.StdEncoding.EncodeToString(make([]byte, 32))}); r.status != 429 {
		t.Fatalf("register rate limit: %d", r.status)
	}
	r := e.do("GET", "/v1/servers/"+a.id, a.token, nil)
	m := r.json(t)
	if r.status != 200 || m["hostname"] != a.id+".folevi.app" || m["linked"] != false {
		t.Fatalf("get %d %s", r.status, r.body)
	}
	if r := e.do("GET", "/v1/servers/"+a.id, "fct_wrong", nil); r.status != 401 {
		t.Fatalf("wrong token %d", r.status)
	}
	if r := e.do("GET", "/v1/servers/"+a.id, "", nil); r.status != 401 {
		t.Fatalf("no token %d", r.status)
	}
	if r := e.do("GET", "/v1/servers/"+b.id, a.token, nil); r.status != 404 {
		t.Fatalf("other server %d", r.status)
	}
	if r := e.do("PATCH", "/v1/servers/"+b.id, a.token, map[string]any{"name": "pwned"}); r.status != 404 {
		t.Fatalf("patch other %d", r.status)
	}
	if got := e.records(a.id + ".folevi.app"); len(got) != 1 || got[0] != "A 198.51.100.10" {
		t.Fatalf("host should point at the relay: %v", got)
	}
	e.noSecretsLogged(a.token, b.token)
}

func TestPatchLanIPsAndDNS(t *testing.T) {
	e := newEnv(t, nil, nil)
	s := e.register("Home")
	for _, bad := range [][]string{{"8.8.8.8"}, {"192.168.1.2", "1.1.1.1"}, {"127.0.0.1"}, {"100.64.1.1"}, {"nope"}} {
		if r := e.do("PATCH", "/v1/servers/"+s.id, s.token, map[string]any{"lanIps": bad}); r.status != 400 {
			t.Fatalf("%v accepted: %d", bad, r.status)
		}
	}
	r := e.do("PATCH", "/v1/servers/"+s.id, s.token, map[string]any{"lanIps": []string{"192.168.1.20", "fd00::5"}, "name": "Home 2", "version": "1.1.0"})
	m := r.json(t)
	if r.status != 200 || m["name"] != "Home 2" || len(m["lanHostnames"].([]any)) != 2 {
		t.Fatalf("patch %d %s", r.status, r.body)
	}
	if got := e.records("192-168-1-20." + s.id + ".folevi.app"); len(got) != 1 || got[0] != "A 192.168.1.20" {
		t.Fatalf("lan record %v", got)
	}
	if got := e.records("fd00-0000-0000-0000-0000-0000-0000-0005." + s.id + ".folevi.app"); len(got) != 1 || got[0] != "AAAA fd00::5" {
		t.Fatalf("lan v6 record %v", got)
	}
	e.do("PATCH", "/v1/servers/"+s.id, s.token, map[string]any{"lanIps": []string{"10.0.0.9"}})
	if got := e.records("192-168-1-20." + s.id + ".folevi.app"); len(got) != 0 {
		t.Fatalf("old lan record kept: %v", got)
	}
	if got := e.records("10-0-0-9." + s.id + ".folevi.app"); len(got) != 1 {
		t.Fatalf("new lan record %v", got)
	}
}

func TestLinkFlow(t *testing.T) {
	e := newEnv(t, map[string]string{"CONNECT_LINK_CODES_PER_HOUR": "3"}, nil)
	s := e.register("Home")
	r := e.do("POST", "/v1/servers/"+s.id+"/link-codes", s.token, nil)
	m := r.json(t)
	code := m["code"].(string)
	if r.status != 201 || !regexp.MustCompile(`^[A-Z2-9]{4}-[A-Z2-9]{4}$`).MatchString(code) || m["approveUrl"] != "https://app.folevi.com/connect/approve?code="+url.QueryEscape(code) {
		t.Fatalf("code %s", r.body)
	}
	if r := e.do("POST", "/v1/link-codes/"+code+"/approve", "wrong", nil, "X-Folevi-User", "user1"); r.status != 401 {
		t.Fatalf("wrong service key %d", r.status)
	}
	if r := e.do("POST", "/v1/link-codes/"+code+"/approve", "svc-key-secret", nil); r.status != 400 {
		t.Fatalf("missing user %d", r.status)
	}
	// Codes are case- and dash-insensitive.
	if r := e.do("POST", "/v1/link-codes/"+strings.ToLower(strings.ReplaceAll(code, "-", ""))+"/approve", "svc-key-secret", nil, "X-Folevi-User", "user1"); r.status != 200 {
		t.Fatalf("approve %d %s", r.status, r.body)
	}
	if r := e.do("POST", "/v1/link-codes/"+code+"/approve", "svc-key-secret", nil, "X-Folevi-User", "user2"); r.status != 404 {
		t.Fatalf("second use %d", r.status)
	}
	m = e.do("GET", "/v1/servers/"+s.id, s.token, nil).json(t)
	if m["linked"] != true || m["ownerAccount"] != "user1" {
		t.Fatalf("not linked: %v", m)
	}
	r = e.do("GET", "/v1/accounts/user1/servers", "svc-key-secret", nil, "X-Folevi-User", "user1")
	var list []map[string]any
	_ = json.Unmarshal(r.body, &list)
	if r.status != 200 || len(list) != 1 || list[0]["serverId"] != s.id || list[0]["online"] != true || list[0]["role"] != "owner" {
		t.Fatalf("account servers %d %s", r.status, r.body)
	}
	if r := e.do("GET", "/v1/accounts/user1/servers", "svc-key-secret", nil, "X-Folevi-User", "user2"); r.status != 403 {
		t.Fatalf("other user's list %d", r.status)
	}
	// Expired after 10 minutes.
	code2 := e.do("POST", "/v1/servers/"+s.id+"/link-codes", s.token, nil).json(t)["code"].(string)
	e.advance(11 * time.Minute)
	if r := e.do("POST", "/v1/link-codes/"+code2+"/approve", "svc-key-secret", nil, "X-Folevi-User", "user1"); r.status != 404 {
		t.Fatalf("expired code %d", r.status)
	}
	// Offline once not seen for a while.
	e.advance(time.Hour)
	_ = json.Unmarshal(e.do("GET", "/v1/accounts/user1/servers", "svc-key-secret", nil, "X-Folevi-User", "user1").body, &list)
	if list[0]["online"] != false {
		t.Fatal("still online after an hour of silence")
	}
	e.do("POST", "/v1/servers/"+s.id+"/link-codes", s.token, nil)
	e.do("POST", "/v1/servers/"+s.id+"/link-codes", s.token, nil)
	e.do("POST", "/v1/servers/"+s.id+"/link-codes", s.token, nil)
	if r := e.do("POST", "/v1/servers/"+s.id+"/link-codes", s.token, nil); r.status != 429 {
		t.Fatalf("link code rate limit %d", r.status)
	}
	e.noSecretsLogged(code, code2, "svc-key-secret", s.token)
}

func TestAcmeRestrictedToOwnNames(t *testing.T) {
	e := newEnv(t, nil, nil)
	s := e.register("Home")
	o := e.register("Other")
	val := "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
	if r := e.do("PUT", "/v1/servers/"+s.id+"/acme/@", s.token, map[string]string{"value": val}); r.status != 200 {
		t.Fatalf("set %d %s", r.status, r.body)
	}
	if got := e.records("_acme-challenge." + s.id + ".folevi.app"); len(got) != 1 || got[0] != "TXT "+val {
		t.Fatalf("txt %v", got)
	}
	if r := e.do("PUT", "/v1/servers/"+s.id+"/acme/192-168-1-5", s.token, map[string]string{"value": val}); r.status != 200 {
		t.Fatalf("lan label %d", r.status)
	}
	for _, label := range []string{"8-8-8-8", "www", "x.y"} {
		if r := e.do("PUT", "/v1/servers/"+s.id+"/acme/"+label, s.token, map[string]string{"value": val}); r.status != 400 {
			t.Fatalf("label %q: %d", label, r.status)
		}
	}
	if r := e.do("PUT", "/v1/servers/"+o.id+"/acme/@", s.token, map[string]string{"value": val}); r.status != 404 {
		t.Fatalf("other server's name %d", r.status)
	}
	if r := e.do("PUT", "/v1/servers/"+s.id+"/acme/@", s.token, map[string]string{"value": "bad value\"; drop"}); r.status != 400 {
		t.Fatalf("bad value %d", r.status)
	}
	if r := e.do("DELETE", "/v1/servers/"+s.id+"/acme/@", s.token, map[string]string{"value": val}); r.status != 204 {
		t.Fatalf("delete %d", r.status)
	}
	if got := e.records("_acme-challenge." + s.id + ".folevi.app"); len(got) != 0 {
		t.Fatalf("txt left %v", got)
	}
}

// reachServer is a server's HTTPS port answering the reachability challenge with key.
func reachServer(t *testing.T, host string, key ed25519.PrivateKey, id string) (*httptest.Server, int) {
	cert, _ := testutil.SelfSigned(host)
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != ReachPath || r.Host != host {
			w.WriteHeader(404)
			return
		}
		sig := ed25519.Sign(key, ReachMessage(id, r.URL.Query().Get("nonce")))
		_ = json.NewEncoder(w).Encode(map[string]string{"signature": base64.StdEncoding.EncodeToString(sig)})
	}))
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{cert}}
	srv.StartTLS()
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	port, _ := strconv.Atoi(u.Port())
	return srv, port
}

func TestReachability(t *testing.T) {
	e := newEnv(t, nil, nil)
	s := e.register("Home")
	host := s.id + ".folevi.app"
	srv, port := reachServer(t, host, s.key, s.id)
	e.api.ReachRoots = newPool(srv.TLS.Certificates[0].Certificate[0])
	r := e.do("POST", "/v1/servers/"+s.id+"/reachability", s.token, map[string]int{"port": port})
	m := r.json(t)
	if r.status != 200 || m["reachable"] != true || m["certificateValid"] != true || m["publicIp"] != "127.0.0.1" {
		t.Fatalf("reach %d %s", r.status, r.body)
	}
	if got := e.records(host); len(got) != 1 || got[0] != "A 127.0.0.1" {
		t.Fatalf("host should point at the public address: %v", got)
	}
	// A different machine on that port (wrong key) is not this server: back to the relay.
	_, otherKey, _ := ed25519.GenerateKey(rand.Reader)
	_, port2 := reachServer(t, host, otherKey, s.id)
	m = e.do("POST", "/v1/servers/"+s.id+"/reachability", s.token, map[string]int{"port": port2}).json(t)
	if m["reachable"] != false {
		t.Fatalf("impostor accepted: %v", m)
	}
	if got := e.records(host); len(got) != 1 || got[0] != "A 198.51.100.10" {
		t.Fatalf("host should point back at the relay: %v", got)
	}
	// Nothing listening.
	m = e.do("POST", "/v1/servers/"+s.id+"/reachability", s.token, map[string]int{"port": 1}).json(t)
	if m["reachable"] != false {
		t.Fatal("closed port reachable")
	}
	// Without the test switch, a private caller address is never dialed.
	e2 := newEnv(t, map[string]string{"CONNECT_REACH_ALLOW_PRIVATE": "false"}, nil)
	s2 := e2.register("Home")
	_, port3 := reachServer(t, s2.id+".folevi.app", s2.key, s2.id)
	if m := e2.do("POST", "/v1/servers/"+s2.id+"/reachability", s2.token, map[string]int{"port": port3}).json(t); m["reachable"] != false {
		t.Fatal("dialed a private address")
	}
}

func TestMail(t *testing.T) {
	e := newEnv(t, map[string]string{"CONNECT_MAIL_PER_RECIPIENT_HOURLY": "2", "CONNECT_MAIL_PER_SERVER_DAILY": "4"}, nil)
	s := e.register("Smith \"family\"")
	msg := map[string]string{"to": "Alice <alice@example.com>", "subject": "Secret subject line", "html": "<p>secret body</p>", "text": "secret body", "replyTo": "owner@example.com", "tag": "invite"}
	if r := e.do("POST", "/v1/mail", s.token, msg); r.status != 403 || !strings.Contains(string(r.body), "not_linked") {
		t.Fatalf("unlinked %d %s", r.status, r.body)
	}
	e.link(s, "user1")
	r := e.do("POST", "/v1/mail", s.token, msg)
	if r.status != 202 || !strings.HasPrefix(r.json(t)["id"].(string), "m_") {
		t.Fatalf("send %d %s", r.status, r.body)
	}
	sent := e.mail.sent[0]
	if sent.From != `"Folevi Server (Smith family)" <no-reply@folevi.app>` || sent.To != "alice@example.com" || sent.ReplyTo != "owner@example.com" || sent.Tag != "invite" {
		t.Fatalf("sent %+v", sent)
	}
	for _, bad := range []map[string]string{
		{"to": "not an address", "subject": "s", "text": "t"},
		{"to": "a@example.com", "subject": "s\r\nBcc: x@evil.com", "text": "t"},
		{"to": "a@example.com", "subject": "s"},
		{"to": "a@example.com", "subject": "s", "text": "t", "tag": "Bad Tag"},
	} {
		if r := e.do("POST", "/v1/mail", s.token, bad); r.status != 400 {
			t.Fatalf("%v accepted: %d", bad, r.status)
		}
	}
	e.do("POST", "/v1/mail", s.token, msg)
	if r := e.do("POST", "/v1/mail", s.token, msg); r.status != 429 || !strings.Contains(string(r.body), "recipient") {
		t.Fatalf("recipient limit %d %s", r.status, r.body)
	}
	e.do("POST", "/v1/mail", s.token, map[string]string{"to": "b@example.com", "subject": "s", "text": "t"})
	e.do("POST", "/v1/mail", s.token, map[string]string{"to": "c@example.com", "subject": "s", "text": "t"})
	if r := e.do("POST", "/v1/mail", s.token, map[string]string{"to": "d@example.com", "subject": "s", "text": "t"}); r.status != 429 || !strings.Contains(string(r.body), "server_daily") {
		t.Fatalf("daily cap %d %s", r.status, r.body)
	}
	// Kill switch.
	if r := e.do("PUT", "/v1/admin/servers/"+s.id+"/flags", "admin-key-secret", map[string]bool{"MailDisabled": true}); r.status != 200 {
		t.Fatalf("flags %d %s", r.status, r.body)
	}
	if r := e.do("POST", "/v1/mail", s.token, msg); r.status != 403 {
		t.Fatalf("kill switch %d", r.status)
	}
	// Audit log: metadata only.
	r = e.do("GET", "/v1/admin/servers/"+s.id+"/mail-log", "admin-key-secret", nil)
	if r.status != 200 || strings.Contains(string(r.body), "alice@") || strings.Contains(string(r.body), "Secret subject") || !strings.Contains(string(r.body), `"recipientDomain":"example.com"`) || !strings.Contains(string(r.body), `"status":"limited"`) {
		t.Fatalf("mail log %s", r.body)
	}
	if r := e.do("GET", "/v1/admin/servers/"+s.id+"/mail-log", "svc-key-secret", nil); r.status != 401 {
		t.Fatalf("admin with the wrong key %d", r.status)
	}
	e.noSecretsLogged("Secret subject", "secret body", "alice@example.com", s.token, "admin-key-secret")
}

func TestPush(t *testing.T) {
	e := newEnv(t, map[string]string{"CONNECT_PUSH_PER_SERVER_HOURLY": "3"}, nil)
	s := e.register("Home")
	tok := strings.Repeat("a", 64)
	n := map[string]any{"platform": "apns", "token": tok, "title": "Private title", "body": "Private body", "data": map[string]string{"path": "/d/1"}}
	if r := e.do("POST", "/v1/push", s.token, n); r.status != 202 {
		t.Fatalf("push %d %s", r.status, r.body)
	}
	if e.apns.sent[0].Environment != "production" || e.apns.sent[0].Data["path"] != "/d/1" {
		t.Fatalf("sent %+v", e.apns.sent[0])
	}
	n["token"] = strings.Repeat("f", 64)
	if r := e.do("POST", "/v1/push", s.token, n); r.status != 410 {
		t.Fatalf("gone %d", r.status)
	}
	if r := e.do("POST", "/v1/push", s.token, map[string]any{"platform": "fcm", "token": "device-token-aaaaaaaaaaaaaaa", "title": "x"}); r.status != 503 {
		t.Fatalf("fcm not configured %d", r.status)
	}
	if r := e.do("POST", "/v1/push", s.token, map[string]any{"platform": "apns", "token": "nothex", "title": "x"}); r.status != 400 {
		t.Fatalf("invalid %d", r.status)
	}
	n["token"] = tok
	if r := e.do("POST", "/v1/push", s.token, n); r.status != 429 {
		t.Fatalf("rate limit %d", r.status)
	}
	e.do("PUT", "/v1/admin/servers/"+s.id+"/flags", "admin-key-secret", map[string]bool{"PushDisabled": true})
	if r := e.do("POST", "/v1/push", s.token, n); r.status != 403 {
		t.Fatalf("disabled %d", r.status)
	}
	e.noSecretsLogged(tok, "Private title", "Private body")
}

func TestAIGatewayThroughAPI(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer gemini-secret" {
			w.WriteHeader(401)
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}],"usage":{"total_tokens":12}}`))
	}))
	defer upstream.Close()
	var st store.Store
	e := newEnv(t, nil, func(d *Deps) {
		st = d.Store
		d.AI = &ai.Gateway{BaseURL: upstream.URL, APIKey: "gemini-secret", ChatModel: "m", EmbeddingModel: "e", Client: upstream.Client(), Usage: d.Store, Limits: ai.StaticLimits{Tokens: 1000}, MaxRequestBytes: 1 << 20}
	})
	s := e.register("Home")
	body := `{"messages":[{"role":"user","content":"private prompt"}]}`
	if r := e.do("POST", "/v1/ai/chat/completions", s.token, body); r.status != 403 || !strings.Contains(string(r.body), "not_linked") {
		t.Fatalf("unlinked %d %s", r.status, r.body)
	}
	e.link(s, "user1")
	r := e.do("POST", "/v1/ai/chat/completions", s.token, body)
	if r.status != 200 || !strings.Contains(string(r.body), `"ok"`) {
		t.Fatalf("ai %d %s", r.status, r.body)
	}
	// Counted for the owner's account, not the server.
	if n, _ := st.GetUsage(context.Background(), "owner:user1", ai.UsageKind, store.Month(time.Now())); n != 12 {
		t.Fatalf("usage %d", n)
	}
	if n, _ := st.GetUsage(context.Background(), s.id, ai.UsageKind, store.Month(time.Now())); n != 0 {
		t.Fatalf("usage under the server id %d", n)
	}
	if r := e.do("GET", "/v1/admin/servers/"+s.id, "admin-key-secret", nil); r.status != 200 || r.json(t)["usage"].(map[string]any)[ai.UsageKind] != float64(12) {
		t.Fatalf("admin usage %d %s", r.status, r.body)
	}
	e.noSecretsLogged("private prompt", "gemini-secret")
}

func TestUnsplashProxy(t *testing.T) {
	var gotQuery url.Values
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Client-ID unsplash-secret" || r.URL.Path != "/search/photos" {
			w.WriteHeader(401)
			return
		}
		gotQuery = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Total", "1")
		_, _ = w.Write([]byte(`{"results":[{"id":"abc"}]}`))
	}))
	defer upstream.Close()
	e := newEnv(t, map[string]string{"CONNECT_UNSPLASH_BASE_URL": upstream.URL}, nil)
	s := e.register("Home")
	r := e.do("GET", "/v1/unsplash/search/photos?query=lake&client_id=stolen", s.token, nil)
	if r.status != 200 || !strings.Contains(string(r.body), "abc") || r.header.Get("X-Total") != "1" || gotQuery.Get("query") != "lake" || gotQuery.Has("client_id") {
		t.Fatalf("unsplash %d %s %v", r.status, r.body, gotQuery)
	}
	if r := e.do("GET", "/v1/unsplash/users/someone", s.token, nil); r.status != 404 {
		t.Fatalf("path not allowed %d", r.status)
	}
}

func TestDiagnostics(t *testing.T) {
	e := newEnv(t, map[string]string{"CONNECT_DIAG_MAX_BYTES": "1000"}, nil)
	s := e.register("Home")
	r := e.do("POST", "/v1/diagnostics", s.token, map[string]string{"text": "log line 1\nlog line 2"})
	ref, _ := r.json(t)["reference"].(string)
	if r.status != 201 || !regexp.MustCompile(`^FD-[A-Z0-9]{8}$`).MatchString(ref) {
		t.Fatalf("diag %d %s", r.status, r.body)
	}
	if r := e.do("POST", "/v1/diagnostics", s.token, map[string]string{"text": strings.Repeat("x", 1001)}); r.status != 413 {
		t.Fatalf("too large %d", r.status)
	}
	r = e.do("GET", "/v1/admin/diagnostics/"+ref, "admin-key-secret", nil)
	if r.status != 200 || string(r.body) != "log line 1\nlog line 2" || r.header.Get("X-Folevi-Server") != s.id {
		t.Fatalf("fetch %d %s", r.status, r.body)
	}
}

func TestSuspendAndTunnel(t *testing.T) {
	e := newEnv(t, nil, nil)
	s := e.register("Home")
	e.link(s, "user1")
	ws := "ws" + strings.TrimPrefix(e.srv.URL, "http") + "/v1/tunnel"
	c, _, err := websocket.Dial(context.Background(), ws, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + s.token}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	deadline := time.Now().Add(3 * time.Second)
	for !e.api.Relay.Connected(s.id) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if m := e.do("GET", "/v1/servers/"+s.id, s.token, nil).json(t); m["tunnelConnected"] != true {
		t.Fatalf("tunnel not shown: %v", m)
	}
	e.do("PUT", "/v1/admin/servers/"+s.id+"/flags", "admin-key-secret", map[string]bool{"Suspended": true})
	if r := e.do("GET", "/v1/servers/"+s.id, s.token, nil); r.status != 403 {
		t.Fatalf("suspended server still served: %d", r.status)
	}
	deadline = time.Now().Add(3 * time.Second)
	for e.api.Relay.Connected(s.id) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if e.api.Relay.Connected(s.id) {
		t.Fatal("tunnel kept after suspension")
	}
	if _, _, err := websocket.Dial(context.Background(), ws, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + s.token}}}); err == nil {
		t.Fatal("suspended server opened a tunnel")
	}
	r := e.do("GET", "/v1/accounts/user1/servers", "svc-key-secret", nil, "X-Folevi-User", "user1")
	if strings.TrimSpace(string(r.body)) != "[]" {
		t.Fatalf("suspended server listed: %s", r.body)
	}
	if r := e.do("GET", "/healthz", "", nil); r.status != 200 {
		t.Fatal("healthz")
	}
	e.noSecretsLogged(s.token)
}

// Registration: one limit per IPv4 address or IPv6 /64, and one for all callers together.
func TestRegisterLimits(t *testing.T) {
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	body := func(name string) map[string]string {
		return map[string]string{"name": name, "version": "1", "publicKey": key}
	}
	e := newEnv(t, map[string]string{"CONNECT_REGISTER_PER_IP_HOURLY": "2", "CONNECT_REGISTER_GLOBAL_HOURLY": "5", "CONNECT_TRUSTED_PROXY_HEADER": "X-Test-IP"}, nil)
	from := func(ip string) int {
		return e.do("POST", "/v1/servers", "", body("x"), "X-Test-IP", ip).status
	}
	// A new address inside the same /64 does not get a new allowance.
	if a, b := from("2001:db8:1:2::1"), from("2001:db8:1:2:aaaa:bbbb:cccc:dddd"); a != 201 || b != 201 {
		t.Fatalf("first two from one /64: %d %d", a, b)
	}
	if got := from("2001:db8:1:2:ffff::9"); got != 429 {
		t.Fatalf("third registration from the same /64 got %d, want 429", got)
	}
	// Another /64 and an IPv4 address have their own.
	if a, b := from("2001:db8:1:3::1"), from("192.0.2.7"); a != 201 || b != 201 {
		t.Fatalf("other networks: %d %d", a, b)
	}
	// A refused or invalid request does not use up the cap for everyone.
	if r := e.do("POST", "/v1/servers", "", map[string]string{"name": "x", "version": "1", "publicKey": "short"}, "X-Test-IP", "192.0.2.50"); r.status != 400 {
		t.Fatalf("bad key %d", r.status)
	}
	if got := from("192.0.2.8"); got != 201 {
		t.Fatalf("fifth registration got %d", got)
	}
	// Five made this hour: the cap for all callers stops a sixth from any address.
	if got := from("192.0.2.9"); got != 429 {
		t.Fatalf("registration over the global cap got %d, want 429", got)
	}
	for in, want := range map[string]string{
		"2001:db8:1:2:aaaa:bbbb:cccc:dddd": "ip:2001:db8:1:2::/64", "192.0.2.7": "ip:192.0.2.7", "::ffff:192.0.2.7": "ip:192.0.2.7",
	} {
		if got := registerKey(netip.MustParseAddr(in)); got != want {
			t.Errorf("registerKey(%s) = %s, want %s", in, got, want)
		}
	}
}

// One account can own only so many servers, and its mail limits are shared by all of them.
func TestOwnerLimits(t *testing.T) {
	e := newEnv(t, map[string]string{"CONNECT_MAX_SERVERS_PER_OWNER": "2", "CONNECT_MAIL_PER_SERVER_HOURLY": "3",
		"CONNECT_REGISTER_PER_IP_HOURLY": "0"}, nil)
	approve := func(s registered, user string) resp {
		code := e.do("POST", "/v1/servers/"+s.id+"/link-codes", s.token, nil).json(t)["code"].(string)
		return e.do("POST", "/v1/link-codes/"+code+"/approve", "svc-key-secret", nil, "X-Folevi-User", user)
	}
	a, b, c := e.register("A"), e.register("B"), e.register("C")
	if r1, r2 := approve(a, "user1"), approve(b, "user1"); r1.status != 200 || r2.status != 200 {
		t.Fatalf("first two links: %d %d", r1.status, r2.status)
	}
	if r := approve(c, "user1"); r.status != 409 || !strings.Contains(string(r.body), "too_many_servers") {
		t.Fatalf("third server for one account got %d %s, want 409 too_many_servers", r.status, r.body)
	}
	if m := e.do("GET", "/v1/servers/"+c.id, c.token, nil).json(t); m["linked"] != false {
		t.Fatalf("the refused server was linked anyway: %v", m)
	}
	// Linking a server the account already owns again is not a new server, and another account is not affected.
	if r := approve(a, "user1"); r.status != 200 {
		t.Fatalf("relink %d %s", r.status, r.body)
	}
	if r := approve(c, "user2"); r.status != 200 {
		t.Fatalf("other account %d %s", r.status, r.body)
	}
	// A suspended server no longer takes a place.
	if r := e.do("PUT", "/v1/admin/servers/"+b.id+"/flags", "admin-key-secret", map[string]bool{"Suspended": true}); r.status != 200 {
		t.Fatalf("suspend %d", r.status)
	}
	d := e.register("D")
	if r := approve(d, "user1"); r.status != 200 {
		t.Fatalf("link after a suspension %d %s", r.status, r.body)
	}

	// Mail: user1's servers A and D share one hourly allowance of 3.
	mailTo := func(s registered, to string) resp {
		return e.do("POST", "/v1/mail", s.token, map[string]string{"to": to, "subject": "s", "text": "t"})
	}
	for i, s := range []registered{a, d, a} {
		if r := mailTo(s, "p"+strconv.Itoa(i)+"@example.com"); r.status != 202 {
			t.Fatalf("mail %d: %d %s", i, r.status, r.body)
		}
	}
	if r := mailTo(d, "p3@example.com"); r.status != 429 || !strings.Contains(string(r.body), "server_hourly") {
		t.Fatalf("fourth mail in the hour from the same owner's other server got %d %s, want 429 server_hourly", r.status, r.body)
	}
	// user2's server is not held back by user1's use.
	if r := mailTo(c, "q@example.com"); r.status != 202 {
		t.Fatalf("other owner's mail %d %s", r.status, r.body)
	}

	// The daily cap is the owner's too (no hourly limit here, so only the daily one can refuse).
	e2 := newEnv(t, map[string]string{"CONNECT_MAIL_PER_SERVER_HOURLY": "0", "CONNECT_MAIL_PER_SERVER_DAILY": "2"}, nil)
	x, y := e2.register("X"), e2.register("Y")
	e2.link(x, "user1")
	e2.link(y, "user1")
	send := func(s registered, to string) resp {
		return e2.do("POST", "/v1/mail", s.token, map[string]string{"to": to, "subject": "s", "text": "t"})
	}
	if r1, r2 := send(x, "a@example.com"), send(y, "b@example.com"); r1.status != 202 || r2.status != 202 {
		t.Fatalf("two mails in the day: %d %d", r1.status, r2.status)
	}
	if r := send(x, "c@example.com"); r.status != 429 || !strings.Contains(string(r.body), "server_daily") {
		t.Fatalf("third mail of the day from the same owner got %d %s, want 429 server_daily", r.status, r.body)
	}
}
