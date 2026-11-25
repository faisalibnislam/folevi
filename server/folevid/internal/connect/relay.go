package connect

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
)

// Relay keeps one outbound tunnel to the relay (CONTRACT §9): a WebSocket to wss://relay.folevi.net/v1/tunnel
// with the connect token as a bearer token, carrying a yamux session. The relay opens one yamux stream per
// incoming TLS connection for <id>.folevi.net (it reads only the SNI and never terminates TLS); folevid is the
// yamux server side and pipes each stream into its own HTTPS listener (Target, 127.0.0.1:8443).
type Relay struct {
	URL    string
	Token  func() string
	Target string
	Log    *slog.Logger
	// Dial is for tests; nil uses the default.
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
	defer stream.Close()
	up, err := net.DialTimeout("tcp", r.Target, 5*time.Second)
	if err != nil {
		r.Log.Warn("relay: local HTTPS listener not reachable", "err", err)
		return
	}
	defer up.Close()
	Pipe(stream, up)
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
