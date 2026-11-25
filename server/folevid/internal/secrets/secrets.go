// Package secrets creates and reads the server's secrets in <data>/secrets (CONTRACT §3).
// The folder is mode 700 and every file is mode 600. Values are never logged; callers hand them to the
// log redactor (see package logs) so they cannot leak through child process output either.
package secrets

import (
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// File names inside secrets/ (CONTRACT §3).
const (
	InstanceSecret   = "instance-secret"
	AdminKey         = "admin-key"
	BetterAuthSecret = "better-auth-secret"
	HashSalt         = "hash-salt"
	FileURLSecret    = "file-url-secret"
	ServerSecret     = "server-secret"
	SetupToken       = "setup-token"
	VapidPublic      = "vapid-public"
	VapidPrivate     = "vapid-private"
	ConnectToken     = "connect-token"
	// ConnectKey is the server's Ed25519 private key for Folevi Connect (base64 of the 64-byte key).
	ConnectKey = "connect-key"
	TLSDir     = "tls"
)

// Store is the secrets folder.
type Store struct {
	Dir string
}

// Open makes sure the folder exists with mode 700.
func Open(dataDir string) (*Store, error) {
	dir := filepath.Join(dataDir, "secrets")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(dir, TLSDir), 0o700); err != nil {
		return nil, err
	}
	return &Store{Dir: dir}, nil
}

// Path returns the file path of a secret.
func (s *Store) Path(name string) string { return filepath.Join(s.Dir, name) }

// Get reads a secret. A missing secret returns "" and no error.
func (s *Store) Get(name string) (string, error) {
	b, err := os.ReadFile(s.Path(name))
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

// MustGet reads a secret that must exist.
func (s *Store) MustGet(name string) (string, error) {
	v, err := s.Get(name)
	if err != nil {
		return "", err
	}
	if v == "" {
		return "", fmt.Errorf("secret %s is missing", name)
	}
	return v, nil
}

// Set writes a secret atomically with mode 600.
func (s *Store) Set(name, value string) error {
	return WriteFile(s.Path(name), []byte(value+"\n"))
}

// Delete removes a secret.
func (s *Store) Delete(name string) error {
	err := os.Remove(s.Path(name))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// WriteFile writes data to path atomically with mode 600.
func WriteFile(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

// AdminKeyFunc makes the backend admin key from the instance secret (runs `convex-backend keygen`).
type AdminKeyFunc func(instanceSecret string) (string, error)

// EnsureAll creates every secret that does not exist yet. It never overwrites one. The admin key needs the
// backend program, so it is made through keygen; pass nil to skip it (tests).
func (s *Store) EnsureAll(keygen AdminKeyFunc) error {
	gen := []struct {
		name string
		make func() (string, error)
	}{
		{InstanceSecret, func() (string, error) { return randHex(32) }},
		{BetterAuthSecret, func() (string, error) { return randB64(32, base64.StdEncoding) }},
		{HashSalt, func() (string, error) { return randHex(16) }},
		{FileURLSecret, func() (string, error) { return randHex(32) }},
		{ServerSecret, func() (string, error) { return randHex(32) }},
		{SetupToken, func() (string, error) { return randB64(24, base64.RawURLEncoding) }},
	}
	for _, g := range gen {
		if err := s.ensure(g.name, g.make); err != nil {
			return err
		}
	}
	if err := s.ensureVapid(); err != nil {
		return err
	}
	if keygen != nil {
		inst, err := s.MustGet(InstanceSecret)
		if err != nil {
			return err
		}
		if err := s.ensure(AdminKey, func() (string, error) { return keygen(inst) }); err != nil {
			return fmt.Errorf("admin key: %w", err)
		}
	}
	return nil
}

func (s *Store) ensure(name string, make func() (string, error)) error {
	v, err := s.Get(name)
	if err != nil || v != "" {
		return err
	}
	v, err = make()
	if err != nil {
		return err
	}
	if strings.TrimSpace(v) == "" {
		return fmt.Errorf("generated an empty %s", name)
	}
	return s.Set(name, strings.TrimSpace(v))
}

// ensureVapid makes a P-256 key pair for Web Push: public is the uncompressed point and private the 32-byte
// scalar, both base64url without padding (the format web-push libraries expect).
func (s *Store) ensureVapid() error {
	pub, _ := s.Get(VapidPublic)
	priv, _ := s.Get(VapidPrivate)
	if pub != "" && priv != "" {
		return nil
	}
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	if err := s.Set(VapidPrivate, base64.RawURLEncoding.EncodeToString(key.Bytes())); err != nil {
		return err
	}
	return s.Set(VapidPublic, base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()))
}

// ConnectKeyPair returns the server's Ed25519 key, creating it on first use.
func (s *Store) ConnectKeyPair() (ed25519.PrivateKey, error) {
	v, err := s.Get(ConnectKey)
	if err != nil {
		return nil, err
	}
	if v != "" {
		b, err := base64.StdEncoding.DecodeString(v)
		if err != nil || len(b) != ed25519.PrivateKeySize {
			return nil, errors.New("connect-key is damaged")
		}
		return ed25519.PrivateKey(b), nil
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	if err := s.Set(ConnectKey, base64.StdEncoding.EncodeToString(priv)); err != nil {
		return nil, err
	}
	return priv, nil
}

// Values returns every secret value currently on disk (for the log redactor). TLS files are skipped.
func (s *Store) Values() []string {
	var out []string
	for _, n := range []string{InstanceSecret, AdminKey, BetterAuthSecret, HashSalt, FileURLSecret, ServerSecret,
		SetupToken, VapidPrivate, ConnectToken, ConnectKey} {
		if v, _ := s.Get(n); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// SHA256Hex is the hex SHA-256 of a string (used for FOLEVI_SETUP_TOKEN_HASH).
func SHA256Hex(v string) string {
	sum := sha256.Sum256([]byte(v))
	return hex.EncodeToString(sum[:])
}

func randHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func randB64(n int, enc *base64.Encoding) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return enc.EncodeToString(b), nil
}
