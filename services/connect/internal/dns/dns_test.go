package dns

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"
)

func TestIsPrivate(t *testing.T) {
	cases := map[string]bool{
		"10.0.0.5": true, "172.16.3.4": true, "172.31.255.1": true, "192.168.1.20": true, "fd12:3456::1": true, "fc00::1": true,
		"8.8.8.8": false, "172.32.0.1": false, "127.0.0.1": false, "169.254.1.1": false, "100.64.0.1": false, "2001:db8::1": false,
		"2606:4700::1111": false, "::1": false, "fe80::1": false, "0.0.0.0": false,
	}
	for s, want := range cases {
		if got := IsPrivate(netip.MustParseAddr(s)); got != want {
			t.Errorf("IsPrivate(%s) = %v, want %v", s, got, want)
		}
	}
}

func TestLanLabels(t *testing.T) {
	n := Names{Zone: "folevi.app"}
	h, err := n.LanHost("abcdefgh23", netip.MustParseAddr("192.168.1.20"))
	if err != nil || h != "192-168-1-20.abcdefgh23.folevi.app" {
		t.Fatalf("LanHost = %q, %v", h, err)
	}
	h6, err := n.LanHost("abcdefgh23", netip.MustParseAddr("fd00::1"))
	if err != nil || h6 != "fd00-0000-0000-0000-0000-0000-0000-0001.abcdefgh23.folevi.app" {
		t.Fatalf("LanHost v6 = %q, %v", h6, err)
	}
	if _, err := n.LanHost("abcdefgh23", netip.MustParseAddr("1.2.3.4")); err == nil {
		t.Fatal("public address accepted as a LAN name")
	}
	for _, bad := range []string{"1-2-3-4", "8-8-8-8", "192-168-01-20", "192-168-1", "x-y-z-w", "127-0-0-1"} {
		if _, err := ParseLanLabel(bad); err == nil {
			t.Errorf("ParseLanLabel(%q) accepted", bad)
		}
	}
	if ip, err := ParseLanLabel("10-0-0-7"); err != nil || ip.String() != "10.0.0.7" {
		t.Fatalf("ParseLanLabel = %v, %v", ip, err)
	}
}

func TestServerOfAndAcme(t *testing.T) {
	n := Names{Zone: "folevi.app"}
	for host, want := range map[string]string{
		"abcdefgh23.folevi.app": "abcdefgh23", "192-168-1-2.abcdefgh23.folevi.app": "abcdefgh23", "ABCDEFGH23.FOLEVI.APP.": "abcdefgh23",
		"a.b.abcdefgh23.folevi.app": "", "short.folevi.app": "", "abcdefgh23.folevi.app.evil.com": "", "folevi.app": "", "abcdefgh23.example.com": "",
	} {
		got, ok := n.ServerOf(host)
		if got != want || ok != (want != "") {
			t.Errorf("ServerOf(%q) = %q %v, want %q", host, got, ok, want)
		}
	}
	if name, err := n.AcmeName("abcdefgh23", "@"); err != nil || name != "_acme-challenge.abcdefgh23.folevi.app" {
		t.Fatalf("AcmeName @ = %q %v", name, err)
	}
	if name, err := n.AcmeName("abcdefgh23", "10-1-2-3"); err != nil || name != "_acme-challenge.10-1-2-3.abcdefgh23.folevi.app" {
		t.Fatalf("AcmeName lan = %q %v", name, err)
	}
	for _, bad := range []string{"www", "other", "8-8-8-8", "_acme-challenge", "..", "a.b"} {
		if _, err := n.AcmeName("abcdefgh23", bad); err == nil {
			t.Errorf("AcmeName(%q) accepted", bad)
		}
	}
	if !ValidAcmeValue("abcDEF0123456789_-xyzabcdefghijklmnopqrstu") || ValidAcmeValue(`"x" or 1`) || ValidAcmeValue("short") {
		t.Fatal("ValidAcmeValue")
	}
}

func TestManagerSetAddressesAndTXT(t *testing.T) {
	mem := NewMemory()
	m := &Manager{Provider: mem, Names: Names{Zone: "folevi.app"}, TTL: 60}
	ctx := context.Background()
	name := "abcdefgh23.folevi.app"
	if err := m.SetAddresses(ctx, name, []netip.Addr{netip.MustParseAddr("203.0.113.5"), netip.MustParseAddr("2001:db8::5")}); err != nil {
		t.Fatal(err)
	}
	if err := m.SetAddresses(ctx, name, []netip.Addr{netip.MustParseAddr("203.0.113.9")}); err != nil {
		t.Fatal(err)
	}
	all := mem.All()
	if len(all) != 1 || all[0].Type != "A" || all[0].Content != "203.0.113.9" {
		t.Fatalf("records = %+v", all)
	}
	txt := "_acme-challenge." + name
	_ = m.AddTXT(ctx, txt, "valueoneaaaaaaaaaaaaaaa")
	_ = m.AddTXT(ctx, txt, "valuetwoaaaaaaaaaaaaaaa")
	_ = m.AddTXT(ctx, txt, "valuetwoaaaaaaaaaaaaaaa") // idempotent
	if rs, _ := mem.List(ctx, txt); len(rs) != 2 {
		t.Fatalf("txt = %+v", rs)
	}
	_ = m.RemoveTXT(ctx, txt, "valueoneaaaaaaaaaaaaaaa")
	if rs, _ := mem.List(ctx, txt); len(rs) != 1 || rs[0].Content != "valuetwoaaaaaaaaaaaaaaa" {
		t.Fatalf("txt after remove = %+v", rs)
	}
	_ = m.SetAddresses(ctx, name, nil)
	_ = m.RemoveTXT(ctx, txt, "")
	if len(mem.All()) != 0 {
		t.Fatalf("left over: %+v", mem.All())
	}
}

// fakeCloudflare is enough of Cloudflare's v4 DNS API for the provider.
func fakeCloudflare(t *testing.T, token string) *httptest.Server {
	var mu sync.Mutex
	recs := map[string]cfRecord{}
	next := 0
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(403)
			_, _ = w.Write([]byte(`{"success":false,"errors":[{"code":10000}]}`))
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/zones/zone1/dns_records") {
			w.WriteHeader(404)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		reply := func(v any) {
			b, _ := json.Marshal(map[string]any{"success": true, "errors": []any{}, "result": v})
			_, _ = w.Write(b)
		}
		switch r.Method {
		case http.MethodGet:
			out := []cfRecord{}
			for _, rec := range recs {
				if rec.Name == r.URL.Query().Get("name") {
					out = append(out, rec)
				}
			}
			reply(out)
		case http.MethodPost:
			var rec cfRecord
			_ = json.NewDecoder(r.Body).Decode(&rec)
			next++
			rec.ID = "id" + string(rune('a'+next))
			recs[rec.ID] = rec
			reply(rec)
		case http.MethodDelete:
			id := strings.TrimPrefix(r.URL.Path, "/zones/zone1/dns_records/")
			delete(recs, id)
			reply(map[string]string{"id": id})
		}
	}))
}

func TestCloudflareProvider(t *testing.T) {
	srv := fakeCloudflare(t, "cf-secret")
	defer srv.Close()
	cf := NewCloudflare("zone1", "cf-secret")
	cf.BaseURL = srv.URL
	m := &Manager{Provider: cf, Names: Names{Zone: "folevi.app"}, TTL: 60}
	ctx := context.Background()
	if err := m.SetAddresses(ctx, "x.folevi.app", []netip.Addr{netip.MustParseAddr("198.51.100.1")}); err != nil {
		t.Fatal(err)
	}
	if err := m.AddTXT(ctx, "_acme-challenge.x.folevi.app", "tokentokentokentoken"); err != nil {
		t.Fatal(err)
	}
	rs, err := cf.List(ctx, "_acme-challenge.x.folevi.app")
	if err != nil || len(rs) != 1 || rs[0].Content != `"tokentokentokentoken"` {
		t.Fatalf("txt = %+v %v", rs, err)
	}
	if err := m.RemoveTXT(ctx, "_acme-challenge.x.folevi.app", "tokentokentokentoken"); err != nil {
		t.Fatal(err)
	}
	if rs, _ := cf.List(ctx, "_acme-challenge.x.folevi.app"); len(rs) != 0 {
		t.Fatal("TXT not removed")
	}
	bad := NewCloudflare("zone1", "wrong")
	bad.BaseURL = srv.URL
	_, err = bad.List(ctx, "x.folevi.app")
	if err == nil || strings.Contains(err.Error(), "wrong") {
		t.Fatalf("expected a refusal without the token in it, got %v", err)
	}
}
