package backup

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakeSnap struct{ imported []byte }

func (f *fakeSnap) Export(ctx context.Context, path string) error {
	return os.WriteFile(path, []byte("EXPORT-DATA"), 0o600)
}

func (f *fakeSnap) Import(ctx context.Context, path string) error {
	b, err := os.ReadFile(path)
	f.imported = b
	return err
}

func newManager(t *testing.T) (*Manager, *fakeSnap, map[string]string) {
	dir := t.TempDir()
	snap := &fakeSnap{}
	restored := map[string]string{}
	m := &Manager{Dir: filepath.Join(dir, "backups"), TmpDir: dir, Version: "1.0.0", Snap: snap,
		Secrets: func() map[string]string { return map[string]string{"hash-salt": "salty"} },
		SetSecrets: func(s map[string]string) error {
			restored = s
			for k, v := range s {
				restored[k] = v
			}
			return nil
		}}
	return m, snap, restored
}

func TestIDs(t *testing.T) {
	ts := time.Date(2026, 11, 25, 3, 0, 0, 0, time.UTC)
	id := NewID(ts, KindNightly)
	if id != "20261125T030000Z-nightly" {
		t.Fatal(id)
	}
	got, kind, ok := ParseID(id)
	if !ok || !got.Equal(ts) || kind != KindNightly {
		t.Fatal(got, kind, ok)
	}
	if _, _, ok := ParseID("20261125T030000Z-pre-update"); !ok {
		t.Fatal("pre-update id rejected")
	}
	for _, bad := range []string{"../etc", "20261125T030000Z-other", "x-nightly", "20261125T030000Z-nightly/../../x"} {
		if ValidID(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestCreateListRestore(t *testing.T) {
	m, snap, _ := newManager(t)
	target := &FolderTarget{Dir: m.Dir, IsLocal: true}
	id := NewID(time.Now(), KindManual)
	info, err := m.Create(context.Background(), id, target, 14)
	if err != nil {
		t.Fatal(err)
	}
	if info.SizeBytes == 0 {
		t.Fatal("empty backup")
	}
	zr, err := zip.OpenReader(filepath.Join(m.Dir, id+".zip"))
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	zr.Close()
	if !names["manifest.json"] || !names["convex-export.zip"] || !names["secrets.json"] {
		t.Fatalf("zip contents %v", names)
	}
	list, _ := List(context.Background(), target)
	if len(list) != 1 || list[0].ID != id || list[0].Kind != KindManual {
		t.Fatalf("list %+v", list)
	}
	var got map[string]string
	m.SetSecrets = func(s map[string]string) error { got = s; return nil }
	if _, err := m.Restore(context.Background(), id, target, ""); err != nil {
		t.Fatal(err)
	}
	if string(snap.imported) != "EXPORT-DATA" || got["hash-salt"] != "salty" {
		t.Fatalf("restore: %q %v", snap.imported, got)
	}
	if _, err := m.Restore(context.Background(), NewID(time.Now().Add(-time.Hour), KindManual), target, ""); err == nil {
		t.Fatal("restored a missing backup")
	}
}

func TestFolderTargetAndRotation(t *testing.T) {
	m, _, _ := newManager(t)
	other := &FolderTarget{Dir: filepath.Join(t.TempDir(), "nas-share")}
	base := time.Date(2026, 11, 1, 3, 0, 0, 0, time.UTC)
	ids := []string{NewID(base, KindPreUpdate)}
	for i := 1; i <= 6; i++ {
		ids = append(ids, NewID(base.Add(time.Duration(i)*24*time.Hour), KindNightly))
	}
	for _, id := range ids {
		if _, err := m.Create(context.Background(), id, other, 3); err != nil {
			t.Fatal(err)
		}
	}
	// Nothing stays in the local folder when the target is elsewhere.
	if ents, _ := os.ReadDir(m.Dir); len(ents) != 0 {
		t.Fatalf("local copies left: %d", len(ents))
	}
	list, _ := List(context.Background(), other)
	if len(list) != 4 {
		t.Fatalf("want 3 newest plus the pre-update one, got %d", len(list))
	}
	if list[0].ID != ids[6] || list[3].ID != ids[0] || list[3].Kind != KindPreUpdate {
		t.Fatalf("kept %+v", list)
	}
	// Restore from the folder target.
	if _, err := m.Restore(context.Background(), ids[6], other, ""); err != nil {
		t.Fatal(err)
	}
}

func TestDueNightly(t *testing.T) {
	loc := time.UTC
	at := func(h, m int) time.Time { return time.Date(2026, 11, 25, h, m, 0, 0, loc) }
	if DueNightly(at(2, 59), 3, time.Time{}) {
		t.Error("due before the hour")
	}
	if !DueNightly(at(3, 0), 3, time.Time{}) {
		t.Error("not due at the hour")
	}
	if DueNightly(at(3, 30), 3, at(3, 1)) {
		t.Error("due twice")
	}
	if !DueNightly(at(3, 0).Add(24*time.Hour), 3, at(3, 1)) {
		t.Error("not due the next day")
	}
}

func TestEncryptedBackups(t *testing.T) {
	ctx := context.Background()
	key, err := NewKey()
	if err != nil {
		t.Fatal(err)
	}
	m, snap, _ := newManager(t)
	m.Key = func() string { return key }
	share := &FolderTarget{Dir: filepath.Join(t.TempDir(), "share")}
	id := NewID(time.Date(2026, 11, 20, 3, 0, 0, 0, time.UTC), KindNightly)
	info, err := m.Create(ctx, id, share, 14)
	if err != nil {
		t.Fatal(err)
	}
	if !info.Encrypted || info.Name != id+ExtEncrypted {
		t.Fatalf("info %+v", info)
	}
	raw, err := os.ReadFile(filepath.Join(share.Dir, id+ExtEncrypted))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(raw, ageMagic) {
		t.Fatal("not an age file")
	}
	for _, plain := range []string{"salty", "EXPORT-DATA", "secrets.json", "PK\x03\x04"} {
		if bytes.Contains(raw, []byte(plain)) {
			t.Fatalf("%q readable in the encrypted backup", plain)
		}
	}
	list, _ := List(ctx, share)
	if len(list) != 1 || !list[0].Encrypted || list[0].ID != id {
		t.Fatalf("list %+v", list)
	}

	// Same machine: its own key opens it.
	var got map[string]string
	m.SetSecrets = func(s map[string]string) error { got = s; return nil }
	if used, err := m.Restore(ctx, id, share, ""); err != nil || used {
		t.Fatal(err, used)
	}
	// A typed key that is not needed: its own key opens it, and the typed key is reported unused.
	unneeded, _ := NewKey()
	if used, err := m.Restore(ctx, id, share, unneeded); err != nil || used {
		t.Fatal(err, used)
	}
	if string(snap.imported) != "EXPORT-DATA" || got["hash-salt"] != "salty" {
		t.Fatalf("restore: %q %v", snap.imported, got)
	}

	// A new machine with its own key: refused until the old key is given.
	other, err := NewKey()
	if err != nil {
		t.Fatal(err)
	}
	m2, snap2, _ := newManager(t)
	m2.Key = func() string { return other }
	if _, err := m2.Restore(ctx, id, share, ""); !errors.Is(err, ErrWrongKey) {
		t.Fatalf("want ErrWrongKey, got %v", err)
	}
	if _, err := m2.Restore(ctx, id, share, other); !errors.Is(err, ErrWrongKey) {
		t.Fatalf("a wrong typed key: want ErrWrongKey, got %v", err)
	}
	if _, err := m2.Restore(ctx, id, share, "not a key"); err == nil || errors.Is(err, ErrWrongKey) {
		t.Fatalf("a malformed key: %v", err)
	}
	used, err := m2.Restore(ctx, id, share, "  "+strings.ToLower(key)+"\n")
	if err != nil || !used {
		t.Fatal(err, used)
	}
	if string(snap2.imported) != "EXPORT-DATA" {
		t.Fatalf("new machine restore: %q", snap2.imported)
	}
	// No key at all on this server: still refused cleanly.
	m3, _, _ := newManager(t)
	if _, err := m3.Restore(ctx, id, share, ""); !errors.Is(err, ErrWrongKey) {
		t.Fatalf("no key: %v", err)
	}
}

func TestOldPlainBackupsStillRestore(t *testing.T) {
	ctx := context.Background()
	m, snap, _ := newManager(t)
	target := &FolderTarget{Dir: m.Dir, IsLocal: true}
	base := time.Date(2026, 11, 1, 3, 0, 0, 0, time.UTC)
	old := NewID(base, KindNightly)
	if info, err := m.Create(ctx, old, target, 14); err != nil || info.Encrypted || info.Name != old+ExtPlain {
		t.Fatalf("plain backup: %+v %v", info, err)
	}
	key, _ := NewKey()
	m.Key = func() string { return key }
	var ids []string
	for i := 1; i <= 3; i++ {
		id := NewID(base.Add(time.Duration(i)*24*time.Hour), KindNightly)
		ids = append(ids, id)
		if _, err := m.Create(ctx, id, target, 14); err != nil {
			t.Fatal(err)
		}
	}
	snap.imported = nil
	if _, err := m.Restore(ctx, old, target, ""); err != nil {
		t.Fatal(err)
	}
	if string(snap.imported) != "EXPORT-DATA" {
		t.Fatal("old backup not imported")
	}
	// Rotation removes the plain file by its own name.
	if err := Rotate(ctx, target, 2); err != nil {
		t.Fatal(err)
	}
	list, _ := List(ctx, target)
	if len(list) != 2 || list[0].ID != ids[2] || !list[0].Encrypted {
		t.Fatalf("after rotation %+v", list)
	}
	if _, err := os.Stat(filepath.Join(m.Dir, old+ExtPlain)); !os.IsNotExist(err) {
		t.Fatal("old plain backup not rotated away")
	}
}

func TestParseKey(t *testing.T) {
	key, _ := NewKey()
	if !strings.HasPrefix(key, "AGE-SECRET-KEY-1") {
		t.Fatal(key)
	}
	r, err := Recipient(key)
	if err != nil || !strings.HasPrefix(r, "age1") {
		t.Fatal(r, err)
	}
	if _, err := ParseKey("AGE-SECRET-KEY-1XYZ"); err == nil {
		t.Fatal("accepted a bad key")
	}
}
