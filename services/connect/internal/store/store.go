// Package store keeps Connect's state: servers, link codes, usage counters, the mail audit log and diagnostics.
// SQLite today (sqlite.go); the Store interface is what a Postgres version would implement later.
package store

import (
	"context"
	"errors"
	"time"
)

// ErrNotFound is returned when a row does not exist (or a link code is spent or expired).
var ErrNotFound = errors.New("not found")

// Flags are the abuse controls Folevi can set per server (the kill switches).
type Flags struct {
	Suspended     bool `json:"suspended"`
	MailDisabled  bool `json:"mailDisabled"`
	PushDisabled  bool `json:"pushDisabled"`
	AIDisabled    bool `json:"aiDisabled"`
	RelayDisabled bool `json:"relayDisabled"`
}

// Server is one registered Folevi Server.
type Server struct {
	ID           string
	Name         string
	Version      string
	PublicKey    []byte // Ed25519, 32 bytes
	TokenHash    []byte // SHA-256 of the bearer token; the token itself is never stored
	OwnerAccount string // Folevi Cloud user id once linked, else ""
	LanIPs       []string
	PublicIP     string // the address the last reachability check dialed
	PublicPort   int
	Reachable    *bool // nil until a check has run
	CheckedAt    time.Time
	CreatedAt    time.Time
	LastSeenAt   time.Time
	TunnelSeenAt time.Time // the last time a relay tunnel was open
	Flags        Flags
}

// LinkCode is a pending link between a server and a Folevi account. Only the code's hash is stored.
type LinkCode struct {
	CodeHash  []byte
	ServerID  string
	ExpiresAt time.Time
	CreatedAt time.Time
}

// MailLog is one row of the mail audit log: metadata only, never the subject or body.
type MailLog struct {
	ID              string
	ServerID        string
	At              time.Time
	RecipientHash   string // SHA-256 hex of the lowercased address
	RecipientDomain string
	Tag             string
	Status          string // "sent", "refused", "failed", "limited"
	ProviderID      string
	Error           string // a short code, never provider text
}

// Diagnostic is one uploaded diagnostics bundle (already redacted by the server).
type Diagnostic struct {
	Reference string
	ServerID  string
	CreatedAt time.Time
	Text      string
}

// Store is everything Connect persists.
type Store interface {
	CreateServer(ctx context.Context, s *Server) error
	GetServer(ctx context.Context, id string) (*Server, error)
	GetServerByTokenHash(ctx context.Context, hash []byte) (*Server, error)
	UpdateServer(ctx context.Context, s *Server) error
	ListServersByOwner(ctx context.Context, account string) ([]*Server, error)
	TouchServer(ctx context.Context, id string, lastSeen time.Time, tunnelSeen time.Time) error

	CreateLinkCode(ctx context.Context, c LinkCode) error
	// ConsumeLinkCode deletes the code and returns its server id, or ErrNotFound when it is unknown or expired.
	ConsumeLinkCode(ctx context.Context, codeHash []byte, now time.Time) (string, error)
	DeleteExpiredLinkCodes(ctx context.Context, now time.Time) error

	// AddUsage adds n to a counter (server, kind, period) and returns the new total.
	AddUsage(ctx context.Context, serverID, kind, period string, n int64) (int64, error)
	GetUsage(ctx context.Context, serverID, kind, period string) (int64, error)

	AppendMailLog(ctx context.Context, l MailLog) error
	ListMailLog(ctx context.Context, serverID string, limit int) ([]MailLog, error)

	PutDiagnostic(ctx context.Context, d Diagnostic) error
	GetDiagnostic(ctx context.Context, reference string) (*Diagnostic, error)
	DeleteDiagnosticsBefore(ctx context.Context, t time.Time) error

	Close() error
}

// Month is the usage period for monthly counters ("2026-11").
func Month(t time.Time) string { return t.UTC().Format("2006-01") }

// Day is the usage period for daily counters ("2026-11-25").
func Day(t time.Time) string { return t.UTC().Format("2006-01-02") }
