# Deployment

Nothing in this repository has been deployed to production by the build process. These are the exact
steps for the account owner. Every secret lives in a provider's secret store — never in Git.

## Environments

| Environment | Web | Convex (incl. accounts) | Identity emails | Loops |
| --- | --- | --- | --- | --- |
| Local | `localhost:3000`, `app.localhost:3000` | anonymous local backend; Better Auth runs inside it | captured in the development mailbox (`/dev/mailbox`) | not configured, or a test team with `@example.com` recipients |
| Preview | Vercel preview URLs | Convex preview deployment per branch | development mailbox if `FOLEVI_DEV_MAILBOX_SECRET` is set; Loops only to allowed test addresses | test team / allowlist (`FOLEVI_ENV=preview`) |
| Production | `folevi.com`, `app.folevi.com` | production deployment | Loops only; no mailbox | production team, `mail.folevi.com` |

Non-production Convex deployments (`FOLEVI_ENV` ≠ `production`) only ever send email to `@example.com`,
`@test.com` or explicitly allowlisted addresses, so non-production identity email never reaches real
people. Accounts are built in (Better Auth inside Convex, `docs/AUTH_DECISION.md`); there is no separate
identity service to deploy.

## 1. Convex

1. Create a Convex project (`npx convex login`, then `npx convex deploy` once from the repo root to create
   production).
2. Dashboard → Settings → generate a **Production deploy key** and a **Preview deploy key**.
3. Set production environment variables (`npx convex env set --prod NAME value`) — the full list with
   descriptions is in `.env.example` (Convex section). Required in production: `FOLEVI_ENV=production`,
   `FOLEVI_APP_URL`, `SITE_URL` (the https app origin, `https://app.folevi.com`; Better Auth runs under
   it and identity-email links point to it), `BETTER_AUTH_SECRET` (at least 32 random bytes, e.g.
   `openssl rand -base64 32`; read "Rotating `BETTER_AUTH_SECRET`" in `docs/AUTH_DECISION.md` before
   ever changing it), `FOLEVI_HASH_SALT`, `FOLEVI_FILE_URL_SECRET`, `FOLEVI_SERVER_SECRET`,
   `LOOPS_API_KEY`, the `LOOPS_TRANSACTIONAL_*_ID` variables named in `packages/email/src/manifest.ts`,
   optionally `LOOPS_WEBHOOK_SECRET`. Optionally `UNSPLASH_ACCESS_KEY` (an Unsplash developer app's
   access key) turns on Insert → Image from Unsplash: searches run server-side in `convex/unsplash.ts`,
   rate-limited per person, and chosen photos are hotlinked and credited per the Unsplash API
   guidelines. Without it the picker explains that Unsplash isn't set up on this server.
   **Must not be set in production:** `FOLEVI_DEV_MAILBOX_SECRET`, `FOLEVI_AUTH_RATE_LIMIT_SCALE`, and
   `FOLEVI_REQUIRE_VERIFIED_EMAIL=false` / `FOLEVI_REQUIRE_MFA=false`. `scripts/check-prod-env.mjs`
   reads the Convex environment during the Vercel production build and fails it if any of these is
   wrong or a required variable is missing.
4. Preview deployments: set the same names as project **default environment variables** for previews with
   non-production values (`FOLEVI_ENV=preview`, its own `BETTER_AUTH_SECRET`, `SITE_URL` = the preview
   origin). `FOLEVI_DEV_MAILBOX_SECRET` and `FOLEVI_AUTH_RATE_LIMIT_SCALE` are allowed here.

Shortcut: with your Convex production deploy key exported as `CONVEX_DEPLOY_KEY`, run
`bash scripts/setup-production-env.sh`. It sets the plain settings, generates the random secrets
(server secret — the same value in Vercel and Convex — Better Auth secret, hash salt, file-URL secret)
straight into Vercel and Convex without printing them, adds the deploy key to Vercel, and asks for the
Loops key with hidden input. Existing values are kept unless you pass `--rotate`.

## 2. Vercel

1. Import the GitHub repository. Root directory: `apps/web`. Framework: Next.js. Keep "Include files outside
   the Root Directory" on (the build installs and deploys from the repository root). Vercel deploys only the
   web app — the native macOS and iOS apps in this monorepo ship through Xcode — and the `ignoreCommand` in
   `apps/web/vercel.json` skips builds for commits that change only them (or docs). `apps/web/vercel.json`
   sets install and build commands; the build runs `scripts/check-prod-env.mjs`, then
   `npx convex deploy --cmd 'pnpm --filter @folevi/web build'`, which deploys the backend first and injects
   `NEXT_PUBLIC_CONVEX_URL` for the matching deployment (preview builds get a per-branch backend).
2. Environment variables (Production and Preview separately; see `.env.example`, Web section):
   `CONVEX_DEPLOY_KEY` (production key for Production only, preview key for Preview only),
   `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_MARKETING_URL`, `FOLEVI_SERVER_SECRET` (the same value as on
   Convex: it signs share-page calls and the visitor IP that sign-in rate limits key on; if the two
   differ, every visitor shares one rate-limit bucket), and
   `NEXT_PUBLIC_CONVEX_SITE_URL` if it can't be derived from the Convex URL (the `/api/auth/*` proxy
   forwards to it). The web app holds no identity secrets: sessions are issued by Better Auth in Convex.
   Never set `FOLEVI_DEV_MAILBOX_SECRET` on the Production environment; the build fails if you do (on
   Preview it only warns).
   No secret may be named `NEXT_PUBLIC_*` (also enforced by the check script).
3. Domains: add `folevi.com` (canonical), `www.folevi.com` (redirects to apex; also handled in
   `vercel.json` and `apps/web/src/proxy.ts`) and `app.folevi.com`. Point DNS as Vercel instructs (apex A/ALIAS,
   `www` and `app` CNAME).
4. Deployment protection for previews is recommended (Vercel Authentication).

## 3. Accounts (Better Auth on Convex)

Nothing to provision outside Convex: the Better Auth component is deployed with the backend
(`convex/convex.config.ts`, `convex/betterAuth/`) and its routes are served by `convex/http.ts`, reached
through the web app's `/api/auth/*` proxy so cookies are first-party on `app.folevi.com`. Checklist:

- `SITE_URL` and `BETTER_AUTH_SECRET` set on the Convex production deployment (above). Store a copy of
  the secret in the team's password manager: losing it makes every stored TOTP secret unreadable.
- The Loops identity templates (`auth_verify_email`, `auth_password_reset`) are published and their ids
  set (section 4); without them nobody can confirm an address or reset a password in production.
- Admin → Configuration → Feature flags → `new_signups` controls whether new accounts can be created.
- There is no DNS for identity (no `auth.folevi.com`); sign-in lives at `https://app.folevi.com/signin`.

## 4. Loops

Follow `docs/EMAIL_OPERATIONS.md`: verify the `mail.folevi.com` sending domain (add the exact MX/TXT/CNAME
records Loops shows), SPF/DKIM alignment, DMARC (`p=none` with reporting, then `quarantine`), import and
**publish** every template from `packages/email/templates` (currently 11, including the two identity
templates), and store each `transactionalId` in the matching Convex env var. Optionally configure the
webhook `https://<deployment>.convex.site/webhooks/loops` and set `LOOPS_WEBHOOK_SECRET`.

## 5. First release checklist

1. `pnpm install && pnpm exec vitest run && pnpm --filter @folevi/web build` locally.
2. Push to `main`; CI (lint, typecheck, unit, Convex, e2e, macOS, secret scan, audit) must pass.
3. Vercel production deploy runs automatically (or promote a verified preview).
4. Verify: `curl -I https://folevi.com` (HSTS, CSP), `https://app.folevi.com/signin` shows Folevi's own
   sign-in page, `https://app.folevi.com/dev/mailbox` returns 404, sign up with a real address →
   confirmation email arrives (Loops) → authenticator setup and backup codes → onboarding → Welcome
   document; sign in on a second browser and revoke that session from Settings → Security (it must sign
   out at once); reset the password by email; `/admin` returns 404 for non-admins; create and revoke a public link; export a page.
5. Bootstrap the first super admin: `npx convex run --prod admin:bootstrapSuperAdmin '{"email":"…"}'`.
6. Recent deployments on the admin dashboard are recorded by CI: the `record-deployment` job in
   `.github/workflows/ci.yml` runs after checks and e2e pass on `main` and calls
   `npx convex run admin:recordDeployment` with the `CONVEX_DEPLOY_KEY` repository secret (the deploy key
   of the deployment `main` ships to; set the `FOLEVI_DEPLOY_ENVIRONMENT` repository variable if it isn't
   `production`). Without the secret the job logs "skipping" and succeeds. To record one by hand:
   `npx convex run --prod admin:recordDeployment '{"environment":"production","commitSha":"…","commitMessage":"…","source":"manual"}'`.

## Mac app distribution

**Not ready to distribute:** the Mac app cannot sign in with Folevi's built-in accounts yet (it still
contains code for the previous identity provider; it will move to Authorization Code + PKCE against
Folevi's own accounts). Once that is done: set the production values in
`apps/macos/Config/Release.xcconfig`, archive with a Developer ID certificate, notarize
(`xcrun notarytool`), staple, and distribute the DMG. See `docs/MACOS.md`.

## Backups and restore

- Convex keeps automatic backups on paid plans; take manual snapshots before risky migrations:
  `npx convex export --prod --path backups/folevi-$(date +%F).zip` (includes file storage with
  `--include-file-storage`). Restore into a staging deployment with `npx convex import` first.
- Deleted documents are recoverable from Trash for 30 days; blocks from version history.

## Incident basics

1. **Stop the bleeding:** Admin → Configuration → maintenance banner, optionally read-only mode (edits stay
   queued on devices and sync when lifted); feature flags can turn off public links, invites, exports or
   new sign-ups.
2. **Contain access:** suspend affected accounts/workspaces (this also ends their sessions); revoke
   sessions (Admin → user → Revoke all sessions — takes effect on the next backend call); pause new
   sign-ups with the `new_signups` flag; rotate `FOLEVI_SERVER_SECRET`, `FOLEVI_FILE_URL_SECRET`
   (invalidates signed file URLs), `LOOPS_API_KEY` as needed. Do **not** simply replace
   `BETTER_AUTH_SECRET`: it also encrypts every stored TOTP secret (see `docs/AUTH_DECISION.md`,
   "Rotating `BETTER_AUTH_SECRET`").
3. **Investigate:** Convex logs (structured, content-free; identity actions log `identity.*` events),
   Vercel logs, the admin audit log.
4. **Recover:** restore from export into staging, verify, then re-import or repair.
5. **Communicate:** notify affected users by email (security template) and document the timeline.
