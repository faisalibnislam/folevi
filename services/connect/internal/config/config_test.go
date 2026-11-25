package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultsAndErrors(t *testing.T) {
	c, err := Load(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	if c.Zone != "folevi.app" || c.MailFromAddress != "no-reply@folevi.app" || c.DNSProvider != "memory" || !c.MailRequireLinked {
		t.Fatalf("defaults %+v", c)
	}
	env := map[string]string{"CONNECT_DNS_PROVIDER": "cloudflare", "CONNECT_RELAY_MAX_STREAMS": "many", "CLOUDFLARE_API_TOKEN": "cf-very-secret"}
	_, err = Load(func(k string) string { return env[k] })
	if err == nil || !strings.Contains(err.Error(), "CLOUDFLARE_ZONE_ID") || !strings.Contains(err.Error(), "CONNECT_RELAY_MAX_STREAMS") || strings.Contains(err.Error(), "cf-very-secret") {
		t.Fatalf("err %v", err)
	}
}

func TestSecretFromFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "key")
	_ = os.WriteFile(p, []byte("re_from_file"), 0o600)
	c, err := Load(func(k string) string {
		if k == "RESEND_API_KEY_FILE" {
			return p
		}
		return ""
	})
	if err != nil || c.ResendAPIKey != "re_from_file" {
		t.Fatalf("%v %q", err, c.ResendAPIKey)
	}
}
