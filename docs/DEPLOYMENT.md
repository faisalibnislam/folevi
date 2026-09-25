# Deployment

Nothing in this repository has been deployed to production by the build process. These are the exact
steps for the account owner. Every secret lives in a provider's secret store — never in Git.

## Environments

| Environment | Web | Convex | Auth0 | Loops |
| --- | --- | --- | --- | --- |
| Local | `localhost:3000`, `app.localhost:3000` | anonymous local backend | optional dev tenant; otherwise dev identity | not configured, or a test team with `@example.com` recipients |
| Preview | Vercel preview URLs | Convex preview deployment per branch | dev/staging tenant | test team / allowlist (`FOLEVI_ENV=preview`) |
| Production | `folevi.com`, `app.folevi.com` | production deployment | production tenant, `auth.folevi.com` | production team, `mail.folevi.com` |

Non-production Convex deployments (`FOLEVI_ENV` ≠ `production`) only ever send email to `@example.com`,
`@test.com` or explicitly allowlisted addresses.

## 1. Convex

1. Create a Convex project (`npx convex login`, then `npx convex deploy` once from the repo root to create
   production).
2. Dashboard → Settings → generate a **Production deploy key** and a **Preview deploy key**.
3. Set production environment variables (`npx convex env set --prod NAME value`) — the full list with
   descriptions is in `.env.example` (Convex section). Required in production: `FOLEVI_ENV=production`,
   `FOLEVI_APP_URL`, `FOLEVI_HASH_SALT`, `FOLEVI_FILE_URL_SECRET`, `FOLEVI_SERVER_SECRET`,
   `FOLEVI_DEV_AUTH_JWKS=none`, `FOLEVI_DEV_AUTH_ISSUER=none`, `AUTH0_DOMAIN`, `AUTH0_WEB_CLIENT_ID`,
   `AUTH0_MAC_CLIENT_ID`, `AUTH0_MGMT_*`, `AUTH0_DB_CONNECTION`, `LOOPS_API_KEY`,
   `LOOPS_TRANSACTIONAL_*_ID` (13), optionally `LOOPS_WEBHOOK_SECRET`.
   Convex requires every variable referenced by `convex/auth.config.ts` to exist, so unused ones are set
   to the literal `none`.
4. Preview deployments: set the same names as project **default environment variables** for previews with
   non-production values (`FOLEVI_ENV=preview`).

## 2. Vercel

1. Import the GitHub repository. Root directory: `apps/web`. Framework: Next.js. `apps/web/vercel.json`
   sets install and build commands; the build runs `scripts/check-prod-env.mjs`, then
   `npx convex deploy --cmd 'pnpm --filter @folevi/web build'`, which deploys the backend first and injects
   `NEXT_PUBLIC_CONVEX_URL` for the matching deployment (preview builds get a per-branch backend).
2. Environment variables (Production and Preview separately; see `.env.example`, Web section):
   `CONVEX_DEPLOY_KEY` (production key for Production only, preview key for Preview only),
   `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_MARKETING_URL`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`,
   `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL` (production only), `FOLEVI_SERVER_SECRET`.
   Never set any `FOLEVI_DEV_AUTH*` variable on Vercel; the build fails in production if you do.
   No secret may be named `NEXT_PUBLIC_*` (also enforced by the check script).
3. Domains: add `folevi.com` (canonical), `www.folevi.com` (redirects to apex; also handled in
   `vercel.json` and `proxy.ts`) and `app.folevi.com`. Point DNS as Vercel instructs (apex A/ALIAS,
   `www` and `app` CNAME).
4. Deployment protection for previews is recommended (Vercel Authentication).

## 3. Auth0

Follow `infra/auth0/README.md` and tick off `infra/auth0/tenant-checklist.md`:

- Regular Web Application (web) — callback `https://app.folevi.com/auth/callback`, logout
  `https://folevi.com`, web origin `https://app.folevi.com`. Preview: add the preview URL pattern your plan
  allows, or use a separate dev tenant.
- Native Application (Mac) — callbacks `com.folevi.mac://auth.folevi.com/macos/com.folevi.mac/callback`
  and the `https://auth.folevi.com/macos/com.folevi.mac/callback` universal-link form; refresh token
  rotation.
- Database connection only; social/passwordless off; attack protection on; OTP + recovery codes on.
- Actions: Post-Login (`actions/post-login.js`) and Custom Email Provider (`actions/custom-email-provider.js`)
  with their secrets.
- Custom domain `auth.folevi.com` (CNAME to the Auth0-provided target).
- M2M application for the backend with the minimal scopes listed in the README.

## 4. Loops

Follow `docs/EMAIL_OPERATIONS.md`: verify the `mail.folevi.com` sending domain (add the exact MX/TXT/CNAME
records Loops shows), SPF/DKIM alignment, DMARC (`p=none` with reporting, then `quarantine`), import and
**publish** the 13 templates from `packages/email/templates`, and store each `transactionalId` in the
matching Convex env var (and the identity ones in the Auth0 Action secrets). Optionally configure the
webhook `https://<deployment>.convex.site/webhooks/loops` and set `LOOPS_WEBHOOK_SECRET`.

## 5. First release checklist

1. `pnpm install && pnpm exec vitest run && pnpm --filter @folevi/web build` locally.
2. Push to `main`; CI (lint, typecheck, unit, Convex, e2e, macOS, secret scan, audit) must pass.
3. Vercel production deploy runs automatically (or promote a verified preview).
4. Verify: `curl -I https://folevi.com` (HSTS, CSP), `https://app.folevi.com/signin` redirects to Auth0,
   sign up with a real address → verification email arrives (Loops) → TOTP enrollment → onboarding →
   Welcome document; `/admin` returns 404 for non-admins; create and revoke a public link; export a page.
5. Bootstrap the first super admin: `npx convex run --prod admin:bootstrapSuperAdmin '{"email":"…"}'`.
6. Record the deployment for the admin dashboard (optional, from CI):
   `npx convex run --prod admin:recordDeployment '{"environment":"production","commitSha":"…","commitMessage":"…","source":"github"}'`.

## Mac app distribution

Set the production values in `apps/macos/Config/Release.xcconfig` (Convex URL, Auth0 domain and native
client id), archive with a Developer ID certificate, notarize (`xcrun notarytool`), staple, and distribute
the DMG. See `docs/MACOS.md`.

## Backups and restore

- Convex keeps automatic backups on paid plans; take manual snapshots before risky migrations:
  `npx convex export --prod --path backups/folevi-$(date +%F).zip` (includes file storage with
  `--include-file-storage`). Restore into a staging deployment with `npx convex import` first.
- Deleted documents are recoverable from Trash for 30 days; blocks from version history.

## Incident basics

1. **Stop the bleeding:** Admin → Configuration → maintenance banner, optionally read-only mode (edits stay
   queued on devices and sync when lifted); feature flags can turn off public links, invites, exports or
   new sign-ups.
2. **Contain access:** suspend affected accounts/workspaces; revoke sessions (Admin → user → Revoke all
   sessions); rotate `FOLEVI_SERVER_SECRET`, `FOLEVI_FILE_URL_SECRET` (invalidates signed file URLs),
   `LOOPS_API_KEY`, Auth0 client secrets as needed.
3. **Investigate:** Convex logs (structured, content-free), Vercel logs, Auth0 logs, the admin audit log.
4. **Recover:** restore from export into staging, verify, then re-import or repair.
5. **Communicate:** notify affected users by email (security template) and document the timeline.
