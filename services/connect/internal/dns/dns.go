// Package dns manages the records of the servers' zone (folevi.net): A/AAAA records for each server's names and
// the _acme-challenge TXT records for its certificates. Provider is the DNS host (Cloudflare in production, an
// in-memory fake in tests); Manager holds the rules for what a server may have.
package dns

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"regexp"
	"slices"
	"strings"
	"sync"
)

// Record is one DNS record. Name is the full name without a trailing dot.
type Record struct {
	ID      string
	Name    string
	Type    string // "A", "AAAA", "TXT"
	Content string
	TTL     int
}

// Provider is a DNS host for one zone.
type Provider interface {
	// List returns every record with this exact name (any type).
	List(ctx context.Context, name string) ([]Record, error)
	Create(ctx context.Context, r Record) error
	Delete(ctx context.Context, id string) error
}

// ErrInvalid is returned for a name or address a server may not have.
var ErrInvalid = errors.New("invalid")

// Names builds and checks the names under the zone.
type Names struct {
	Zone string // "folevi.net"
}

var serverIDRe = regexp.MustCompile(`^[a-z2-7]{10}$`)

// ValidServerID reports whether id is 10 lowercase base32 characters.
func ValidServerID(id string) bool { return serverIDRe.MatchString(id) }

// Host is "<id>.<zone>".
func (n Names) Host(id string) string { return id + "." + n.Zone }

// IsPrivate reports whether ip is a home-network address: RFC 1918 IPv4 or an IPv6 unique local address (fc00::/7).
// Loopback, link-local, CGNAT (100.64/10) and public addresses are refused.
func IsPrivate(ip netip.Addr) bool {
	ip = ip.Unmap()
	if ip.Is4() {
		return ip.IsPrivate() // 10/8, 172.16/12, 192.168/16
	}
	return ip.Is6() && ip.IsPrivate() && ip.Zone() == "" // fc00::/7
}

// LanLabel is the label for a private address: "192-168-1-20", or for IPv6 the expanded form with dashes
// ("fd00-0000-0000-0000-0000-0000-0000-0001").
func LanLabel(ip netip.Addr) (string, error) {
	ip = ip.Unmap()
	if !IsPrivate(ip) {
		return "", fmt.Errorf("%w: %s is not a private address", ErrInvalid, ip)
	}
	if ip.Is4() {
		return strings.ReplaceAll(ip.String(), ".", "-"), nil
	}
	return strings.ReplaceAll(ip.StringExpanded(), ":", "-"), nil
}

// ParseLanLabel turns a label back into its private address, refusing anything else.
func ParseLanLabel(label string) (netip.Addr, error) {
	var text string
	switch strings.Count(label, "-") {
	case 3:
		text = strings.ReplaceAll(label, "-", ".")
	case 7:
		text = strings.ReplaceAll(label, "-", ":")
	default:
		return netip.Addr{}, fmt.Errorf("%w: label", ErrInvalid)
	}
	ip, err := netip.ParseAddr(text)
	if err != nil || !IsPrivate(ip) {
		return netip.Addr{}, fmt.Errorf("%w: label", ErrInvalid)
	}
	if want, _ := LanLabel(ip); want != label {
		return netip.Addr{}, fmt.Errorf("%w: label is not canonical", ErrInvalid)
	}
	return ip, nil
}

// LanHost is "<a-b-c-d>.<id>.<zone>".
func (n Names) LanHost(id string, ip netip.Addr) (string, error) {
	label, err := LanLabel(ip)
	if err != nil {
		return "", err
	}
	return label + "." + n.Host(id), nil
}

// ServerOf returns the server id a host name belongs to: "<id>.<zone>" or "<label>.<id>.<zone>".
func (n Names) ServerOf(host string) (string, bool) {
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	rest, ok := strings.CutSuffix(host, "."+n.Zone)
	if !ok {
		return "", false
	}
	parts := strings.Split(rest, ".")
	if len(parts) > 2 {
		return "", false
	}
	id := parts[len(parts)-1]
	if !ValidServerID(id) {
		return "", false
	}
	return id, true
}

// AcmeName is the TXT name for a server's DNS-01 check: label "@" is the server's own name (and its wildcard),
// any other label must be one of the server's private-address labels.
func (n Names) AcmeName(id, label string) (string, error) {
	if !ValidServerID(id) {
		return "", fmt.Errorf("%w: server id", ErrInvalid)
	}
	if label == "@" {
		return "_acme-challenge." + n.Host(id), nil
	}
	if _, err := ParseLanLabel(label); err != nil {
		return "", err
	}
	return "_acme-challenge." + label + "." + n.Host(id), nil
}

var acmeValueRe = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

// ValidAcmeValue reports whether v looks like a DNS-01 key authorization digest (base64url).
func ValidAcmeValue(v string) bool { return acmeValueRe.MatchString(v) }

// Manager applies records through a Provider.
type Manager struct {
	Provider Provider
	Names    Names
	TTL      int
}

func addrType(ip netip.Addr) string {
	if ip.Unmap().Is4() {
		return "A"
	}
	return "AAAA"
}

// SetAddresses makes name's A and AAAA records exactly ips (an empty list removes them).
func (m *Manager) SetAddresses(ctx context.Context, name string, ips []netip.Addr) error {
	existing, err := m.Provider.List(ctx, name)
	if err != nil {
		return err
	}
	want := map[string]string{} // content -> type
	for _, ip := range ips {
		want[ip.Unmap().String()] = addrType(ip)
	}
	for _, r := range existing {
		if r.Type != "A" && r.Type != "AAAA" {
			continue
		}
		if t, ok := want[r.Content]; ok && t == r.Type {
			delete(want, r.Content)
			continue
		}
		if err := m.Provider.Delete(ctx, r.ID); err != nil {
			return err
		}
	}
	keys := make([]string, 0, len(want))
	for k := range want {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, content := range keys {
		if err := m.Provider.Create(ctx, Record{Name: name, Type: want[content], Content: content, TTL: m.TTL}); err != nil {
			return err
		}
	}
	return nil
}

// AddTXT adds value to name's TXT records (several can exist: a wildcard and a bare certificate at once).
func (m *Manager) AddTXT(ctx context.Context, name, value string) error {
	existing, err := m.Provider.List(ctx, name)
	if err != nil {
		return err
	}
	n := 0
	for _, r := range existing {
		if r.Type == "TXT" {
			if unquote(r.Content) == value {
				return nil
			}
			n++
		}
	}
	if n >= 4 {
		return fmt.Errorf("%w: too many challenge records", ErrInvalid)
	}
	return m.Provider.Create(ctx, Record{Name: name, Type: "TXT", Content: value, TTL: 60})
}

// RemoveTXT removes value from name's TXT records, or all of them when value is empty.
func (m *Manager) RemoveTXT(ctx context.Context, name, value string) error {
	existing, err := m.Provider.List(ctx, name)
	if err != nil {
		return err
	}
	for _, r := range existing {
		if r.Type == "TXT" && (value == "" || unquote(r.Content) == value) {
			if err := m.Provider.Delete(ctx, r.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

func unquote(s string) string { return strings.Trim(s, `"`) }

// Memory is an in-memory Provider for tests and local runs.
type Memory struct {
	mu      sync.Mutex
	next    int
	records map[string]Record
}

func NewMemory() *Memory { return &Memory{records: map[string]Record{}} }

func (m *Memory) List(_ context.Context, name string) ([]Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Record
	for _, r := range m.records {
		if r.Name == name {
			out = append(out, r)
		}
	}
	slices.SortFunc(out, func(a, b Record) int { return strings.Compare(a.ID, b.ID) })
	return out, nil
}

func (m *Memory) Create(_ context.Context, r Record) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.next++
	r.ID = fmt.Sprintf("r%d", m.next)
	m.records[r.ID] = r
	return nil
}

func (m *Memory) Delete(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.records, id)
	return nil
}

// All returns every record, sorted by name, type and content (tests).
func (m *Memory) All() []Record {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Record, 0, len(m.records))
	for _, r := range m.records {
		out = append(out, r)
	}
	slices.SortFunc(out, func(a, b Record) int {
		return strings.Compare(a.Name+"|"+a.Type+"|"+a.Content, b.Name+"|"+b.Type+"|"+b.Content)
	})
	return out
}
