# Decision: built-in accounts (Better Auth on Convex) instead of Auth0

- **Status:** accepted, 25 Sept 2026. Replaces the earlier Auth0 integration (Universal Login, Post-Login
  and Custom Email Provider Actions, Management API), which has been removed together with `infra/auth0`.
- **Scope:** sign-up, sign-in, email confirmation, password reset, two-step verification, sessions and
  the admin identity actions for the web app and backend, and sign-in for the native Mac app (see
  "Native apps").
- **Versions:** `better-auth` 1.6.33, `@convex-dev/better-auth` 0.12.5 (local-install component).
- **Code:** `convex/auth.ts` (all configuration), `convex/betterAuth/` (component schema and adapter),
  `convex/http.ts` (route registration), `convex/auth.config.ts` (the one trusted issuer),
  `convex/lib/auth.ts` + `convex/lib/authStore.ts` (per-call checks), `convex/authEmails.ts` (identity
  email + development mailbox), `convex/identity.ts` (admin actions), `convex/users.ts` (sessions,
  bootstrap), `apps/web/src/app/api/auth/[...all]/route.ts` (proxy), `apps/web/src/app/(auth)/*` (pages),
  `apps/web/src/components/views/settings/SecuritySection.tsx`.

## Decision

Folevi runs its own accounts on **Better Auth inside Convex**, with exactly these methods:

1. **Email + password only.** No social sign-in, magic links, passkeys or anonymous accounts.
2. **A confirmed email address** before first sign-in.
3. **An optional authenticator-app second step (TOTP)** with single-use backup codes, turned on or off
   in Settings → Security; required only for the admin console. No SMS or email codes. (Until
   2026-09-29 it was mandatory for every account; the account owner made it optional.)

The account owner chose this set of methods. Given that set, an external identity provider was mostly
cost: it added a vendor and a subprocessor holding password hashes, a second place where email was
rendered (and had to be parsed to reach Loops), plan-dependent features we could not verify, and a
revocation model where a signed-out device kept a valid token until it expired.

## Why built in

- **Fewer vendors and subprocessors.** Credentials live in the same Convex deployment as the rest of the
  account data. Auth0 is no longer a subprocessor (`docs/SECURITY.md`), and identity email goes through
  the same Loops pipeline as every other email (`docs/EMAIL_DECISION.md`) without link extraction.
- **Instant session revocation.** Sessions are rows in Folevi's own database. Every backend call checks
  that the session behind the token still exists (`requireActiveSession`), and because live queries read
  that row, revoking a session signs the device out at once, not when a token expires.
- **No hand-rolled cryptography.** Better Auth does all credential work; Folevi's code only configures
  it. A static test (`tests/convex/static/invariants.test.ts`) fails CI if code outside the component
  mentions password-hashing or TOTP primitives. Specifically, Better Auth:
  - hashes passwords with **scrypt** (`node:crypto` where available, `@noble/hashes` otherwise);
  - stores **TOTP secrets encrypted** (XChaCha20-Poly1305, key derived from `BETTER_AUTH_SECRET`);
  - generates and stores the **backup codes** (encrypted the same way, each usable once);
  - creates, stores, expires and consumes **session, confirmation and reset tokens**;
  - signs the **Convex tokens** with an RS256 key pair it keeps (encrypted) in the component's `jwks`
    table and publishes as a JWKS for Convex to verify.
- **Same product surface on our own pages.** Sign-in, sign-up, confirmation, reset and two-step pages are
  Folevi pages in `apps/web/src/app/(auth)`, in Folevi's design, instead of a hosted login page.

Alternatives: keeping Auth0 (rejected for the reasons above) and writing the account system ourselves
(rejected: no hand-rolled credential code).

## What's in scope

| Area | Behavior |
| --- | --- |
| Sign-up | Name, email, password (10–128 characters). Sends a confirmation email; does not sign in. Admins can pause sign-ups (`new_signups` flag). |
| Email confirmation | Required. Links expire after 24 hours; confirming signs the person in and opens the app. Signing in unconfirmed sends a fresh link. |
| Two-step setup | Optional, from Settings → Security (`/two-factor/setup`, with a “Not now” link); required before the admin console opens: password → QR code rendered on the device (the `qrcode` library, never a third-party QR service) plus the manual key → a code from the app → 10 backup codes to save. |
| Sign-in | Password; then, if two-step verification is on, a 6-digit authenticator code or a backup code. “Trust this device for 30 days” is optional. |
| Password reset | By email (`/forgot-password` → `/reset-password`); link valid 1 hour, single use; ends every session of the account. Two-step verification, if on, stays on. |
| Settings → Security | Turn two-step verification on, or off (password-gated); new backup codes and “move to a new authenticator app” (both password-gated), change password (ends every other session), list of sessions with “sign out” per device and for all others. |
| Sessions | HTTP-only cookie with the `folevi` prefix, first-party on `app.folevi.com` via the `/api/auth/*` proxy; rolling 14 days, refreshed at most daily. Convex tokens last 15 minutes and carry `sessionId`, `https://folevi.com/email_verified` and `https://folevi.com/mfa`. |
| Admin | `convex/identity.ts`: end all sessions, resend confirmation, send a password reset, block (suspension also ends sessions), delete credentials at the end of account deletion. Each writes an audit row when triggered from the console. |
| Migration | `users.bootstrap` re-links a profile created under Auth0 (or the old local development sign-in) to the new account by **verified** email, so existing workspaces carry over. |
| Development | No separate development identity. Identity emails are captured in the development mailbox (`/dev/mailbox`) outside production. |

## Native apps

Folevi for Mac (and later iOS) signs in with **Authorization Code + PKCE** (RFC 7636), the pattern
RFC 8252 recommends for native apps. `convex/lib/nativeAuth.ts` adds two endpoints to Better Auth, and
Better Auth's `bearer` plugin lets the app present its session token as `Authorization: Bearer …`.

1. The app opens `/connect?client_id=folevi-mac&redirect_uri=com.folevi.mac://auth/callback&
   code_challenge=…&code_challenge_method=S256&state=…` in the system browser. Signed-out visitors sign in
   first (password, then two-step verification) and come back.
2. The page shows which account the app will be signed in as. **Continue** calls
   `POST /api/auth/native/authorize` with the browser's session; it refuses unless the email is verified
   and two-step verification is on, and stores a one-time code (only its SHA-256) bound to the account,
   client, redirect URI and challenge for 2 minutes in Better Auth's verification table.
3. The browser is sent to `redirect_uri?code=…&state=…`. **Cancel** returns `error=access_denied`.
4. The app calls `POST /api/auth/native/token` with the code and its PKCE verifier. The code is consumed
   atomically (`consumeVerificationValue`), so it works once even when replayed concurrently, and a wrong
   verifier uses it up. If everything matches, Better Auth creates a **new session** for the app.
5. The app keeps that token in the Keychain and trades it for 15-minute Convex JWTs at
   `/api/auth/convex/token` (which also keeps the session rolling), and ends it with `/api/auth/sign-out`.

Clients and their exact redirect URIs are registered in `convex/lib/nativeClients.ts`; anything else is
refused by the page and by the server. Both endpoints are rate limited (10 per minute per IP). Because
the app has its own session, it appears in Settings → Devices, counts toward the plan's device limit,
and is signed out by the same actions as any other device (sign out, revoke, password change or reset,
suspension).

## Security properties

- **Credentials:** scrypt password hashes; TOTP secrets and backup codes encrypted at rest with a key
  derived from `BETTER_AUTH_SECRET`; confirmation and reset tokens are single-use and expire (24 h and
  1 h).
- **Factors enforced by the backend:** `requireProfile` rejects tokens without the verified-email claim,
  regardless of what the UI does. The MFA claim (`twoFactorEnabled`) is optional for everyone except
  platform admins: `requirePlatformRole` refuses admin functions with `mfa_required` when it's missing
  (checked after the role, so non-admins still see `not_found`), and `/admin` sends such an admin to
  `/two-factor/setup`. `FOLEVI_REQUIRE_VERIFIED_EMAIL=false` exists for automated tests only; the
  production build check fails if it is set.
- **Brute force:** per-IP limits stored in the database, so they hold across Convex instances (5
  sign-ins per minute, 5 sign-ups per hour, 5 two-step codes per minute, 3 reset requests per hour, 3
  confirmation resends per 5 minutes, among others; `rateLimitRules()`). Each sign-in challenge allows 5
  code attempts, and Better Auth's defaults lock two-step verification for an account for 15 minutes
  after 10 consecutive failures. `FOLEVI_AUTH_RATE_LIMIT_SCALE` multiplies the limits in non-production
  only (ignored when `FOLEVI_ENV=production`, and rejected by the build check there).
- **No account enumeration:** an unknown email and a wrong password give the same error; sign-up with an
  existing address, “forgot password” and “resend confirmation” answer the same way whether or not the
  address has an account.
- **Instant revocation:** sign-out, per-session revoke, “sign out other devices”, password change or
  reset, and admin suspension delete session rows; the next backend call (and every open live query)
  fails for that device.
- **Cookies and CSRF:** HTTP-only session cookie, `Secure` on https, first-party on the app host; Better
  Auth accepts state-changing requests only from the trusted origin (`SITE_URL`).
- **Single issuer:** `convex/auth.config.ts` trusts only this deployment's Better Auth issuer (issuer,
  audience `convex`, expiry and RS256 signature).
- **Development tools can't reach production:** the development mailbox is refused in Convex when
  `FOLEVI_ENV=production`, needs `FOLEVI_DEV_MAILBOX_SECRET` (compared in constant time) everywhere
  else, and `scripts/check-prod-env.mjs` fails a production build if that secret is set on Vercel or
  Convex. Non-production Loops sends only reach `@example.com`, `@test.com` or allowlisted addresses.
- **Logs:** identity actions log event names and outcome codes only; never tokens, links, codes or full
  addresses.

## Threat notes

- **Stolen password:** enough on its own for an account without two-step verification (which is
  optional); with it on, the attacker also needs the authenticator or a backup code. Reset emails go
  only to the account's confirmed address. A breached-password check is not built yet.
- **Phishing:** TOTP codes can be phished in real time; passkeys would close this (not built yet).
- **Stolen session cookie:** HTTP-only (not readable by script), and ended from Settings or by an admin
  with immediate effect. There is no device binding.
- **Lost authenticator and all backup codes:** there is no self-service recovery and, as of this
  writing, no admin action to reset two-step verification. Support would have to handle this by hand;
  a documented procedure is still to be written.
- **Database or backup exposure:** password hashes are scrypt; TOTP secrets and backup codes are
  encrypted, but the key is `BETTER_AUTH_SECRET` in the same deployment's environment, so a leak of
  both the data and the environment exposes them. Protect Convex dashboard access and deploy keys
  accordingly.
- **Confused origin / open redirect:** only `SITE_URL` is trusted; post-sign-in return paths are
  restricted to same-site paths (`apps/web/src/lib/auth/returnTo.ts`).

## Operational notes

- **Configuration (Convex):** `BETTER_AUTH_SECRET` (32+ random bytes), `SITE_URL` (the https app
  origin), `FOLEVI_ENV`; non-production only: `FOLEVI_DEV_MAILBOX_SECRET`, `FOLEVI_AUTH_RATE_LIMIT_SCALE`.
  Web: `FOLEVI_DEV_MAILBOX_SECRET` locally only. There are no `AUTH0_*` or `FOLEVI_DEV_AUTH_*` variables
  any more. See `.env.example`, `scripts/setup-local.mjs` and `docs/DEPLOYMENT.md`.
- **Identity email** depends on the Loops templates `auth_verify_email` and `auth_password_reset` being
  published and configured; without them nobody can confirm an address or reset a password.

### Rotating `BETTER_AUTH_SECRET`

Treat this secret as long-lived and back it up in the team's password manager. Based on reading the
Better Auth 1.6.33 source (not on a rotation we have performed), the secret is used to:

- sign the session, “trust this device” and two-step challenge cookies;
- sign email-confirmation tokens;
- encrypt TOTP secrets, backup codes and the private key that signs Convex tokens.

So **replacing it outright** would sign everyone out, invalidate outstanding confirmation links, make
every stored TOTP secret and backup code unreadable (locking every account out of two-step
verification) and break issuing Convex tokens until the signing key is replaced.

Better Auth 1.6 also supports versioned secrets (`BETTER_AUTH_SECRETS="2:<new>,1:<old>"`, first entry
current) that keep decrypting data encrypted under older secrets while encrypting new data with the
current one. Folevi has **not tested** this path, and cookies would still be signed with the new
secret only (so people sign in again). Rehearse any rotation on a preview deployment with real accounts
first, and check the Better Auth documentation for the version in use before doing it in production.

## Known gaps

- **No breached-password check yet** (Better Auth ships a `haveibeenpwned` plugin; it is not enabled).
- **No passkeys** yet.
- **No social sign-in, by design.**
- **No admin or support procedure for a lost second factor** (see threat notes).
- **Email address changes** are handled by support, not self-service.
- **Not yet run in production:** everything above has been exercised locally and in the automated
  suites (`docs/TESTING.md`), not on a production deployment.
