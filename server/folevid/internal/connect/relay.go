package connect

import (
	"bufio"
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
)

// Relay keeps one outbound tunnel to the relay (CONTRACT §9): a WebSocket to wss://relay.folevi.app/v1/tunnel
// with the connect token as a bearer token, carrying a yamux session. The relay opens one yamux stream per
// incoming TLS connection for <id>.folevi.app (it reads only the SNI and never terminates TLS); folevid is the
// yamux server side. Each stream starts with a PROXY protocol v1 line naming the visitor (CONTRACT §9.1);
// folevid strips it and hands the connection, with the visitor's address as its remote address, to Deliver
// (the HTTPS server), or else pipes it to Target (127.0.0.1:8443).
type Relay struct {
	URL     string
	Token   func() string
	Target  string
	Deliver func(net.Conn)
	Log     *slog.Logger
	// HTTPClient is for tests; nil uses the default.
	HTTPClient *http.Client

	connected atomic.Bool
}

// Connected reports whether a tunnel is up.
func (r *Relay) Connected() bool { return r.connected.Load() }

// Run keeps the tunnel up until ctx ends, reconnecting with backoff.
func (r *Relay) Run(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		started := time.Now()
		err := r.once(ctx)
		r.connected.Store(false)
		if ctx.Err() != nil {
			return
		}
		if time.Since(started) > time.Minute {
			backoff = time.Second
		}
		r.Log.Warn("relay tunnel closed, reconnecting", "err", errText(err), "after", backoff.String())
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 2*time.Minute)
	}
}

func errText(err error) string {
	if err == nil {
		return "closed"
	}
	return err.Error()
}

func (r *Relay) once(ctx context.Context) error {
	dctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	h := http.Header{}
	h.Set("Authorization", "Bearer "+r.Token())
	ws, _, err := websocket.Dial(dctx, r.URL, &websocket.DialOptions{HTTPHeader: h, HTTPClient: r.HTTPClient})
	if err != nil {
		return err
	}
	ws.SetReadLimit(-1)
	conn := websocket.NetConn(ctx, ws, websocket.MessageBinary)
	cfg := yamux.DefaultConfig()
	cfg.LogOutput = io.Discard
	cfg.EnableKeepAlive = true
	cfg.KeepAliveInterval = 25 * time.Second
	sess, err := yamux.Server(conn, cfg)
	if err != nil {
		conn.Close()
		return err
	}
	defer sess.Close()
	r.connected.Store(true)
	r.Log.Info("relay tunnel connected")
	go func() {
		<-ctx.Done()
		sess.Close()
	}()
	for {
		stream, err := sess.Accept()
		if err != nil {
			return err
		}
		go r.pipe(stream)
	}
}

func (r *Relay) pipe(stream net.Conn) {
	conn, err := ReadProxyHeader(stream)
	if err != nil {
		r.Log.Warn("relay: bad stream header", "err", err)
		stream.Close()
		return
	}
	if r.Deliver != nil {
		r.Deliver(conn)
		return
	}
	defer conn.Close()
	up, err := net.DialTimeout("tcp", r.Target, 5*time.Second)
	if err != nil {
		r.Log.Warn("relay: local HTTPS listener not reachable", "err", err)
		return
	}
	defer up.Close()
	Pipe(conn, up)
}

// Pipe copies both ways until either side closes.
func Pipe(a, b net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)
	cp := func(dst, src net.Conn) {
		defer wg.Done()
		_, _ = io.Copy(dst, src)
		if cw, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		} else {
			_ = dst.Close()
		}
	}
	go cp(a, b)
	go cp(b, a)
	wg.Wait()
}

// proxiedConn is a stream whose first bytes (the PROXY line) were already read.
type proxiedConn struct {
	net.Conn
	r      *bufio.Reader
	remote net.Addr
}

func (c *proxiedConn) Read(p []byte) (int, error) { return c.r.Read(p) }
func (c *proxiedConn) RemoteAddr() net.Addr       { return c.remote }

// ReadProxyHeader reads a PROXY protocol v1 line ("PROXY TCP4 <src> <dst> <sport> <dport>\r\n") from the start
// of conn and returns a conn that reports the source as its remote address and yields the bytes after the line.
func ReadProxyHeader(conn net.Conn) (net.Conn, error) {
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	br := bufio.NewReaderSize(conn, 4096)
	var line []byte
	for len(line) < 108 {
		b, err := br.ReadByte()
		if err != nil {
			return nil, err
		}
		line = append(line, b)
		if b == '\n' {
			break
		}
	}
	_ = conn.SetReadDeadline(time.Time{})
	text := strings.TrimRight(string(line), "\r\n")
	if !strings.HasSuffix(string(line), "\r\n") {
		return nil, errors.New("no PROXY line")
	}
	f := strings.Fields(text)
	if len(f) < 2 || f[0] != "PROXY" {
		return nil, errors.New("no PROXY line")
	}
	remote := conn.RemoteAddr()
	if (f[1] == "TCP4" || f[1] == "TCP6") && len(f) == 6 {
		ip := net.ParseIP(f[2])
		port, err := strconv.Atoi(f[4])
		if ip == nil || err != nil || port < 0 || port > 65535 {
			return nil, errors.New("bad PROXY line")
		}
		remote = &net.TCPAddr{IP: ip, Port: port}
	} else if f[1] != "UNKNOWN" {
		return nil, errors.New("bad PROXY line")
	}
	return &proxiedConn{Conn: conn, r: br, remote: remote}, nil
}

// ChanListener is a net.Listener fed with connections (relay streams) instead of a socket.
type ChanListener struct {
	ch   chan net.Conn
	done chan struct{}
	once sync.Once
	addr net.Addr
}

// NewChanListener makes one.
func NewChanListener(addr net.Addr) *ChanListener {
	return &ChanListener{ch: make(chan net.Conn), done: make(chan struct{}), addr: addr}
}

// Put hands a connection to Accept (closing it if the listener is closed).
func (l *ChanListener) Put(c net.Conn) {
	select {
	case l.ch <- c:
	case <-l.done:
		c.Close()
	}
}

func (l *ChanListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.ch:
		return c, nil
	case <-l.done:
		return nil, net.ErrClosed
	}
}

func (l *ChanListener) Close() error   { l.once.Do(func() { close(l.done) }); return nil }
func (l *ChanListener) Addr() net.Addr { return l.addr }
