package connect

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-acme/lego/v4/challenge/dns01"
)

// TestAgainstRealConnect builds and runs the real Folevi Connect service (services/connect) on loopback and
// drives it with folevid's client: registration, addresses, link codes, ACME TXT values, the reachability check
// (which calls back into folevid's reach handler and verifies the signature), diagnostics and the relay tunnel
// with its PROXY v1 line. Skipped when the service is not in the checkout.
func TestAgainstRealConnect(t *testing.T) {
	if testing.Short() {
		t.Skip("short")
	}
	src, _ := filepath.Abs("../../../../services/connect")
	if _, err := os.Stat(filepath.Join(src, "cmd", "connect")); err != nil {
		t.Skip("services/connect is not in this checkout")
	}
	bin := filepath.Join(t.TempDir(), "connect")
	build := exec.Command("go", "build", "-o", bin, "./cmd/connect")
	build.Dir = src
	if out, err := build.CombinedOutput(); err != nil {
		t.Skipf("could not build services/connect: %v\n%s", err, out)
	}
	httpPort, relayPort := freePort(t), freePort(t)
	cmd := exec.Command(bin)
	cmd.Env = append(os.Environ(),
		"CONNECT_HTTP_ADDR=127.0.0.1:"+strconv.Itoa(httpPort),
		"CONNECT_RELAY_ADDR=127.0.0.1:"+strconv.Itoa(relayPort),
		"CONNECT_DB="+filepath.Join(t.TempDir(), "c.db"),
		"CONNECT_REACH_ALLOW_PRIVATE=true",
		"CONNECT_RELAY_IPV4=127.0.0.1",
		"CONNECT_LOG_LEVEL=warn",
	)
	logs := &strings.Builder{}
	cmd.Stdout, cmd.Stderr = io.Discard, &limitedWriter{b: logs}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Signal(os.Interrupt); _ = cmd.Wait() })
	base := "http://127.0.0.1:" + strconv.Itoa(httpPort)
	waitUp(t, base+"/healthz")

	ctx := context.Background()
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	token := ""
	c := &Client{BaseURL: base, Token: func() string { return token }}
	reg, err := c.Register(ctx, "Test home", "1.0.0", base64.StdEncoding.EncodeToString(pub))
	if err != nil {
		t.Fatal(err)
	}
	token = reg.Token
	if len(reg.ServerID) != 10 || reg.Hostname != reg.ServerID+".folevi.app" {
		t.Fatalf("registration %+v", Registration{ServerID: reg.ServerID, Hostname: reg.Hostname})
	}
	if err := c.Update(ctx, reg.ServerID, Patch{Name: "Test home", Version: "1.0.1", LANIPs: []string{"192.168.1.20"}}); err != nil {
		t.Fatal(err)
	}
	st, err := c.State(ctx, reg.ServerID)
	if err != nil || st.Hostname != reg.Hostname || len(st.LANHostnames) != 1 || st.LANHostnames[0] != "192-168-1-20."+reg.Hostname {
		t.Fatalf("state %+v %v", st, err)
	}
	lc, err := c.NewLinkCode(ctx, reg.ServerID)
	if err != nil || lc.Code == "" || !strings.Contains(lc.ApproveURL, lc.Code) || lc.ExpiresAt == nil {
		t.Fatalf("link code %+v %v", lc, err)
	}
	p := &DNSProvider{Client: c, ServerID: reg.ServerID, Hostname: reg.Hostname}
	keyAuth := "token.thumbprint"
	if err := p.Present("*."+reg.Hostname, "token", keyAuth); err != nil {
		t.Fatal(err)
	}
	if err := p.CleanUp("*."+reg.Hostname, "token", keyAuth); err != nil {
		t.Fatal(err)
	}
	if dns01.GetChallengeInfo(reg.Hostname, keyAuth).Value == "" {
		t.Fatal("no challenge value")
	}
	ref, err := c.UploadDiagnostics(ctx, "folevid test diagnostics")
	if err != nil || !strings.HasPrefix(ref, "FD-") {
		t.Fatalf("diagnostics %q %v", ref, err)
	}

	// The HTTPS side of folevid: reach handler plus an app page that reports the visitor's address.
	cert, pool := selfSigned(t, reg.Hostname, "*."+reg.Hostname)
	mux := http.NewServeMux()
	mux.Handle(ReachPath, ReachHandler(func() string { return reg.ServerID }, func() (ed25519.PrivateKey, error) { return priv, nil }))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "app via "+r.RemoteAddr) })
	srv := &http.Server{Handler: mux, TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}}}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	relayLn := NewChanListener(ln.Addr())
	go func() { _ = srv.ServeTLS(ln, "", "") }()
	go func() { _ = srv.ServeTLS(relayLn, "", "") }()
	t.Cleanup(func() { srv.Close() })

	reach, err := c.CheckReachable(ctx, reg.ServerID, ln.Addr().(*net.TCPAddr).Port)
	if err != nil || !reach.Reachable {
		t.Fatalf("reachability %+v %v\n%s", reach, err, logs.String())
	}

	// The relay tunnel: a visitor dials the relay port with SNI <id>.folevi.app and reaches the page above.
	rctx, cancel := context.WithCancel(ctx)
	defer cancel()
	r := &Relay{URL: "ws://127.0.0.1:" + strconv.Itoa(httpPort) + "/v1/tunnel", Token: func() string { return token },
		Deliver: relayLn.Put, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	go r.Run(rctx)
	deadline := time.Now().Add(10 * time.Second)
	for !r.Connected() && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if !r.Connected() {
		t.Fatalf("tunnel did not connect\n%s", logs.String())
	}
	var body string
	for time.Now().Before(deadline) {
		body, err = visit(relayPort, reg.Hostname, pool)
		if err == nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err != nil || !strings.HasPrefix(body, "app via 127.0.0.1:") {
		t.Fatalf("through the relay: %q %v\n%s", body, err, logs.String())
	}
}

func visit(relayPort int, host string, pool *x509.CertPool) (string, error) {
	conn, err := tls.Dial("tcp", "127.0.0.1:"+strconv.Itoa(relayPort), &tls.Config{ServerName: host, RootCAs: pool})
	if err != nil {
		return "", err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	_, _ = io.WriteString(conn, "GET / HTTP/1.1\r\nHost: "+host+"\r\nConnection: close\r\n\r\n")
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return string(b), err
}

func freePort(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func waitUp(t *testing.T, url string) {
	for i := 0; i < 100; i++ {
		if resp, err := http.Get(url); err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("connect did not start")
}

func selfSigned(t *testing.T, names ...string) (tls.Certificate, *x509.CertPool) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: names[0]},
		DNSNames: names, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true, IsCA: true}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	leaf, _ := x509.ParseCertificate(der)
	pool := x509.NewCertPool()
	pool.AddCert(leaf)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key, Leaf: leaf}, pool
}

type limitedWriter struct{ b *strings.Builder }

func (w *limitedWriter) Write(p []byte) (int, error) {
	if w.b.Len() < 1<<16 {
		w.b.Write(p)
	}
	return len(p), nil
}
