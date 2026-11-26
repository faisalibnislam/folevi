// Package api is Connect's HTTP API (CONTRACT.md §9): the server registry and linking, DNS, the reachability
// check, the mail, push, AI and Unsplash relays, diagnostics, the cloud calls and Folevi's admin calls.
package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"folevi.com/connect/internal/ai"
	"folevi.com/connect/internal/config"
	"folevi.com/connect/internal/dns"
	"folevi.com/connect/internal/limits"
	"folevi.com/connect/internal/mail"
	"folevi.com/connect/internal/push"
	"folevi.com/connect/internal/relay"
	"folevi.com/connect/internal/store"
)

// Deps are the pieces the API uses. Nil senders turn their endpoint into 503.
type Deps struct {
	Config *config.Config
	Store  store.Store
	DNS    *dns.Manager // nil: no DNS changes
	Relay  *relay.Relay // nil: no relay
	Mail   mail.Sender
	APNs   push.Sender
	FCM    push.Sender
	AI     *ai.Gateway // nil: AI unavailable
	HTTP   *http.Client
	Log    *slog.Logger
	Now    func() time.Time
	// ReachRoots verifies the certificate seen by the reachability check (nil: the system roots).
	ReachRoots *x509.CertPool
}

// API serves the endpoints.
type API struct {
	Deps
	cfg   *config.Config
	names dns.Names

	register    *limits.Window
	registerAll *limits.Window
	linkCodes   *limits.Window
	approve     *limits.Window
	reach       *limits.Window
	mailHour    *limits.Window
	rcptHour    *limits.Window
	rcptDay     *limits.Window
	pushHour    *limits.Window
	aiMinute    *limits.Window
	unsplashHr  *limits.Window

	touchMu sync.Mutex
	touched map[string]time.Time
}

func New(d Deps) *API {
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.HTTP == nil {
		d.HTTP = &http.Client{Timeout: 20 * time.Second}
	}
	c := d.Config
	return &API{
		Deps:        d,
		cfg:         c,
		names:       dns.Names{Zone: c.Zone},
		register:    limits.NewWindow(c.RegisterPerIPHourly, time.Hour),
		registerAll: limits.NewWindow(c.RegisterGlobalHourly, time.Hour),
		linkCodes:   limits.NewWindow(c.LinkCodesPerHour, time.Hour),
		approve:     limits.NewWindow(c.ApprovePerUserHourly, time.Hour),
		reach:       limits.NewWindow(20, time.Hour),
		mailHour:    limits.NewWindow(c.MailPerServerHourly, time.Hour),
		rcptHour:    limits.NewWindow(c.MailPerRecipientHourly, time.Hour),
		rcptDay:     limits.NewWindow(c.MailPerRecipientDaily, 24*time.Hour),
		pushHour:    limits.NewWindow(c.PushPerServerHourly, time.Hour),
		aiMinute:    limits.NewWindow(c.AIPerServerMinute, time.Minute),
		unsplashHr:  limits.NewWindow(c.UnsplashPerServerHourly, time.Hour),
		touched:     map[string]time.Time{},
	}
}

// Handler is the whole HTTP surface.
func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]any{"ok": true}) })

	mux.HandleFunc("POST /v1/servers", a.handleRegister)
	mux.HandleFunc("GET /v1/servers/{id}", a.server(a.handleGetServer))
	mux.HandleFunc("PATCH /v1/servers/{id}", a.server(a.handleUpdateServer))
	mux.HandleFunc("POST /v1/servers/{id}/link-codes", a.server(a.handleLinkCode))
	mux.HandleFunc("PUT /v1/servers/{id}/acme/{label}", a.server(a.handleAcmeSet))
	mux.HandleFunc("DELETE /v1/servers/{id}/acme/{label}", a.server(a.handleAcmeDelete))
	mux.HandleFunc("POST /v1/servers/{id}/reachability", a.server(a.handleReachability))

	mux.HandleFunc("POST /v1/mail", a.server(a.handleMail))
	mux.HandleFunc("POST /v1/push", a.server(a.handlePush))
	mux.HandleFunc("POST /v1/ai/chat/completions", a.server(a.handleAI(ai.Chat)))
	mux.HandleFunc("POST /v1/ai/embeddings", a.server(a.handleAI(ai.Embeddings)))
	mux.HandleFunc("GET /v1/unsplash/{path...}", a.server(a.handleUnsplash))
	mux.HandleFunc("POST /v1/diagnostics", a.server(a.handleDiagnostics))

	mux.HandleFunc("POST /v1/link-codes/{code}/approve", a.cloud(a.handleApprove))
	mux.HandleFunc("GET /v1/accounts/{userId}/servers", a.cloud(a.handleAccountServers))

	mux.HandleFunc("GET /v1/admin/servers/{id}", a.admin(a.handleAdminServer))
	mux.HandleFunc("PUT /v1/admin/servers/{id}/flags", a.admin(a.handleAdminFlags))
	mux.HandleFunc("GET /v1/admin/servers/{id}/mail-log", a.admin(a.handleAdminMailLog))
	mux.HandleFunc("GET /v1/admin/diagnostics/{ref}", a.admin(a.handleAdminDiagnostic))

	if a.Relay != nil {
		mux.HandleFunc("GET /v1/tunnel", a.Relay.HandleTunnel)
	}
	return a.logRequests(mux)
}

// ---------------------------------------------------------------- plumbing

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

// readJSON decodes a JSON body of at most max bytes, refusing unknown shapes loosely (unknown fields are ignored).
func readJSON(w http.ResponseWriter, r *http.Request, max int64, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, max))
	if err := dec.Decode(v); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeErr(w, http.StatusRequestEntityTooLarge, "too_large")
		} else {
			writeErr(w, http.StatusBadRequest, "invalid_json")
		}
		return false
	}
	return true
}

func bearer(r *http.Request) string {
	if t, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		return strings.TrimSpace(t)
	}
	return ""
}

func hashToken(t string) []byte {
	h := sha256.Sum256([]byte(t))
	return h[:]
}

func sameSecret(given, want string) bool {
	if want == "" || given == "" {
		return false
	}
	g, w := sha256.Sum256([]byte(given)), sha256.Sum256([]byte(want))
	return subtle.ConstantTimeCompare(g[:], w[:]) == 1
}

// clientIP is the caller's address: the trusted proxy header when configured (Fly-Client-IP), else the socket.
func (a *API) clientIP(r *http.Request) netip.Addr {
	if h := a.cfg.TrustedProxyHeader; h != "" {
		if v := strings.TrimSpace(strings.Split(r.Header.Get(h), ",")[0]); v != "" {
			if ip, err := netip.ParseAddr(v); err == nil {
				return ip.Unmap()
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip, _ := netip.ParseAddr(host)
	return ip.Unmap()
}

// registerKey is the registration limiter's key for an address: the address itself for IPv4, and the /64 for
// IPv6, where one customer holds a whole /64 (or more) and could otherwise use a new address for every call.
func registerKey(ip netip.Addr) string {
	ip = ip.Unmap()
	if ip.Is6() {
		if p, err := ip.WithZone("").Prefix(64); err == nil {
			return "ip:" + p.String()
		}
	}
	return "ip:" + ip.String()
}

// accountKey is what a server's mail and AI limits are counted under: its owner's account once linked, so
// registering more servers does not buy more allowance, else the server itself.
func accountKey(sv *store.Server) string { return ai.UsageKey(sv.ID, sv.OwnerAccount) }

type ctxKey struct{}

// reqInfo lets handlers tell the request log which server a call was for.
type reqInfo struct{ server string }

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (s *statusWriter) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = 200
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += int64(n)
	return n, err
}

func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// logRequests logs one line per request: method, route pattern (never the raw path, which can hold a link code),
// status, duration and server id. Never headers, bodies or query strings.
func (a *API) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		info := &reqInfo{}
		sw := &statusWriter{ResponseWriter: w}
		inner := r.WithContext(context.WithValue(r.Context(), ctxKey{}, info))
		defer func() {
			if p := recover(); p != nil {
				a.Log.Error("panic", "route", inner.Pattern)
				if sw.status == 0 {
					writeErr(sw, http.StatusInternalServerError, "internal")
				}
			}
			if inner.Pattern == "GET /healthz" {
				return
			}
			a.Log.Info("request", "method", r.Method, "route", inner.Pattern, "status", sw.status, "ms", time.Since(start).Milliseconds(), "server", info.server, "bytes", sw.bytes)
		}()
		next.ServeHTTP(sw, inner)
	})
}

func setServer(r *http.Request, id string) {
	if info, ok := r.Context().Value(ctxKey{}).(*reqInfo); ok {
		info.server = id
	}
}

// server wraps a handler that needs the calling server (Authorization: Bearer <connect token>). When the route
// has {id}, it must be the caller's own.
func (a *API) server(h func(http.ResponseWriter, *http.Request, *store.Server)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := bearer(r)
		if tok == "" {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		sv, err := a.Store.GetServerByTokenHash(r.Context(), hashToken(tok))
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if err != nil {
			a.Log.Error("store", "err", err)
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		setServer(r, sv.ID)
		if id := r.PathValue("id"); id != "" && id != sv.ID {
			writeErr(w, http.StatusNotFound, "not_found")
			return
		}
		if sv.Flags.Suspended {
			writeErr(w, http.StatusForbidden, "suspended")
			return
		}
		a.touch(r.Context(), sv.ID)
		h(w, r, sv)
	}
}

// touch records that a server was seen, at most once a minute per server.
func (a *API) touch(ctx context.Context, id string) {
	now := a.Now()
	a.touchMu.Lock()
	last := a.touched[id]
	if now.Sub(last) < time.Minute {
		a.touchMu.Unlock()
		return
	}
	a.touched[id] = now
	a.touchMu.Unlock()
	if err := a.Store.TouchServer(ctx, id, now, time.Time{}); err != nil {
		a.Log.Warn("touch failed", "server", id, "err", err)
	}
}

// cloud wraps a handler called by Folevi Cloud (Authorization: Bearer <CONNECT_SERVICE_KEY>, X-Folevi-User).
func (a *API) cloud(h func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sameSecret(bearer(r), a.cfg.ServiceKey) {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		user := r.Header.Get("X-Folevi-User")
		if !validAccount(user) {
			writeErr(w, http.StatusBadRequest, "missing_user")
			return
		}
		h(w, r, user)
	}
}

// admin wraps Folevi's own operations calls (Authorization: Bearer <CONNECT_ADMIN_KEY>).
func (a *API) admin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sameSecret(bearer(r), a.cfg.AdminKey) {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		h(w, r)
	}
}

func validAccount(s string) bool {
	if len(s) == 0 || len(s) > 128 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-' || c == '|' || c == ':') {
			return false
		}
	}
	return true
}
