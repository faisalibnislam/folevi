# Security

This document describes the controls that exist in the code today. It does not describe controls that
are not implemented. Report vulnerabilities to security@folevi.com.

## Accounts and sessions

Accounts are built into Folevi: Better Auth 1.6 running inside Convex (`convex/auth.ts`); the reasons
and the full list of properties and gaps are in `docs/AUTH_DECISION.md`.

- Email + password only (10–128 characters). There is no social, passwordless, passkey or anonymous
  sign-in. Folevi's own code never hashes passwords or handles TOTP maths: Better Auth hashes passwords
  with scrypt, stores TOTP secrets and backup codes encrypted with `BETTER_AUTH_SECRET`, and issues the
  sessions (`tests/convex/static/invariants.test.ts` fails CI if hand-rolled credential crypto appears).
- Email verification is required: unverified accounts can't sign in (a new link is sent instead),
  confirmation links expire after 24 hours, and the backend rejects tokens without the
  `https://folevi.com/email_verified` claim.
- Authenticator-app TOTP is optional: anyone can turn it on (password → QR code rendered on the device,
  never by a third-party QR service → code → 10 single-use backup codes) or off (password) in Settings →
  Security. Platform admins must have it: admin functions reject tokens without the
  `https://folevi.com/mfa` claim. There is no SMS or email second factor.
- “Trust this device for 30 days” skips the TOTP step on that browser; signing out, revoking the session
  or changing the password ends it.
- Brute-force limits: per-IP rate limits stored in the database (for example 5 sign-ins per minute, 5
  sign-ups per hour, 5 two-step codes per minute, 3 password-reset requests per 15 minutes); a sign-in
  challenge allows 5 code attempts and Better Auth locks two-step verification for the account after
  repeated failures. `FOLEVI_AUTH_RATE_LIMIT_SCALE` loosens the limits for automated tests and is ignored
  when `FOLEVI_ENV=production`.
- The IP those limits key on can't be forged. Browsers reach Better Auth through the web server, which
  signs the visitor's IP (HMAC with `FOLEVI_SERVER_SECRET`, 60-second freshness) in
  `x-folevi-client-ip`; Convex strips every other forwarded-IP header and trusts that one only when the
  signature checks out (`convex/lib/clientIp.ts`). A request sent straight to the Convex site URL has no
  client IP and shares one bucket, so it can't rotate fake addresses to dodge the limits. IPv6 addresses
  are grouped by /64.
- Sign-in errors are generic: an unknown email and a wrong password produce the same message (no account
  enumeration). “Forgot password” always answers the same way.
- Password reset by email (link valid 1 hour, single use) ends every session of the account; changing
  the password in Settings (current password required) ends every other session. Showing the
  authenticator key again or creating new backup codes also asks for the password.
- Web sessions: HTTP-only, `Secure` (on https) cookies with the `folevi` prefix, first-party on
  `app.folevi.com` through the `/api/auth/*` proxy; rolling 14-day lifetime. The browser receives only
  short-lived (15-minute) RS256 tokens for Convex.
- Instant revocation: every backend call checks that the Better Auth session behind the token still
  exists (`requireActiveSession` in `convex/lib/auth.ts`). Revoking a session in Settings → Security,
  “sign out other devices”, a password change or reset, or an admin suspension ends it on its next
  request, and open live queries fail at once.
- Mac: not signing in at the moment; it will use Authorization Code + PKCE against Folevi's own accounts
  (`docs/MACOS.md`).
- New-device security email on sign-in from a new session.
- Development tools: identity emails outside production are captured in a development mailbox guarded
  by `FOLEVI_DEV_MAILBOX_SECRET`; it refuses to work when `FOLEVI_ENV=production`, and the production
  build fails if the secret is set on Vercel or Convex.
- Account deletion: 7-day grace period (cancellable by signing in), then a bounded server-side cascade
  that also deletes the credentials, sessions and two-step data. A confirmation email is sent.

## Authorization

- Every public Convex function derives identity from the verified token and calls the centralized
  helpers in `convex/lib/auth.ts`; the static test `tests/convex/static/invariants.test.ts` fails CI if a
  function lacks one.
- Reads are scoped by workspace membership and document permissions (workspace mode or restricted with
  explicit grants inherited by nested pages). Missing and forbidden resources return the same `not_found`.
- Workspace roles: Owner, Admin, Member (members may be limited to comment or view); guests are page grants
  without a membership and see only what was shared with them (`convex/lib/permissions.ts` has the matrix;
  `tests/convex/members-guests.test.ts`). Platform roles for the admin console are enforced in
  every admin function (`docs/ADMIN.md`).
- Tenant isolation, role changes, invitation binding, public-link expiry, file authorization and deletion
  cascades are covered by `tests/convex/backend.test.ts`.

## Sharing

- Public links are off until created; tokens are 256-bit random, stored only as SHA-256 hashes, can expire,
  can require a password (PBKDF2-SHA256, 210k iterations, per-link salt), are rate limited per client, are
  served with `robots: noindex, nofollow` (unless the owner allowed indexing for an unprotected link),
  `Referrer-Policy: no-referrer` and `no-store`, and are revocable instantly. After a visitor enters a
  link's password, the share page keeps only a sealed unlock grant (AES-256-GCM under a key derived from
  `FOLEVI_SERVER_SECRET`, bound to that link, expiring after 30 minutes) in an HTTP-only, SameSite=Strict
  cookie scoped to the link — never the raw password, never in the URL. The password is re-checked by
  Convex on every load, so changing it invalidates old grants.
- Presence and notifications are only visible to people who can read the document.

## Files

Authorized short-lived upload URLs; server-side re-verification of size and SHA-256; content sniffing
(extensions and client MIME types are ignored); active content (HTML/SVG/XML/script) is stored as
`application/octet-stream` and always downloaded; image metadata is stripped (JPEG EXIF/XMP/comments,
PNG text/EXIF chunks, GIF comments and non-rendering application extensions, WebP EXIF/XMP chunks);
images whose dimensions can't be read are rejected, so the pixel-count limit always applies;
per-workspace storage quotas; delivery only through signed, expiring URLs with `nosniff`, sandboxing CSP
and `Content-Disposition`.

## Web platform

CSP (no third-party scripts; Convex and signed file origins only; `frame-ancestors 'none'`), HSTS
(preload), `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, restrictive Permissions-Policy,
COOP. State-changing routes check `Origin`; sign-out is POST-only. Product HTML is `private, no-store`;
the service worker never caches authenticated API responses or share pages. The policy is built by
`apps/web/src/lib/security/csp.ts`. Routes that render per request (product views, admin, sign-in flows,
share pages) get a per-request nonce policy from the request proxy (`apps/web/src/proxy.ts`):
`'nonce-…' 'strict-dynamic'` plus the SHA-256 of the one inline theme script, no `'unsafe-inline'`.
Statically prerendered pages (marketing, `/forgot-password`, `/offline`) keep the static header from
next.config.ts, which still allows inline scripts because they have no per-request nonce.

## Abuse controls

Fixed-window rate limits (admin-tunable) on bootstrap, invites, email resends, password resets, public
link opens and password attempts, sync batches, uploads, comments, exports and device registration.
Exhausted windows are recorded in `rateLimitEvents` and every rejection is logged.

## Logging and privacy

- Structured logs contain ids, statuses and codes only — never note text, titles, attachment contents,
  tokens, passwords, TOTP data or full email addresses (static test enforced). Next.js routes log through
  `apps/web/src/lib/server/log.ts`: one JSON line per request with a request id (from `x-request-id` /
  `x-vercel-id` or generated, echoed back as `x-request-id`), and an allow-list redactor that drops
  anything named like content, identity or secrets.
- Notification emails never contain note or comment text, only who, where and a link. Emails are stored hashed in
  email logs with a redacted hint.
- Admins cannot read note content: there is no content viewer, and admin APIs return metadata and
  aggregates only. Every admin view of personal metadata and every admin action is written to an
  append-only audit log with actor, role, reason, before/after, request id and a hashed client hint.
- Analytics: none. Folevi ships no third-party analytics or trackers.

## Encryption

Traffic is encrypted in transit (TLS/HSTS). Data at rest is encrypted by the infrastructure providers
(Convex, Vercel, Loops). Folevi is **not** end-to-end encrypted — server-side search, sharing,
exports and abuse handling require the server to process content.

## Data retention

| Data | Retention |
| --- | --- |
| Documents in Trash | 30 days, then permanently deleted |
| Deleted blocks (tombstones) | 30 days |
| Version snapshots | the newest 50 per document, plus anything younger than 30 days |
| Sync idempotency log | 30 days |
| Notifications | 180 days |
| Rate-limit events | 90 days |
| Accounts scheduled for deletion | 7 days grace, then cascade |
| Email attempt log | kept for operations (hashed recipients) |
| Admin audit log | kept (append-only) |

Backups: Convex provides deployment backups and point-in-time export (`npx convex export`); see
`docs/DEPLOYMENT.md` for the procedure.

## Subprocessors

| Provider | Purpose | Data |
| --- | --- | --- |
| Convex | Database, backend functions, file storage, accounts (Better Auth runs here) | Account, workspace and document data, files, password hashes, encrypted two-step secrets, sessions |
| Vercel | Web hosting | Request metadata, logs |
| Loops | Transactional email delivery | Recipient email, template variables (no note bodies) |

## Known limitations

- Account email changes are handled by support, not self-service.
- Passwords are not yet checked against known breach lists; there are no passkeys (see
  `docs/AUTH_DECISION.md`, known gaps).
- The native Mac app cannot sign in until it moves to Authorization Code + PKCE against Folevi's own
  accounts.
- Auth0 was previously a subprocessor; it is no longer used.
- Loops does not document a plain-text email part; text versions are kept in the repo for review.
