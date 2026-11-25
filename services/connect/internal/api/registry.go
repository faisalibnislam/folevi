package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"errors"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"

	"folevi.com/connect/internal/dns"
	"folevi.com/connect/internal/store"
)

const (
	linkCodeTTL  = 10 * time.Minute
	onlineWindow = 5 * time.Minute
	maxLanIPs    = 8
	tokenPrefix  = "fct_"
	codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O, 1/I
)

var (
	idEncoding  = base32.NewEncoding("abcdefghijklmnopqrstuvwxyz234567").WithPadding(base32.NoPadding)
	versionRe   = regexp.MustCompile(`^[0-9A-Za-z.+-]{1,40}$`)
	codeCleanRe = regexp.MustCompile(`[\s-]`)
)

func randomBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}

// newServerID is 10 lowercase base32 characters (50 random bits).
func newServerID() string { return idEncoding.EncodeToString(randomBytes(7))[:10] }

func newToken() string { return tokenPrefix + base64.RawURLEncoding.EncodeToString(randomBytes(32)) }

// newLinkCode is 8 characters from a 32-letter alphabet, shown as XXXX-XXXX.
func newLinkCode() string {
	b := randomBytes(8)
	out := make([]byte, 0, 9)
	for i, v := range b {
		if i == 4 {
			out = append(out, '-')
		}
		out = append(out, codeAlphabet[int(v)%len(codeAlphabet)])
	}
	return string(out)
}

func normalizeCode(code string) string {
	return strings.ToUpper(codeCleanRe.ReplaceAllString(code, ""))
}

func codeHash(code string) []byte {
	h := sha256.Sum256([]byte("link:" + normalizeCode(code)))
	return h[:]
}

func cleanName(s string) (string, bool) {
	s = strings.Join(strings.Fields(s), " ")
	if s == "" || len([]rune(s)) > 80 {
		return "", false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	return s, true
}

func decodeKey(s string) ([]byte, bool) {
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if b, err := enc.DecodeString(strings.TrimSpace(s)); err == nil && len(b) == 32 {
			return b, true
		}
	}
	return nil, false
}

// ---------------------------------------------------------------- views

type serverView struct {
	ServerID        string   `json:"serverId"`
	Name            string   `json:"name"`
	Version         string   `json:"version"`
	Linked          bool     `json:"linked"`
	OwnerAccount    string   `json:"ownerAccount,omitempty"`
	Hostname        string   `json:"hostname"`
	LanHostnames    []string `json:"lanHostnames"`
	Reachable       *bool    `json:"reachable,omitempty"`
	PublicIP        string   `json:"publicIp,omitempty"`
	PublicPort      int      `json:"publicPort,omitempty"`
	TunnelConnected bool     `json:"tunnelConnected"`
	Online          bool     `json:"online"`
	LastSeenAt      string   `json:"lastSeenAt,omitempty"`
}

func (a *API) lanHostnames(sv *store.Server) []string {
	out := []string{}
	for _, s := range sv.LanIPs {
		ip, err := netip.ParseAddr(s)
		if err != nil {
			continue
		}
		if h, err := a.names.LanHost(sv.ID, ip); err == nil {
			out = append(out, h)
		}
	}
	return out
}

func (a *API) tunnelConnected(id string) bool { return a.Relay != nil && a.Relay.Connected(id) }

func (a *API) online(sv *store.Server) bool {
	now := a.Now()
	return a.tunnelConnected(sv.ID) || now.Sub(sv.LastSeenAt) < onlineWindow || now.Sub(sv.TunnelSeenAt) < onlineWindow
}

func (a *API) view(sv *store.Server) serverView {
	v := serverView{ServerID: sv.ID, Name: sv.Name, Version: sv.Version, Linked: sv.OwnerAccount != "", OwnerAccount: sv.OwnerAccount,
		Hostname: a.names.Host(sv.ID), LanHostnames: a.lanHostnames(sv), Reachable: sv.Reachable, PublicIP: sv.PublicIP, PublicPort: sv.PublicPort,
		TunnelConnected: a.tunnelConnected(sv.ID), Online: a.online(sv)}
	if !sv.LastSeenAt.IsZero() {
		v.LastSeenAt = sv.LastSeenAt.Format(time.RFC3339)
	}
	return v
}

// ---------------------------------------------------------------- DNS

// hostAddresses is where <id>.<zone> points: the public address when the last check reached it, else the relay.
func (a *API) hostAddresses(sv *store.Server) []netip.Addr {
	if sv.Reachable != nil && *sv.Reachable && sv.PublicIP != "" {
		if ip, err := netip.ParseAddr(sv.PublicIP); err == nil {
			return []netip.Addr{ip}
		}
	}
	var out []netip.Addr
	for _, s := range []string{a.cfg.RelayIPv4, a.cfg.RelayIPv6} {
		if ip, err := netip.ParseAddr(s); err == nil {
			out = append(out, ip)
		}
	}
	return out
}

// syncDNS points the server's names at the right addresses; oldLan are LAN addresses whose names should go.
func (a *API) syncDNS(ctx context.Context, sv *store.Server, oldLan []string) error {
	if a.DNS == nil {
		return nil
	}
	if err := a.DNS.SetAddresses(ctx, a.names.Host(sv.ID), a.hostAddresses(sv)); err != nil {
		return err
	}
	for _, s := range oldLan {
		if slices.Contains(sv.LanIPs, s) {
			continue
		}
		ip, err := netip.ParseAddr(s)
		if err != nil {
			continue
		}
		if name, err := a.names.LanHost(sv.ID, ip); err == nil {
			if err := a.DNS.SetAddresses(ctx, name, nil); err != nil {
				return err
			}
		}
	}
	for _, s := range sv.LanIPs {
		ip, err := netip.ParseAddr(s)
		if err != nil {
			continue
		}
		name, err := a.names.LanHost(sv.ID, ip)
		if err != nil {
			continue
		}
		if err := a.DNS.SetAddresses(ctx, name, []netip.Addr{ip}); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------- handlers

func (a *API) handleRegister(w http.ResponseWriter, r *http.Request) {
	ip := a.clientIP(r)
	if !a.register.Allow("ip:" + ip.String()) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	var in struct {
		Name      string `json:"name"`
		Version   string `json:"version"`
		PublicKey string `json:"publicKey"`
	}
	if !readJSON(w, r, 8<<10, &in) {
		return
	}
	name, ok := cleanName(in.Name)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid_name")
		return
	}
	if !versionRe.MatchString(in.Version) {
		writeErr(w, http.StatusBadRequest, "invalid_version")
		return
	}
	key, ok := decodeKey(in.PublicKey)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid_public_key")
		return
	}
	token := newToken()
	now := a.Now().UTC()
	var sv *store.Server
	for attempt := 0; attempt < 5; attempt++ {
		sv = &store.Server{ID: newServerID(), Name: name, Version: in.Version, PublicKey: key, TokenHash: hashToken(token), CreatedAt: now, LastSeenAt: now}
		err := a.Store.CreateServer(r.Context(), sv)
		if err == nil {
			break
		}
		if attempt == 4 {
			a.Log.Error("register failed", "err", err)
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
	}
	setServer(r, sv.ID)
	a.Log.Info("server registered", "server", sv.ID)
	if err := a.syncDNS(r.Context(), sv, nil); err != nil {
		a.Log.Warn("dns sync failed", "server", sv.ID, "err", err)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"serverId": sv.ID, "token": token, "hostname": a.names.Host(sv.ID)})
}

func (a *API) handleGetServer(w http.ResponseWriter, r *http.Request, sv *store.Server) {
	writeJSON(w, http.StatusOK, a.view(sv))
}

func (a *API) handleUpdateServer(w http.ResponseWriter, r *http.Request, sv *store.Server) {
	var in struct {
		Name       *string   `json:"name"`
		Version    *string   `json:"version"`
		LanIPs     *[]string `json:"lanIps"`
		PublicPort *int      `json:"publicPort"`
	}
	if !readJSON(w, r, 16<<10, &in) {
		return
	}
	if in.Name != nil {
		name, ok := cleanName(*in.Name)
		if !ok {
			writeErr(w, http.StatusBadRequest, "invalid_name")
			return
		}
		sv.Name = name
	}
	if in.Version != nil {
		if !versionRe.MatchString(*in.Version) {
			writeErr(w, http.StatusBadRequest, "invalid_version")
			return
		}
		sv.Version = *in.Version
	}
	oldLan := sv.LanIPs
	if in.LanIPs != nil {
		if len(*in.LanIPs) > maxLanIPs {
			writeErr(w, http.StatusBadRequest, "too_many_lan_ips")
			return
		}
		lan := []string{}
		for _, s := range *in.LanIPs {
			ip, err := netip.ParseAddr(strings.TrimSpace(s))
			if err != nil || !dns.IsPrivate(ip) {
				writeErr(w, http.StatusBadRequest, "invalid_lan_ip")
				return
			}
			if c := ip.Unmap().String(); !slices.Contains(lan, c) {
				lan = append(lan, c)
			}
		}
		sv.LanIPs = lan
	}
	if in.PublicPort != nil {
		if *in.PublicPort < 0 || *in.PublicPort > 65535 {
			writeErr(w, http.StatusBadRequest, "invalid_port")
			return
		}
		if *in.PublicPort != sv.PublicPort {
			sv.PublicPort = *in.PublicPort
			sv.Reachable = nil // a new port needs a new check
		}
	}
	if err := a.Store.UpdateServer(r.Context(), sv); err != nil {
		a.Log.Error("update failed", "server", sv.ID, "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := a.syncDNS(r.Context(), sv, oldLan); err != nil {
		a.Log.Warn("dns sync failed", "server", sv.ID, "err", err)
		writeErr(w, http.StatusBadGateway, "dns_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, a.view(sv))
}

func (a *API) handleLinkCode(w http.ResponseWriter, r *http.Request, sv *store.Server) {
	if !a.linkCodes.Allow(sv.ID) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	now := a.Now().UTC()
	_ = a.Store.DeleteExpiredLinkCodes(r.Context(), now)
	code := newLinkCode()
	expires := now.Add(linkCodeTTL)
	if err := a.Store.CreateLinkCode(r.Context(), store.LinkCode{CodeHash: codeHash(code), ServerID: sv.ID, ExpiresAt: expires, CreatedAt: now}); err != nil {
		a.Log.Error("link code failed", "server", sv.ID, "err", err)
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"code":       code,
		"approveUrl": a.cfg.AppURL + "/connect/approve?code=" + url.QueryEscape(code),
		"expiresAt":  expires.Format(time.RFC3339),
	})
}

func (a *API) handleApprove(w http.ResponseWriter, r *http.Request, user string) {
	if !a.approve.Allow(user) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	code := normalizeCode(r.PathValue("code"))
	if len(code) != 8 {
		writeErr(w, http.StatusNotFound, "invalid_code")
		return
	}
	id, err := a.Store.ConsumeLinkCode(r.Context(), codeHash(code), a.Now().UTC())
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "invalid_code")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	sv, err := a.Store.GetServer(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "invalid_code")
		return
	}
	setServer(r, sv.ID)
	if sv.Flags.Suspended {
		writeErr(w, http.StatusForbidden, "suspended")
		return
	}
	sv.OwnerAccount = user
	if err := a.Store.UpdateServer(r.Context(), sv); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	a.Log.Info("server linked", "server", sv.ID)
	writeJSON(w, http.StatusOK, map[string]any{"serverId": sv.ID, "name": sv.Name, "hostname": a.names.Host(sv.ID)})
}

func (a *API) handleAccountServers(w http.ResponseWriter, r *http.Request, user string) {
	if r.PathValue("userId") != user {
		writeErr(w, http.StatusForbidden, "user_mismatch")
		return
	}
	list, err := a.Store.ListServersByOwner(r.Context(), user)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, sv := range list {
		if sv.Flags.Suspended {
			continue
		}
		out = append(out, map[string]any{
			"serverId": sv.ID, "name": sv.Name, "hostname": a.names.Host(sv.ID), "lanHostnames": a.lanHostnames(sv),
			"version": sv.Version, "online": a.online(sv), "role": "owner",
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) handleAcmeSet(w http.ResponseWriter, r *http.Request, sv *store.Server) {
	name, err := a.names.AcmeName(sv.ID, r.PathValue("label"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_label")
		return
	}
	var in struct {
		Value string `json:"value"`
	}
	if !readJSON(w, r, 4<<10, &in) {
		return
	}
	if !dns.ValidAcmeValue(in.Value) {
		writeErr(w, http.StatusBadRequest, "invalid_value")
		return
	}
	if a.DNS == nil {
		writeErr(w, http.StatusServiceUnavailable, "dns_unavailable")
		return
	}
	if err := a.DNS.AddTXT(r.Context(), name, in.Value); err != nil {
		if errors.Is(err, dns.ErrInvalid) {
			writeErr(w, http.StatusConflict, "too_many_records")
			return
		}
		a.Log.Warn("acme set failed", "server", sv.ID, "err", err)
		writeErr(w, http.StatusBadGateway, "dns_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": name})
}

func (a *API) handleAcmeDelete(w http.ResponseWriter, r *http.Request, sv *store.Server) {
	name, err := a.names.AcmeName(sv.ID, r.PathValue("label"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_label")
		return
	}
	// The value can come in a JSON body or ?value=; without one every challenge record for the name goes.
	value := r.URL.Query().Get("value")
	if r.ContentLength > 0 {
		var in struct {
			Value string `json:"value"`
		}
		if !readJSON(w, r, 4<<10, &in) {
			return
		}
		value = in.Value
	}
	if value != "" && !dns.ValidAcmeValue(value) {
		writeErr(w, http.StatusBadRequest, "invalid_value")
		return
	}
	if a.DNS == nil {
		writeErr(w, http.StatusServiceUnavailable, "dns_unavailable")
		return
	}
	if err := a.DNS.RemoveTXT(r.Context(), name, value); err != nil {
		a.Log.Warn("acme delete failed", "server", sv.ID, "err", err)
		writeErr(w, http.StatusBadGateway, "dns_unavailable")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
