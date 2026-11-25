// Command connect runs Folevi Connect: the registry, DNS, relays and gateways self-hosted Folevi servers use.
// Configuration comes from the environment (README.md lists every variable).
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"golang.org/x/crypto/acme/autocert"

	"folevi.com/connect/internal/ai"
	"folevi.com/connect/internal/api"
	"folevi.com/connect/internal/config"
	"folevi.com/connect/internal/dns"
	"folevi.com/connect/internal/mail"
	"folevi.com/connect/internal/push"
	"folevi.com/connect/internal/relay"
	"folevi.com/connect/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("connect stopped", "err", err)
		os.Exit(1)
	}
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	if err := l.UnmarshalText([]byte(level)); err != nil {
		l = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}

func run() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		slog.Error("bad configuration", "err", err)
		os.Exit(2)
	}
	log := newLogger(cfg.LogLevel)
	slog.SetDefault(log)

	st, err := store.OpenSQLite(cfg.DBPath)
	if err != nil {
		return err
	}
	defer st.Close()

	deps := api.Deps{Config: cfg, Store: st, Log: log}

	switch cfg.DNSProvider {
	case "cloudflare":
		deps.DNS = &dns.Manager{Provider: dns.NewCloudflare(cfg.CloudflareZoneID, cfg.CloudflareToken), Names: dns.Names{Zone: cfg.Zone}, TTL: cfg.DNSTTL}
	default:
		log.Warn("DNS provider is the in-memory fake; nothing is published")
		deps.DNS = &dns.Manager{Provider: dns.NewMemory(), Names: dns.Names{Zone: cfg.Zone}, TTL: cfg.DNSTTL}
	}

	if cfg.ResendAPIKey != "" {
		rs := mail.NewResend(cfg.ResendAPIKey)
		rs.BaseURL = cfg.ResendBaseURL
		deps.Mail = rs
	} else {
		log.Warn("RESEND_API_KEY is not set; /v1/mail answers 503")
	}

	if cfg.APNsKey != "" && cfg.APNsKeyID != "" && cfg.APNsTeamID != "" {
		key, err := push.ParseP8(cfg.APNsKey)
		if err != nil {
			return err
		}
		deps.APNs = push.NewAPNs(cfg.APNsKeyID, cfg.APNsTeamID, cfg.APNsBundleID, key)
	} else {
		log.Warn("APNs is not configured; apns pushes answer 503")
	}
	if len(cfg.FCMServiceAccount) > 0 {
		f, err := push.NewFCM(cfg.FCMServiceAccount, cfg.FCMProjectID)
		if err != nil {
			return err
		}
		deps.FCM = f
	} else {
		log.Warn("FCM is not configured; fcm pushes answer 503")
	}

	allowed := map[string]bool{}
	for _, m := range cfg.AIAllowedModels {
		allowed[m] = true
	}
	deps.AI = &ai.Gateway{BaseURL: cfg.AIBaseURL, APIKey: cfg.GeminiAPIKey, ChatModel: cfg.AIChatModel, EmbeddingModel: cfg.AIEmbeddingModel,
		AllowedModels: allowed, Client: &http.Client{Timeout: 5 * time.Minute}, Usage: st, Limits: ai.StaticLimits{Tokens: cfg.AIMonthlyTokens},
		MaxRequestBytes: cfg.AIMaxRequestBytes}

	var a *api.API
	rl := relay.New(relay.Config{
		BytesPerSecond: cfg.RelayBytesPerSecond, MonthlyBytes: cfg.RelayMonthlyBytes, MaxStreams: cfg.RelayMaxStreams, MaxConns: cfg.RelayMaxConns,
		IdleTimeout: cfg.RelayIdleTimeout, LocalHosts: cfg.LocalHostnames, AcceptProxyHeader: cfg.RelayProxyProtocol,
	}, dns.Names{Zone: cfg.Zone}, func(ctx context.Context, token string) (string, error) { return a.TunnelAuth(ctx, token) }, st, log)
	rl.Allowed = func(id string) bool { return a.RelayAllowed(id) }
	rl.OnTunnel = func(id string, connected bool) {
		now := time.Now()
		_ = st.TouchServer(context.Background(), id, now, now)
		if connected {
			rl.LoadTotal(context.Background(), id, now)
		}
	}
	deps.Relay = rl
	a = api.New(deps)
	handler := a.Handler()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errc := make(chan error, 3)

	httpSrv := &http.Server{Addr: cfg.HTTPAddr, Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	go func() {
		log.Info("http listening", "addr", cfg.HTTPAddr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- err
		}
	}()

	var localSrv *http.Server
	var relayLn net.Listener
	if cfg.RelayAddr != "" {
		relayLn, err = net.Listen("tcp", cfg.RelayAddr)
		if err != nil {
			return err
		}
		tlsCfg, err := localTLS(cfg)
		if err != nil {
			return err
		}
		if tlsCfg != nil {
			rl.Local = relay.NewChanListener(relayLn.Addr())
			localSrv = &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
			go func() {
				if err := localSrv.Serve(tls.NewListener(rl.Local, tlsCfg)); err != nil && !errors.Is(err, http.ErrServerClosed) {
					errc <- err
				}
			}()
		} else {
			log.Warn("no TLS for the local names; " + strings.Join(cfg.LocalHostnames, ",") + " on the relay port are closed")
		}
		go func() {
			log.Info("relay listening", "addr", cfg.RelayAddr)
			if err := rl.Serve(relayLn); err != nil {
				errc <- err
			}
		}()
	}

	// Background: flush relay usage, mark connected tunnels as seen, sweep expired link codes.
	go func() {
		t := time.NewTicker(10 * time.Second)
		defer t.Stop()
		n := 0
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-t.C:
				rl.Flush(ctx, now)
				n++
				if n%6 == 0 {
					_ = st.DeleteExpiredLinkCodes(ctx, now)
				}
			}
		}
	}()

	select {
	case <-ctx.Done():
		log.Info("shutting down")
	case err := <-errc:
		log.Error("listener failed", "err", err)
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if relayLn != nil {
		_ = relayLn.Close()
	}
	_ = httpSrv.Shutdown(shutdownCtx)
	if localSrv != nil {
		_ = localSrv.Shutdown(shutdownCtx)
		_ = rl.Local.Close()
	}
	rl.Close(shutdownCtx)
	rl.Flush(context.Background(), time.Now())
	return nil
}

// localTLS is the certificate for Connect's own names on the relay port: files, or Let's Encrypt (TLS-ALPN-01).
func localTLS(cfg *config.Config) (*tls.Config, error) {
	if cfg.TLSCertFile != "" {
		cert, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
		if err != nil {
			return nil, err
		}
		return &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12, NextProtos: []string{"h2", "http/1.1"}}, nil
	}
	if cfg.ACMEEmail != "" {
		m := &autocert.Manager{Prompt: autocert.AcceptTOS, Email: cfg.ACMEEmail, HostPolicy: autocert.HostWhitelist(cfg.LocalHostnames...), Cache: autocert.DirCache(cfg.ACMECacheDir)}
		c := m.TLSConfig()
		c.MinVersion = tls.VersionTLS12
		return c, nil
	}
	return nil, nil
}
