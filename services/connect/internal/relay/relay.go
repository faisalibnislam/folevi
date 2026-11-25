// Package relay is Folevi Relay: servers that can't be reached directly keep one outbound WebSocket to it
// (yamux over WebSocket, bearer token), and the relay accepts TLS on :443, reads only the ClientHello's server
// name, and pipes the raw bytes into a new stream on that server's tunnel. It never terminates TLS for a
// server's name, so it cannot read what passes through.
//
// Stream protocol (what folevid must do): the server runs the yamux *server* side and accepts streams. Each
// stream starts with one PROXY protocol v1 line naming the original client, then the client's raw TLS bytes
// (starting with its ClientHello); the server strips the line and hands the rest to its TLS listener.
package relay

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
	"golang.org/x/time/rate"

	"folevi.com/connect/internal/dns"
	"folevi.com/connect/internal/limits"
)

// Usage is where relayed bytes are counted (the store implements it).
type Usage interface {
	AddUsage(ctx context.Context, serverID, kind, period string, n int64) (int64, error)
	GetUsage(ctx context.Context, serverID, kind, period string) (int64, error)
}

// UsageKind is the usage counter for relayed bytes (both directions).
const UsageKind = "relay_bytes"

// Config is the relay's limits.
type Config struct {
	BytesPerSecond    int64         // per server, both directions together; 0 = unlimited
	MonthlyBytes      int64         // per server; 0 = unlimited
	MaxStreams        int           // concurrent client connections per server
	MaxConns          int           // concurrent client connections in all
	IdleTimeout       time.Duration // a client connection with no bytes either way for this long is closed
	HelloTimeout      time.Duration // time to send the ClientHello
	LocalHosts        []string      // names the relay answers itself (connect.folevi.com, relay.folevi.app)
	AcceptProxyHeader bool          // the :443 listener sits behind a load balancer that sends PROXY v1
}

// Authenticate turns a bearer token into a server id, or an error when the server may not use the relay.
type Authenticate func(ctx context.Context, token string) (serverID string, err error)

// Relay holds the open tunnels and routes client connections to them.
type Relay struct {
	cfg   Config
	names dns.Names
	auth  Authenticate
	usage Usage
	log   *slog.Logger
	// Local receives connections for LocalHosts (with the ClientHello replayed); nil closes them.
	Local *ChanListener
	// OnTunnel is told when a server's tunnel opens or closes.
	OnTunnel func(serverID string, connected bool)
	// Allowed is asked before a client connection is routed (the kill switch); nil allows all.
	Allowed func(serverID string) bool

	mu       sync.Mutex
	tunnels  map[string]*yamux.Session
	limiters map[string]*rate.Limiter
	pending  map[string]int64 // bytes not yet written to usage
	totals   map[string]int64 // bytes this month as of the last flush
	month    string

	streams *limits.Counter
	conns   atomic.Int64
	closed  atomic.Bool
	wg      sync.WaitGroup
}

func New(cfg Config, names dns.Names, auth Authenticate, usage Usage, log *slog.Logger) *Relay {
	if cfg.IdleTimeout <= 0 {
		cfg.IdleTimeout = 5 * time.Minute
	}
	if cfg.HelloTimeout <= 0 {
		cfg.HelloTimeout = 10 * time.Second
	}
	return &Relay{cfg: cfg, names: names, auth: auth, usage: usage, log: log,
		tunnels: map[string]*yamux.Session{}, limiters: map[string]*rate.Limiter{}, pending: map[string]int64{}, totals: map[string]int64{},
		streams: limits.NewCounter()}
}

// Connected reports whether serverID has an open tunnel.
func (r *Relay) Connected(serverID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.tunnels[serverID]
	return ok && !s.IsClosed()
}

func bearer(req *http.Request) string {
	h := req.Header.Get("Authorization")
	if t, ok := strings.CutPrefix(h, "Bearer "); ok {
		return strings.TrimSpace(t)
	}
	return ""
}

// HandleTunnel is the WebSocket endpoint servers connect to (GET /v1/tunnel, Authorization: Bearer <token>).
func (r *Relay) HandleTunnel(w http.ResponseWriter, req *http.Request) {
	if r.closed.Load() {
		http.Error(w, `{"error":"shutting_down"}`, http.StatusServiceUnavailable)
		return
	}
	id, err := r.auth(req.Context(), bearer(req))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
		return
	}
	c, err := websocket.Accept(w, req, &websocket.AcceptOptions{})
	if err != nil {
		return
	}
	c.SetReadLimit(1 << 20)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	conn := websocket.NetConn(ctx, c, websocket.MessageBinary)
	ycfg := yamux.DefaultConfig()
	ycfg.LogOutput = io.Discard
	ycfg.EnableKeepAlive = true
	ycfg.KeepAliveInterval = 20 * time.Second
	ycfg.ConnectionWriteTimeout = 15 * time.Second
	sess, err := yamux.Client(conn, ycfg)
	if err != nil {
		_ = conn.Close()
		return
	}
	r.mu.Lock()
	old := r.tunnels[id]
	r.tunnels[id] = sess
	r.mu.Unlock()
	if old != nil {
		_ = old.Close() // the newest connection wins (a restarted server)
	}
	r.log.Info("tunnel open", "server", id)
	if r.OnTunnel != nil {
		r.OnTunnel(id, true)
	}
	<-sess.CloseChan()
	r.mu.Lock()
	still := r.tunnels[id] == sess
	if still {
		delete(r.tunnels, id)
	}
	r.mu.Unlock()
	r.log.Info("tunnel closed", "server", id)
	if still && r.OnTunnel != nil {
		r.OnTunnel(id, false)
	}
}

// Serve accepts client TLS connections on ln (the :443 listener) until ln is closed.
func (r *Relay) Serve(ln net.Listener) error {
	for {
		c, err := ln.Accept()
		if err != nil {
			if r.closed.Load() || errors.Is(err, net.ErrClosed) {
				return nil
			}
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				time.Sleep(50 * time.Millisecond)
				continue
			}
			return err
		}
		if r.cfg.MaxConns > 0 && r.conns.Load() >= int64(r.cfg.MaxConns) {
			_ = c.Close()
			continue
		}
		r.conns.Add(1)
		r.wg.Add(1)
		go func() {
			defer r.wg.Done()
			defer r.conns.Add(-1)
			r.handle(c)
		}()
	}
}

func (r *Relay) isLocal(host string) bool {
	for _, h := range r.cfg.LocalHosts {
		if strings.EqualFold(h, host) {
			return true
		}
	}
	return false
}

func (r *Relay) handle(c net.Conn) {
	_ = c.SetDeadline(time.Now().Add(r.cfg.HelloTimeout))
	if r.cfg.AcceptProxyHeader {
		pc, err := ReadProxyV1(c)
		if err != nil {
			_ = c.Close()
			return
		}
		c = pc
	}
	host, peeked, err := PeekSNI(c)
	if err != nil || host == "" {
		_ = c.Close()
		return
	}
	_ = c.SetDeadline(time.Time{})
	if r.isLocal(host) {
		if r.Local == nil || !r.Local.deliver(newPrefixConn(c, peeked)) {
			_ = c.Close()
		}
		return
	}
	id, ok := r.names.ServerOf(host)
	if !ok {
		_ = c.Close()
		return
	}
	defer c.Close()
	if r.Allowed != nil && !r.Allowed(id) {
		return
	}
	if r.overMonthly(id) {
		return
	}
	if !r.streams.Acquire(id, r.cfg.MaxStreams) {
		return
	}
	defer r.streams.Release(id)
	r.mu.Lock()
	sess := r.tunnels[id]
	r.mu.Unlock()
	if sess == nil || sess.IsClosed() {
		return
	}
	stream, err := sess.Open()
	if err != nil {
		return
	}
	defer stream.Close()
	_ = stream.SetWriteDeadline(time.Now().Add(15 * time.Second))
	if _, err := io.WriteString(stream, proxyHeader(c.RemoteAddr(), c.LocalAddr())); err != nil {
		return
	}
	if _, err := stream.Write(peeked); err != nil {
		return
	}
	_ = stream.SetWriteDeadline(time.Time{})
	r.add(id, int64(len(peeked)))
	r.pipe(id, c, stream)
}

// pipe copies both ways until either side ends, the connection idles out, or the relay shuts down.
func (r *Relay) pipe(id string, client net.Conn, stream net.Conn) {
	var last atomic.Int64
	last.Store(time.Now().UnixNano())
	done := make(chan struct{})
	closeBoth := sync.OnceFunc(func() {
		_ = client.Close()
		_ = stream.Close()
		close(done)
	})
	lim := r.limiter(id)
	copyHalf := func(dst, src net.Conn) {
		defer closeBoth()
		buf := make([]byte, 32<<10)
		for {
			n, err := src.Read(buf)
			if n > 0 {
				last.Store(time.Now().UnixNano())
				if lim != nil {
					if werr := lim.WaitN(context.Background(), n); werr != nil {
						return
					}
				}
				if _, werr := dst.Write(buf[:n]); werr != nil {
					return
				}
				r.add(id, int64(n))
				if r.overMonthly(id) {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}
	go copyHalf(stream, client)
	go copyHalf(client, stream)
	tick := time.NewTicker(minDuration(r.cfg.IdleTimeout/4, time.Second*15))
	defer tick.Stop()
	for {
		select {
		case <-done:
			return
		case <-tick.C:
			if r.closed.Load() || time.Since(time.Unix(0, last.Load())) > r.cfg.IdleTimeout {
				closeBoth()
				return
			}
		}
	}
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b && a > 0 {
		return a
	}
	return b
}

func (r *Relay) limiter(id string) *rate.Limiter {
	if r.cfg.BytesPerSecond <= 0 {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	l, ok := r.limiters[id]
	if !ok {
		burst := int(max(r.cfg.BytesPerSecond, 32<<10))
		l = rate.NewLimiter(rate.Limit(r.cfg.BytesPerSecond), burst)
		r.limiters[id] = l
	}
	return l
}

func (r *Relay) add(id string, n int64) {
	r.mu.Lock()
	r.pending[id] += n
	r.mu.Unlock()
}

func (r *Relay) overMonthly(id string) bool {
	if r.cfg.MonthlyBytes <= 0 {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.totals[id]+r.pending[id] >= r.cfg.MonthlyBytes
}

// Flush writes counted bytes to the usage store and refreshes the monthly totals. main calls it every few
// seconds and once at shutdown.
func (r *Relay) Flush(ctx context.Context, now time.Time) {
	month := now.UTC().Format("2006-01")
	r.mu.Lock()
	if month != r.month {
		r.totals = map[string]int64{}
		r.month = month
	}
	pending := r.pending
	r.pending = map[string]int64{}
	r.mu.Unlock()
	for id, n := range pending {
		total, err := r.usage.AddUsage(ctx, id, UsageKind, month, n)
		if err != nil {
			r.log.Error("relay usage flush failed", "server", id, "err", err)
			r.add(id, n)
			continue
		}
		r.mu.Lock()
		r.totals[id] = total
		r.mu.Unlock()
	}
}

// LoadTotal reads a server's month total from the store (called when its tunnel opens).
func (r *Relay) LoadTotal(ctx context.Context, id string, now time.Time) {
	month := now.UTC().Format("2006-01")
	total, err := r.usage.GetUsage(ctx, id, UsageKind, month)
	if err != nil {
		return
	}
	r.mu.Lock()
	if r.month == "" {
		r.month = month
	}
	if r.month == month {
		r.totals[id] = total
	}
	r.mu.Unlock()
}

// Disconnect closes a server's tunnel (the kill switch).
func (r *Relay) Disconnect(id string) {
	r.mu.Lock()
	s := r.tunnels[id]
	r.mu.Unlock()
	if s != nil {
		_ = s.Close()
	}
}

// Close closes every tunnel and waits (up to ctx) for client connections to end.
func (r *Relay) Close(ctx context.Context) {
	r.closed.Store(true)
	r.mu.Lock()
	for _, s := range r.tunnels {
		_ = s.Close()
	}
	r.mu.Unlock()
	done := make(chan struct{})
	go func() { r.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

// ChanListener is a net.Listener fed by the relay with connections for its own names, so the API can be served
// on the same :443 as the relay (TLS terminated by Connect with its own certificate, only for LocalHosts).
type ChanListener struct {
	ch     chan net.Conn
	addr   net.Addr
	once   sync.Once
	closed chan struct{}
}

func NewChanListener(addr net.Addr) *ChanListener {
	return &ChanListener{ch: make(chan net.Conn), addr: addr, closed: make(chan struct{})}
}

func (l *ChanListener) deliver(c net.Conn) bool {
	select {
	case l.ch <- c:
		return true
	case <-l.closed:
		return false
	case <-time.After(5 * time.Second):
		return false
	}
}

func (l *ChanListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.ch:
		return c, nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}

func (l *ChanListener) Close() error {
	l.once.Do(func() { close(l.closed) })
	return nil
}

func (l *ChanListener) Addr() net.Addr { return l.addr }
