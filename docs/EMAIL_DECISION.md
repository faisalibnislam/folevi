# Decision: how Folevi sends email

- **Status:** accepted, 25 Sept 2026; identity path revised the same day when Auth0 was replaced by
  built-in accounts ([AUTH_DECISION.md](./AUTH_DECISION.md))
- **Scope:** all transactional email: identity (email confirmation, password reset), security, and
  product notifications
- **Code:** `packages/email` (manifest, templates, Loops client, webhook verification),
  `convex/email.ts` (sending, attempt log, webhooks) and `convex/authEmails.ts` (identity email and the
  development mailbox)
- **Operations:** [EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md)

## Decision

1. **Identity email** covers email confirmation and password reset. Better Auth (running inside Convex,
   `convex/auth.ts`) creates the single-use link and hands it to Folevi's callback;
   `convex/authEmails.ts` then sends it with the **Loops transactional API** through the same
   `internal.email.sendTemplate` path as every other email. Each identity email has **one dedicated,
   published Loops template** (`auth_verify_email`, `auth_password_reset` in `emailManifest`). The only
   data sent is the link and its lifetime. All copy and design live in Loops and in this repo.
2. **Security and product email** covers new device, account deletion, invites, mentions,
   comments, digest, shares and access changes. Convex actions send it by calling `sendTransactional()`
   from `@folevi/email`, with the same Loops account and a separate template per purpose.
3. **There is no silent fallback.** If an email can't be sent (Loops not configured, template not
   published, recipient not allowed outside production), the attempt is recorded as failed and logged.
   Identity email never goes through Better Auth's own sender or a second vendor. Failures should be
   visible, not quietly degraded.
4. **Outside production, identity email is captured.** Every identity email is also written to the
   development mailbox (`devMailbox` table, read at `/dev/mailbox` with `FOLEVI_DEV_MAILBOX_SECRET`),
   so people and automated tests can follow the links without a mail provider. Loops still only accepts
   `@example.com`, `@test.com` and allowlisted recipients there, so non-production email never reaches
   real users. In production the mailbox is neither written nor readable.

Previously (until Sept 2026) identity email was rendered by Auth0 and relayed to Loops by an Auth0
Custom Email Provider Action that extracted the link from Auth0's message. That path, its link-parsing
rules and its fallback plan were removed together with Auth0.

## Evidence

The following facts were verified against the official docs in Sept 2026:

| Fact                                                                                                                                                                                                                                                                                                                                                                                                                                     | Source                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST https://app.loops.so/api/v1/transactional` takes `transactionalId`, `email`, `addToAudience`, `dataVariables` (strings or numbers) and `attachments`. The `Idempotency-Key` header (≤100 chars, 24 h) is optional. A 200 returns `{"success":true}`, with **no message id**. 400 means an unpublished template or a missing variable, 404 an unknown template, 409 an idempotency key that was already used, and 429 a rate limit. | https://loops.so/docs/api-reference/send-transactional-email                                                                                                                                                                               |
| Custom MJML is uploaded as a zip containing `index.mjml`. Transactional data variables use `{DATA_VARIABLE:name}`.                                                                                                                                                                                                                                                                                                                       | https://loops.so/docs/creating-emails/uploading-custom-email                                                                                                                                                                               |
| Webhooks carry the headers `Webhook-Id`, `Webhook-Timestamp` and `Webhook-Signature`. The secret has a `whsec_` prefix, and after a rotation the old secret stays valid for 24 h. Loops makes up to 8 attempts over about 28 h.                                                                                                                                                                                                          | https://loops.so/docs/webhooks                                                                                                                                                                                                             |

Not verified:

- whether Loops HTML-escapes data variables
- whether Loops supports a plain-text alternative for transactional templates. None is
  documented, so we treat it as unsupported.

## Why this path

- **The identity system owns the token lifecycle.** Better Auth creates, stores, expires and
  consumes the verification and reset tokens (confirmation links last 24 h, reset links 1 h and are
  single use). Folevi's code never mints or stores these tokens itself; it only delivers the URL it is
  given.
- **No parsing.** The link comes straight from Better Auth's callback (`sendVerificationEmail`,
  `sendResetPassword` in `convex/auth.ts`), not from a rendered message, so there is nothing to
  extract or validate by host and path.
- **One vendor, one sending domain, one reputation.** The same Loops account, domain
  authentication and webhooks cover identity and product mail, with separate templates and
  sender identities.

## How identity email is sent

1. **Scheduling.** Better Auth's callback schedules `internal.authEmails.send` right away, so the HTTP
   request that asked for the email (sign-up, "resend", "forgot password") doesn't wait on Loops.
2. **Idempotency.** The key is derived from the token (`auth-verify:…`, `auth-reset:…`), so a retry of
   the same email is sent at most once by Loops within 24 h, while a new link gets a new key.
3. **Minimal data.** The only data variables are `actionUrl` and `expiresInHours`. Logs contain the
   template, the redacted recipient (`j***@e***.com`) and the status, never the link.
4. **No enumeration.** "Forgot password" and "resend confirmation" answer the same way whether or not
   the address has an account; an email is only sent when it does.
5. **Rate limits.** Better Auth limits these requests per IP (3 reset requests per 15 minutes, 3 confirmation
   resends per 5 minutes; see `rateLimitRules()` in `convex/auth.ts`).
6. **Non-production isolation.** Unless `FOLEVI_ENV=production`, Loops only receives mail for
   `@example.com`, `@test.com` and addresses in `FOLEVI_EMAIL_ALLOWLIST`; everything else is refused,
   and the message is still readable in the development mailbox.

## Separation of identity and product email

|             | Identity / security                                                                | Product                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Templates   | `auth_verify_email`, `auth_password_reset`, `security_new_device`, `account_deletion_*` | `workspace_invite`, `mention_notification`, `comment_notification`, `comment_digest`, `share_notification`, `access_changed`                  |
| Sender      | `Folevi <security@LOOPS_SENDING_DOMAIN>`                                           | `Folevi <hello@LOOPS_SENDING_DOMAIN>`                                                                                                           |
| Unsubscribe | never (`unsubscribable: false`, no unsubscribe or preferences link, test-enforced) | Folevi-side preference (`preferenceKey`) checked **before** sending. Every email links to `preferencesUrl` ("Manage notification preferences"). |
| Trigger     | Convex: Better Auth callbacks (`auth_*`) or security events                        | Convex only                                                                                                                                     |
| Content     | one link, plus expiry                                                              | names, titles and a link. Never note bodies or comment text (no excerpts).                                                                           |

`addToAudience` is always `false`. Transactional sends never create marketing contacts.

## Delivery-state honesty

- A Loops **HTTP 200 means "accepted by the provider"**, and nothing more. `sendTransactional`
  reports it as `status: "accepted"`. Loops returns no message id, so we correlate on our own
  idempotency key and `hashRecipient()`.
- **Delivered, soft bounce, hard bounce and spam complaint** come only from **verified Loops
  webhooks** (`verifyLoopsWebhook`, deduplicated on `Webhook-Id`, with ±5 min timestamp
  tolerance). The UI must never say "sent" or "delivered" on the strength of an API 200 alone.
  "Email requested" or "We've sent a link if the address exists" is the honest wording.
- A 409 on a retry can mean an earlier attempt was in fact accepted. `idempotency_conflict` is
  therefore reported as a non-retryable failure, and callers must not resend it with a fresh key
  without checking webhook state.
