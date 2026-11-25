package backup

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
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
	if err := m.Restore(context.Background(), id, target); err != nil {
		t.Fatal(err)
	}
	if string(snap.imported) != "EXPORT-DATA" || got["hash-salt"] != "salty" {
		t.Fatalf("restore: %q %v", snap.imported, got)
	}
	if err := m.Restore(context.Background(), NewID(time.Now().Add(-time.Hour), KindManual), target); err == nil {
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
	if err := m.Restore(context.Background(), ids[6], other); err != nil {
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
