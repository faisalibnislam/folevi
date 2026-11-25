package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestSQLiteServersAndCodes(t *testing.T) {
	st, err := OpenSQLite(filepath.Join(t.TempDir(), "c.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	sv := &Server{ID: "abcdefgh23", Name: "Home", Version: "1.0.0", PublicKey: make([]byte, 32), TokenHash: []byte("h1"), CreatedAt: now, LanIPs: []string{"192.168.1.2"}}
	if err := st.CreateServer(ctx, sv); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetServerByTokenHash(ctx, []byte("h1"))
	if err != nil || got.Name != "Home" || got.LanIPs[0] != "192.168.1.2" || got.Reachable != nil || !got.CreatedAt.Equal(now) {
		t.Fatalf("got %+v %v", got, err)
	}
	yes := true
	got.Reachable, got.OwnerAccount, got.Flags.MailDisabled = &yes, "user1", true
	if err := st.UpdateServer(ctx, got); err != nil {
		t.Fatal(err)
	}
	list, _ := st.ListServersByOwner(ctx, "user1")
	if len(list) != 1 || !*list[0].Reachable || !list[0].Flags.MailDisabled {
		t.Fatalf("list %+v", list)
	}
	if _, err := st.GetServer(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatal("want ErrNotFound")
	}

	_ = st.CreateLinkCode(ctx, LinkCode{CodeHash: []byte("c1"), ServerID: sv.ID, ExpiresAt: now.Add(time.Minute), CreatedAt: now})
	_ = st.CreateLinkCode(ctx, LinkCode{CodeHash: []byte("c2"), ServerID: sv.ID, ExpiresAt: now.Add(-time.Second), CreatedAt: now})
	if id, err := st.ConsumeLinkCode(ctx, []byte("c1"), now); err != nil || id != sv.ID {
		t.Fatalf("consume %q %v", id, err)
	}
	if _, err := st.ConsumeLinkCode(ctx, []byte("c1"), now); !errors.Is(err, ErrNotFound) {
		t.Fatal("code used twice")
	}
	if _, err := st.ConsumeLinkCode(ctx, []byte("c2"), now); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired code accepted")
	}

	if n, _ := st.AddUsage(ctx, sv.ID, "ai", "2026-11", 5); n != 5 {
		t.Fatal(n)
	}
	if n, _ := st.AddUsage(ctx, sv.ID, "ai", "2026-11", 7); n != 12 {
		t.Fatal(n)
	}
	if n, _ := st.GetUsage(ctx, sv.ID, "ai", "2026-12"); n != 0 {
		t.Fatal(n)
	}

	_ = st.PutDiagnostic(ctx, Diagnostic{Reference: "FD-1", ServerID: sv.ID, CreatedAt: now.Add(-48 * time.Hour), Text: "old"})
	_ = st.DeleteDiagnosticsBefore(ctx, now.Add(-24*time.Hour))
	if _, err := st.GetDiagnostic(ctx, "FD-1"); !errors.Is(err, ErrNotFound) {
		t.Fatal("old diagnostics kept")
	}
}
