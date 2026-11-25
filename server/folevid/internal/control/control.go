// Package control is folevid's loopback control API (CONTRACT §5). Every request needs
// `Authorization: Bearer <FOLEVI_SERVER_SECRET>`; the comparison is constant time.
package control

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/faisalibnislam/folevi/server/folevid/internal/config"
)

// Service is one row of status.services.
type Service struct {
	Name     string `json:"name"`
	State    string `json:"state"`
	PID      int    `json:"pid"`
	RSSBytes uint64 `json:"rssBytes"`
	Restarts int    `json:"restarts"`
}

// Status is GET /v1/status.
type Status struct {
	Version       string    `json:"version"`
	UptimeSeconds int64     `json:"uptimeSeconds"`
	PublicURL     string    `json:"publicUrl"`
	Services      []Service `json:"services"`
	Disk          struct {
		DataBytes uint64 `json:"dataBytes"`
		FreeBytes uint64 `json:"freeBytes"`
	} `json:"disk"`
	Memory struct {
		TotalBytes     uint64 `json:"totalBytes"`
		AvailableBytes uint64 `json:"availableBytes"`
		// Profile is the memory profile in use (tiny, low or high). Low is true when the machine has
		// 2.5 GB or less in total or under 256 MB available now, so the admin panel can warn.
		Profile string `json:"profile"`
		Low     bool   `json:"low"`
	} `json:"memory"`
}

// Backup is one row of GET /v1/backups.
type Backup struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	SizeBytes int64     `json:"sizeBytes"`
	Kind      string    `json:"kind"`
	Encrypted bool      `json:"encrypted"`
}

// BackupKey is GET /v1/backups/key: the key that encrypts this server's backups (key, secret: the owner saves
// it once to restore on another machine) and its public half (recipient).
type BackupKey struct {
	Key       string `json:"key"`
	Recipient string `json:"recipient"`
}

// RestoreRequest is the optional body of POST /v1/backups/{id}/restore: the key of the server that made an
// encrypted backup, when it is not this one.
type RestoreRequest struct {
	Key string `json:"key,omitempty"`
}

// S3 is the S3 part of a schedule target. The secret is write-only.
type S3 struct {
	Endpoint        string `json:"endpoint"`
	Bucket          string `json:"bucket"`
	Prefix          string `json:"prefix,omitempty"`
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey,omitempty"`
	Region          string `json:"region,omitempty"`
}

// Target is where backups go.
type Target struct {
	Kind string `json:"kind"`
	Path string `json:"path,omitempty"`
	S3   *S3    `json:"s3,omitempty"`
}

// Schedule is the backup schedule.
type Schedule struct {
	Enabled bool   `json:"enabled"`
	Hour    int    `json:"hour"`
	Keep    int    `json:"keep"`
	Target  Target `json:"target"`
}

// Backups is GET /v1/backups.
type Backups struct {
	Backups  []Backup `json:"backups"`
	Schedule Schedule `json:"schedule"`
}

// Remote is GET /v1/remote.
type Remote struct {
	PublicURL string `json:"publicUrl"`
	Connect   struct {
		State        string   `json:"state"`
		ServerID     string   `json:"serverId,omitempty"`
		Hostname     string   `json:"hostname,omitempty"`
		LANHostnames []string `json:"lanHostnames,omitempty"`
	} `json:"connect"`
	UPnP struct {
		State        string `json:"state"`
		ExternalPort int    `json:"externalPort,omitempty"`
	} `json:"upnp"`
	Reachable *bool `json:"reachable,omitempty"`
	Relay     struct {
		Enabled   bool `json:"enabled"`
		Connected bool `json:"connected"`
	} `json:"relay"`
	CustomDomain string `json:"customDomain,omitempty"`
}

// RemoteUpdate is PUT /v1/remote.
type RemoteUpdate struct {
	ConnectEnabled *bool   `json:"connectEnabled,omitempty"`
	RelayEnabled   *bool   `json:"relayEnabled,omitempty"`
	UPnPEnabled    *bool   `json:"upnpEnabled,omitempty"`
	CustomDomain   *string `json:"customDomain,omitempty"`
}

// Link is POST /v1/connect/link.
type Link struct {
	Code       string    `json:"code"`
	ApproveURL string    `json:"approveUrl"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

// Update is GET /v1/update.
type Update struct {
	Current   string `json:"current"`
	Latest    string `json:"latest,omitempty"`
	NotesURL  string `json:"notesUrl,omitempty"`
	Channel   string `json:"channel"`
	ManagedBy string `json:"managedBy"`
}

// Backend is what the API controls (implemented by package app).
type Backend interface {
	Status() Status
	Logs(service string, lines int) ([]string, error)
	Backups() (Backups, error)
	StartBackup(kind string, wait bool) (string, error)
	SetSchedule(Schedule) error
	Restore(id, key string) error
	BackupKey() (BackupKey, error)
	Remote() Remote
	SetRemote(RemoteUpdate) error
	ConnectLink() (Link, error)
	Update() Update
	Diagnostics() (string, error)
}

// Error is an error with an HTTP status.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return e.Message }

// BadRequest makes a 400 error.
func BadRequest(msg string) error { return &Error{Status: http.StatusBadRequest, Message: msg} }

// NotFound makes a 404 error.
func NotFound(msg string) error { return &Error{Status: http.StatusNotFound, Message: msg} }

// Conflict makes a 409 error.
func Conflict(msg string) error { return &Error{Status: http.StatusConflict, Message: msg} }

// Handler returns the API. secret is called on every request so a rotated secret takes effect at once.
func Handler(b Backend, secret func() string, log *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/status", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, b.Status()) })
	mux.HandleFunc("GET /v1/logs", func(w http.ResponseWriter, r *http.Request) {
		svc := r.URL.Query().Get("service")
		if svc == "" {
			svc = "folevid"
		}
		if svc != "folevid" && svc != "backend" && svc != "web" {
			writeErr(w, BadRequest("service must be folevid, backend or web"))
			return
		}
		n := 500
		if v := r.URL.Query().Get("lines"); v != "" {
			var err error
			if n, err = strconv.Atoi(v); err != nil || n < 0 {
				writeErr(w, BadRequest("lines must be a number"))
				return
			}
		}
		n = min(n, 5000)
		lines, err := b.Logs(svc, n)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, map[string]any{"lines": lines})
	})
	mux.HandleFunc("GET /v1/backups", func(w http.ResponseWriter, r *http.Request) {
		res, err := b.Backups()
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, res)
	})
	mux.HandleFunc("POST /v1/backups", func(w http.ResponseWriter, r *http.Request) {
		// ?wait=1 (folevid's own CLI) answers when the backup is done.
		id, err := b.StartBackup("manual", r.URL.Query().Get("wait") == "1")
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, map[string]string{"id": id})
	})
	mux.HandleFunc("PUT /v1/backups/schedule", func(w http.ResponseWriter, r *http.Request) {
		var s Schedule
		if !readJSON(w, r, &s) {
			return
		}
		if err := b.SetSchedule(s); err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /v1/backups/key", func(w http.ResponseWriter, r *http.Request) {
		k, err := b.BackupKey()
		if err != nil {
			writeErr(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, k)
	})
	mux.HandleFunc("POST /v1/backups/{id}/restore", func(w http.ResponseWriter, r *http.Request) {
		// The body is optional: {"key": "AGE-SECRET-KEY-1..."} for a backup made on another machine.
		var req RestoreRequest
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
		if err != nil {
			writeErr(w, BadRequest("body too large"))
			return
		}
		if len(bytes.TrimSpace(body)) > 0 {
			dec := json.NewDecoder(bytes.NewReader(body))
			dec.DisallowUnknownFields()
			if err := dec.Decode(&req); err != nil {
				writeErr(w, BadRequest("invalid JSON: "+err.Error()))
				return
			}
		}
		if err := b.Restore(r.PathValue("id"), req.Key); err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /v1/remote", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, b.Remote()) })
	mux.HandleFunc("PUT /v1/remote", func(w http.ResponseWriter, r *http.Request) {
		var u RemoteUpdate
		if !readJSON(w, r, &u) {
			return
		}
		if err := b.SetRemote(u); err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, b.Remote())
	})
	mux.HandleFunc("POST /v1/connect/link", func(w http.ResponseWriter, r *http.Request) {
		l, err := b.ConnectLink()
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, l)
	})
	mux.HandleFunc("GET /v1/update", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, b.Update()) })
	mux.HandleFunc("POST /v1/diagnostics", func(w http.ResponseWriter, r *http.Request) {
		ref, err := b.Diagnostics()
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, map[string]string{"reference": ref})
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if !Authorized(r.Header.Get("Authorization"), secret()) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="folevid"`)
			writeJSONStatus(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		// Loopback names only (defends against DNS rebinding, on top of the bearer token).
		if host := hostOnly(r.Host); host != "127.0.0.1" && host != "localhost" && host != "::1" {
			writeJSONStatus(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
			return
		}
		if log != nil {
			log.Debug("control", "method", r.Method, "path", r.URL.Path)
		}
		mux.ServeHTTP(w, r)
	})
}

// Authorized compares "Bearer <secret>" in constant time. An empty secret never matches.
func Authorized(header, secret string) bool {
	if secret == "" {
		return false
	}
	token, ok := strings.CutPrefix(header, "Bearer ")
	if !ok {
		return false
	}
	// Hash both sides so the comparison time does not depend on the length either.
	a := sha256.Sum256([]byte(token))
	b := sha256.Sum256([]byte(secret))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

func hostOnly(hostport string) string {
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		return strings.Trim(h, "[]")
	}
	return strings.Trim(hostport, "[]")
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeErr(w, BadRequest("invalid JSON: "+err.Error()))
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, v any) { writeJSONStatus(w, http.StatusOK, v) }

func writeJSONStatus(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	var e *Error
	if errors.As(err, &e) {
		writeJSONStatus(w, e.Status, map[string]string{"error": e.Message})
		return
	}
	writeJSONStatus(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
}

// ScheduleFromConfig converts the stored schedule for the API, hiding the S3 secret.
func ScheduleFromConfig(b config.Backup) Schedule {
	s := Schedule{Enabled: b.Enabled, Hour: b.Hour, Keep: b.Keep, Target: Target{Kind: b.Target.Kind, Path: b.Target.Path}}
	if b.Target.S3 != nil {
		c := b.Target.S3
		s.Target.S3 = &S3{Endpoint: c.Endpoint, Bucket: c.Bucket, Prefix: c.Prefix, AccessKeyID: c.AccessKeyID, Region: c.Region}
	}
	return s
}

// ApplySchedule writes an API schedule into the stored config. An empty S3 secret keeps the stored one.
func ApplySchedule(c *config.Config, s Schedule) error {
	if s.Keep <= 0 {
		s.Keep = config.DefaultKeep
	}
	if s.Hour < 0 || s.Hour > 23 {
		return BadRequest("hour must be 0 to 23")
	}
	t := config.BackupTarget{Kind: s.Target.Kind, Path: s.Target.Path}
	switch s.Target.Kind {
	case "local", "folder":
	case "s3":
		if s.Target.S3 == nil {
			return BadRequest("s3 target needs s3 settings")
		}
		in := s.Target.S3
		t.S3 = &config.S3Target{Endpoint: in.Endpoint, Bucket: in.Bucket, Prefix: in.Prefix, AccessKeyID: in.AccessKeyID,
			SecretAccessKey: in.SecretAccessKey, Region: in.Region}
		if t.S3.SecretAccessKey == "" && c.Backup.Target.S3 != nil {
			t.S3.SecretAccessKey = c.Backup.Target.S3.SecretAccessKey
		}
	default:
		return BadRequest("target.kind must be local, folder or s3")
	}
	c.Backup = config.Backup{Enabled: s.Enabled, Hour: s.Hour, Keep: s.Keep, Target: t}
	return nil
}
