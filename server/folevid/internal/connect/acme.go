package connect

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-acme/lego/v4/certcrypto"
	"github.com/go-acme/lego/v4/certificate"
	"github.com/go-acme/lego/v4/challenge/dns01"
	"github.com/go-acme/lego/v4/lego"
	"github.com/go-acme/lego/v4/registration"

	"github.com/faisalibnislam/folevi/server/folevid/internal/secrets"
)

// DNSProvider is a lego DNS-01 provider that sets the TXT record through Connect's /acme endpoints.
type DNSProvider struct {
	Client   *Client
	ServerID string
	Hostname string // <id>.folevi.app
	// Wait bounds lego's propagation check.
	Wait time.Duration
}

// Label turns a domain into the label Connect expects: "@" for the bare name, "x" for x.<hostname>.
func (p *DNSProvider) Label(domain string) (string, error) {
	d := strings.TrimSuffix(strings.TrimPrefix(strings.ToLower(domain), "*."), ".")
	h := strings.ToLower(p.Hostname)
	if d == h {
		return "@", nil
	}
	if l, ok := strings.CutSuffix(d, "."+h); ok && l != "" {
		return l, nil
	}
	return "", fmt.Errorf("%s is not under %s", domain, p.Hostname)
}

// Present implements challenge.Provider.
func (p *DNSProvider) Present(domain, token, keyAuth string) error {
	label, err := p.Label(domain)
	if err != nil {
		return err
	}
	info := dns01.GetChallengeInfo(domain, keyAuth)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return p.Client.SetACME(ctx, p.ServerID, label, info.Value)
}

// CleanUp implements challenge.Provider.
func (p *DNSProvider) CleanUp(domain, token, keyAuth string) error {
	label, err := p.Label(domain)
	if err != nil {
		return err
	}
	info := dns01.GetChallengeInfo(domain, keyAuth)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return p.Client.DeleteACME(ctx, p.ServerID, label, info.Value)
}

// Timeout implements challenge.ProviderTimeout.
func (p *DNSProvider) Timeout() (time.Duration, time.Duration) {
	w := p.Wait
	if w == 0 {
		w = 3 * time.Minute
	}
	return w, 5 * time.Second
}

// Sequential makes lego solve the bare name and the wildcard one after the other, because both use the same
// TXT name (_acme-challenge.<id>.folevi.app) and Connect may keep one value per label.
func (p *DNSProvider) Sequential() (bool, time.Duration) { return true, 5 * time.Second }

// acmeUser is the ACME account.
type acmeUser struct {
	Email        string                 `json:"email"`
	Registration *registration.Resource `json:"registration"`
	key          crypto.PrivateKey
}

func (u *acmeUser) GetEmail() string                        { return u.Email }
func (u *acmeUser) GetRegistration() *registration.Resource { return u.Registration }
func (u *acmeUser) GetPrivateKey() crypto.PrivateKey        { return u.key }

// CertStore is secrets/tls.
type CertStore struct{ Dir string }

func (s CertStore) CertPath() string { return filepath.Join(s.Dir, "cert.pem") }
func (s CertStore) KeyPath() string  { return filepath.Join(s.Dir, "key.pem") }

// Load returns the stored certificate, or nil when there is none.
func (s CertStore) Load() (*tls.Certificate, error) {
	cert, err := tls.LoadX509KeyPair(s.CertPath(), s.KeyPath())
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if cert.Leaf == nil && len(cert.Certificate) > 0 {
		cert.Leaf, _ = x509.ParseCertificate(cert.Certificate[0])
	}
	return &cert, nil
}

// NeedsRenewal reports whether cert is missing, expires within 30 days, or does not cover hostname.
func NeedsRenewal(cert *tls.Certificate, hostname string, now time.Time) bool {
	if cert == nil || cert.Leaf == nil {
		return true
	}
	if cert.Leaf.NotAfter.Sub(now) < 30*24*time.Hour {
		return true
	}
	return cert.Leaf.VerifyHostname(hostname) != nil || cert.Leaf.VerifyHostname("a."+hostname) != nil
}

// ObtainOptions configure Obtain.
type ObtainOptions struct {
	Provider     *DNSProvider
	DirectoryURL string // empty for Let's Encrypt production
	Email        string // optional
	// SkipPropagationCheck skips lego's own DNS lookups (for test CAs that do not resolve DNS).
	SkipPropagationCheck bool
}

// Obtain gets a certificate for <hostname> and *.<hostname> and writes cert.pem and key.pem (mode 600).
func (s CertStore) Obtain(opts ObtainOptions) error {
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return err
	}
	user, err := s.account(opts.Email)
	if err != nil {
		return err
	}
	cfg := lego.NewConfig(user)
	if opts.DirectoryURL != "" {
		cfg.CADirURL = opts.DirectoryURL
	}
	cfg.Certificate.KeyType = certcrypto.EC256
	client, err := lego.NewClient(cfg)
	if err != nil {
		return err
	}
	var dnsOpts []dns01.ChallengeOption
	if opts.SkipPropagationCheck {
		dnsOpts = append(dnsOpts, dns01.PropagationWait(time.Second, true))
	}
	if err := client.Challenge.SetDNS01Provider(opts.Provider, dnsOpts...); err != nil {
		return err
	}
	if user.Registration == nil {
		reg, err := client.Registration.Register(registration.RegisterOptions{TermsOfServiceAgreed: true})
		if err != nil {
			return fmt.Errorf("acme account: %w", err)
		}
		user.Registration = reg
		if err := s.saveAccount(user); err != nil {
			return err
		}
	}
	h := opts.Provider.Hostname
	res, err := client.Certificate.Obtain(certificate.ObtainRequest{Domains: []string{h, "*." + h}, Bundle: true})
	if err != nil {
		return err
	}
	if err := secrets.WriteFile(s.KeyPath(), res.PrivateKey); err != nil {
		return err
	}
	return secrets.WriteFile(s.CertPath(), res.Certificate)
}

func (s CertStore) account(email string) (*acmeUser, error) {
	keyPath := filepath.Join(s.Dir, "account-key.pem")
	u := &acmeUser{Email: email}
	if b, err := os.ReadFile(keyPath); err == nil {
		blk, _ := pem.Decode(b)
		if blk == nil {
			return nil, errors.New("account-key.pem is damaged")
		}
		k, err := x509.ParseECPrivateKey(blk.Bytes)
		if err != nil {
			return nil, err
		}
		u.key = k
		if b, err := os.ReadFile(filepath.Join(s.Dir, "account.json")); err == nil {
			var saved acmeUser
			if json.Unmarshal(b, &saved) == nil {
				u.Registration = saved.Registration
				if u.Email == "" {
					u.Email = saved.Email
				}
			}
		}
		return u, nil
	}
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	der, err := x509.MarshalECPrivateKey(k)
	if err != nil {
		return nil, err
	}
	if err := secrets.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der})); err != nil {
		return nil, err
	}
	u.key = k
	return u, nil
}

func (s CertStore) saveAccount(u *acmeUser) error {
	b, err := json.MarshalIndent(u, "", "  ")
	if err != nil {
		return err
	}
	return secrets.WriteFile(filepath.Join(s.Dir, "account.json"), b)
}
