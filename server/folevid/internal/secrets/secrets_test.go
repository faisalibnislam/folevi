package secrets

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureAll(t *testing.T) {
	data := t.TempDir()
	s, err := Open(data)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	keygen := func(inst string) (string, error) {
		calls++
		if len(inst) != 64 {
			t.Fatalf("instance secret length %d", len(inst))
		}
		return "folevi-server|0123abcd", nil
	}
	if err := s.EnsureAll(keygen); err != nil {
		t.Fatal(err)
	}
	st, _ := os.Stat(filepath.Join(data, "secrets"))
	if st.Mode().Perm() != 0o700 {
		t.Fatalf("secrets dir mode %v", st.Mode().Perm())
	}
	want := []string{InstanceSecret, AdminKey, BetterAuthSecret, HashSalt, FileURLSecret, ServerSecret, SetupToken, VapidPublic, VapidPrivate}
	before := map[string]string{}
	for _, n := range want {
		fi, err := os.Stat(s.Path(n))
		if err != nil {
			t.Fatalf("%s missing: %v", n, err)
		}
		if fi.Mode().Perm() != 0o600 {
			t.Fatalf("%s mode %v", n, fi.Mode().Perm())
		}
		before[n], _ = s.Get(n)
	}
	pub, _ := base64.RawURLEncoding.DecodeString(before[VapidPublic])
	priv, _ := base64.RawURLEncoding.DecodeString(before[VapidPrivate])
	if len(pub) != 65 || pub[0] != 4 || len(priv) != 32 {
		t.Fatalf("vapid key sizes %d %d", len(pub), len(priv))
	}
	// A second run changes nothing and does not call keygen again.
	if err := s.EnsureAll(keygen); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("keygen called %d times", calls)
	}
	for _, n := range want {
		if v, _ := s.Get(n); v != before[n] {
			t.Fatalf("%s changed", n)
		}
	}
	if len(s.Values()) < 8 {
		t.Fatalf("Values: %d", len(s.Values()))
	}
	if v, _ := s.Get(ConnectToken); v != "" {
		t.Fatal("connect token made before registration")
	}
}

func TestConnectKeyStable(t *testing.T) {
	s, _ := Open(t.TempDir())
	k1, err := s.ConnectKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	k2, _ := s.ConnectKeyPair()
	if !k1.Equal(k2) {
		t.Fatal("key changed")
	}
}

func TestSHA256Hex(t *testing.T) {
	if got := SHA256Hex("abc"); got != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatal(got)
	}
}
