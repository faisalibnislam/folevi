# Deployment

Production is live (`folevi.com`, `app.folevi.com`; current status in `docs/PRODUCT.md`). These are the
exact steps the account owner follows to set up or rebuild it. Every secret lives in a provider's secret store, never in Git.

## Environments

| Environment | Web | Convex (incl. accounts) | Identity emails | Email provider (Mailtrap) |
| --- | --- | --- | --- | --- |
| Local | `localhost:3000`, `app.localhost:3000` | anonymous local backend; Better Auth runs inside it | captured in the development mailbox (`/dev/mailbox`) | not configured, or the Mailtrap sandbox |
| Preview | Vercel preview URLs | Convex preview deployment per branch | development mailbox if `FOLEVI_DEV_MAILBOX_SECRET` is set | Mailtrap **sandbox** (`MAILTRAP_SANDBOX_*`), or a live token restricted to test addresses (`FOLEVI_ENV=preview`) |
| Production | `folevi.com`, `app.folevi.com` | production deployment | Mailtrap only; no mailbox | Mailtrap Email API, `mail.folevi.com` |

Non-production Convex deployments (`FOLEVI_ENV` ≠ `production`) send either to the Mailtrap Email Sandbox
(captured, never delivered) or only to `@example.com`, `@test.com` or explicitly allowlisted addresses, so
non-production email never reaches real people. Accounts are built in (Better Auth inside Convex, `docs/AUTH_DECISION.md`); there is no separate
identity service to deploy.

## 1. Convex

1. Create a Convex project (`npx convex login`, then `npx convex deploy` once from the repo root to create
   production).
2. Dashboard → Settings → generate a **Production deploy key** and a **Preview deploy key**.
3. Set production environment variables (`npx convex env set --deployment <prod-deployment> NAME value`). The full list with
   descriptions is in `.env.example` (Convex section). Required in production: `FOLEVI_ENV=production`,
   `FOLEVI_APP_URL`, `SITE_URL` (the https app origin, `https://app.folevi.com`; Better Auth runs under
   it and identity-email links point to it), `BETTER_AUTH_SECRET` (at least 32 random bytes, e.g.
   `openssl rand -base64 32`; read "Rotating `BETTER_AUTH_SECRET`" in `docs/AUTH_DECISION.md` before
   ever changing it), `FOLEVI_HASH_SALT`, `FOLEVI_FILE_URL_SECRET`, `FOLEVI_SERVER_SECRET`,
   `MAILTRAP_API_TOKEN` and `MAILTRAP_WEBHOOK_SECRET` (section 4), optionally `EMAIL_REPLY_TO`. Optionally `UNSPLASH_ACCESS_KEY` (an Unsplash developer app's
   access key) turns on Insert → Image from Unsplash: searches run server-side in `convex/unsplash.ts`,
   rate-limited per person, and chosen photos are hotlinked and credited per the Unsplash API
   guidelines. Without it the picker explains that Unsplash isn't set up on this server.
   **Must not be set in production:** `FOLEVI_DEV_MAILBOX_SECRET`, `FOLEVI_AUTH_RATE_LIMIT_SCALE`, and
   `FOLEVI_REQUIRE_VERIFIED_EMAIL=false` (and `MAILTRAP_SANDBOX_*`, which production ignores). `scripts/check-prod-env.mjs`
   reads the Convex environment during the Vercel production build and fails it if any of these is
   wrong or a required variable is missing.
4. Preview deployments: set the same names as project **default environment variables** for previews with
   non-production values (`FOLEVI_ENV=preview`, its own `BETTER_AUTH_SECRET`, `SITE_URL` = the preview
   origin). `FOLEVI_DEV_MAILBOX_SECRET` and `FOLEVI_AUTH_RATE_LIMIT_SCALE` are allowed here, and
   `MAILTRAP_SANDBOX_INBOX_ID` + `MAILTRAP_SANDBOX_TOKEN` route every preview email into a Mailtrap sandbox
   inbox.

Shortcut: with your Convex production deploy key exported as `CONVEX_DEPLOY_KEY`, run
`bash scripts/setup-production-env.sh`. It sets the plain settings, generates the random secrets
(server secret, with the same value in Vercel and Convex; Better Auth secret; hash salt; file-URL secret)
straight into Vercel and Convex without printing them, adds the deploy key to Vercel, and asks for the
Mailtrap sending token and webhook signing secret with hidden input. Existing values are kept unless you pass `--rotate`.

## 2. Vercel

1. Import the GitHub repository. Root directory: `apps/web`. Framework: Next.js. Keep "Include files outside
   the Root Directory" on (the build installs and deploys from the repository root). Vercel deploys only the
   web app (the native macOS app in this monorepo, `apps/macos`, ships through Xcode), and the `ignoreCommand` in
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
- `MAILTRAP_API_TOKEN` is set and `mail.folevi.com` is verified in Mailtrap (section 4); without them
  nobody can confirm an address or reset a password in production.
- Admin → Configuration → Feature flags → `new_signups` controls whether new accounts can be created.
- There is no DNS for identity (no `auth.folevi.com`); sign-in lives at `https://app.folevi.com/signin`.

## 4. Email (Mailtrap)

Follow `docs/EMAIL_OPERATIONS.md` §1: add `mail.folevi.com` as a Mailtrap sending domain, add the exact
records Mailtrap shows at Namecheap (one merged SPF record; keep our DMARC), verify, **turn off open and
click tracking**, create a sending API token and set `MAILTRAP_API_TOKEN` on Convex production, create the
webhook `https://<deployment>.convex.site/webhooks/mailtrap` (delivery, bounces, spam complaint, reject,
suspension) and set `MAILTRAP_WEBHOOK_SECRET`, then send a test. The templates are compiled in the
repository and ship with the Convex deploy; nothing is uploaded to Mailtrap. Mailtrap is the only
provider: the production build fails without `MAILTRAP_API_TOKEN` and warns about any leftover `LOOPS_*`
variable (delete them; EMAIL_OPERATIONS.md §9).

## 5. Payments (Polar)

Optional until paid plans go on sale; without it, upgrades say payments aren't set up (non-production
deployments offer test purchases instead). All variables are server-only, on Convex: `POLAR_ACCESS_TOKEN`,
`POLAR_WEBHOOK_SECRET` and `POLAR_SERVER` (sandbox | production). The 14 products (one per plan, interval
and credit pack) are created from Admin → Billing setup, which records their ids in the database; a
`POLAR_PRODUCT_*` env var per product (`.env.example`, Billing section) still works as a fallback. The webhook endpoint is
`https://<deployment>.convex.site/webhooks/polar`. The full checklist (the 14 products with names, prices
and intervals, the webhook events, the token's scopes, sandbox testing) and the one-time plan migration
command are in `docs/BILLING.md`. Access is granted only by signed webhook events (never by returning
from checkout). Remove any leftover `STRIPE_*` variables: Stripe was never live and its code is gone.

## 6. Account-model migration (done) and clean-up

Production was migrated to the new account model (Personal is not a workspace; workspace plans and seats;
members vs guests) with the runbook in `docs/ACCOUNT_MODEL_PLAN.md` §3a on 2026-09-29; the migration code
has since been removed. The §3b clean-up ran on the same day (`workspaces.kind` deleted,
`subscriptions.ownerType` and `aiUsage.scope` required, one-off migrations removed). `migrations:verifyAccountModel` / `migrations:accountModelReport` stay as an integrity
check any time (`done: true, ok: true`).

## 7. First release checklist

1. `pnpm install && pnpm exec vitest run && pnpm --filter @folevi/web build` locally.
2. Push to `main`; CI (lint, typecheck, unit, Convex, e2e, macOS, secret scan, audit) must pass.
3. Vercel production deploy runs automatically (or promote a verified preview).
4. Verify: `curl -I https://folevi.com` (HSTS, CSP), `https://app.folevi.com/signin` shows Folevi's own
   sign-in page, `https://app.folevi.com/dev/mailbox` returns 404, sign up with a real address →
   confirmation email arrives (Mailtrap; admin Emails log shows it delivered) → onboarding → Welcome
   document; turn on two-step verification in Settings → Security (authenticator + backup codes); sign
   in on a second browser and revoke that session from Settings → Security (it must sign out at once); reset the password by email; `/admin` returns 404 for non-admins; create and revoke a public link; export a page.
5. Bootstrap the first super admin: `npx convex run --deployment <prod-deployment> admin:bootstrapSuperAdmin '{"email":"…"}'`.
   That account needs two-step verification on before `/admin` opens.
6. Recent deployments on the admin dashboard are recorded by CI: the `record-deployment` job in
   `.github/workflows/ci.yml` runs after checks and e2e pass on `main` and calls
   `npx convex run admin:recordDeployment` with the `CONVEX_DEPLOY_KEY` repository secret (the deploy key
   of the deployment `main` ships to; set the `FOLEVI_DEPLOY_ENVIRONMENT` repository variable if it isn't
   `production`). Without the secret the job logs "skipping" and succeeds. To record one by hand:
   `npx convex run --deployment <prod-deployment> admin:recordDeployment '{"environment":"production","commitSha":"…","commitMessage":"…","source":"manual"}'`.

## Mac app distribution

**Not distributed yet.** The app signs in through the browser (Authorization Code + PKCE against
Folevi's own accounts, `docs/AUTH_DECISION.md`). To ship it: set the production values in
`apps/macos/Config/Release.xcconfig`, archive with a Developer ID certificate, notarize
(`xcrun notarytool`), staple, and distribute the DMG. See `docs/MACOS.md`.

## Backups and restore

- Convex keeps automatic backups on paid plans; take manual snapshots before risky migrations (always
  before the account-model migration, section 6):
  `npx convex export --deployment <prod-deployment> --path backups/folevi-$(date +%F).zip` (includes file storage with
  `--include-file-storage`). Restore into a staging deployment with `npx convex import` first.
- Deleted documents are recoverable from Trash for 30 days; blocks from version history.

## Incident basics

1. **Stop the bleeding:** Admin → Configuration → maintenance banner, optionally read-only mode (edits stay
   queued on devices and sync when lifted); feature flags can turn off public links, invites, exports or
   new sign-ups.
2. **Contain access:** suspend affected accounts/workspaces (this also ends their sessions); revoke
   sessions (Admin → user → Revoke all sessions; takes effect on the next backend call); pause new
   sign-ups with the `new_signups` flag; rotate `FOLEVI_SERVER_SECRET`, `FOLEVI_FILE_URL_SECRET`
   (invalidates signed file URLs), `MAILTRAP_API_TOKEN` / `MAILTRAP_WEBHOOK_SECRET` as needed. Do **not** simply replace
   `BETTER_AUTH_SECRET`: it also encrypts every stored TOTP secret (see `docs/AUTH_DECISION.md`,
   "Rotating `BETTER_AUTH_SECRET`").
3. **Investigate:** Convex logs (structured, content-free; identity actions log `identity.*` events),
   Vercel logs, the admin audit log.
4. **Recover:** restore from export into staging, verify, then re-import or repair.
5. **Communicate:** notify affected users by email (security template) and document the timeline.
