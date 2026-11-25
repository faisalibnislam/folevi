// Package config reads Connect's settings from the environment. Every variable is documented in README.md.
// Secrets are read here and passed on; nothing here prints them.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr           string
	RelayAddr          string
	RelayProxyProtocol bool
	LocalHostnames     []string
	TLSCertFile        string
	TLSKeyFile         string
	ACMEEmail          string
	ACMECacheDir       string
	DBPath             string
	Zone               string
	AppURL             string
	ServiceKey         string // secret
	AdminKey           string // secret
	TrustedProxyHeader string
	RelayIPv4          string
	RelayIPv6          string
	LogLevel           string

	DNSProvider        string
	CloudflareToken    string // secret
	CloudflareZoneID   string
	DNSTTL             int
	ReachAllowPrivate  bool
	ReachTimeout       time.Duration

	RelayBytesPerSecond int64
	RelayMonthlyBytes   int64
	RelayMaxStreams     int
	RelayMaxConns       int
	RelayIdleTimeout    time.Duration

	RegisterPerIPHourly   int
	LinkCodesPerHour      int
	ApprovePerUserHourly  int

	ResendAPIKey            string // secret
	ResendBaseURL           string
	MailFromAddress         string
	MailDisabled            bool
	MailRequireLinked       bool
	MailPerServerHourly     int
	MailPerServerDaily      int
	MailPerRecipientHourly  int
	MailPerRecipientDaily   int
	MailGlobalDaily         int

	APNsKeyID    string
	APNsTeamID   string
	APNsBundleID string
	APNsKey      string // secret (contents of the .p8)
	FCMServiceAccount []byte // secret (JSON)
	FCMProjectID string
	PushPerServerHourly int

	GeminiAPIKey       string // secret
	AIBaseURL          string
	AIChatModel        string
	AIEmbeddingModel   string
	AIAllowedModels    []string
	AIMonthlyTokens    int64
	AIPerServerMinute  int
	AIRequireLinked    bool
	AIMaxRequestBytes  int64

	UnsplashAccessKey     string // secret
	UnsplashBaseURL       string
	UnsplashPerServerHourly int

	DiagMaxBytes        int64
	DiagRetention       time.Duration
	DiagPerServerDaily  int
}

type reader struct {
	get  func(string) string
	errs []string
}

func (r *reader) str(key, def string) string {
	if v := strings.TrimSpace(r.get(key)); v != "" {
		return v
	}
	return def
}

func (r *reader) int(key string, def int) int {
	v := strings.TrimSpace(r.get(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		r.errs = append(r.errs, key+" must be a whole number")
		return def
	}
	return n
}

func (r *reader) int64(key string, def int64) int64 {
	v := strings.TrimSpace(r.get(key))
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		r.errs = append(r.errs, key+" must be a whole number")
		return def
	}
	return n
}

func (r *reader) bool(key string, def bool) bool {
	v := strings.TrimSpace(r.get(key))
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		r.errs = append(r.errs, key+" must be true or false")
		return def
	}
	return b
}

func (r *reader) dur(key string, def time.Duration) time.Duration {
	v := strings.TrimSpace(r.get(key))
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		r.errs = append(r.errs, key+" must be a duration such as 30s or 5m")
		return def
	}
	return d
}

func (r *reader) list(key, def string) []string {
	var out []string
	for _, p := range strings.Split(r.str(key, def), ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// secretFile reads KEY, or the file named by KEY_FILE.
func (r *reader) secretFile(key string) string {
	if v := r.get(key); strings.TrimSpace(v) != "" {
		return v
	}
	if path := strings.TrimSpace(r.get(key + "_FILE")); path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			r.errs = append(r.errs, key+"_FILE could not be read")
			return ""
		}
		return string(b)
	}
	return ""
}

// Load reads the configuration from getenv (os.Getenv in main).
func Load(getenv func(string) string) (*Config, error) {
	r := &reader{get: getenv}
	c := &Config{
		HTTPAddr:           r.str("CONNECT_HTTP_ADDR", ":8080"),
		RelayAddr:          r.str("CONNECT_RELAY_ADDR", ""),
		RelayProxyProtocol: r.bool("CONNECT_RELAY_PROXY_PROTOCOL", false),
		LocalHostnames:     r.list("CONNECT_LOCAL_HOSTNAMES", "connect.folevi.com,relay.folevi.app"),
		TLSCertFile:        r.str("CONNECT_TLS_CERT_FILE", ""),
		TLSKeyFile:         r.str("CONNECT_TLS_KEY_FILE", ""),
		ACMEEmail:          r.str("CONNECT_ACME_EMAIL", ""),
		ACMECacheDir:       r.str("CONNECT_ACME_CACHE_DIR", "./acme"),
		DBPath:             r.str("CONNECT_DB", "./connect.db"),
		Zone:               strings.ToLower(r.str("CONNECT_ZONE", "folevi.app")),
		AppURL:             strings.TrimRight(r.str("CONNECT_APP_URL", "https://app.folevi.com"), "/"),
		ServiceKey:         r.secretFile("CONNECT_SERVICE_KEY"),
		AdminKey:           r.secretFile("CONNECT_ADMIN_KEY"),
		TrustedProxyHeader: r.str("CONNECT_TRUSTED_PROXY_HEADER", ""),
		RelayIPv4:          r.str("CONNECT_RELAY_IPV4", ""),
		RelayIPv6:          r.str("CONNECT_RELAY_IPV6", ""),
		LogLevel:           r.str("CONNECT_LOG_LEVEL", "info"),

		DNSProvider:       r.str("CONNECT_DNS_PROVIDER", "memory"),
		CloudflareToken:   r.secretFile("CLOUDFLARE_API_TOKEN"),
		CloudflareZoneID:  r.str("CLOUDFLARE_ZONE_ID", ""),
		DNSTTL:            r.int("CONNECT_DNS_TTL", 60),
		ReachAllowPrivate: r.bool("CONNECT_REACH_ALLOW_PRIVATE", false),
		ReachTimeout:      r.dur("CONNECT_REACH_TIMEOUT", 8*time.Second),

		RelayBytesPerSecond: r.int64("CONNECT_RELAY_BYTES_PER_SECOND", 1<<20),
		RelayMonthlyBytes:   r.int64("CONNECT_RELAY_MONTHLY_BYTES", 5<<30),
		RelayMaxStreams:     r.int("CONNECT_RELAY_MAX_STREAMS", 64),
		RelayMaxConns:       r.int("CONNECT_RELAY_MAX_CONNS", 20000),
		RelayIdleTimeout:    r.dur("CONNECT_RELAY_IDLE_TIMEOUT", 5*time.Minute),

		RegisterPerIPHourly:  r.int("CONNECT_REGISTER_PER_IP_HOURLY", 10),
		LinkCodesPerHour:     r.int("CONNECT_LINK_CODES_PER_HOUR", 6),
		ApprovePerUserHourly: r.int("CONNECT_APPROVE_PER_USER_HOURLY", 20),

		ResendAPIKey:           r.secretFile("RESEND_API_KEY"),
		ResendBaseURL:          r.str("CONNECT_RESEND_BASE_URL", "https://api.resend.com"),
		MailFromAddress:        r.str("CONNECT_MAIL_FROM_ADDRESS", "no-reply@folevi.app"),
		MailDisabled:           r.bool("CONNECT_MAIL_DISABLED", false),
		MailRequireLinked:      r.bool("CONNECT_MAIL_REQUIRE_LINKED", true),
		MailPerServerHourly:    r.int("CONNECT_MAIL_PER_SERVER_HOURLY", 30),
		MailPerServerDaily:     r.int("CONNECT_MAIL_PER_SERVER_DAILY", 200),
		MailPerRecipientHourly: r.int("CONNECT_MAIL_PER_RECIPIENT_HOURLY", 5),
		MailPerRecipientDaily:  r.int("CONNECT_MAIL_PER_RECIPIENT_DAILY", 20),
		MailGlobalDaily:        r.int("CONNECT_MAIL_GLOBAL_DAILY", 10000),

		APNsKeyID:           r.str("APNS_KEY_ID", ""),
		APNsTeamID:          r.str("APNS_TEAM_ID", ""),
		APNsBundleID:        r.str("APNS_BUNDLE_ID", "com.folevi.ios"),
		APNsKey:             r.secretFile("APNS_KEY"),
		FCMServiceAccount:   []byte(r.secretFile("FCM_SERVICE_ACCOUNT")),
		FCMProjectID:        r.str("FCM_PROJECT_ID", ""),
		PushPerServerHourly: r.int("CONNECT_PUSH_PER_SERVER_HOURLY", 1000),

		GeminiAPIKey:      r.secretFile("GEMINI_API_KEY"),
		AIBaseURL:         r.str("CONNECT_AI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/"),
		AIChatModel:       r.str("CONNECT_AI_CHAT_MODEL", "gemini-3.8-flash"),
		AIEmbeddingModel:  r.str("CONNECT_AI_EMBEDDING_MODEL", "gemini-embedding-001"),
		AIAllowedModels:   r.list("CONNECT_AI_ALLOWED_MODELS", "gemini-3.8-flash,gemini-flash-lite-latest,gemini-embedding-001"),
		AIMonthlyTokens:   r.int64("CONNECT_AI_MONTHLY_TOKENS", 2_000_000),
		AIPerServerMinute: r.int("CONNECT_AI_PER_SERVER_MINUTE", 60),
		AIRequireLinked:   r.bool("CONNECT_AI_REQUIRE_LINKED", true),
		AIMaxRequestBytes: r.int64("CONNECT_AI_MAX_REQUEST_BYTES", 4<<20),

		UnsplashAccessKey:       r.secretFile("UNSPLASH_ACCESS_KEY"),
		UnsplashBaseURL:         r.str("CONNECT_UNSPLASH_BASE_URL", "https://api.unsplash.com"),
		UnsplashPerServerHourly: r.int("CONNECT_UNSPLASH_PER_SERVER_HOURLY", 100),

		DiagMaxBytes:       r.int64("CONNECT_DIAG_MAX_BYTES", 2<<20),
		DiagRetention:      r.dur("CONNECT_DIAG_RETENTION", 30*24*time.Hour),
		DiagPerServerDaily: r.int("CONNECT_DIAG_PER_SERVER_DAILY", 10),
	}
	switch c.DNSProvider {
	case "memory":
	case "cloudflare":
		if c.CloudflareToken == "" || c.CloudflareZoneID == "" {
			r.errs = append(r.errs, "CONNECT_DNS_PROVIDER=cloudflare needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID")
		}
	default:
		r.errs = append(r.errs, "CONNECT_DNS_PROVIDER must be memory or cloudflare")
	}
	if (c.TLSCertFile == "") != (c.TLSKeyFile == "") {
		r.errs = append(r.errs, "CONNECT_TLS_CERT_FILE and CONNECT_TLS_KEY_FILE go together")
	}
	if len(r.errs) > 0 {
		return nil, fmt.Errorf("configuration: %s", strings.Join(r.errs, "; "))
	}
	return c, nil
}
