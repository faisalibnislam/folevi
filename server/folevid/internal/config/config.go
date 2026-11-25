// Package config reads and writes <data>/config.json, the settings folevid owns (CONTRACT §3).
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

const (
	DefaultConnectURL = "https://connect.folevi.com"
	DefaultRelayURL   = "wss://relay.folevi.app/v1/tunnel"
	DefaultKeep       = 14
	DefaultBackupHour = 3
)

// S3Target is an S3-compatible bucket. SecretAccessKey is stored here because the data folder is private to
// the service user; the control API never returns it.
type S3Target struct {
	Endpoint        string `json:"endpoint"`
	Bucket          string `json:"bucket"`
	Prefix          string `json:"prefix,omitempty"`
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey,omitempty"`
	Region          string `json:"region,omitempty"`
}

// BackupTarget says where backups go.
type BackupTarget struct {
	Kind string    `json:"kind"` // local | folder | s3
	Path string    `json:"path,omitempty"`
	S3   *S3Target `json:"s3,omitempty"`
}

// Backup is the backup schedule.
type Backup struct {
	Enabled bool         `json:"enabled"`
	Hour    int          `json:"hour"`
	Keep    int          `json:"keep"`
	Target  BackupTarget `json:"target"`
}

// Remote holds what the owner turned on in the admin panel (PUT /v1/remote).
type Remote struct {
	ConnectEnabled bool   `json:"connectEnabled"`
	RelayEnabled   bool   `json:"relayEnabled"`
	UPnPEnabled    bool   `json:"upnpEnabled"`
	CustomDomain   string `json:"customDomain,omitempty"`
}

// Connect is the state of the Folevi Connect registration. The token itself is in secrets/connect-token.
type Connect struct {
	ServerID     string   `json:"serverId,omitempty"`
	Hostname     string   `json:"hostname,omitempty"`
	LANHostnames []string `json:"lanHostnames,omitempty"`
	Linked       bool     `json:"linked,omitempty"`
	OwnerAccount string   `json:"ownerAccount,omitempty"`
}

// Deployed records the last successful functions deploy, so a restart with the same bundle skips it.
type Deployed struct {
	Version       string `json:"version,omitempty"`
	FunctionsHash string `json:"functionsHash,omitempty"`
	EnvHash       string `json:"envHash,omitempty"`
	Origin        string `json:"origin,omitempty"`
}

// Internal ports. The contract fixes them (3501, 3510, 3511); they are settable only so tests can run beside
// another server.
type Internal struct {
	WebPort     int `json:"webPort,omitempty"`
	BackendPort int `json:"backendPort,omitempty"`
	SitePort    int `json:"sitePort,omitempty"`
}

// Config is config.json.
type Config struct {
	Name          string   `json:"name,omitempty"`
	Port          int      `json:"port"`
	HTTPSPort     int      `json:"httpsPort"`
	ControlPort   int      `json:"controlPort"`
	BindAddress   string   `json:"bindAddress,omitempty"`
	PublicURL     string   `json:"publicUrl,omitempty"` // fixed by the owner; empty means work it out
	ConnectURL    string   `json:"connectUrl"`
	RelayURL      string   `json:"relayUrl"`
	ACMEDirectory string   `json:"acmeDirectory,omitempty"` // Let's Encrypt production when empty
	MemoryProfile string   `json:"memoryProfile,omitempty"` // auto | low | high
	MDNS          *bool    `json:"mdns,omitempty"`
	Channel       string   `json:"channel,omitempty"`
	Remote        Remote   `json:"remote"`
	Connect       Connect  `json:"connect"`
	Backup        Backup   `json:"backup"`
	Deployed      Deployed `json:"deployed"`
	LastVersion   string   `json:"lastVersion,omitempty"` // bundle version of the last start, for pre-update backups
	Internal      Internal `json:"internal,omitempty"`
}

// Default is a fresh config.
func Default() Config {
	return Config{
		Port:        8460,
		HTTPSPort:   8443,
		ControlPort: 8461,
		ConnectURL:  DefaultConnectURL,
		RelayURL:    DefaultRelayURL,
		Channel:     "stable",
		Backup:      Backup{Enabled: true, Hour: DefaultBackupHour, Keep: DefaultKeep, Target: BackupTarget{Kind: "local"}},
		Internal:    Internal{WebPort: 3501, BackendPort: 3510, SitePort: 3511},
	}
}

// MDNSOn says whether to announce on the home network.
func (c *Config) MDNSOn() bool { return c.MDNS == nil || *c.MDNS }

// fillDefaults sets zero fields to their defaults.
func (c *Config) fillDefaults() {
	d := Default()
	if c.Port == 0 {
		c.Port = d.Port
	}
	if c.HTTPSPort == 0 {
		c.HTTPSPort = d.HTTPSPort
	}
	if c.ControlPort == 0 {
		c.ControlPort = d.ControlPort
	}
	if c.ConnectURL == "" {
		c.ConnectURL = d.ConnectURL
	}
	if c.RelayURL == "" {
		c.RelayURL = d.RelayURL
	}
	if c.Channel == "" {
		c.Channel = d.Channel
	}
	if c.Backup.Keep <= 0 {
		c.Backup.Keep = d.Backup.Keep
	}
	if c.Backup.Target.Kind == "" {
		c.Backup.Target.Kind = "local"
	}
	if c.Internal.WebPort == 0 {
		c.Internal.WebPort = d.Internal.WebPort
	}
	if c.Internal.BackendPort == 0 {
		c.Internal.BackendPort = d.Internal.BackendPort
	}
	if c.Internal.SitePort == 0 {
		c.Internal.SitePort = d.Internal.SitePort
	}
}

// ApplyEnv applies the environment overrides packages may set (FOLEVI_PORT, FOLEVI_HTTPS_PORT,
// FOLEVI_CONTROL_PORT, FOLEVI_PUBLIC_URL, FOLEVI_CONNECT_URL, FOLEVI_RELAY_URL, FOLEVI_ACME_DIRECTORY,
// FOLEVI_BIND). They are not written back to config.json.
func (c *Config) ApplyEnv(getenv func(string) string) error {
	ports := []struct {
		env string
		dst *int
	}{{"FOLEVI_PORT", &c.Port}, {"FOLEVI_HTTPS_PORT", &c.HTTPSPort}, {"FOLEVI_CONTROL_PORT", &c.ControlPort}}
	for _, p := range ports {
		if v := getenv(p.env); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n <= 0 || n > 65535 {
				return fmt.Errorf("%s=%q is not a port", p.env, v)
			}
			*p.dst = n
		}
	}
	if v := getenv("FOLEVI_PUBLIC_URL"); v != "" {
		c.PublicURL = v
	}
	if v := getenv("FOLEVI_CONNECT_URL"); v != "" {
		c.ConnectURL = v
	}
	if v := getenv("FOLEVI_RELAY_URL"); v != "" {
		c.RelayURL = v
	}
	if v := getenv("FOLEVI_ACME_DIRECTORY"); v != "" {
		c.ACMEDirectory = v
	}
	if v := getenv("FOLEVI_BIND"); v != "" {
		c.BindAddress = v
	}
	return nil
}

// Validate checks values that would stop the server from starting.
func (c *Config) Validate() error {
	seen := map[int]string{}
	for name, p := range map[string]int{"port": c.Port, "httpsPort": c.HTTPSPort, "controlPort": c.ControlPort,
		"webPort": c.Internal.WebPort, "backendPort": c.Internal.BackendPort, "sitePort": c.Internal.SitePort} {
		if p <= 0 || p > 65535 {
			return fmt.Errorf("%s %d is not a port", name, p)
		}
		if other, ok := seen[p]; ok {
			return fmt.Errorf("%s and %s both use port %d", name, other, p)
		}
		seen[p] = name
	}
	if c.PublicURL != "" {
		if _, err := NormalizeOrigin(c.PublicURL); err != nil {
			return fmt.Errorf("publicUrl: %w", err)
		}
	}
	switch c.Backup.Target.Kind {
	case "local":
	case "folder":
		if !filepath.IsAbs(c.Backup.Target.Path) {
			return errors.New("backup folder must be an absolute path")
		}
	case "s3":
		s := c.Backup.Target.S3
		if s == nil || s.Endpoint == "" || s.Bucket == "" || s.AccessKeyID == "" {
			return errors.New("s3 backup target needs endpoint, bucket and accessKeyId")
		}
	default:
		return fmt.Errorf("unknown backup target %q", c.Backup.Target.Kind)
	}
	if c.Backup.Hour < 0 || c.Backup.Hour > 23 {
		return errors.New("backup hour must be 0 to 23")
	}
	switch c.MemoryProfile {
	case "", "auto", "low", "high":
	default:
		return fmt.Errorf("unknown memoryProfile %q", c.MemoryProfile)
	}
	return nil
}

// NormalizeOrigin checks an http(s) origin and returns it without a trailing slash or path.
func NormalizeOrigin(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", fmt.Errorf("%q is not an http or https origin", raw)
	}
	if u.Path != "" && u.Path != "/" {
		return "", fmt.Errorf("%q must not have a path", raw)
	}
	return u.Scheme + "://" + u.Host, nil
}

// File is config.json with a lock, shared by everything in folevid.
type File struct {
	path string
	mu   sync.Mutex
	cfg  Config
	env  func(string) string
}

// Load reads config.json, creating it with defaults when missing.
func Load(dataDir string, getenv func(string) string) (*File, error) {
	f := &File{path: filepath.Join(dataDir, "config.json"), env: getenv}
	cfg := Default()
	b, err := os.ReadFile(f.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		if err := writeJSON(f.path, cfg); err != nil {
			return nil, err
		}
	case err != nil:
		return nil, err
	default:
		cfg = Config{}
		if err := json.Unmarshal(b, &cfg); err != nil {
			return nil, fmt.Errorf("config.json: %w", err)
		}
		cfg.fillDefaults()
	}
	f.cfg = cfg
	return f, nil
}

// Get returns a copy of the config with environment overrides applied.
func (f *File) Get() Config {
	f.mu.Lock()
	defer f.mu.Unlock()
	c := f.cfg
	c.Connect.LANHostnames = append([]string(nil), f.cfg.Connect.LANHostnames...)
	if f.env != nil {
		_ = c.ApplyEnv(f.env)
	}
	return c
}

// Update changes the stored config (without environment overrides) and saves it.
func (f *File) Update(fn func(c *Config) error) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	c := f.cfg
	if s := f.cfg.Backup.Target.S3; s != nil {
		cp := *s
		c.Backup.Target.S3 = &cp
	}
	if err := fn(&c); err != nil {
		return err
	}
	c.fillDefaults()
	check := c
	if f.env != nil {
		_ = check.ApplyEnv(f.env)
	}
	if err := check.Validate(); err != nil {
		return err
	}
	if err := writeJSON(f.path, c); err != nil {
		return err
	}
	f.cfg = c
	return nil
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
