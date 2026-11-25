package control

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/faisalibnislam/folevi/server/folevid/internal/config"
)

type fake struct {
	schedule Schedule
	restored string
	remote   RemoteUpdate
}

func (f *fake) Status() Status { return Status{Version: "1.2.3"} }
func (f *fake) Logs(s string, n int) ([]string, error) {
	return []string{s, strings.Repeat("x", n%3)}, nil
}
func (f *fake) Backups() (Backups, error) {
	return Backups{Backups: []Backup{}, Schedule: f.schedule}, nil
}
func (f *fake) StartBackup(string, bool) (string, error) { return "20261125T030000Z-manual", nil }
func (f *fake) SetSchedule(s Schedule) error             { f.schedule = s; return nil }
func (f *fake) Restore(id string) error {
	if id == "missing" {
		return NotFound("no such backup")
	}
	f.restored = id
	return nil
}
func (f *fake) Remote() Remote                 { return Remote{PublicURL: "http://x"} }
func (f *fake) SetRemote(u RemoteUpdate) error { f.remote = u; return nil }
func (f *fake) ConnectLink() (Link, error)     { return Link{Code: "ABC"}, nil }
func (f *fake) Update() Update {
	return Update{Current: "1.2.3", Channel: "stable", ManagedBy: "folevid"}
}
func (f *fake) Diagnostics() (string, error) { return "REF1", nil }

const secret = "0123456789abcdef0123456789abcdef"

func do(t *testing.T, h http.Handler, method, path, auth, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, "http://127.0.0.1:8461"+path, strings.NewReader(body))
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	b, _ := io.ReadAll(rec.Body)
	_ = json.Unmarshal(b, &out)
	return rec.Code, out
}

func TestAuthorized(t *testing.T) {
	cases := []struct {
		header, secret string
		want           bool
	}{
		{"Bearer " + secret, secret, true},
		{"Bearer " + secret + "x", secret, false},
		{"Bearer " + secret[:10], secret, false},
		{"bearer " + secret, secret, false},
		{secret, secret, false},
		{"Bearer ", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		if got := Authorized(c.header, c.secret); got != c.want {
			t.Errorf("Authorized(%q) = %v", c.header, got)
		}
	}
}

func TestHandlerAuth(t *testing.T) {
	h := Handler(&fake{}, func() string { return secret }, nil)
	if code, _ := do(t, h, "GET", "/v1/status", "", ""); code != 401 {
		t.Fatalf("no token: %d", code)
	}
	if code, _ := do(t, h, "GET", "/v1/status", "Bearer wrong", ""); code != 401 {
		t.Fatalf("wrong token: %d", code)
	}
	code, out := do(t, h, "GET", "/v1/status", "Bearer "+secret, "")
	if code != 200 || out["version"] != "1.2.3" {
		t.Fatalf("good token: %d %v", code, out)
	}
	// An empty configured secret locks everything.
	h2 := Handler(&fake{}, func() string { return "" }, nil)
	if code, _ := do(t, h2, "GET", "/v1/status", "Bearer ", ""); code != 401 {
		t.Fatalf("empty secret: %d", code)
	}
	// A non-loopback Host (DNS rebinding) is refused even with the token.
	req := httptest.NewRequest("GET", "http://evil.example:8461/v1/status", nil)
	req.Header.Set("Authorization", "Bearer "+secret)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("rebinding host: %d", rec.Code)
	}
}

func TestHandlerRoutes(t *testing.T) {
	f := &fake{}
	h := Handler(f, func() string { return secret }, nil)
	auth := "Bearer " + secret
	if code, out := do(t, h, "GET", "/v1/logs?service=backend&lines=4", auth, ""); code != 200 || out["lines"] == nil {
		t.Fatalf("logs: %d %v", code, out)
	}
	if code, _ := do(t, h, "GET", "/v1/logs?service=etc", auth, ""); code != 400 {
		t.Fatalf("bad service: %d", code)
	}
	if code, out := do(t, h, "POST", "/v1/backups", auth, ""); code != 200 || out["id"] == "" {
		t.Fatalf("backup: %d %v", code, out)
	}
	if code, _ := do(t, h, "PUT", "/v1/backups/schedule", auth, `{"enabled":true,"hour":4,"keep":7,"target":{"kind":"local"}}`); code != 200 || f.schedule.Hour != 4 {
		t.Fatalf("schedule: %d %+v", code, f.schedule)
	}
	if code, _ := do(t, h, "PUT", "/v1/backups/schedule", auth, `{"nope":1}`); code != 400 {
		t.Fatalf("unknown field: %d", code)
	}
	if code, _ := do(t, h, "POST", "/v1/backups/20261125T030000Z-nightly/restore", auth, ""); code != 200 || f.restored != "20261125T030000Z-nightly" {
		t.Fatalf("restore: %d", code)
	}
	if code, _ := do(t, h, "POST", "/v1/backups/missing/restore", auth, ""); code != 404 {
		t.Fatalf("restore missing: %d", code)
	}
	if code, _ := do(t, h, "PUT", "/v1/remote", auth, `{"upnpEnabled":true}`); code != 200 || f.remote.UPnPEnabled == nil || !*f.remote.UPnPEnabled {
		t.Fatalf("remote: %d", code)
	}
	if code, out := do(t, h, "POST", "/v1/connect/link", auth, ""); code != 200 || out["code"] != "ABC" {
		t.Fatalf("link: %d", code)
	}
	if code, out := do(t, h, "GET", "/v1/update", auth, ""); code != 200 || out["managedBy"] != "folevid" {
		t.Fatalf("update: %d", code)
	}
	if code, out := do(t, h, "POST", "/v1/diagnostics", auth, ""); code != 200 || out["reference"] != "REF1" {
		t.Fatalf("diagnostics: %d", code)
	}
	if code, _ := do(t, h, "DELETE", "/v1/status", auth, ""); code != 405 {
		t.Fatalf("method: %d", code)
	}
}

func TestScheduleSecretWriteOnly(t *testing.T) {
	c := config.Default()
	err := ApplySchedule(&c, Schedule{Enabled: true, Hour: 2, Keep: 5, Target: Target{Kind: "s3", S3: &S3{
		Endpoint: "https://s3.example", Bucket: "b", AccessKeyID: "AK", SecretAccessKey: "SECRETVALUE"}}})
	if err != nil {
		t.Fatal(err)
	}
	if c.Backup.Target.S3.SecretAccessKey != "SECRETVALUE" {
		t.Fatal("secret not stored")
	}
	// Leaving the secret out keeps the stored one.
	if err := ApplySchedule(&c, Schedule{Enabled: true, Hour: 2, Keep: 5, Target: Target{Kind: "s3", S3: &S3{
		Endpoint: "https://s3.example", Bucket: "b", AccessKeyID: "AK"}}}); err != nil {
		t.Fatal(err)
	}
	if c.Backup.Target.S3.SecretAccessKey != "SECRETVALUE" {
		t.Fatal("secret lost")
	}
	out := ScheduleFromConfig(c.Backup)
	if out.Target.S3.SecretAccessKey != "" {
		t.Fatal("secret returned by the API")
	}
	if err := ApplySchedule(&c, Schedule{Hour: 30, Target: Target{Kind: "local"}}); err == nil {
		t.Fatal("hour 30 accepted")
	}
}
