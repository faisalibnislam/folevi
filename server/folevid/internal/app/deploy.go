package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/faisalibnislam/folevi/server/folevid/internal/config"
	"github.com/faisalibnislam/folevi/server/folevid/internal/convex"
	"github.com/faisalibnislam/folevi/server/folevid/internal/secrets"
)

// convexEnv is the Convex environment from CONTRACT §4, without FOLEVI_JWKS (handled after the deploy).
func (a *App) convexEnv() (map[string]string, error) {
	get := func(name string) (string, error) { return a.sec.MustGet(name) }
	env := map[string]string{
		"FOLEVI_EDITION":        "server",
		"FOLEVI_ENV":            "production",
		"SITE_URL":              a.Origin(),
		"FOLEVI_APP_URL":        a.Origin(),
		"FOLEVI_SERVER_VERSION": a.version,
		"FOLEVI_CONNECT_URL":    a.cfg.Get().ConnectURL,
		"VAPID_SUBJECT":         "mailto:no-reply@folevi.app",
	}
	for envName, secret := range map[string]string{
		"BETTER_AUTH_SECRET":     secrets.BetterAuthSecret,
		"FOLEVI_HASH_SALT":       secrets.HashSalt,
		"FOLEVI_FILE_URL_SECRET": secrets.FileURLSecret,
		"FOLEVI_SERVER_SECRET":   secrets.ServerSecret,
		"VAPID_PUBLIC_KEY":       secrets.VapidPublic,
		"VAPID_PRIVATE_KEY":      secrets.VapidPrivate,
	} {
		v, err := get(secret)
		if err != nil {
			return nil, err
		}
		env[envName] = v
	}
	setup, err := get(secrets.SetupToken)
	if err != nil {
		return nil, err
	}
	env["FOLEVI_SETUP_TOKEN_HASH"] = secrets.SHA256Hex(setup)
	if tok, _ := a.sec.Get(secrets.ConnectToken); tok != "" {
		env["FOLEVI_CONNECT_TOKEN"] = tok
	}
	return env, nil
}

// EnvHash hashes an environment map (the values never leave this process).
func EnvHash(env map[string]string) string {
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	h := sha256.New()
	for _, k := range keys {
		fmt.Fprintf(h, "%s=%s\x00", k, env[k])
	}
	return hex.EncodeToString(h.Sum(nil))
}

func (a *App) cli() *convex.CLI {
	c := a.cfg.Get()
	key, _ := a.sec.Get(secrets.AdminKey)
	return &convex.CLI{
		Node:         a.nodeExec,
		FunctionsDir: a.bundle.Path("functions"),
		URL:          a.internalURL(c.Internal.BackendPort),
		AdminKey:     key,
		Env:          []string{"PATH=" + a.pathWithNode(), "TMPDIR=" + a.tmpDir, "HOME=" + a.tmpDir},
		Output:       a.childOutput("folevid"),
	}
}

// nodeExec adapts Bundle.Wrap to convex.Exec (the CLI asks for "node").
func (a *App) nodeExec(program string, args ...string) (string, []string) {
	if program == "node" {
		program = a.bundle.Node()
	}
	return a.bundle.Wrap(program, args...)
}

// ensureDeployed sets the Convex environment and deploys the functions when needed:
//   - a different bundle version, functions or public origin, or force: set env, deploy, then set FOLEVI_JWKS
//     from the backend's own keys and deploy again if it changed (the auth config reads it at deploy time);
//   - only the environment changed (for example a new Connect token): set env, no deploy.
func (a *App) ensureDeployed(ctx context.Context, force bool) error {
	a.deployMu.Lock()
	defer a.deployMu.Unlock()
	env, err := a.convexEnv()
	if err != nil {
		return err
	}
	envHash := EnvHash(env)
	fnHash := a.bundle.FunctionsHash()
	origin := a.Origin()
	prev := a.cfg.Get().Deployed
	cli := a.cli()

	codeSame := prev.Version == a.version && prev.FunctionsHash == fnHash && prev.Origin == origin
	if codeSame && !force {
		// Make sure the backend really has it (a restore or a new database would not).
		cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
		live, err := a.conv.GetEnv(cctx, "FOLEVI_SERVER_VERSION")
		cancel()
		if err == nil && live == a.version {
			if prev.EnvHash == envHash {
				a.log.Info("functions already deployed", "version", a.version)
				return nil
			}
			if err := a.conv.SetEnv(ctx, env); err != nil {
				return fmt.Errorf("set env: %w", err)
			}
			a.log.Info("environment updated")
			return a.saveDeployed(fnHash, envHash, origin)
		}
	}

	a.log.Info("deploying functions", "version", a.version)
	start := time.Now()
	if err := a.conv.SetEnv(ctx, env); err != nil {
		return fmt.Errorf("set env: %w", err)
	}
	// The Convex CLI refuses to push an auth config that reads an unset variable, and the keys only exist
	// after the first deploy. A blank FOLEVI_JWKS means "none" to convex/lib/jwks.ts, so start with that.
	if cur, err := a.conv.GetEnv(ctx, "FOLEVI_JWKS"); err == nil && cur == "" {
		if err := a.conv.SetEnv(ctx, map[string]string{"FOLEVI_JWKS": " "}); err != nil {
			return fmt.Errorf("set FOLEVI_JWKS placeholder: %w", err)
		}
	}
	if err := cli.Deploy(ctx); err != nil {
		return fmt.Errorf("deploy: %w", err)
	}
	site := a.internalURL(a.cfg.Get().Internal.SitePort)
	var jwks string
	for i := 0; i < 10 && ctx.Err() == nil; i++ {
		jctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		jwks, err = convex.FetchJWKS(jctx, site)
		cancel()
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		a.log.Warn("could not read the JWKS; FOLEVI_JWKS stays as it was", "err", err)
	} else {
		cur, _ := a.conv.GetEnv(ctx, "FOLEVI_JWKS")
		if strings.TrimSpace(cur) != jwks {
			if err := a.conv.SetEnv(ctx, map[string]string{"FOLEVI_JWKS": jwks}); err != nil {
				return fmt.Errorf("set FOLEVI_JWKS: %w", err)
			}
			a.log.Info("FOLEVI_JWKS set, deploying again so the auth config uses it")
			if err := cli.Deploy(ctx); err != nil {
				return fmt.Errorf("deploy with JWKS: %w", err)
			}
		}
	}
	a.log.Info("deployed", "version", a.version, "seconds", time.Since(start).Round(100*time.Millisecond).Seconds())
	return a.saveDeployed(fnHash, envHash, origin)
}

func (a *App) saveDeployed(fnHash, envHash, origin string) error {
	return a.cfg.Update(func(c *config.Config) error {
		c.Deployed = config.Deployed{Version: a.version, FunctionsHash: fnHash, EnvHash: envHash, Origin: origin}
		return nil
	})
}

// snapshotter exports and imports through the Convex CLI.
type cliSnap struct{ a *App }

func (a *App) snapshotter() cliSnap { return cliSnap{a} }

func (s cliSnap) Export(ctx context.Context, path string) error {
	cli := s.a.cli()
	return cli.Export(ctx, path)
}

func (s cliSnap) Import(ctx context.Context, path string) error {
	cli := s.a.cli()
	return cli.Import(ctx, path)
}

// portableSecrets are the secrets the data depends on; they travel inside backups.
var portable = []string{secrets.HashSalt, secrets.BetterAuthSecret, secrets.FileURLSecret}

func (a *App) portableSecrets() map[string]string {
	out := map[string]string{}
	for _, n := range portable {
		if v, _ := a.sec.Get(n); v != "" {
			out[n] = v
		}
	}
	return out
}

func (a *App) restorePortableSecrets(m map[string]string) error {
	for _, n := range portable {
		if v := strings.TrimSpace(m[n]); v != "" {
			if cur, _ := a.sec.Get(n); cur != v {
				if err := a.sec.Set(n, v); err != nil {
					return err
				}
			}
		}
	}
	a.red.Set(a.sec.Values())
	return nil
}
