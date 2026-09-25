# Security

This document describes the controls that exist in the code today. It does not describe controls that
are not implemented. Report vulnerabilities to security@folevi.com.

## Accounts and sessions

- Email + password only, through Auth0 Universal Login. Social, passwordless, passkey and anonymous
  connections are disabled at the tenant (`infra/auth0/README.md`). Folevi never handles passwords,
  TOTP secrets or recovery codes.
- Email verification is required: the Post-Login Action denies unverified sign-ins and the backend
  rejects tokens without a verified-email claim.
- Authenticator-app TOTP is required for every account (Action-enforced, with recovery codes shown once
  at enrollment by Auth0). The backend requires the `https://folevi.com/mfa` claim.
- “Remember this browser” skips the TOTP step for 30 days on that browser (tenant setting; the copy in
  the app states the same period).
- Attack protection at Auth0: brute-force protection, suspicious-IP throttling, breached-password
  detection. Sign-in errors are generic (Universal Login).
- Web sessions: encrypted HTTP-only, `SameSite=Lax`, `Secure` cookies with rolling (3 days) and absolute
  (14 days) lifetimes. The browser receives only short-lived ID tokens for Convex from a same-origin route.
- Mac: Authorization Code + PKCE; tokens only in the Keychain.
- Session list and revocation: every browser/device registers a session in `sessionsMirror` (keyed by a
  hash of the identity provider's session id). Revoked sessions are rejected by the backend on their next
  request; “revoke all” also calls the Auth0 Management API (sessions, refresh tokens, remembered
  browsers) where the plan allows.
- New-device security email on sign-in from a new session.
- Account deletion: 7-day grace period (cancellable by signing in), then a bounded server-side cascade
  and Auth0 user deletion. A confirmation email is sent.

## Authorization

- Every public Convex function derives identity from the verified token and calls the centralized
  helpers in `convex/lib/auth.ts`; the static test `tests/convex/static/invariants.test.ts` fails CI if a
  function lacks one.
- Reads are scoped by workspace membership and document permissions (workspace mode or restricted with
  explicit grants inherited by nested pages). Missing and forbidden resources return the same `not_found`.
- Roles: Owner, Admin, Editor, Commenter, Viewer; platform roles for the admin console are enforced in
  every admin function (`docs/ADMIN.md`).
- Tenant isolation, role changes, invitation binding, public-link expiry, file authorization and deletion
  cascades are covered by `tests/convex/backend.test.ts`.

## Sharing

- Public links are off until created; tokens are 256-bit random, stored only as SHA-256 hashes, can expire,
  can require a password (PBKDF2-SHA256, 210k iterations, per-link salt), are rate limited per client, are
  served with `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer` and `no-store`,
  and are revocable instantly. The share page's password travels in a short-lived HTTP-only cookie scoped
  to that link, never in the URL.
- Presence and notifications are only visible to people who can read the document.

## Files

Authorized short-lived upload URLs; server-side re-verification of size and SHA-256; content sniffing
(extensions and client MIME types are ignored); active content (HTML/SVG/XML/script) is stored as
`application/octet-stream` and always downloaded; JPEG/PNG metadata (EXIF/XMP/text chunks) is stripped;
per-workspace storage quotas; delivery only through signed, expiring URLs with `nosniff`, sandboxing CSP
and `Content-Disposition`.

## Web platform

CSP (no third-party scripts; Convex, Auth0 and signed file origins only; `frame-ancestors 'none'`), HSTS
(preload), `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, restrictive Permissions-Policy,
COOP. State-changing routes check `Origin`; sign-out is POST-only. Product HTML is `private, no-store`;
the service worker never caches authenticated API responses or share pages.

## Abuse controls

Fixed-window rate limits (admin-tunable) on bootstrap, invites, email resends, password resets, public
link opens and password attempts, sync batches, uploads, comments, exports and device registration.
Exhausted windows are recorded in `rateLimitEvents` and every rejection is logged.

## Logging and privacy

- Structured logs contain ids, statuses and codes only — never note text, titles, attachment contents,
  tokens, passwords, TOTP data or full email addresses (static test enforced). Emails are stored hashed in
  email logs with a redacted hint.
- Admins cannot read note content: there is no content viewer, and admin APIs return metadata and
  aggregates only. Every admin view of personal metadata and every admin action is written to an
  append-only audit log with actor, role, reason, before/after, request id and a hashed client hint.
- Analytics: none. Folevi ships no third-party analytics or trackers.

## Encryption

Traffic is encrypted in transit (TLS/HSTS). Data at rest is encrypted by the infrastructure providers
(Convex, Vercel, Auth0, Loops). Folevi is **not** end-to-end encrypted — server-side search, sharing,
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
| Convex | Database, backend functions, file storage | Account, workspace and document data, files |
| Vercel | Web hosting | Request metadata, logs |
| Auth0 (Okta) | Sign-in, email verification, two-step verification | Email, password hash, MFA enrollment, sign-in logs |
| Loops | Transactional email delivery | Recipient email, template variables (no note bodies) |

## Known limitations

- Account email changes are handled by support, not self-service.
- Auth0 plan features (custom email provider, Sessions API, custom domain) are unverified on the chosen
  plan; the fallbacks are documented in `docs/EMAIL_DECISION.md` and `infra/auth0/README.md`.
- Loops does not document a plain-text email part; text versions are kept in the repo for review.
