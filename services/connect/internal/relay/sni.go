package relay

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"time"
)

var errHelloRead = errors.New("hello read")

// readOnlyConn lets crypto/tls parse a ClientHello from a reader without ever writing back.
type readOnlyConn struct{ r io.Reader }

func (c readOnlyConn) Read(p []byte) (int, error)     { return c.r.Read(p) }
func (readOnlyConn) Write([]byte) (int, error)        { return 0, io.ErrClosedPipe }
func (readOnlyConn) Close() error                     { return nil }
func (readOnlyConn) LocalAddr() net.Addr              { return nil }
func (readOnlyConn) RemoteAddr() net.Addr             { return nil }
func (readOnlyConn) SetDeadline(time.Time) error      { return nil }
func (readOnlyConn) SetReadDeadline(time.Time) error  { return nil }
func (readOnlyConn) SetWriteDeadline(time.Time) error { return nil }

// PeekSNI reads the TLS ClientHello from r and returns the server name it asks for and every byte read, so the
// caller can replay them. It never answers the client and never holds a key: the handshake is abandoned the moment
// the hello is parsed.
func PeekSNI(r io.Reader) (string, []byte, error) {
	var buf bytes.Buffer
	var name string
	var seen bool
	err := tls.Server(readOnlyConn{r: io.TeeReader(r, &buf)}, &tls.Config{
		GetConfigForClient: func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
			name, seen = hello.ServerName, true
			return nil, errHelloRead
		},
	}).Handshake()
	if !seen {
		if err == nil {
			err = errors.New("no client hello")
		}
		return "", buf.Bytes(), err
	}
	return strings.ToLower(name), buf.Bytes(), nil
}

// prefixConn is a net.Conn that first replays bytes already read from it.
type prefixConn struct {
	net.Conn
	r io.Reader
}

func newPrefixConn(c net.Conn, prefix []byte) *prefixConn {
	return &prefixConn{Conn: c, r: io.MultiReader(bytes.NewReader(prefix), c)}
}

func (c *prefixConn) Read(p []byte) (int, error) { return c.r.Read(p) }

// proxyHeader is a PROXY protocol v1 line telling the server who the client is (it never sees the client's
// address otherwise, since the relay opens the stream).
func proxyHeader(src, dst net.Addr) string {
	s, ok := addrPort(src)
	if !ok {
		return "PROXY UNKNOWN\r\n"
	}
	d, ok := addrPort(dst)
	if !ok {
		d = netip.AddrPortFrom(netip.Addr{}, 443)
	}
	if !d.Addr().IsValid() || s.Addr().Is4() != d.Addr().Is4() {
		unspecified := netip.IPv6Unspecified()
		if s.Addr().Is4() {
			unspecified = netip.IPv4Unspecified()
		}
		d = netip.AddrPortFrom(unspecified, d.Port())
	}
	proto := "TCP4"
	if !s.Addr().Is4() {
		proto = "TCP6"
	}
	return fmt.Sprintf("PROXY %s %s %s %d %d\r\n", proto, s.Addr(), d.Addr(), s.Port(), d.Port())
}

func addrPort(a net.Addr) (netip.AddrPort, bool) {
	if a == nil {
		return netip.AddrPort{}, false
	}
	if t, ok := a.(*net.TCPAddr); ok {
		ap := t.AddrPort()
		return netip.AddrPortFrom(ap.Addr().Unmap(), ap.Port()), ap.IsValid()
	}
	ap, err := netip.ParseAddrPort(a.String())
	if err != nil {
		return netip.AddrPort{}, false
	}
	return netip.AddrPortFrom(ap.Addr().Unmap(), ap.Port()), true
}

// proxiedConn carries the client address learned from an incoming PROXY v1 line (a load balancer in front).
type proxiedConn struct {
	net.Conn
	r      *bufio.Reader
	remote net.Addr
}

func (c *proxiedConn) Read(p []byte) (int, error) { return c.r.Read(p) }
func (c *proxiedConn) RemoteAddr() net.Addr       { return c.remote }

// ReadProxyV1 reads a PROXY protocol v1 line from c (sent by a load balancer such as Fly's proxy_proto handler)
// and returns a conn whose RemoteAddr is the original client.
func ReadProxyV1(c net.Conn) (net.Conn, error) {
	br := bufio.NewReaderSize(c, 256)
	line, err := br.ReadString('\n')
	if err != nil {
		return nil, err
	}
	if len(line) > 107 || !strings.HasPrefix(line, "PROXY ") || !strings.HasSuffix(line, "\r\n") {
		return nil, errors.New("bad proxy header")
	}
	f := strings.Fields(strings.TrimSpace(line))
	if len(f) >= 2 && f[1] == "UNKNOWN" {
		return &proxiedConn{Conn: c, r: br, remote: c.RemoteAddr()}, nil
	}
	if len(f) != 6 {
		return nil, errors.New("bad proxy header")
	}
	ip, err := netip.ParseAddr(f[2])
	if err != nil {
		return nil, errors.New("bad proxy header")
	}
	port, err := strconv.Atoi(f[4])
	if err != nil || port < 0 || port > 65535 {
		return nil, errors.New("bad proxy header")
	}
	return &proxiedConn{Conn: c, r: br, remote: net.TCPAddrFromAddrPort(netip.AddrPortFrom(ip, uint16(port)))}, nil
}
