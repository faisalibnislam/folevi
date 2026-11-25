// Package backup makes, lists, rotates and restores backups (plan §9).
//
// A backup is one ZIP, <data>/backups/<id>.zip, where id is "<UTC timestamp>-<kind>" (for example
// 20261125T030000Z-nightly). Inside:
//
//	manifest.json       {id, kind, createdAt, version, format}
//	convex-export.zip   `convex export --include-file-storage` (every table and every stored file)
//	secrets.json        the keys the data depends on (hash salt, auth and file URL secrets), so a restore on a
//	                    new machine keeps hashed lookups and sign-in working
//
// Backups go to the data folder, another folder, or an S3-compatible bucket.
//
// Encryption: when the Manager has a key (secrets/backup-key, an age X25519 identity made on first start), the
// ZIP is written straight into an age stream (https://age-encryption.org/v1) and stored as <id>.zip.age. Restore
// tells the two apart by their first bytes, so plain <id>.zip backups from before still restore. A backup made
// on another machine needs that machine's key, which the owner saves once (GET /v1/backups/key).
package backup

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"filippo.io/age"
)

// Kinds.
const (
	KindNightly   = "nightly"
	KindManual    = "manual"
	KindPreUpdate = "pre-update"
)

const idLayout = "20060102T150405Z"

// File name endings: a plain ZIP (older backups, or no key) and an age-encrypted one.
const (
	ExtPlain     = ".zip"
	ExtEncrypted = ".zip.age"
)

// ageMagic starts every age file.
var ageMagic = []byte("age-encryption.org/v1\n")

// ErrWrongKey means the backup is encrypted with a key this server does not have.
var ErrWrongKey = errors.New("this backup is encrypted with another backup key: enter the key saved from the server that made it")

// Info describes one backup.
type Info struct {
	ID        string
	Kind      string
	CreatedAt time.Time
	SizeBytes int64
	Name      string // file name in the target: <id>.zip or <id>.zip.age
	Encrypted bool
}

// NewKey makes a backup key: an age X25519 identity ("AGE-SECRET-KEY-1...").
func NewKey() (string, error) {
	id, err := age.GenerateX25519Identity()
	if err != nil {
		return "", err
	}
	return id.String(), nil
}

// ParseKey checks a backup key and returns its identity. Spaces and line breaks around it are ignored, and a
// key typed in lower case is accepted.
func ParseKey(key string) (*age.X25519Identity, error) {
	id, err := age.ParseX25519Identity(strings.ToUpper(strings.TrimSpace(key)))
	if err != nil {
		return nil, errors.New("that is not a Folevi backup key (it starts with AGE-SECRET-KEY-1)")
	}
	return id, nil
}

// Recipient is the public half of a backup key (age1...), safe to show.
func Recipient(key string) (string, error) {
	id, err := ParseKey(key)
	if err != nil {
		return "", err
	}
	return id.Recipient().String(), nil
}

// Manifest is manifest.json inside a backup.
type Manifest struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	CreatedAt time.Time `json:"createdAt"`
	Version   string    `json:"version"`
	Format    int       `json:"format"`
}

// Snapshotter exports and imports the Convex data.
type Snapshotter interface {
	Export(ctx context.Context, path string) error
	Import(ctx context.Context, path string) error
}

// Object is a stored file in a target.
type Object struct {
	Name     string
	Size     int64
	Modified time.Time
}

// Target stores backup files.
type Target interface {
	Put(ctx context.Context, localPath, name string) error
	Get(ctx context.Context, name, localPath string) error
	List(ctx context.Context) ([]Object, error)
	Delete(ctx context.Context, name string) error
	// Local reports whether the target is the local backups folder itself (no copy needed).
	Local() bool
}

// ErrBusy means a backup or restore is already running.
var ErrBusy = errors.New("a backup or restore is already running")

// Manager makes and restores backups.
type Manager struct {
	Dir     string // <data>/backups
	TmpDir  string // <data>/tmp
	Version string
	Snap    Snapshotter
	// Secrets returns the secrets to keep with the data; SetSecrets writes them back on restore.
	Secrets    func() map[string]string
	SetSecrets func(map[string]string) error
	// Key returns the backup key (secrets/backup-key). Empty or nil: backups are written unencrypted.
	Key func() string
	Now func() time.Time

	mu sync.Mutex
}

func (m *Manager) now() time.Time {
	if m.Now != nil {
		return m.Now().UTC()
	}
	return time.Now().UTC()
}

// NewID makes a backup id for a kind at a time.
func NewID(t time.Time, kind string) string { return t.UTC().Format(idLayout) + "-" + kind }

// ParseID splits an id into its time and kind.
func ParseID(id string) (time.Time, string, bool) {
	ts, kind, ok := strings.Cut(id, "-")
	if !ok {
		return time.Time{}, "", false
	}
	t, err := time.Parse(idLayout, ts)
	if err != nil {
		return time.Time{}, "", false
	}
	switch kind {
	case KindNightly, KindManual, KindPreUpdate:
	default:
		return time.Time{}, "", false
	}
	return t, kind, true
}

// ValidID guards against path tricks in ids that come from the API.
func ValidID(id string) bool {
	_, _, ok := ParseID(id)
	return ok && !strings.ContainsAny(id, "/\\.")
}

// TryLock takes the backup lock without waiting.
func (m *Manager) TryLock() bool { return m.mu.TryLock() }

// Unlock releases it.
func (m *Manager) Unlock() { m.mu.Unlock() }

// Create makes a backup of this kind, stores it in the target and rotates the target down to keep files.
// The caller must hold the lock (TryLock).
func (m *Manager) Create(ctx context.Context, id string, target Target, keep int) (Info, error) {
	created, kind, ok := ParseID(id)
	if !ok {
		return Info{}, fmt.Errorf("bad backup id %q", id)
	}
	if err := os.MkdirAll(m.Dir, 0o700); err != nil {
		return Info{}, err
	}
	work, err := os.MkdirTemp(m.TmpDir, "bk-")
	if err != nil {
		return Info{}, err
	}
	defer os.RemoveAll(work)
	export := filepath.Join(work, "convex-export.zip")
	if err := m.Snap.Export(ctx, export); err != nil {
		return Info{}, fmt.Errorf("export: %w", err)
	}
	var recipient age.Recipient
	if m.Key != nil {
		if key := m.Key(); key != "" {
			ident, err := ParseKey(key)
			if err != nil {
				return Info{}, fmt.Errorf("backup key: %w", err)
			}
			recipient = ident.Recipient()
		}
	}
	name := id + ExtPlain
	if recipient != nil {
		name = id + ExtEncrypted
	}
	final := filepath.Join(m.Dir, name)
	partial := final + ".partial"
	man := Manifest{ID: id, Kind: kind, CreatedAt: created, Version: m.Version, Format: 1}
	var secrets map[string]string
	if m.Secrets != nil {
		secrets = m.Secrets()
	}
	if err := writeBackupFile(partial, man, export, secrets, recipient); err != nil {
		os.Remove(partial)
		return Info{}, err
	}
	if err := os.Rename(partial, final); err != nil {
		return Info{}, err
	}
	st, err := os.Stat(final)
	if err != nil {
		return Info{}, err
	}
	info := Info{ID: id, Kind: kind, CreatedAt: created, SizeBytes: st.Size(), Name: name, Encrypted: recipient != nil}
	if !target.Local() {
		if err := target.Put(ctx, final, name); err != nil {
			return info, fmt.Errorf("copy to backup target: %w", err)
		}
		os.Remove(final)
	}
	if err := Rotate(ctx, target, keep); err != nil {
		return info, fmt.Errorf("rotate: %w", err)
	}
	return info, nil
}

// writeBackupFile writes the backup ZIP to path, through age when recipient is set (streamed: the export is
// never held in memory or written out unencrypted).
func writeBackupFile(path string, man Manifest, export string, secrets map[string]string, recipient age.Recipient) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	bw := bufio.NewWriterSize(f, 1<<20)
	var dst io.Writer = bw
	var enc io.WriteCloser
	if recipient != nil {
		if enc, err = age.Encrypt(bw, recipient); err != nil {
			return err
		}
		dst = enc
	}
	if err := writeBackupZip(dst, man, export, secrets); err != nil {
		return err
	}
	if enc != nil {
		if err := enc.Close(); err != nil {
			return err
		}
	}
	if err := bw.Flush(); err != nil {
		return err
	}
	return f.Sync()
}

func writeBackupZip(dst io.Writer, man Manifest, export string, secrets map[string]string) error {
	zw := zip.NewWriter(dst)
	mb, _ := json.MarshalIndent(man, "", "  ")
	if err := addBytes(zw, "manifest.json", mb, man.CreatedAt); err != nil {
		return err
	}
	if secrets != nil {
		sb, _ := json.Marshal(secrets)
		if err := addBytes(zw, "secrets.json", sb, man.CreatedAt); err != nil {
			return err
		}
	}
	ef, err := os.Open(export)
	if err != nil {
		return err
	}
	defer ef.Close()
	// The export is already compressed: store it as is.
	w, err := zw.CreateHeader(&zip.FileHeader{Name: "convex-export.zip", Method: zip.Store, Modified: man.CreatedAt})
	if err != nil {
		return err
	}
	if _, err := io.Copy(w, ef); err != nil {
		return err
	}
	return zw.Close()
}

func addBytes(zw *zip.Writer, name string, b []byte, mod time.Time) error {
	w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: mod})
	if err != nil {
		return err
	}
	_, err = w.Write(b)
	return err
}

// List returns the backups in a target, newest first.
func List(ctx context.Context, target Target) ([]Info, error) {
	objs, err := target.List(ctx)
	if err != nil {
		return nil, err
	}
	var out []Info
	for _, o := range objs {
		enc := true
		id, ok := strings.CutSuffix(o.Name, ExtEncrypted)
		if !ok {
			enc = false
			if id, ok = strings.CutSuffix(o.Name, ExtPlain); !ok {
				continue
			}
		}
		t, kind, ok := ParseID(id)
		if !ok {
			continue
		}
		out = append(out, Info{ID: id, Kind: kind, CreatedAt: t, SizeBytes: o.Size, Name: o.Name, Encrypted: enc})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

// Rotate deletes the oldest backups so that keep remain. The newest pre-update backup is always kept, so an
// update can be undone even after many nightly runs.
func Rotate(ctx context.Context, target Target, keep int) error {
	if keep <= 0 {
		return nil
	}
	list, err := List(ctx, target)
	if err != nil {
		return err
	}
	keptPreUpdate := false
	var errs []error
	for i, b := range list {
		if b.Kind == KindPreUpdate && !keptPreUpdate {
			keptPreUpdate = true
			continue
		}
		if i < keep {
			continue
		}
		if err := target.Delete(ctx, b.Name); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// Restore fetches a backup from the target, restores its secrets and imports its data. An encrypted backup is
// opened with extraKey (a key the owner typed in, for a backup made on another machine) or this server's own
// key; ErrWrongKey when neither fits. usedExtraKey reports that extraKey (not this server's key) opened it.
// The caller must hold the lock and should stop the web server first.
func (m *Manager) Restore(ctx context.Context, id string, target Target, extraKey string) (usedExtraKey bool, err error) {
	if !ValidID(id) {
		return false, fmt.Errorf("bad backup id %q", id)
	}
	// Tried in order: the typed key first, then this server's.
	var idents []age.Identity
	if strings.TrimSpace(extraKey) != "" {
		ident, err := ParseKey(extraKey)
		if err != nil {
			return false, err
		}
		idents = append(idents, ident)
	}
	if m.Key != nil {
		if key := m.Key(); key != "" {
			if ident, err := ParseKey(key); err == nil {
				idents = append(idents, ident)
			}
		}
	}
	work, err := os.MkdirTemp(m.TmpDir, "rs-")
	if err != nil {
		return false, err
	}
	defer os.RemoveAll(work)
	name, err := findBackup(ctx, target, id)
	if err != nil {
		return false, err
	}
	src := filepath.Join(m.Dir, name)
	if !target.Local() {
		src = filepath.Join(work, name)
		if err := target.Get(ctx, name, src); err != nil {
			return false, fmt.Errorf("fetch backup: %w", err)
		}
	}
	src, opened, err := decryptIfNeeded(src, filepath.Join(work, "backup.zip"), idents)
	if err != nil {
		return false, err
	}
	usedExtraKey = opened == 0 && strings.TrimSpace(extraKey) != ""
	return usedExtraKey, m.restoreZip(ctx, src, work)
}

// restoreZip restores the secrets and imports the data of a plain backup ZIP.
func (m *Manager) restoreZip(ctx context.Context, src, work string) error {
	zr, err := zip.OpenReader(src)
	if err != nil {
		return fmt.Errorf("open backup: %w", err)
	}
	defer zr.Close()
	export := filepath.Join(work, "convex-export.zip")
	var secrets map[string]string
	found := false
	for _, f := range zr.File {
		switch f.Name {
		case "convex-export.zip":
			if err := extract(f, export); err != nil {
				return err
			}
			found = true
		case "secrets.json":
			rc, err := f.Open()
			if err != nil {
				return err
			}
			err = json.NewDecoder(io.LimitReader(rc, 1<<20)).Decode(&secrets)
			rc.Close()
			if err != nil {
				return fmt.Errorf("secrets.json: %w", err)
			}
		}
	}
	if !found {
		return errors.New("the backup has no convex-export.zip")
	}
	if secrets != nil && m.SetSecrets != nil {
		if err := m.SetSecrets(secrets); err != nil {
			return err
		}
	}
	if err := m.Snap.Import(ctx, export); err != nil {
		return fmt.Errorf("import: %w", err)
	}
	return nil
}

// findBackup returns the file name of backup id in the target, preferring the encrypted one.
func findBackup(ctx context.Context, target Target, id string) (string, error) {
	list, err := List(ctx, target)
	if err != nil {
		return "", fmt.Errorf("list backups: %w", err)
	}
	name := ""
	for _, b := range list {
		if b.ID == id && (name == "" || b.Encrypted) {
			name = b.Name
		}
	}
	if name == "" {
		return "", fmt.Errorf("backup %s not found", id)
	}
	return name, nil
}

// decryptIfNeeded returns src when it is a plain ZIP (opened -1), else decrypts it into plain with the first of
// idents that fits and returns that and the identity's index.
func decryptIfNeeded(src, plain string, idents []age.Identity) (path string, opened int, err error) {
	isAge, err := isEncrypted(src)
	if err != nil || !isAge {
		return src, -1, err
	}
	for i, ident := range idents {
		err := decryptFile(src, plain, ident)
		var nm *age.NoIdentityMatchError
		if errors.As(err, &nm) {
			continue
		}
		return plain, i, err
	}
	return "", -1, ErrWrongKey
}

func isEncrypted(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	head := make([]byte, len(ageMagic))
	n, _ := io.ReadFull(f, head)
	return bytes.Equal(head[:n], ageMagic), nil
}

func decryptFile(src, plain string, ident age.Identity) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	r, err := age.Decrypt(bufio.NewReaderSize(f, 1<<20), ident)
	if err != nil {
		var nm *age.NoIdentityMatchError
		if errors.As(err, &nm) {
			return err
		}
		return fmt.Errorf("open encrypted backup: %w", err)
	}
	out, err := os.OpenFile(plain, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, r); err != nil {
		out.Close()
		return fmt.Errorf("decrypt backup (damaged file?): %w", err)
	}
	return out.Close()
}

func extract(f *zip.File, dst string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, rc); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// DueNightly says whether a nightly backup should run now: the schedule is on, the local hour has come, and
// no nightly backup was made since the start of that hour today.
func DueNightly(now time.Time, hour int, last time.Time) bool {
	slot := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, now.Location())
	if now.Before(slot) {
		return false
	}
	return last.Before(slot)
}
