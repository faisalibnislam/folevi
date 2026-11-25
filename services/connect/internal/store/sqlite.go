package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite" // pure Go driver, registered as "sqlite"
)

// SQLite is the Store on a SQLite file (modernc.org/sqlite, no cgo).
type SQLite struct {
	db *sql.DB
}

const schema = `
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  public_key BLOB NOT NULL,
  token_hash BLOB NOT NULL UNIQUE,
  owner_account TEXT NOT NULL DEFAULT '',
  lan_ips TEXT NOT NULL DEFAULT '[]',
  public_ip TEXT NOT NULL DEFAULT '',
  public_port INTEGER NOT NULL DEFAULT 0,
  reachable INTEGER,
  checked_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL DEFAULT 0,
  tunnel_seen_at INTEGER NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS servers_owner ON servers(owner_account);
CREATE TABLE IF NOT EXISTS link_codes (
  code_hash BLOB PRIMARY KEY,
  server_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  server_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  period TEXT NOT NULL,
  amount INTEGER NOT NULL,
  PRIMARY KEY (server_id, kind, period)
);
CREATE TABLE IF NOT EXISTS mail_log (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  recipient_hash TEXT NOT NULL,
  recipient_domain TEXT NOT NULL,
  tag TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_id TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS mail_log_server ON mail_log(server_id, at);
CREATE TABLE IF NOT EXISTS diagnostics (
  reference TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  text TEXT NOT NULL
);
`

// OpenSQLite opens (creating if needed) the database at path. ":memory:" works for tests.
func OpenSQLite(path string) (*SQLite, error) {
	dsn := "file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	if path == ":memory:" {
		dsn = "file::memory:?_pragma=busy_timeout(5000)"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// One writer keeps SQLite simple and an in-memory database single (each connection would get its own).
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("schema: %w", err)
	}
	return &SQLite{db: db}, nil
}

func (s *SQLite) Close() error { return s.db.Close() }

func ms(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

func fromMs(v int64) time.Time {
	if v == 0 {
		return time.Time{}
	}
	return time.UnixMilli(v).UTC()
}

const serverCols = `id, name, version, public_key, token_hash, owner_account, lan_ips, public_ip, public_port, reachable, checked_at, created_at, last_seen_at, tunnel_seen_at, flags`

type scanner interface{ Scan(dest ...any) error }

func scanServer(row scanner) (*Server, error) {
	var (
		sv                                 Server
		lan, flags                         string
		reachable                          sql.NullInt64
		checked, created, seen, tunnelSeen int64
	)
	err := row.Scan(&sv.ID, &sv.Name, &sv.Version, &sv.PublicKey, &sv.TokenHash, &sv.OwnerAccount, &lan, &sv.PublicIP, &sv.PublicPort, &reachable, &checked, &created, &seen, &tunnelSeen, &flags)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(lan), &sv.LanIPs); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(flags), &sv.Flags); err != nil {
		return nil, err
	}
	if reachable.Valid {
		r := reachable.Int64 == 1
		sv.Reachable = &r
	}
	sv.CheckedAt, sv.CreatedAt, sv.LastSeenAt, sv.TunnelSeenAt = fromMs(checked), fromMs(created), fromMs(seen), fromMs(tunnelSeen)
	return &sv, nil
}

func serverArgs(sv *Server) ([]any, error) {
	lan := sv.LanIPs
	if lan == nil {
		lan = []string{}
	}
	lanJSON, err := json.Marshal(lan)
	if err != nil {
		return nil, err
	}
	flagsJSON, err := json.Marshal(sv.Flags)
	if err != nil {
		return nil, err
	}
	var reachable any
	if sv.Reachable != nil {
		if *sv.Reachable {
			reachable = 1
		} else {
			reachable = 0
		}
	}
	return []any{sv.ID, sv.Name, sv.Version, sv.PublicKey, sv.TokenHash, sv.OwnerAccount, string(lanJSON), sv.PublicIP, sv.PublicPort, reachable, ms(sv.CheckedAt), ms(sv.CreatedAt), ms(sv.LastSeenAt), ms(sv.TunnelSeenAt), string(flagsJSON)}, nil
}

func (s *SQLite) CreateServer(ctx context.Context, sv *Server) error {
	args, err := serverArgs(sv)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO servers (`+serverCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, args...)
	return err
}

func (s *SQLite) GetServer(ctx context.Context, id string) (*Server, error) {
	return scanServer(s.db.QueryRowContext(ctx, `SELECT `+serverCols+` FROM servers WHERE id = ?`, id))
}

func (s *SQLite) GetServerByTokenHash(ctx context.Context, hash []byte) (*Server, error) {
	return scanServer(s.db.QueryRowContext(ctx, `SELECT `+serverCols+` FROM servers WHERE token_hash = ?`, hash))
}

func (s *SQLite) UpdateServer(ctx context.Context, sv *Server) error {
	args, err := serverArgs(sv)
	if err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx, `UPDATE servers SET name=?2, version=?3, public_key=?4, token_hash=?5, owner_account=?6, lan_ips=?7, public_ip=?8, public_port=?9, reachable=?10, checked_at=?11, created_at=?12, last_seen_at=?13, tunnel_seen_at=?14, flags=?15 WHERE id=?1`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *SQLite) ListServersByOwner(ctx context.Context, account string) ([]*Server, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+serverCols+` FROM servers WHERE owner_account = ? ORDER BY created_at`, account)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Server
	for rows.Next() {
		sv, err := scanServer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sv)
	}
	return out, rows.Err()
}

func (s *SQLite) TouchServer(ctx context.Context, id string, lastSeen, tunnelSeen time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE servers SET last_seen_at = MAX(last_seen_at, ?), tunnel_seen_at = MAX(tunnel_seen_at, ?) WHERE id = ?`, ms(lastSeen), ms(tunnelSeen), id)
	return err
}

func (s *SQLite) CreateLinkCode(ctx context.Context, c LinkCode) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO link_codes (code_hash, server_id, expires_at, created_at) VALUES (?,?,?,?)`, c.CodeHash, c.ServerID, ms(c.ExpiresAt), ms(c.CreatedAt))
	return err
}

func (s *SQLite) ConsumeLinkCode(ctx context.Context, codeHash []byte, now time.Time) (string, error) {
	var id string
	err := s.db.QueryRowContext(ctx, `DELETE FROM link_codes WHERE code_hash = ? AND expires_at > ? RETURNING server_id`, codeHash, ms(now)).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

func (s *SQLite) DeleteExpiredLinkCodes(ctx context.Context, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM link_codes WHERE expires_at <= ?`, ms(now))
	return err
}

func (s *SQLite) AddUsage(ctx context.Context, serverID, kind, period string, n int64) (int64, error) {
	var total int64
	err := s.db.QueryRowContext(ctx, `INSERT INTO usage (server_id, kind, period, amount) VALUES (?,?,?,?)
ON CONFLICT(server_id, kind, period) DO UPDATE SET amount = amount + excluded.amount RETURNING amount`, serverID, kind, period, n).Scan(&total)
	return total, err
}

func (s *SQLite) GetUsage(ctx context.Context, serverID, kind, period string) (int64, error) {
	var total int64
	err := s.db.QueryRowContext(ctx, `SELECT amount FROM usage WHERE server_id=? AND kind=? AND period=?`, serverID, kind, period).Scan(&total)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return total, err
}

func (s *SQLite) AppendMailLog(ctx context.Context, l MailLog) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO mail_log (id, server_id, at, recipient_hash, recipient_domain, tag, status, provider_id, error) VALUES (?,?,?,?,?,?,?,?,?)`,
		l.ID, l.ServerID, ms(l.At), l.RecipientHash, l.RecipientDomain, l.Tag, l.Status, l.ProviderID, l.Error)
	return err
}

func (s *SQLite) ListMailLog(ctx context.Context, serverID string, limit int) ([]MailLog, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, server_id, at, recipient_hash, recipient_domain, tag, status, provider_id, error FROM mail_log WHERE server_id = ? ORDER BY at DESC LIMIT ?`, serverID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MailLog
	for rows.Next() {
		var l MailLog
		var at int64
		if err := rows.Scan(&l.ID, &l.ServerID, &at, &l.RecipientHash, &l.RecipientDomain, &l.Tag, &l.Status, &l.ProviderID, &l.Error); err != nil {
			return nil, err
		}
		l.At = fromMs(at)
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *SQLite) PutDiagnostic(ctx context.Context, d Diagnostic) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO diagnostics (reference, server_id, created_at, text) VALUES (?,?,?,?)`, d.Reference, d.ServerID, ms(d.CreatedAt), d.Text)
	return err
}

func (s *SQLite) GetDiagnostic(ctx context.Context, reference string) (*Diagnostic, error) {
	var d Diagnostic
	var created int64
	err := s.db.QueryRowContext(ctx, `SELECT reference, server_id, created_at, text FROM diagnostics WHERE reference = ?`, reference).Scan(&d.Reference, &d.ServerID, &created, &d.Text)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	d.CreatedAt = fromMs(created)
	return &d, nil
}

func (s *SQLite) DeleteDiagnosticsBefore(ctx context.Context, t time.Time) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM diagnostics WHERE created_at < ?`, ms(t))
	return err
}
