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
- Mac: Folevi for Mac is the web app in a sandboxed Electron window and signs in like the web; its own
  hardening (origin-checked bridge, navigation and permission limits) is in `docs/DESKTOP.md`.
- New-device security email on sign-in from a new session.
- Development tools: identity emails outside production are captured in a development mailbox guarded
  by `FOLEVI_DEV_MAILBOX_SECRET`; it refuses to work when `FOLEVI_ENV=production`, and the production
  build fails if the secret is set on Vercel or Convex.
- Account deletion: refused while the person owns a workspace other people are in (they transfer or delete
  it first; `users.deletionBlockers`). 7-day grace period (cancellable by signing in), then a bounded
  server-side cascade that deletes the Personal, owned workspaces nobody else is in, the credentials,
  sessions and two-step data. A workspace someone joined during the grace period (or when support
  scheduled the deletion) passes to its longest-standing admin, else member. Other people's work is never
  deleted. A confirmation email is sent.

## Authorization

- Every public Convex function derives identity from the verified token and calls the centralized
  helpers in `convex/lib/auth.ts`; the static test `tests/convex/static/invariants.test.ts` fails CI if a
  function lacks one.
- Every content row belongs to exactly one scope: a person's Personal (`ownerProfileId`, only its owner
  browses it) or a team workspace (`workspaceId`, its members). Reads are scoped by that and by document
  permissions (workspace mode or restricted with explicit grants inherited by nested pages); a page grant
  outside your own scope makes you a guest of that page only. Missing and forbidden resources return the
  same `not_found`.
- Guests never reach workspace-wide data (lists, search, folders, tags, members, settings, billing,
  export) and can't add pages to the workspace, move pages to its top level or into folders, or share.
  Moving a page out from under a restricted page needs manage access. A workspace scheduled for deletion
  is hidden from everyone but its owner (read-only), its public links stop, and its billing can only be
  canceled (`tests/convex/sweep-security.test.ts`).
- Nothing about a page someone can't open reaches them, not even as a number or an id: counts shown to
  members (tasks, folders, tags, drafts, Trash) include only pages they can open (`PageReader` in
  `convex/lib/auth.ts`); guests get no folder ids and nobody gets the id of a parent page they can't open
  (`Placement` in `convex/lib/documents.ts`); and a link to a page is served with its current title only
  to readers who can open it (everyone else sees "Page you can't open"), while text derived from a page
  (excerpt, card preview, search text, task titles) and public links show only titles of unrestricted
  pages in the same Personal or workspace, never a restricted page's (`convex/lib/linkLabels.ts`;
  `tests/convex/privacy-gaps.test.ts`).
- Plans, storage and AI credits are resolved per scope on the server (`convex/lib/entitlements.ts`,
  `convex/lib/credits.ts`); seats per workspace (`convex/lib/seats.ts`). Core scopes never send anything to
  AI: every AI request in a Core Personal or workspace is refused on the server, whoever asks.
- Billing and payments (`docs/BILLING.md`): Polar is the merchant of record; Folevi never sees card data.
  Workspace billing is managed only by the owner and admins the owner allows (`canManageWorkspaceBilling`);
  only the person who pays for a workspace can open its Polar customer portal. Checkout is started only by
  an authenticated action that picks the product, price and seat count on the server (the client names a
  tier and an interval, never a price, product id, seat count or owner). The Polar token, webhook secret
  and product ids are Convex environment variables only (the production build fails if a Polar variable
  is in the web app's environment). Webhooks (`/webhooks/polar`) are verified with the Standard Webhooks
  signature (HMAC-SHA256, constant-time compare, timestamps older or newer than 5 minutes refused),
  applied once per delivery id, keyed by order id, and ordered (stale subscription events ignored; an old
  subscription ending never ends a newer one). Plans and credits change only from these events, never
  from a browser returning from checkout. Logs carry event types and outcomes only, never addresses,
  tokens or bodies. Test purchases are refused on production.
- AI metering records per person per scope per day the requests, credits and token counts; prompts, note
  text and answers are never stored or logged. Credits are held before a request so parallel requests
  can't overspend.
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
  cookie scoped to the link: never the raw password, never in the URL. The password is re-checked by
  Convex on every load, so changing it invalidates old grants.
- Presence and notifications are only visible to people who can read the document.

## Files

Authorized short-lived upload URLs; server-side re-verification of size and SHA-256; content sniffing
(extensions and client MIME types are ignored); active content (HTML/SVG/XML/script) is stored as
`application/octet-stream` and always downloaded; image metadata is stripped (JPEG EXIF/XMP/comments,
PNG text/EXIF chunks, GIF comments and non-rendering application extensions, WebP EXIF/XMP chunks);
images whose dimensions can't be read are rejected, so the pixel-count limit always applies;
storage limits per Personal and per workspace (never pooled); delivery only through signed, expiring URLs
(at most ~2 hours for page files, whatever the client's clock says; verification refuses any link that
claims to last longer than 9 days) with `nosniff`, sandboxing CSP and `Content-Disposition`. Export ZIPs
are only ever linked for the person who made them.

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
link opens and password attempts, sync batches, uploads, comments, exports, device registration, and
support requests (per hashed IP and per address, plus inbound support email per sender; see
`docs/SUPPORT.md`).
Exhausted windows are recorded in `rateLimitEvents` and every rejection is logged.

## Logging and privacy

- Structured logs contain ids, statuses and codes only, never note text, titles, attachment contents,
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
(Convex, Vercel, Mailtrap). Folevi is **not** end-to-end encrypted: server-side search, sharing,
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
| Workspaces scheduled for deletion | 7 days (the owner can cancel), then cascade |
| Export ZIPs | 1 day |
| Email attempt log | kept for operations (hashed recipients) |
| Admin audit log | kept (append-only) |
| Support requests (tickets and their messages) | kept for support history; deleted with the account (those filed under it or sent from its address) |

Backups: Convex provides deployment backups and point-in-time export (`npx convex export`); see
`docs/DEPLOYMENT.md` for the procedure.

## Subprocessors

| Provider | Purpose | Data |
| --- | --- | --- |
| Convex | Database, backend functions, file storage, accounts (Better Auth runs here) | Account, workspace and document data, files, password hashes, encrypted two-step secrets, sessions |
| Vercel | Web hosting | Request metadata, logs |
| Mailtrap | Transactional email delivery (open/click tracking off); receiving email to support@folevi.com | Recipient email and the rendered email (names, titles, links; no note bodies); support emails people send us |
| Google (Gemini API) | AI Assistant, only when used | The request and the notes it needs (not stored or used for training) |
| Polar | Merchant of record for paid plans and AI credit packs: checkout, tax, receipts, customer portal (not configured yet) | The buyer's email and billing details they enter at checkout, the product bought, seat count, and Folevi's internal ids (profile and workspace ids) in metadata; card details stay with Polar and its processor. Never note content |

## Known limitations

- Account email changes are handled by support, not self-service.
- Passwords are not yet checked against known breach lists; there are no passkeys (see
  `docs/AUTH_DECISION.md`, known gaps).
- Folevi for Mac (Electron) is signed for the owner's Mac only and not notarized, so it isn't distributed.
- A guest of a page sees, in that page's excerpt and preview, the titles of unrestricted pages in the same
  Personal or workspace it links to, even ones they can't open (the page's own link blocks show them "Page
  you can't open"); a visitor of its public link sees those titles in its links. Restricted pages' titles
  never appear.
- Auth0 was previously a subprocessor; it is no longer used.
- Loops (the previous email provider) is no longer used; Mailtrap sends all email. Its account, webhook
  and DNS records are removed per `docs/EMAIL_OPERATIONS.md` §9.
