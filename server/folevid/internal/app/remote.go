package app

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/faisalibnislam/folevi/server/folevid/internal/config"
	"github.com/faisalibnislam/folevi/server/folevid/internal/connect"
	"github.com/faisalibnislam/folevi/server/folevid/internal/control"
	"github.com/faisalibnislam/folevi/server/folevid/internal/netx"
	"github.com/faisalibnislam/folevi/server/folevid/internal/secrets"
	"github.com/faisalibnislam/folevi/server/folevid/internal/sysinfo"
)

// remoteState is what the remote-access loop knows (not saved; worked out again on start).
type remoteState struct {
	mu          sync.Mutex
	kick        chan struct{}
	mapping     *netx.Mapping
	upnpState   string // off | mapping | mapped | failed
	reachable   *bool
	relay       *connect.Relay
	relayStop   context.CancelFunc
	certTried   time.Time
	linkUntil   time.Time
	announcer   *netx.Announcer
	announceKey string
}

func (r *remoteState) poke() {
	r.mu.Lock()
	if r.kick == nil {
		r.kick = make(chan struct{}, 1)
	}
	ch := r.kick
	r.mu.Unlock()
	select {
	case ch <- struct{}{}:
	default:
	}
}

func (r *remoteState) kickCh() chan struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.kick == nil {
		r.kick = make(chan struct{}, 1)
	}
	return r.kick
}

func (r *remoteState) cleanup() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.relayStop != nil {
		r.relayStop()
		r.relayStop, r.relay = nil, nil
	}
	if r.mapping != nil {
		_ = r.mapping.Remove()
		r.mapping = nil
	}
	if r.announcer != nil {
		r.announcer.Stop()
		r.announcer = nil
	}
}

func (a *App) connectClient() *connect.Client {
	return &connect.Client{
		BaseURL: a.cfg.Get().ConnectURL,
		Token:   func() string { v, _ := a.sec.Get(secrets.ConnectToken); return v },
	}
}

func (a *App) serverName() string {
	if n := a.cfg.Get().Name; n != "" {
		return n
	}
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return "Folevi"
}

// remoteLoop keeps Connect, the certificate, UPnP and the relay in line with what the owner turned on.
func (a *App) remoteLoop(ctx context.Context) {
	tick := time.NewTicker(10 * time.Minute)
	defer tick.Stop()
	kick := a.remote.kickCh()
	a.reconcileRemote(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-kick:
		case <-tick.C:
		}
		a.reconcileRemote(ctx)
	}
}

func (a *App) reconcileRemote(ctx context.Context) {
	c := a.cfg.Get()
	if c.Remote.ConnectEnabled {
		if err := a.connectStep(ctx); err != nil {
			a.log.Warn("folevi connect", "err", a.red.Redact(err.Error()))
		}
	}
	a.upnpStep(ctx)
	a.relayStep(ctx)
	a.reconfigureOrigin(ctx)
}

// connectStep registers, sends addresses, reads the linked state and gets or renews the certificate.
func (a *App) connectStep(ctx context.Context) error {
	cl := a.connectClient()
	tok, _ := a.sec.Get(secrets.ConnectToken)
	if tok == "" || a.cfg.Get().Connect.ServerID == "" {
		key, err := a.sec.ConnectKeyPair()
		if err != nil {
			return err
		}
		pub := base64.StdEncoding.EncodeToString(key.Public().(ed25519.PublicKey))
		reg, err := cl.Register(ctx, a.serverName(), a.version, pub)
		if err != nil {
			return fmt.Errorf("register: %w", err)
		}
		if err := a.sec.Set(secrets.ConnectToken, reg.Token); err != nil {
			return err
		}
		a.red.Add(reg.Token)
		if err := a.cfg.Update(func(c *config.Config) error {
			c.Connect.ServerID = reg.ServerID
			if reg.Hostname != "" {
				c.Connect.Hostname = reg.Hostname
			}
			return nil
		}); err != nil {
			return err
		}
		a.log.Info("registered with folevi connect", "serverId", reg.ServerID)
		// The backend needs FOLEVI_CONNECT_TOKEN for mail, push and AI relays.
		if err := a.ensureDeployed(ctx, false); err != nil {
			a.log.Warn("could not set the connect token in the backend", "err", a.red.Redact(err.Error()))
		}
	}
	id := a.cfg.Get().Connect.ServerID
	var ips []string
	for _, ip := range sysinfo.LANIPs() {
		ips = append(ips, ip.String())
	}
	a.remote.mu.Lock()
	publicPort := 0
	if a.remote.mapping != nil {
		publicPort = a.remote.mapping.ExternalPort
	}
	a.remote.mu.Unlock()
	if err := cl.Update(ctx, id, connect.Patch{Name: a.serverName(), Version: a.version, LANIPs: ips, PublicPort: publicPort}); err != nil {
		return fmt.Errorf("update addresses: %w", err)
	}
	if err := a.refreshConnectState(ctx); err != nil {
		return err
	}
	return a.certStep(ctx)
}

func (a *App) refreshConnectState(ctx context.Context) error {
	id := a.cfg.Get().Connect.ServerID
	if id == "" {
		return nil
	}
	st, err := a.connectClient().State(ctx, id)
	if err != nil {
		return fmt.Errorf("read state: %w", err)
	}
	return a.cfg.Update(func(c *config.Config) error {
		c.Connect.Hostname = st.Hostname
		c.Connect.LANHostnames = st.LANHostnames
		c.Connect.Linked = st.Linked
		c.Connect.OwnerAccount = st.OwnerAccount
		return nil
	})
}

func (a *App) certStep(ctx context.Context) error {
	c := a.cfg.Get()
	host := c.Connect.Hostname
	if host == "" {
		return nil
	}
	store := connect.CertStore{Dir: a.sec.Path(secrets.TLSDir)}
	if !connect.NeedsRenewal(a.cert.Load(), host, time.Now()) {
		return nil
	}
	a.remote.mu.Lock()
	if time.Since(a.remote.certTried) < time.Hour {
		a.remote.mu.Unlock()
		return nil
	}
	a.remote.certTried = time.Now()
	a.remote.mu.Unlock()
	a.log.Info("getting a certificate", "hostname", host)
	err := store.Obtain(connect.ObtainOptions{
		Provider:             &connect.DNSProvider{Client: a.connectClient(), ServerID: c.Connect.ServerID, Hostname: host},
		DirectoryURL:         c.ACMEDirectory,
		SkipPropagationCheck: a.opts.Getenv("FOLEVI_ACME_SKIP_PROPAGATION") == "1",
	})
	if err != nil {
		return fmt.Errorf("certificate: %w", err)
	}
	cert, err := store.Load()
	if err != nil || cert == nil {
		return fmt.Errorf("certificate saved but unreadable: %v", err)
	}
	a.cert.Store(cert)
	a.log.Info("certificate ready", "hostname", host, "expires", cert.Leaf.NotAfter.Format(time.DateOnly))
	if err := a.startHTTPS(); err != nil {
		return fmt.Errorf("https listener: %w", err)
	}
	a.announceAgain()
	return nil
}

// upnpStep maps the HTTPS port on the router when UPnP is on and a certificate exists (plain HTTP is never
// opened to the internet), then asks Connect whether it is reachable.
func (a *App) upnpStep(ctx context.Context) {
	c := a.cfg.Get()
	want := c.Remote.UPnPEnabled && a.httpsRunning()
	a.remote.mu.Lock()
	defer a.remote.mu.Unlock()
	if !want {
		if a.remote.mapping != nil {
			_ = a.remote.mapping.Remove()
			a.remote.mapping = nil
		}
		a.remote.upnpState, a.remote.reachable = "off", nil
		return
	}
	a.remote.upnpState = "mapping"
	lan := sysinfo.PrimaryLANIP()
	var m *netx.Mapping
	var err error
	// Prefer the standard HTTPS port outside, so https://<id>.folevi.app needs no port; fall back to the same port.
	for _, ext := range []int{443, c.HTTPSPort} {
		m, err = netx.MapPort(ctx, lan, c.HTTPSPort, ext, "Folevi", 2*time.Hour)
		if err == nil {
			break
		}
	}
	if err != nil {
		a.remote.upnpState, a.remote.mapping = "failed", nil
		a.log.Info("router port mapping failed", "err", err)
		return
	}
	a.remote.mapping, a.remote.upnpState = m, "mapped"
	if c.Remote.ConnectEnabled && c.Connect.ServerID != "" {
		r, err := a.connectClient().CheckReachable(ctx, c.Connect.ServerID, m.ExternalPort)
		if err == nil {
			a.remote.reachable = &r.Reachable
		}
	}
}

// relayStep runs the relay tunnel when the owner turned it on, Connect is registered and HTTPS is up.
func (a *App) relayStep(ctx context.Context) {
	c := a.cfg.Get()
	tok, _ := a.sec.Get(secrets.ConnectToken)
	want := c.Remote.ConnectEnabled && c.Remote.RelayEnabled && tok != "" && a.httpsRunning()
	a.remote.mu.Lock()
	defer a.remote.mu.Unlock()
	if !want {
		if a.remote.relayStop != nil {
			a.remote.relayStop()
			a.remote.relayStop, a.remote.relay = nil, nil
		}
		return
	}
	if a.remote.relay != nil {
		return
	}
	rctx, cancel := context.WithCancel(ctx)
	r := &connect.Relay{
		URL:    c.RelayURL,
		Token:  func() string { v, _ := a.sec.Get(secrets.ConnectToken); return v },
		Target: net.JoinHostPort("127.0.0.1", strconv.Itoa(c.HTTPSPort)),
		Log:    a.log,
	}
	a.httpsMu.Lock()
	if a.relayLn != nil {
		r.Deliver = a.relayLn.Put
	}
	a.httpsMu.Unlock()
	a.remote.relay, a.remote.relayStop = r, cancel
	go r.Run(rctx)
}

// Remote implements control.Backend.
func (a *App) Remote() control.Remote {
	c := a.cfg.Get()
	var r control.Remote
	r.PublicURL = a.Origin()
	r.CustomDomain = c.Remote.CustomDomain
	tok, _ := a.sec.Get(secrets.ConnectToken)
	switch {
	case !c.Remote.ConnectEnabled || tok == "":
		r.Connect.State = "off"
		if tok != "" {
			r.Connect.State = "registered"
		}
	case c.Connect.Linked:
		r.Connect.State = "linked"
	default:
		r.Connect.State = "registered"
	}
	if r.Connect.State != "off" {
		r.Connect.ServerID = c.Connect.ServerID
		r.Connect.Hostname = c.Connect.Hostname
		r.Connect.LANHostnames = c.Connect.LANHostnames
	}
	a.remote.mu.Lock()
	r.UPnP.State = a.remote.upnpState
	if r.UPnP.State == "" {
		r.UPnP.State = "off"
	}
	if a.remote.mapping != nil {
		r.UPnP.ExternalPort = a.remote.mapping.ExternalPort
	}
	r.Reachable = a.remote.reachable
	r.Relay.Enabled = c.Remote.RelayEnabled
	r.Relay.Connected = a.remote.relay != nil && a.remote.relay.Connected()
	a.remote.mu.Unlock()
	return r
}

// SetRemote implements control.Backend. The work happens in the background loop.
func (a *App) SetRemote(u control.RemoteUpdate) error {
	if u.CustomDomain != nil {
		d := strings.ToLower(strings.TrimSpace(*u.CustomDomain))
		if d != "" && (strings.ContainsAny(d, "/: ") || !strings.Contains(d, ".")) {
			return control.BadRequest("customDomain must be a host name such as notes.example.com")
		}
		u.CustomDomain = &d
	}
	err := a.cfg.Update(func(c *config.Config) error {
		if u.ConnectEnabled != nil {
			c.Remote.ConnectEnabled = *u.ConnectEnabled
		}
		if u.RelayEnabled != nil {
			c.Remote.RelayEnabled = *u.RelayEnabled
		}
		if u.UPnPEnabled != nil {
			c.Remote.UPnPEnabled = *u.UPnPEnabled
		}
		if u.CustomDomain != nil {
			c.Remote.CustomDomain = *u.CustomDomain
		}
		return nil
	})
	if err != nil {
		return control.BadRequest(err.Error())
	}
	a.remote.poke()
	return nil
}

// ConnectLink implements control.Backend.
func (a *App) ConnectLink() (control.Link, error) {
	c := a.cfg.Get()
	tok, _ := a.sec.Get(secrets.ConnectToken)
	if !c.Remote.ConnectEnabled {
		return control.Link{}, control.Conflict("turn on Folevi Connect first")
	}
	if tok == "" || c.Connect.ServerID == "" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		err := a.connectStep(ctx)
		cancel()
		if err != nil && a.cfg.Get().Connect.ServerID == "" {
			return control.Link{}, fmt.Errorf("could not register with Folevi Connect: %s", a.red.Redact(err.Error()))
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	lc, err := a.connectClient().NewLinkCode(ctx, a.cfg.Get().Connect.ServerID)
	if err != nil {
		return control.Link{}, err
	}
	exp := time.Now().Add(10 * time.Minute).UTC()
	if lc.ExpiresAt != nil {
		exp = lc.ExpiresAt.UTC()
	}
	a.remote.mu.Lock()
	start := a.remote.linkUntil.Before(time.Now())
	a.remote.linkUntil = exp
	a.remote.mu.Unlock()
	if start {
		go a.pollLinked()
	}
	return control.Link{Code: lc.Code, ApproveURL: lc.ApproveURL, ExpiresAt: exp}, nil
}

// pollLinked checks every 3 seconds whether the owner approved the code, until it expires.
func (a *App) pollLinked() {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	for {
		a.remote.mu.Lock()
		until := a.remote.linkUntil
		a.remote.mu.Unlock()
		if time.Now().After(until) || ctx.Err() != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}
		rctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := a.refreshConnectState(rctx)
		cancel()
		if err == nil && a.cfg.Get().Connect.Linked {
			a.log.Info("server linked to a folevi account")
			a.remote.mu.Lock()
			a.remote.linkUntil = time.Time{}
			a.remote.mu.Unlock()
			a.remote.poke()
			return
		}
	}
}

// Diagnostics implements control.Backend: redacted status and log tails, uploaded through Connect.
func (a *App) Diagnostics() (string, error) {
	c := a.cfg.Get()
	tok, _ := a.sec.Get(secrets.ConnectToken)
	if tok == "" || c.Connect.ServerID == "" {
		return "", control.Conflict("Folevi Connect is not set up, so diagnostics cannot be sent")
	}
	text := a.DiagnosticsText(300)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	ref, err := a.connectClient().UploadDiagnostics(ctx, text)
	if err != nil {
		var ae *connect.APIError
		if errors.As(err, &ae) && ae.Status == http.StatusUnauthorized {
			return "", control.Conflict("Folevi Connect refused this server's token")
		}
		return "", err
	}
	a.log.Info("diagnostics sent", "reference", ref)
	return ref, nil
}

// DiagnosticsText is the report: status, remote state and the last lines of each log, all redacted.
func (a *App) DiagnosticsText(lines int) string {
	var b strings.Builder
	st, _ := json.MarshalIndent(a.Status(), "", "  ")
	rm, _ := json.MarshalIndent(a.Remote(), "", "  ")
	fmt.Fprintf(&b, "Folevi Server diagnostics\nversion %s, %s\n\n== status\n%s\n\n== remote\n%s\n", a.version,
		time.Now().UTC().Format(time.RFC3339), st, rm)
	for _, svc := range []string{"folevid", "backend", "web"} {
		ls, _ := a.Logs(svc, lines)
		fmt.Fprintf(&b, "\n== %s.log (last %d lines)\n%s\n", svc, len(ls), strings.Join(ls, "\n"))
	}
	return a.red.Redact(b.String())
}

// mdnsLoop announces _folevi._tcp on the public port, and again when the address or name changes.
func (a *App) mdnsLoop(ctx context.Context) {
	if !a.cfg.Get().MDNSOn() {
		return
	}
	a.announceAgain()
	tick := time.NewTicker(5 * time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			a.announceAgain()
		}
	}
}

// announceAgain (re)starts the mDNS responder when its records would change. TXT records follow CONTRACT
// §6.1: id (Connect server id), name, v (version) and url (the https origin, when a certificate exists).
func (a *App) announceAgain() {
	c := a.cfg.Get()
	if !c.MDNSOn() {
		return
	}
	ips := sysinfo.LANIPs()
	txt := []string{"name=" + a.serverName(), "v=" + a.version}
	if c.Connect.ServerID != "" {
		txt = append(txt, "id="+c.Connect.ServerID)
	}
	if o := a.Origin(); strings.HasPrefix(o, "https://") {
		txt = append(txt, "url="+o)
	}
	key := fmt.Sprint(c.Port, ips, txt)
	a.remote.mu.Lock()
	defer a.remote.mu.Unlock()
	if key == a.remote.announceKey && a.remote.announcer != nil {
		return
	}
	if a.remote.announcer != nil {
		a.remote.announcer.Stop()
		a.remote.announcer = nil
	}
	ann, err := netx.Announce(a.serverName(), c.Port, ips, txt)
	if err != nil {
		a.log.Info("mdns announce failed", "err", err)
		return
	}
	a.remote.announcer, a.remote.announceKey = ann, key
}
