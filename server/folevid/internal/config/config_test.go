package config

import (
	"os"
	"path/filepath"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestLoadCreatesDefaults(t *testing.T) {
	dir := t.TempDir()
	f, err := Load(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	c := f.Get()
	if c.Port != 8460 || c.HTTPSPort != 8443 || c.ControlPort != 8461 || c.Backup.Keep != 14 || c.Backup.Target.Kind != "local" {
		t.Fatalf("defaults: %+v", c)
	}
	if c.Internal.WebPort != 3501 || c.Internal.BackendPort != 3510 || c.Internal.SitePort != 3511 {
		t.Fatalf("internal ports: %+v", c.Internal)
	}
	if c.ConnectURL != DefaultConnectURL || c.RelayURL != "wss://relay.folevi.app/v1/tunnel" || !c.MDNSOn() {
		t.Fatalf("connect: %+v", c)
	}
	st, err := os.Stat(filepath.Join(dir, "config.json"))
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("config.json: %v %v", err, st)
	}
}

func TestEnvOverrides(t *testing.T) {
	dir := t.TempDir()
	f, _ := Load(dir, env(map[string]string{"FOLEVI_PORT": "9000", "FOLEVI_CONNECT_URL": "http://127.0.0.1:1"}))
	c := f.Get()
	if c.Port != 9000 || c.ConnectURL != "http://127.0.0.1:1" {
		t.Fatalf("%+v", c)
	}
	// Overrides are not written back.
	if err := f.Update(func(c *Config) error { c.Name = "Home"; return nil }); err != nil {
		t.Fatal(err)
	}
	g, _ := Load(dir, nil)
	if c := g.Get(); c.Port != 8460 || c.Name != "Home" {
		t.Fatalf("saved: %+v", c)
	}
	var bad Config = Default()
	if err := bad.ApplyEnv(env(map[string]string{"FOLEVI_PORT": "x"})); err == nil {
		t.Fatal("bad port accepted")
	}
}

func TestValidate(t *testing.T) {
	bad := []func(c *Config){
		func(c *Config) { c.ControlPort = c.Port },
		func(c *Config) { c.PublicURL = "ftp://x" },
		func(c *Config) { c.PublicURL = "https://x/path" },
		func(c *Config) { c.Backup.Target = BackupTarget{Kind: "folder", Path: "relative"} },
		func(c *Config) { c.Backup.Target = BackupTarget{Kind: "s3"} },
		func(c *Config) { c.Backup.Hour = 24 },
		func(c *Config) { c.MemoryProfile = "huge" },
	}
	for i, fn := range bad {
		c := Default()
		fn(&c)
		if c.Validate() == nil {
			t.Errorf("case %d accepted", i)
		}
	}
	c := Default()
	c.PublicURL = "https://notes.example.com/"
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	f, _ := Load(t.TempDir(), nil)
	if err := f.Update(func(c *Config) error { c.Backup.Hour = 99; return nil }); err == nil {
		t.Fatal("invalid update saved")
	}
	if f.Get().Backup.Hour != DefaultBackupHour {
		t.Fatal("invalid update applied in memory")
	}
}

func TestBadJSON(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "config.json"), []byte("{"), 0o600)
	if _, err := Load(dir, nil); err == nil {
		t.Fatal("bad json accepted")
	}
}

func TestNormalizeOrigin(t *testing.T) {
	for in, want := range map[string]string{"https://a.b": "https://a.b", "http://1.2.3.4:8460/": "http://1.2.3.4:8460"} {
		if got, err := NormalizeOrigin(in); err != nil || got != want {
			t.Errorf("%s: %s %v", in, got, err)
		}
	}
}
