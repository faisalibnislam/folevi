# Deployment

Production is live (`folevi.com`, `app.folevi.com`; current status in `docs/PRODUCT.md`). These are the
exact steps the account owner follows to set up or rebuild it. Every secret lives in a provider's secret store, never in Git.

## Environments

| Environment | Web | Convex (incl. accounts) | Identity emails | Email provider (Resend) |
| --- | --- | --- | --- | --- |
| Local | `localhost:3000`, `app.localhost:3000` | anonymous local backend; Better Auth runs inside it | captured in the development mailbox (`/dev/mailbox`) | not configured, or a key that only reaches test addresses |
| Preview | Vercel preview URLs | Convex preview deployment per branch | development mailbox if `FOLEVI_DEV_MAILBOX_SECRET` is set | its own Resend key, restricted to test and allowlisted addresses (`FOLEVI_ENV=preview`) |
| Production | `folevi.com`, `app.folevi.com` | production deployment | Resend only; no mailbox | Resend, sending and receiving on `folevi.com` |

**Previews are switched off for now.** No Preview deploy key is set in Vercel, so every branch build failed
at `convex deploy`. `apps/web/vercel.json`'s `ignoreCommand` skips any build that isn't production; pull
requests are still checked by GitHub CI (tests and a web build). To bring previews back, add the Convex
Preview deploy key as `CONVEX_DEPLOY_KEY` (Preview only) with the variables below, then drop the
`[ "$VERCEL_ENV" != "production" ] ||` part of the `ignoreCommand`.

Non-production Convex deployments (`FOLEVI_ENV` ≠ `production`) send only to `@example.com`, `@test.com`
or explicitly allowlisted addresses (`FOLEVI_EMAIL_ALLOWLIST`), so non-production email never reaches real
people. Accounts are built in (Better Auth inside Convex, `docs/AUTH_DECISION.md`); there is no separate
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
   `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` (section 4), optionally `EMAIL_REPLY_TO`. Optionally `UNSPLASH_ACCESS_KEY` (an Unsplash developer app's
   access key) turns on Insert → Image from Unsplash: searches run server-side in `convex/unsplash.ts`,
   rate-limited per person, and chosen photos are hotlinked and credited per the Unsplash API
   guidelines. Without it the picker explains that Unsplash isn't set up on this server.
   **Must not be set in production:** `FOLEVI_DEV_MAILBOX_SECRET`, `FOLEVI_AUTH_RATE_LIMIT_SCALE`, and
   `FOLEVI_REQUIRE_VERIFIED_EMAIL=false`. `scripts/check-prod-env.mjs`
   reads the Convex environment during the Vercel production build and fails it if any of these is
   wrong or a required variable is missing.
4. Preview deployments: set the same names as project **default environment variables** for previews with
   non-production values (`FOLEVI_ENV=preview`, its own `BETTER_AUTH_SECRET`, `SITE_URL` = the preview
   origin). `FOLEVI_DEV_MAILBOX_SECRET` and `FOLEVI_AUTH_RATE_LIMIT_SCALE` are allowed here. Give previews
   their own `RESEND_API_KEY` (or none); they only send to test and allowlisted addresses.

Shortcut: with your Convex production deploy key exported as `CONVEX_DEPLOY_KEY`, run
`bash scripts/setup-production-env.sh`. It sets the plain settings, generates the random secrets
(server secret, with the same value in Vercel and Convex; Better Auth secret; hash salt; file-URL secret)
straight into Vercel and Convex without printing them, adds the deploy key to Vercel, and asks for the
Resend API key and webhook signing secret with hidden input. Existing values are kept unless you pass `--rotate`.

## 2. Vercel

1. Import the GitHub repository. Root directory: `apps/web`. Framework: Next.js. Keep "Include files outside
   the Root Directory" on (the build installs and deploys from the repository root). Vercel deploys only the
   web app (Folevi for Mac, `apps/mac`, is built on the Mac with `apps/mac/scripts/release.mjs`), and the `ignoreCommand` in
   `apps/web/vercel.json` skips builds for commits that change only it (or docs). `apps/web/vercel.json`
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
- `RESEND_API_KEY` is set and `folevi.com` is verified in Resend (section 4); without them
  nobody can confirm an address or reset a password in production.
- Admin → Configuration → Feature flags → `new_signups` controls whether new accounts can be created.
- There is no DNS for identity (no `auth.folevi.com`); sign-in lives at `https://app.folevi.com/signin`.

### Sign in with Apple

"Continue with Apple" shows on sign-in and sign-up (web, the Mac app through the browser, the iPhone and iPad
app's web view) and in Settings > Security > Sign-in methods once all four `APPLE_SIGNIN_*` variables are set
on a Convex deployment; with any missing there's no Apple button (`scripts/check-prod-env.mjs` warns about a
partial set). Code: `convex/auth.ts` (`appleSignIn`), `convex/lib/appleSignIn.ts`, and
`apps/web/src/lib/auth/appleCallback.ts`, which answers Apple's cross-site form post to the callback.

Already set up at Apple (team `7K32QQ2FX8`): the App ID `com.folevi.ios` with Sign in with Apple (primary
app), the Services ID `com.folevi.signin` (website `app.folevi.com`, return URL
`https://app.folevi.com/api/auth/callback/apple`), the key `BNZC6FGWJC`, and the private email relay sources
`folevi.com`, `hello@`, `security@` and `support@folevi.com`.

| Variable | Value |
| --- | --- |
| `APPLE_SIGNIN_CLIENT_ID` | `com.folevi.signin` (the Services ID) |
| `APPLE_SIGNIN_TEAM_ID` | `7K32QQ2FX8` |
| `APPLE_SIGNIN_KEY_ID` | `BNZC6FGWJC` |
| `APPLE_SIGNIN_KEY` | the whole `.p8` file (PEM) |
| `APPLE_SIGNIN_BUNDLE_ID` | optional, defaults to `com.folevi.ios` (the audience of the iOS app's native id tokens) |

There's no client secret to rotate: Apple wants a JWT signed with the key, and the backend makes one at
runtime (ES256, `iss` the team, `sub` the Services ID, `aud` `https://appleid.apple.com`, valid 30 days, well
under Apple's 6-month limit) and makes a new one a day before it runs out. Replacing the key means setting the
new `APPLE_SIGNIN_KEY_ID` and `APPLE_SIGNIN_KEY`; nothing else.

Set them from the repository root. `--from-file` reads the key from the file, so it never appears in the
command, the shell history or the output:

```sh
# Development deployment (the one `npx convex dev` uses). Apple can't send anyone back to localhost, so here
# this only shows the button and exercises the server side.
npx convex env set APPLE_SIGNIN_CLIENT_ID com.folevi.signin
npx convex env set APPLE_SIGNIN_TEAM_ID 7K32QQ2FX8
npx convex env set APPLE_SIGNIN_KEY_ID BNZC6FGWJC
npx convex env set APPLE_SIGNIN_KEY --from-file ~/.appstoreconnect/private_keys/AuthKey_BNZC6FGWJC.p8

# Production.
npx convex env set --deployment fastidious-clownfish-123 APPLE_SIGNIN_CLIENT_ID com.folevi.signin
npx convex env set --deployment fastidious-clownfish-123 APPLE_SIGNIN_TEAM_ID 7K32QQ2FX8
npx convex env set --deployment fastidious-clownfish-123 APPLE_SIGNIN_KEY_ID BNZC6FGWJC
npx convex env set --deployment fastidious-clownfish-123 APPLE_SIGNIN_KEY --from-file ~/.appstoreconnect/private_keys/AuthKey_BNZC6FGWJC.p8
```

To pass the key with `$(cat ...)` instead, put `--` before the name:
`npx convex env set --deployment fastidious-clownfish-123 -- APPLE_SIGNIN_KEY "$(cat ~/.appstoreconnect/private_keys/AuthKey_BNZC6FGWJC.p8)"`.
Without the `--`, the CLI takes the key's first line (`-----BEGIN PRIVATE KEY-----`) for an option, refuses
it, and **prints the whole key** in its error. Check what was stored without showing it:
`npx convex env get --deployment fastidious-clownfish-123 APPLE_SIGNIN_KEY | head -1` should print `-----BEGIN PRIVATE KEY-----`.

The variables take effect at once (no deploy needed for them). The code itself goes live with the next
production deploy. Then check:

1. `https://app.folevi.com/signin` and `/signup` show "Continue with Apple" (black in light mode, white in
   dark mode).
2. Continue with Apple, sign in at Apple and choose **Share My Email** with the address of an existing,
   confirmed Folevi account: it comes back signed in to that account, and Settings > Security > Sign-in
   methods lists Apple as linked.
3. With another Apple ID choose **Hide My Email**: a new account is created with the
   `@privaterelay.appleid.com` address, already confirmed, named with the name given at Apple (only sent the
   first time; "Friend" if it wasn't).
4. Settings > Security: Remove Apple, then Link it again (any Apple address works there). Removing it, or
   deleting an account that used Apple, has Apple revoke Folevi's token (App Store guideline 5.1.1(v)): within
   a minute the Apple ID's settings (Sign in with Apple, or appleid.apple.com > Sign-In and Security) no longer
   list Folevi, and the Convex logs show `apple.revoke` with `"ok":true`. Tries that fail log
   `apple.revoke.retry` and run again in the background for 3 days (`appleRevocations` holds what's still
   pending).
5. Cancel at Apple: back on `/signin` with "Apple sign-in was cancelled."
6. The Mac app: Continue with Apple opens the browser, and the app signs in when it hands back.
7. Email to Hide My Email addresses: Apple only relays mail from the registered sources, and checks SPF.
   SPF for `folevi.com` currently fails at Apple (Certificates, Identifiers & Profiles > Services > Sign in
   with Apple for Email Communication), so until it passes, verification, reset and notification emails to
   relay addresses may not arrive. Apple accounts don't need the confirmation email, but they do need the
   others. Fix the SPF record (it must include Resend's sending servers) and click Verify there again.

If something fails, the Convex logs (`npx convex logs --deployment fastidious-clownfish-123`) show Better Auth's reason
(`invalid_code`: the client secret or redirect URL didn't match at Apple; "Sign in with Apple is off:
APPLE_SIGNIN_KEY can't be used": the key didn't parse).

## 4. Email (Resend)

Follow `docs/EMAIL_OPERATIONS.md` §1: add `folevi.com` as a Resend domain (sending and receiving), copy the exact records
from Resend → Domains into folevi.com's DNS at Namecheap (keep our DMARC), verify, **turn off open and click tracking**,
create a **full-access** API key and set `RESEND_API_KEY` on Convex production, create the webhook
`https://fastidious-clownfish-123.convex.site/webhooks/resend` (`email.delivered`,
`email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`,
`email.received`) and set `RESEND_WEBHOOK_SECRET`, point `folevi.com`'s MX at Resend's receiving
(`docs/SUPPORT.md` §3), then send a test. The templates are compiled in the repository and ship with the
Convex deploy; nothing is uploaded to Resend. Resend is the only provider: the production build fails
without `RESEND_API_KEY` and warns about any leftover `MAILTRAP_*` or `LOOPS_*` variable (delete them;
EMAIL_OPERATIONS.md §10).

## 5. Payments (Polar)

Optional until paid plans go on sale; without it, upgrades say payments aren't set up (non-production
deployments offer test purchases instead). All variables are server-only, on Convex: `POLAR_ACCESS_TOKEN`,
`POLAR_WEBHOOK_SECRET` and `POLAR_SERVER` (sandbox | production). The 14 products (one per plan, interval
and credit pack) are created from Admin → Billing setup, which records their ids in the database; a
`POLAR_PRODUCT_*` env var per product (`.env.example`, Billing section) still works as a fallback. The webhook endpoint is
`https://<deployment>.convex.site/webhooks/polar`. The full checklist (the 14 products with names, prices
and intervals, the webhook events, the token's scopes, sandbox testing) are in `docs/BILLING.md`. The one-time plan migration ran on production on 2026-09-30 and
its code has been removed (`docs/BILLING.md`, step 6). Access is granted only by signed webhook events (never by returning
from checkout). Remove any leftover `STRIPE_*` variables: Stripe was never live and its code is gone.

## 6. Account-model migration (done) and clean-up

Production was migrated to the new account model (Personal is not a workspace; workspace plans and seats;
members vs guests) with the runbook in `docs/ACCOUNT_MODEL_PLAN.md` §3a on 2026-09-29; the migration code
has since been removed. The §3b clean-up ran on the same day (`workspaces.kind` deleted,
`subscriptions.ownerType` and `aiUsage.scope` required, one-off migrations removed). `migrations:verifyAccountModel` / `migrations:accountModelReport` stay as an integrity
check any time (`done: true, ok: true`).

## 7. First release checklist

1. `pnpm install && pnpm exec vitest run && pnpm --filter @folevi/web build` locally.
2. Push to `main`; CI (lint, typecheck, unit, Convex, e2e, Mac shell, secret scan, audit) must pass.
3. Vercel production deploy runs automatically (or promote a verified preview).
4. Verify: `curl -I https://folevi.com` (HSTS, CSP), `https://app.folevi.com/signin` shows Folevi's own
   sign-in page, `https://app.folevi.com/dev/mailbox` returns 404, sign up with a real address →
   confirmation email arrives (Resend; admin Emails log shows it delivered) → onboarding → Welcome
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

## Folevi for Mac

Folevi for Mac (`apps/mac`) carries the web app's interface built in, so a web deploy reaches it with its next
release (`docs/DESKTOP.md`). `apps/mac/scripts/release.mjs --install` builds and installs it on the owner's Mac;
`apps/mac/scripts/publish.mjs` makes the notarized build for everyone and uploads it to the update bucket
(Cloudflare R2 `folevi-updates`). The website serves that bucket at `https://folevi.com/download/` (a rewrite in
`apps/web/next.config.ts`, with caching headers): the DMG at `https://folevi.com/download/mac/Folevi.dmg`, Sparkle's
feed at `https://folevi.com/download/mac/appcast.xml`. So a release is downloadable once the website with the
rewrite is deployed. See `docs/MAC_RELEASE.md`. It signs in through the browser like the other native apps
(Authorization Code + PKCE, `convex/lib/nativeAuth.ts`).

## Backups and restore

Three layers (docs/SECURITY_PLAN.md P0.4):

1. **In the product:** Trash keeps notes 30 days; deleted blocks 30 days; version history.
2. **Convex's own backups** (on paid plans): confirm the plan and how long they're kept in the Convex dashboard.
3. **Folevi's off-platform backup**, daily, by `.github/workflows/backup.yml`: a full export with file storage,
   encrypted with an [age](https://age-encryption.org) public key, stored in a Cloudflare R2 bucket whose
   retention lock stops anyone (a stolen deploy key, stolen R2 keys, a mistake) deleting or overwriting a backup
   before it expires. Dailies are kept 30 days, the copy made on the 1st of each month for a year.

### Setting up the off-platform backup (once)

1. **age key pair** on a trusted computer: `age-keygen -o folevi-backup.key`. Keep `folevi-backup.key` offline
   (a password manager and a printed copy in a safe place). Never put it in GitHub, Convex or Vercel. The line
   starting `# public key: age1…` is the recipient.
2. **R2 bucket** `folevi-backups` (not the public `folevi-updates` one), in the Cloudflare dashboard:
   - Settings → Bucket lock rules: `daily/` locked 30 days, `monthly/` locked 365 days.
   - Settings → Object lifecycle rules: delete `daily/` after 31 days, `monthly/` after 366 days.
   - An R2 API token with **Object Read & Write on this bucket only**.
3. **A production deploy key** just for backups (Convex dashboard → production → Settings → Deploy keys), so it
   can be revoked on its own.
4. **GitHub** (repository Settings → Secrets and variables → Actions):
   - Secrets: `BACKUP_CONVEX_DEPLOY_KEY`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`.
   - Variables: `BACKUP_AGE_RECIPIENT` (the `age1…` public key), `BACKUP_R2_BUCKET` (`folevi-backups`),
     `BACKUP_R2_ENDPOINT` (`https://<account id>.r2.cloudflarestorage.com`).
5. Run the workflow once by hand (Actions → Backup → Run workflow) and check the file appears in R2.

### Restore drill (every quarter, and before any risky migration)

Into a scratch deployment, never production:

1. Download the newest `daily/folevi-….zip.age` and its `.sha256`; check it: `shasum -a 256 folevi-….zip.age`.
2. Decrypt on the trusted computer: `age -d -i folevi-backup.key -o folevi.zip folevi-….zip.age`.
3. Create or reuse a scratch Convex deployment (a dev deployment of a separate project), then
   `npx convex import --replace-all --include-file-storage folevi.zip` there.
4. Point a local web build at it, sign in with a test account, open a few notes, files and a workspace.
5. Write the date, the backup used, how long it took and anything that failed in the table below; delete the
   decrypted ZIP (`rm -P folevi.zip` on macOS).

| Date | Backup | Time to restore | Result |
| --- | --- | --- | --- |
| | | | |

Manual exports before risky changes still work the same way:
`npx convex export --deployment <prod-deployment> --include-file-storage --path backups/folevi-$(date +%F).zip`.
Never leave an unencrypted production export on a laptop: encrypt it right away
(`age -r age1… -o folevi.zip.age folevi.zip && rm -P folevi.zip`).

## Incident basics

1. **Stop the bleeding:** Admin → Configuration → maintenance banner, optionally read-only mode (edits stay
   queued on devices and sync when lifted); feature flags can turn off public links, invites, exports or
   new sign-ups.
2. **Contain access:** suspend affected accounts/workspaces (this also ends their sessions); revoke
   sessions (Admin → user → Revoke all sessions; takes effect on the next backend call); pause new
   sign-ups with the `new_signups` flag; rotate `FOLEVI_SERVER_SECRET`, `FOLEVI_FILE_URL_SECRET`
   (invalidates signed file URLs), `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` as needed. Do **not** simply replace
   `BETTER_AUTH_SECRET`: it also encrypts every stored TOTP secret (see `docs/AUTH_DECISION.md`,
   "Rotating `BETTER_AUTH_SECRET`").
3. **Investigate:** Convex logs (structured, content-free; identity actions log `identity.*` events),
   Vercel logs, the admin audit log.
4. **Recover:** restore from export into staging, verify, then re-import or repair.
5. **Communicate:** notify affected users by email (security template) and document the timeline.
