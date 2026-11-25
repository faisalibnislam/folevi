package proxy

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func upstream(t *testing.T, name string) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Upgrade") == "websocket" {
			c, err := websocket.Accept(w, r, nil)
			if err != nil {
				return
			}
			defer c.CloseNow()
			ctx := r.Context()
			for {
				typ, msg, err := c.Read(ctx)
				if err != nil {
					return
				}
				_ = c.Write(ctx, typ, append([]byte(name+":"+r.URL.Path+":"), msg...))
			}
		}
		w.Header().Set("X-Upstream", name)
		w.Header().Set("X-Seen-Path", r.URL.RequestURI())
		w.Header().Set("X-Seen-Host", r.Host)
		w.Header().Set("X-Seen-Proto", r.Header.Get("X-Forwarded-Proto"))
		w.Header().Set("X-Seen-For", r.Header.Get("X-Forwarded-For"))
		body, _ := io.ReadAll(r.Body)
		_, _ = w.Write([]byte(name + " " + string(body)))
	}))
	t.Cleanup(s.Close)
	return s
}

func targets(t *testing.T) (*Targets, *httptest.Server) {
	web, cv, site := upstream(t, "web"), upstream(t, "convex"), upstream(t, "site")
	tg := &Targets{Web: mustParse(web.URL), Convex: mustParse(cv.URL), Site: mustParse(site.URL), Scheme: "http"}
	front := httptest.NewServer(New(tg))
	t.Cleanup(front.Close)
	return tg, front
}

func mustParse(s string) *url.URL { u, _ := url.Parse(s); return u }

func TestRoute(t *testing.T) {
	tg := &Targets{Web: mustParse("http://w"), Convex: mustParse("http://c"), Site: mustParse("http://s")}
	cases := []struct{ in, host, path string }{
		{"/", "w", "/"},
		{"/documents/x", "w", "/documents/x"},
		{"/convex", "c", "/"},
		{"/convex/", "c", "/"},
		{"/convex/api/1.0/sync", "c", "/api/1.0/sync"},
		{"/convex-site", "s", "/"},
		{"/convex-site/files/abc", "s", "/files/abc"},
		{"/convexity", "w", "/convexity"},
		{"/convex-sites/x", "w", "/convex-sites/x"},
		{"/setup", "w", "/setup"},
	}
	for _, c := range cases {
		u, p := Route(tg, c.in)
		if u.Host != c.host || p != c.path {
			t.Errorf("Route(%q) = %s %s, want %s %s", c.in, u.Host, p, c.host, c.path)
		}
	}
}

func TestProxyHTTP(t *testing.T) {
	_, front := targets(t)
	cases := []struct{ path, upstream, seen string }{
		{"/documents?x=1", "web", "/documents?x=1"},
		{"/convex/version", "convex", "/version"},
		{"/convex-site/api/auth/convex/jwks?a=b", "site", "/api/auth/convex/jwks?a=b"},
		{"/convex", "convex", "/"},
	}
	for _, c := range cases {
		resp, err := http.Post(front.URL+c.path, "text/plain", strings.NewReader("hi"))
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if got := resp.Header.Get("X-Upstream"); got != c.upstream {
			t.Errorf("%s went to %q, want %q", c.path, got, c.upstream)
		}
		if got := resp.Header.Get("X-Seen-Path"); got != c.seen {
			t.Errorf("%s arrived as %q, want %q", c.path, got, c.seen)
		}
		if string(body) != c.upstream+" hi" {
			t.Errorf("%s body %q", c.path, body)
		}
		if resp.Header.Get("X-Seen-Proto") != "http" || resp.Header.Get("X-Seen-For") == "" {
			t.Errorf("forwarded headers missing: %v", resp.Header)
		}
		if !strings.HasPrefix(resp.Header.Get("X-Seen-Host"), "127.0.0.1:") {
			t.Errorf("host header not kept: %q", resp.Header.Get("X-Seen-Host"))
		}
	}
}

func TestProxyWebSocket(t *testing.T) {
	_, front := targets(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(front.URL, "http") + "/convex/api/1.0/sync"
	c, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	for _, msg := range []string{"one", "two"} {
		if err := c.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
			t.Fatal(err)
		}
		_, got, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != "convex:/api/1.0/sync:"+msg {
			t.Fatalf("got %q", got)
		}
	}
}

func TestProxyStartingPage(t *testing.T) {
	starting := true
	dead := mustParse("http://127.0.0.1:1")
	h := New(&Targets{Web: dead, Convex: dead, Site: dead, Scheme: "http", Starting: func() bool { return starting }})
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Accept", "text/html")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 503 || !strings.Contains(rec.Body.String(), "starting") {
		t.Fatalf("starting: %d %q", rec.Code, rec.Body.String())
	}
	starting = false
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != 502 {
		t.Fatalf("after start: %d", rec.Code)
	}
}
