// Package proxy is the one public origin (CONTRACT §2): /convex/* to the backend's client API (WebSocket
// included), /convex-site/* to its HTTP actions, both with the prefix removed, and everything else to the web
// server. It replaces scripts/self-host/proxy.mjs.
package proxy

import (
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// Targets are the three upstreams.
type Targets struct {
	Web    *url.URL // http://127.0.0.1:3501
	Convex *url.URL // http://127.0.0.1:3510
	Site   *url.URL // http://127.0.0.1:3511
	Scheme string   // "http" or "https", for X-Forwarded-Proto
	Logger *slog.Logger
	// Starting reports whether services are still coming up; upstream connection errors then get a
	// friendly "starting" page instead of a bare 502.
	Starting func() bool
}

// Route picks the upstream for a request path and returns the path to send. Exported for tests.
func Route(t *Targets, path string) (*url.URL, string) {
	for _, r := range []struct {
		prefix string
		target *url.URL
	}{{"/convex-site", t.Site}, {"/convex", t.Convex}} {
		if path == r.prefix || strings.HasPrefix(path, r.prefix+"/") {
			rest := strings.TrimPrefix(path, r.prefix)
			if rest == "" {
				rest = "/"
			}
			return r.target, rest
		}
	}
	return t.Web, path
}

// New returns the proxy handler.
func New(t *Targets) http.Handler {
	if t.Logger == nil {
		t.Logger = slog.Default()
	}
	transport := &http.Transport{
		Proxy:                 nil, // never send loopback traffic through an HTTP_PROXY
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   32,
		IdleConnTimeout:       90 * time.Second,
		ResponseHeaderTimeout: 0, // long polls and streams
		ExpectContinueTimeout: time.Second,
		DisableCompression:    true,
	}
	rp := &httputil.ReverseProxy{
		Transport:     transport,
		FlushInterval: -1, // stream (server-sent events, AI answers)
		Rewrite: func(pr *httputil.ProxyRequest) {
			target, path := Route(t, pr.In.URL.Path)
			rawPath := ""
			if pr.In.URL.RawPath != "" {
				_, rawPath = Route(t, pr.In.URL.RawPath)
			}
			pr.Out.URL.Scheme = target.Scheme
			pr.Out.URL.Host = target.Host
			pr.Out.URL.Path = path
			pr.Out.URL.RawPath = rawPath
			pr.Out.URL.RawQuery = pr.In.URL.RawQuery
			pr.Out.Host = pr.In.Host // keep the public Host, as the Phase 0 proxy did
			pr.SetXForwarded()
			pr.Out.Header.Set("X-Forwarded-Proto", t.Scheme)
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			refused := errors.Is(err, syscall.ECONNREFUSED)
			if refused && t.Starting != nil && t.Starting() {
				w.Header().Set("Retry-After", "3")
				if strings.Contains(r.Header.Get("Accept"), "text/html") {
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte(startingPage))
					return
				}
				http.Error(w, "Folevi is starting", http.StatusServiceUnavailable)
				return
			}
			if !errors.Is(err, http.ErrAbortHandler) && r.Context().Err() == nil {
				t.Logger.Warn("proxy upstream error", "path", r.URL.Path, "err", err)
			}
			http.Error(w, "Folevi could not reach one of its services", http.StatusBadGateway)
		},
	}
	return rp
}

const startingPage = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="3">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Folevi is starting</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#333}</style>
</head><body><p>Folevi is starting. This page reloads by itself.</p></body></html>`
