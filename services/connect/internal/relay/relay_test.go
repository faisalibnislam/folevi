package relay

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
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

	"folevi.com/connect/internal/dns"
	"folevi.com/connect/internal/testutil"
)

type memUsage struct {
	mu sync.Mutex
	m  map[string]int64
}

func (u *memUsage) AddUsage(_ context.Context, id, kind, period string, n int64) (int64, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.m[id+kind+period] += n
	return u.m[id+kind+period], nil
}

func (u *memUsage) GetUsage(_ context.Context, id, kind, period string) (int64, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.m[id+kind+period], nil
}

const serverID = "abcdefgh23"

// wire records every byte that crossed the tunnel stream (both directions), as the relay carried it.
type wire struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (w *wire) add(p []byte) {
	w.mu.Lock()
	w.buf.Write(p)
	w.mu.Unlock()
}

func (w *wire) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.String()
}

type tappedConn struct {
	net.Conn
	r   io.Reader
	tap *wire
}

func (c *tappedConn) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.tap.add(p[:n])
	return n, err
}

func (c *tappedConn) Write(p []byte) (int, error) {
	c.tap.add(p)
	return c.Conn.Write(p)
}

// fakeServer plays folevid: it dials the tunnel, accepts streams, strips the PROXY line and serves TLS with a
// certificate only it holds. It answers "echo: <line>" to each line.
type fakeServer struct {
	tap        *wire
	proxyLines chan string
	sess       *yamux.Session
}

func startFakeServer(t *testing.T, wsURL, token string, cert tls.Certificate) *fakeServer {
	t.Helper()
	ctx := context.Background()
	c, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + token}}})
	if err != nil {
		t.Fatalf("tunnel dial: %v", err)
	}
	c.SetReadLimit(1 << 20)
	conn := websocket.NetConn(ctx, c, websocket.MessageBinary)
	cfg := yamux.DefaultConfig()
	cfg.LogOutput = io.Discard
	sess, err := yamux.Server(conn, cfg)
	if err != nil {
		t.Fatal(err)
	}
	fs := &fakeServer{tap: &wire{}, proxyLines: make(chan string, 16), sess: sess}
	tlsCfg := &tls.Config{Certificates: []tls.Certificate{cert}}
	go func() {
		for {
			st, err := sess.Accept()
			if err != nil {
				return
			}
			go func(st net.Conn) {
				defer st.Close()
				br := bufio.NewReader(st)
				line, err := br.ReadString('\n')
				if err != nil {
					return
				}
				fs.proxyLines <- line
				tc := tls.Server(&tappedConn{Conn: st, r: br, tap: fs.tap}, tlsCfg)
				r := bufio.NewReader(tc)
				for {
					msg, err := r.ReadString('\n')
					if err != nil {
						return
					}
					if _, err := io.WriteString(tc, "echo: "+msg); err != nil {
						return
					}
				}
			}(st)
		}
	}()
	t.Cleanup(func() { sess.Close() })
	return fs
}

type harness struct {
	relay   *Relay
	ln      net.Listener
	ws      string
	usage   *memUsage
	cert    tls.Certificate
	pool    *x509.CertPool
	tunnels chan bool
}

func newHarness(t *testing.T, cfg Config) *harness {
	t.Helper()
	usage := &memUsage{m: map[string]int64{}}
	auth := func(_ context.Context, token string) (string, error) {
		if token == "good-token" {
			return serverID, nil
		}
		return "", errors.New("no")
	}
	r := New(cfg, dns.Names{Zone: "folevi.app"}, auth, usage, slog.New(slog.NewTextHandler(io.Discard, nil)))
	h := &harness{relay: r, usage: usage, tunnels: make(chan bool, 8)}
	r.OnTunnel = func(id string, connected bool) { h.tunnels <- connected }
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/tunnel", r.HandleTunnel)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	h.ws = "ws" + strings.TrimPrefix(srv.URL, "http") + "/v1/tunnel"
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	h.ln = ln
	go r.Serve(ln)
	t.Cleanup(func() {
		ln.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		r.Close(ctx)
	})
	h.cert, h.pool = testutil.SelfSigned(serverID+".folevi.app", "*."+serverID+".folevi.app")
	return h
}

func (h *harness) dial(t *testing.T, name string) (*tls.Conn, error) {
	t.Helper()
	d := &net.Dialer{Timeout: 3 * time.Second}
	return tls.DialWithDialer(d, "tcp", h.ln.Addr().String(), &tls.Config{ServerName: name, RootCAs: h.pool})
}

func waitTunnel(t *testing.T, h *harness) {
	t.Helper()
	select {
	case up := <-h.tunnels:
		if !up {
			t.Fatal("tunnel reported down")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("tunnel never opened")
	}
}

func TestSNIRoutingThroughTunnelNeverSeesPlaintext(t *testing.T) {
	h := newHarness(t, Config{})
	fs := startFakeServer(t, h.ws, "good-token", h.cert)
	waitTunnel(t, h)
	if !h.relay.Connected(serverID) {
		t.Fatal("not connected")
	}
	const secret = "my-private-note-text-0123456789"
	for _, name := range []string{serverID + ".folevi.app", "192-168-1-20." + serverID + ".folevi.app"} {
		c, err := h.dial(t, name)
		if err != nil {
			t.Fatalf("dial %s: %v", name, err)
		}
		if _, err := io.WriteString(c, secret+"\n"); err != nil {
			t.Fatal(err)
		}
		got, err := bufio.NewReader(c).ReadString('\n')
		if err != nil || got != "echo: "+secret+"\n" {
			t.Fatalf("got %q %v", got, err)
		}
		c.Close()
		line := <-fs.proxyLines
		if !strings.HasPrefix(line, "PROXY TCP4 127.0.0.1 127.0.0.1 ") {
			t.Fatalf("proxy line %q", line)
		}
	}
	carried := fs.tap.String()
	if len(carried) < 200 {
		t.Fatalf("too few bytes crossed the tunnel: %d", len(carried))
	}
	if strings.Contains(carried, secret) || strings.Contains(carried, "echo: ") {
		t.Fatal("plaintext crossed the relay")
	}
	h.relay.Flush(context.Background(), time.Now())
	if n, _ := h.usage.GetUsage(context.Background(), serverID, UsageKind, time.Now().UTC().Format("2006-01")); n < int64(len(carried))/2 {
		t.Fatalf("usage not counted: %d", n)
	}
}

func TestTunnelRefusesBadToken(t *testing.T) {
	h := newHarness(t, Config{})
	_, res, err := websocket.Dial(context.Background(), h.ws, &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer nope"}}})
	if err == nil || res == nil || res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("want 401, got %v %v", res, err)
	}
}

func TestUnknownOrOfflineNamesAreClosed(t *testing.T) {
	h := newHarness(t, Config{})
	for _, name := range []string{serverID + ".folevi.app", "zzzzzzzzzz.folevi.app", "example.com"} {
		if c, err := h.dial(t, name); err == nil {
			c.Close()
			t.Fatalf("%s: handshake should fail without a tunnel", name)
		}
	}
}

func TestMonthlyCapAndStreamLimit(t *testing.T) {
	h := newHarness(t, Config{MonthlyBytes: 1})
	startFakeServer(t, h.ws, "good-token", h.cert)
	waitTunnel(t, h)
	h.relay.add(serverID, 10) // over the cap already
	if c, err := h.dial(t, serverID+".folevi.app"); err == nil {
		c.Close()
		t.Fatal("over the monthly cap but still routed")
	}

	h2 := newHarness(t, Config{MaxStreams: 1})
	startFakeServer(t, h2.ws, "good-token", h2.cert)
	waitTunnel(t, h2)
	c1, err := h2.dial(t, serverID+".folevi.app")
	if err != nil {
		t.Fatal(err)
	}
	defer c1.Close()
	if c2, err := h2.dial(t, serverID+".folevi.app"); err == nil {
		c2.Close()
		t.Fatal("second stream allowed over MaxStreams")
	}
}

func TestKillSwitchAndReplacement(t *testing.T) {
	h := newHarness(t, Config{})
	allowed := true
	var mu sync.Mutex
	h.relay.Allowed = func(string) bool { mu.Lock(); defer mu.Unlock(); return allowed }
	first := startFakeServer(t, h.ws, "good-token", h.cert)
	waitTunnel(t, h)
	startFakeServer(t, h.ws, "good-token", h.cert) // a restarted server replaces the old tunnel
	waitTunnel(t, h)
	select {
	case <-first.sess.CloseChan():
	case <-time.After(3 * time.Second):
		t.Fatal("old tunnel not closed")
	}
	mu.Lock()
	allowed = false
	mu.Unlock()
	if c, err := h.dial(t, serverID+".folevi.app"); err == nil {
		c.Close()
		t.Fatal("routed while switched off")
	}
	h.relay.Disconnect(serverID)
	deadline := time.Now().Add(3 * time.Second)
	for h.relay.Connected(serverID) && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if h.relay.Connected(serverID) {
		t.Fatal("still connected after Disconnect")
	}
}

func TestIdleTimeout(t *testing.T) {
	h := newHarness(t, Config{IdleTimeout: 300 * time.Millisecond})
	startFakeServer(t, h.ws, "good-token", h.cert)
	waitTunnel(t, h)
	c, err := h.dial(t, serverID+".folevi.app")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, err := c.Read(make([]byte, 1)); err == nil {
		t.Fatal("expected the idle connection to be closed")
	} else if ne, ok := err.(net.Error); ok && ne.Timeout() {
		t.Fatal("connection was not closed by the idle timeout")
	}
}

func TestLocalHostsGoToChanListener(t *testing.T) {
	h := newHarness(t, Config{LocalHosts: []string{"relay.folevi.app"}})
	h.relay.Local = NewChanListener(h.ln.Addr())
	cert, pool := testutil.SelfSigned("relay.folevi.app")
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "local ok") })}
	go srv.Serve(tls.NewListener(h.relay.Local, &tls.Config{Certificates: []tls.Certificate{cert}}))
	defer srv.Close()
	client := &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: pool},
		DialContext:     func(ctx context.Context, _, _ string) (net.Conn, error) { return net.Dial("tcp", h.ln.Addr().String()) },
	}}
	res, err := client.Get("https://relay.folevi.app/")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(b) != "local ok" {
		t.Fatalf("got %q", b)
	}
}

func TestPeekSNIAndProxyHeaders(t *testing.T) {
	a, b := net.Pipe()
	go func() {
		_ = tls.Client(a, &tls.Config{ServerName: "Abc.Example.com", InsecureSkipVerify: true}).Handshake()
	}()
	name, peeked, err := PeekSNI(b)
	if err != nil || name != "abc.example.com" || len(peeked) < 50 || peeked[0] != 0x16 {
		t.Fatalf("PeekSNI = %q %d %v", name, len(peeked), err)
	}
	a.Close()
	b.Close()
	if _, _, err := PeekSNI(strings.NewReader("GET / HTTP/1.1\r\n\r\n")); err == nil {
		t.Fatal("plain HTTP accepted as a ClientHello")
	}
	src := &net.TCPAddr{IP: net.ParseIP("203.0.113.7"), Port: 5555}
	if got := proxyHeader(src, &net.TCPAddr{IP: net.ParseIP("10.0.0.1"), Port: 443}); got != "PROXY TCP4 203.0.113.7 10.0.0.1 5555 443\r\n" {
		t.Fatalf("header %q", got)
	}
	if got := proxyHeader(src, &net.TCPAddr{IP: net.ParseIP("2001:db8::1"), Port: 443}); got != "PROXY TCP4 203.0.113.7 0.0.0.0 5555 443\r\n" {
		t.Fatalf("mixed header %q", got)
	}
	c1, c2 := net.Pipe()
	go func() { _, _ = io.WriteString(c1, "PROXY TCP4 198.51.100.2 10.0.0.1 4000 443\r\nrest") }()
	pc, err := ReadProxyV1(c2)
	if err != nil || pc.RemoteAddr().String() != "198.51.100.2:4000" {
		t.Fatalf("ReadProxyV1 %v %v", pc, err)
	}
	buf := make([]byte, 4)
	if _, err := io.ReadFull(pc, buf); err != nil || string(buf) != "rest" {
		t.Fatalf("rest %q %v", buf, err)
	}
}
