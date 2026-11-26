package api

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	netmail "net/mail"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"folevi.com/connect/internal/ai"
	"folevi.com/connect/internal/mail"
	"folevi.com/connect/internal/push"
	"folevi.com/connect/internal/relay"
	"folevi.com/connect/internal/store"
)

// ---------------------------------------------------------------- reachability

// ReachPath is what a server answers on its HTTPS port to prove who it is: GET <ReachPath>?nonce=<n> returns
// {"signature": base64(Ed25519 signature of ReachMessage(serverId, n))} made with the key it registered.
const ReachPath = "/.well-known/folevi-connect/reach"

// ReachMessage is the exact bytes a server signs for the reachability check.
func ReachMessage(serverID, nonce string) []byte {
	return []byte("folevi-connect-reach:" + serverID + ":" + nonce)
}

// isPublic reports whether ip is a globally routable unicast address (not private, loopback, link-local or CGNAT).
func isPublic(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() {
		return false
	}
	return !netip.MustParsePrefix("100.64.0.0/10").Contains(ip)
}

// checkReach dials addr with TLS (SNI <id>.<zone>) and asks the server to sign a fresh nonce. The certificate is
// not what proves identity (a new server may not have one yet); the signature is. certValid says whether the
// certificate is also valid for the name.
func (a *API) checkReach(ctx context.Context, addr netip.AddrPort, sv *store.Server) (reachable, certValid bool) {
	host := a.names.Host(sv.ID)
	nonce := base64.RawURLEncoding.EncodeToString(randomBytes(18))
	tlsCfg := &tls.Config{
		ServerName:         host,
		InsecureSkipVerify: true, // identity is checked by the signature below
		MinVersion:         tls.VersionTLS12,
		VerifyConnection: func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return nil
			}
			inter := x509.NewCertPool()
			for _, c := range cs.PeerCertificates[1:] {
				inter.AddCert(c)
			}
			_, err := cs.PeerCertificates[0].Verify(x509.VerifyOptions{DNSName: host, Roots: a.ReachRoots, Intermediates: inter})
			certValid = err == nil
			return nil
		},
	}
	dialer := &net.Dialer{Timeout: a.cfg.ReachTimeout}
	tr := &http.Transport{
		DialTLSContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&tls.Dialer{NetDialer: dialer, Config: tlsCfg}).DialContext(ctx, "tcp", addr.String())
		},
		DisableKeepAlives: true,
	}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: a.cfg.ReachTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://"+host+ReachPath+"?nonce="+url.QueryEscape(nonce), nil)
	if err != nil {
		return false, false
	}
	res, err := client.Do(req)
	if err != nil {
		return false, false
	}
	defer res.Body.Close()
	var body struct {
		Signature string `json:"signature"`
	}
	if res.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(res.Body, 4<<10)).Decode(&body) != nil {
		return false, certValid
	}
	sig, err := base64.StdEncoding.DecodeString(body.Signature)
	if err != nil {
		sig, err = base64.RawURLEncoding.DecodeString(body.Signature)
	}
	if err != nil || len(sv.PublicKey) != ed25519.PublicKeySize {
		return false, certValid
	}
	return ed25519.Verify(ed25519.PublicKey(sv.PublicKey), ReachMessage(sv.ID, nonce), sig), certValid
}

func (a *API) handleReachability(w http.ResponseWriter, r *http.Request, sv *store.Server) {
	if !a.reach.Allow(sv.ID) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	var in struct {
		Port int `json:"port"`
	}
	if !readJSON(w, r, 1<<10, &in) {
		return
	}
	if in.Port < 1 || in.Port > 65535 {
		writeErr(w, http.StatusBadRequest, "invalid_port")
		return
	}
	ip := a.clientIP(r)
	reachable, certValid := false, false
	// Only ever dial the caller's own address, and never into a private network (unless testing).
	if ip.IsValid() && (isPublic(ip) || a.cfg.ReachAllowPrivate) {
		ctx, cancel := context.WithTimeout(r.Context(), a.cfg.ReachTimeout+2*time.Second)
		reachable, certValid = a.checkReach(ctx, netip.AddrPortFrom(ip, uint16(in.Port)), sv)
		cancel()
	}
	sv.Reachable = &reachable
	sv.PublicIP = ip.String()
	sv.PublicPort = in.Port
	sv.CheckedAt = a.Now().UTC()
	if err := a.Store.UpdateServer(r.Context(), sv); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := a.syncDNS(r.Context(), sv, nil); err != nil {
		a.Log.Warn("dns sync failed", "server", sv.ID, "err", err)
	}
	a.Log.Info("reachability", "server", sv.ID, "reachable", reachable, "certValid", certValid)
	writeJSON(w, http.StatusOK, map[string]any{"reachable": reachable, "publicIp": ip.String(), "certificateValid": certValid})
}

// ---------------------------------------------------------------- mail

var tagRe = regexp.MustCompile(`^[a-z0-9_-]{1,40}$`)

func parseAddress(s string) (string, bool) {
	if s == "" || len(s) > 254 || strings.ContainsAny(s, "\r\n") {
		return "", false
	}
	addr, err := netmail.ParseAddress(s)
	if err != nil || !strings.Contains(addr.Address, "@") {
		return "", false
	}
	return addr.Address, true
}

func (a *API) handleMail(w http.ResponseWriter, r *http.Request, sv *store.Server) {
	if a.cfg.MailDisabled || sv.Flags.MailDisabled {
		writeErr(w, http.StatusForbidden, "mail_disabled")
		return
	}
	if a.cfg.MailRequireLinked && sv.OwnerAccount == "" {
		writeErr(w, http.StatusForbidden, "not_linked")
		return
	}
	if a.Mail == nil {
		writeErr(w, http.StatusServiceUnavailable, "mail_unavailable")
		return
	}
	var in struct {
		To      string `json:"to"`
		Subject string `json:"subject"`
		HTML    string `json:"html"`
		Text    string `json:"text"`
		ReplyTo string `json:"replyTo"`
		Tag     string `json:"tag"`
	}
	if !readJSON(w, r, 512<<10, &in) {
		return
	}
	to, ok := parseAddress(in.To)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid_to")
		return
	}
	if in.Subject == "" || len(in.Subject) > 200 || strings.ContainsAny(in.Subject, "\r\n") {
		writeErr(w, http.StatusBadRequest, "invalid_subject")
		return
	}
	if in.HTML == "" && in.Text == "" {
		writeErr(w, http.StatusBadRequest, "empty_body")
		return
	}
	replyTo := ""
	if in.ReplyTo != "" {
		if replyTo, ok = parseAddress(in.ReplyTo); !ok {
			writeErr(w, http.StatusBadRequest, "invalid_reply_to")
			return
		}
	}
	if in.Tag == "" {
		in.Tag = "general"
	}
	if !tagRe.MatchString(in.Tag) {
		writeErr(w, http.StatusBadRequest, "invalid_tag")
		return
	}
	lower := strings.ToLower(to)
	sum := sha256.Sum256([]byte(lower))
	rcpt := hex.EncodeToString(sum[:])
	now := a.Now().UTC()
	entry := store.MailLog{ID: "m_" + hex.EncodeToString(randomBytes(10)), ServerID: sv.ID, At: now, RecipientHash: rcpt,
		RecipientDomain: lower[strings.LastIndex(lower, "@")+1:], Tag: in.Tag}
	limited := func(code string) {
		entry.Status, entry.Error = "limited", code
		_ = a.Store.AppendMailLog(r.Context(), entry)
		a.Log.Warn("mail limited", "server", sv.ID, "limit", code)
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate_limited", "limit": code})
	}
	// The hourly and daily caps are the owner's, shared by every server linked to that account.
	account := accountKey(sv)
	if !a.mailHour.Allow(account) {
		limited("server_hourly")
		return
	}
	if !a.rcptHour.Allow(rcpt) || !a.rcptDay.Allow(rcpt) {
		limited("recipient")
		return
	}
	if n, err := a.Store.AddUsage(r.Context(), account, "mail", store.Day(now), 1); err != nil || (a.cfg.MailPerServerDaily > 0 && n > int64(a.cfg.MailPerServerDaily)) {
		limited("server_daily")
		return
	}
	if n, err := a.Store.AddUsage(r.Context(), "_all", "mail", store.Day(now), 1); err != nil || (a.cfg.MailGlobalDaily > 0 && n > int64(a.cfg.MailGlobalDaily)) {
		limited("global_daily")
		return
	}
	id, err := a.Mail.Send(r.Context(), mail.Message{From: mail.FromHeader(sv.Name, a.cfg.MailFromAddress), To: to, ReplyTo: replyTo,
		Subject: in.Subject, HTML: in.HTML, Text: in.Text, Tag: in.Tag})
	if err != nil {
		entry.Status, entry.Error = "failed", "provider"
		if errors.Is(err, mail.ErrBusy) {
			entry.Error = "provider_busy"
		}
		_ = a.Store.AppendMailLog(r.Context(), entry)
		a.Log.Warn("mail failed", "server", sv.ID, "err", err)
		if errors.Is(err, mail.ErrBusy) {
			writeErr(w, http.StatusServiceUnavailable, "provider_busy")
		} else {
			writeErr(w, http.StatusBadGateway, "provider_refused")
		}
		return
	}
	entry.Status, entry.ProviderID = "sent", id
	if err := a.Store.AppendMailLog(r.Context(), entry); err != nil {
		a.Log.Error("mail log failed", "server", sv.ID, "err", err)
	}
	a.Log.Info("mail sent", "server", sv.ID, "tag", in.Tag, "id", entry.ID)
	writeJSON(w, http.StatusAccepted, map[string]string{"id": entry.ID})
}

// ---------------------------------------------------------------- push

func (a *API) handlePush(w http.ResponseWriter, r *http.Request, sv *store.Server) {
	if sv.Flags.PushDisabled {
		writeErr(w, http.StatusForbidden, "push_disabled")
		return
	}
	var n push.Notification
	if !readJSON(w, r, 16<<10, &n) {
		return
	}
	if err := push.Validate(&n); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_notification", "field": err.Error()})
		return
	}
	if !a.pushHour.Allow(sv.ID) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	sender := a.APNs
	if n.Platform == "fcm" {
		sender = a.FCM
	}
	if sender == nil {
		writeErr(w, http.StatusServiceUnavailable, "push_unavailable")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	res := sender.Send(ctx, n)
	a.Log.Info("push", "server", sv.ID, "platform", n.Platform, "outcome", string(res.Outcome), "reason", res.Reason)
	switch res.Outcome {
	case push.Sent:
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "sent"})
	case push.Gone:
		writeJSON(w, http.StatusGone, map[string]string{"error": "token_gone", "reason": res.Reason})
	case push.Busy:
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provider_busy", "reason": res.Reason})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "provider_refused", "reason": res.Reason})
	}
}

// ---------------------------------------------------------------- AI

func (a *API) handleAI(kind ai.Kind) func(http.ResponseWriter, *http.Request, *store.Server) {
	return func(w http.ResponseWriter, r *http.Request, sv *store.Server) {
		if a.AI == nil || sv.Flags.AIDisabled {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": map[string]string{"message": "Folevi AI is off for this server.", "type": "permission_error", "code": "ai_disabled"}})
			return
		}
		if a.cfg.AIRequireLinked && sv.OwnerAccount == "" {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": map[string]string{"message": "Link this server to a Folevi account to use Folevi AI.", "type": "permission_error", "code": "not_linked"}})
			return
		}
		if !a.aiMinute.Allow(accountKey(sv)) {
			writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": map[string]string{"message": "Too many requests.", "type": "rate_limit_error", "code": "rate_limited"}})
			return
		}
		a.AI.Handle(w, r, kind, sv.ID, sv.OwnerAccount)
	}
}

// ---------------------------------------------------------------- Unsplash

var unsplashPathRe = regexp.MustCompile(`^(search/photos|photos/random|photos/[A-Za-z0-9_-]{1,64}(/download)?)$`)

func (a *API) handleUnsplash(w http.ResponseWriter, r *http.Request, sv *store.Server) {
	if a.cfg.UnsplashAccessKey == "" {
		writeErr(w, http.StatusServiceUnavailable, "unsplash_unavailable")
		return
	}
	path := r.PathValue("path")
	if !unsplashPathRe.MatchString(path) {
		writeErr(w, http.StatusNotFound, "not_found")
		return
	}
	if !a.unsplashHr.Allow(sv.ID) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	q := r.URL.Query()
	q.Del("client_id")
	target := strings.TrimRight(a.cfg.UnsplashBaseURL, "/") + "/" + path
	if enc := q.Encode(); enc != "" {
		target += "?" + enc
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request")
		return
	}
	req.Header.Set("Authorization", "Client-ID "+a.cfg.UnsplashAccessKey)
	req.Header.Set("Accept-Version", "v1")
	res, err := a.HTTP.Do(req)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "unsplash_unreachable")
		return
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		writeErr(w, http.StatusBadGateway, "unsplash_unreachable")
		return
	}
	w.Header().Set("Content-Type", res.Header.Get("Content-Type"))
	for _, h := range []string{"X-Total", "X-Total-Pages", "Link"} {
		if v := res.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	w.WriteHeader(res.StatusCode)
	_, _ = w.Write(body)
}

// ---------------------------------------------------------------- diagnostics

const refAlphabet = "ABCDEFGHJKMNPQRSTVWXYZ0123456789"

func newReference() string {
	b := randomBytes(8)
	out := []byte("FD-")
	for _, v := range b {
		out = append(out, refAlphabet[int(v)%len(refAlphabet)])
	}
	return string(out)
}

func (a *API) handleDiagnostics(w http.ResponseWriter, r *http.Request, sv *store.Server) {
	var in struct {
		Text string `json:"text"`
	}
	// JSON escaping can grow the text; allow some room over the limit for the envelope.
	if !readJSON(w, r, a.cfg.DiagMaxBytes*2+1024, &in) {
		return
	}
	if in.Text == "" || int64(len(in.Text)) > a.cfg.DiagMaxBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "too_large")
		return
	}
	now := a.Now().UTC()
	if n, err := a.Store.AddUsage(r.Context(), sv.ID, "diagnostics", store.Day(now), 1); err != nil || (a.cfg.DiagPerServerDaily > 0 && n > int64(a.cfg.DiagPerServerDaily)) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	_ = a.Store.DeleteDiagnosticsBefore(r.Context(), now.Add(-a.cfg.DiagRetention))
	ref := newReference()
	if err := a.Store.PutDiagnostic(r.Context(), store.Diagnostic{Reference: ref, ServerID: sv.ID, CreatedAt: now, Text: in.Text}); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	a.Log.Info("diagnostics stored", "server", sv.ID, "reference", ref, "bytes", len(in.Text))
	writeJSON(w, http.StatusCreated, map[string]string{"reference": ref})
}

// ---------------------------------------------------------------- admin (Folevi operations)

func (a *API) adminServer(w http.ResponseWriter, r *http.Request) *store.Server {
	sv, err := a.Store.GetServer(r.Context(), r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found")
		return nil
	}
	setServer(r, sv.ID)
	return sv
}

func (a *API) handleAdminServer(w http.ResponseWriter, r *http.Request) {
	sv := a.adminServer(w, r)
	if sv == nil {
		return
	}
	now := a.Now()
	usage := map[string]int64{}
	for kind, period := range map[string]string{ai.UsageKind: store.Month(now), relay.UsageKind: store.Month(now), "mail": store.Day(now), "diagnostics": store.Day(now)} {
		// AI tokens and mail are counted for the owner's account (all of its servers together).
		key := sv.ID
		if kind == ai.UsageKind || kind == "mail" {
			key = accountKey(sv)
		}
		usage[kind], _ = a.Store.GetUsage(r.Context(), key, kind, period)
	}
	writeJSON(w, http.StatusOK, map[string]any{"server": a.view(sv), "flags": sv.Flags, "usage": usage, "createdAt": sv.CreatedAt.Format(time.RFC3339)})
}

func (a *API) handleAdminFlags(w http.ResponseWriter, r *http.Request) {
	sv := a.adminServer(w, r)
	if sv == nil {
		return
	}
	var in struct {
		Suspended, MailDisabled, PushDisabled, AIDisabled, RelayDisabled *bool
	}
	if !readJSON(w, r, 4<<10, &in) {
		return
	}
	set := func(dst *bool, v *bool) {
		if v != nil {
			*dst = *v
		}
	}
	set(&sv.Flags.Suspended, in.Suspended)
	set(&sv.Flags.MailDisabled, in.MailDisabled)
	set(&sv.Flags.PushDisabled, in.PushDisabled)
	set(&sv.Flags.AIDisabled, in.AIDisabled)
	set(&sv.Flags.RelayDisabled, in.RelayDisabled)
	if err := a.Store.UpdateServer(r.Context(), sv); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	if (sv.Flags.Suspended || sv.Flags.RelayDisabled) && a.Relay != nil {
		a.Relay.Disconnect(sv.ID)
	}
	a.Log.Warn("server flags changed", "server", sv.ID, "flags", sv.Flags)
	writeJSON(w, http.StatusOK, sv.Flags)
}

func (a *API) handleAdminMailLog(w http.ResponseWriter, r *http.Request) {
	sv := a.adminServer(w, r)
	if sv == nil {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := a.Store.ListMailLog(r.Context(), sv.ID, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, l := range rows {
		out = append(out, map[string]any{"id": l.ID, "at": l.At.Format(time.RFC3339), "recipientHash": l.RecipientHash, "recipientDomain": l.RecipientDomain,
			"tag": l.Tag, "status": l.Status, "providerId": l.ProviderID, "error": l.Error})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) handleAdminDiagnostic(w http.ResponseWriter, r *http.Request) {
	d, err := a.Store.GetDiagnostic(r.Context(), r.PathValue("ref"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Folevi-Server", d.ServerID)
	_, _ = io.WriteString(w, d.Text)
}

// TunnelAuth is the relay's token check: the server must exist, not be suspended, and may use the relay.
func (a *API) TunnelAuth(ctx context.Context, token string) (string, error) {
	if token == "" {
		return "", errors.New("no token")
	}
	sv, err := a.Store.GetServerByTokenHash(ctx, hashToken(token))
	if err != nil {
		return "", err
	}
	if sv.Flags.Suspended || sv.Flags.RelayDisabled {
		return "", errors.New("relay not allowed")
	}
	return sv.ID, nil
}

// RelayAllowed is the relay's per-connection kill switch check.
func (a *API) RelayAllowed(id string) bool {
	sv, err := a.Store.GetServer(context.Background(), id)
	return err == nil && !sv.Flags.Suspended && !sv.Flags.RelayDisabled
}
