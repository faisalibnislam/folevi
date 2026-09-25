# Decision: how Folevi sends email

- **Status:** accepted, 25 Sept 2026
- **Scope:** all transactional email: identity (Auth0), security, and product notifications
- **Code:** `packages/email` (manifest, templates, Loops client, webhook verification) and
  `infra/auth0/actions/*`
- **Operations:** [EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md)

## Decision

1. **Identity email** covers verify email, password reset, blocked account, breached password,
   and verification code. It goes through an **Auth0 Custom Email Provider Action →
   Loops transactional API**. Each Auth0 notification type has **one dedicated, published Loops
   template** (`auth_*` in `emailManifest`). The Action takes exactly one thing from Auth0's
   rendered message: the single action link, or the one-time code for code flows. All copy and
   design live in Loops and in this repo.
2. **Security and product email** covers new device, account deletion, invites, mentions,
   comments, digest and shares. Convex actions send it by calling `sendTransactional()` from
   `@folevi/email`, with the same Loops account and a separate template per purpose.
3. **There is no silent fallback.** If the Action cannot send safely, it **drops** the
   notification and logs a reason. It never lets Auth0's built-in or test sender deliver, and it
   never sends through a second vendor. Failures should be visible, not quietly degraded.
   Switching paths is a deliberate, reviewed change, described below.

## Evidence

The following facts were verified against the official docs in Sept 2026:

| Fact                                                                                                                                                                                                                                                                                                                                                                                                                                     | Source                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST https://app.loops.so/api/v1/transactional` takes `transactionalId`, `email`, `addToAudience`, `dataVariables` (strings or numbers) and `attachments`. The `Idempotency-Key` header (≤100 chars, 24 h) is optional. A 200 returns `{"success":true}`, with **no message id**. 400 means an unpublished template or a missing variable, 404 an unknown template, 409 an idempotency key that was already used, and 429 a rate limit. | https://loops.so/docs/api-reference/send-transactional-email                                                                                                                                                                               |
| Custom MJML is uploaded as a zip containing `index.mjml`. Transactional data variables use `{DATA_VARIABLE:name}`.                                                                                                                                                                                                                                                                                                                       | https://loops.so/docs/creating-emails/uploading-custom-email                                                                                                                                                                               |
| Webhooks carry the headers `Webhook-Id`, `Webhook-Timestamp` and `Webhook-Signature`. The secret has a `whsec_` prefix, and after a rotation the old secret stays valid for 24 h. Loops makes up to 8 attempts over about 28 h.                                                                                                                                                                                                          | https://loops.so/docs/webhooks                                                                                                                                                                                                             |
| The Custom Email Provider Action gives us `event.notification.{to,from,subject,html,text,message_type}`, plus `api.notification.drop` and `api.notification.retry`.                                                                                                                                                                                                                                                                      | https://auth0.com/docs/customize/email/configure-a-custom-email-provider                                                                                                                                                                   |
| Post-login provides `api.access.deny`, `api.multifactor.enable(…, {allowRememberBrowser})`, `api.authentication.enrollWith({type:"otp"})` and `api.idToken.setCustomClaim`.                                                                                                                                                                                                                                                              | https://auth0.com/docs/customize/actions/explore-triggers/signup-and-login-triggers/login-trigger/post-login-api-object, https://auth0.com/docs/secure/multi-factor-authentication/customize-mfa/customize-mfa-enrollments-universal-login |
| Management API: `POST /api/v2/tickets/email-verification`, `POST /api/v2/tickets/password-change` (scope `create:user_tickets`), and `POST /api/v2/jobs/verification-email`.                                                                                                                                                                                                                                                             | https://auth0.com/docs/api/management/v2/tickets/post-email-verification, https://auth0.com/docs/api/management/v2/tickets/post-password-change, https://auth0.com/docs/api/management/v2/jobs/post-verification-email                     |

Not verified, and tracked in [infra/auth0/README.md](../infra/auth0/README.md#plan-dependent-unknowns-not-verified-sept-2026):

- whether our Auth0 plan includes the Custom Email Provider and template customization
- the exact blocked-account link path
- whether the breached-password notice contains a link
- whether Loops HTML-escapes data variables
- whether Loops supports a plain-text alternative for transactional templates. None is
  documented, so we treat it as unsupported.

## Why this path

- **Auth0 keeps owning the security-critical token lifecycle.** Auth0 still creates, stores,
  expires and consumes the tickets. We never mint or store tokens.
- **Universal Login keeps working unchanged.** "Forgot password", brute-force unblock and
  breached-password notices all trigger inside Auth0, and the Action delivers them. The fallback
  path (below) would need Folevi-side reset pages and Universal Login customization to hide
  Auth0's own "forgot password" entry point.
- **One vendor, one sending domain, one reputation.** The same Loops account, domain
  authentication and webhooks cover identity and product mail, with separate templates and
  sender identities.

## Why link extraction is safe

The Action parses a message that Auth0 renders. That is only acceptable because it enforces all
of these rules:

1. **Host restriction.** It only accepts URLs whose hostname exactly matches an entry in
   `AUTH0_LINK_HOSTS` (for example `auth.folevi.com` and `folevi.us.auth0.com`). Lookalike hosts
   (`auth.folevi.com.evil.example`), explicit ports and userinfo are rejected.
2. **Scheme restriction.** Only `https:` is accepted.
3. **Path restriction by message type.** For example, `verify_email` only accepts
   `/u/email-verification` or `/lo/verify_email`, and a reset path in a verify message is
   rejected. The link must carry a query string (the ticket).
4. **Uniqueness.** If there are two different qualifying links, the message is ambiguous and is
   dropped.
5. **Drop on failure.** If no link qualifies, the Action calls
   `api.notification.drop("link_not_found")`. It never sends an email without a valid link, and
   never falls back to Auth0's sender. The one exception is `stolen_credentials` (breached
   password): the notice may carry no ticket, so the Action may use the static first-party
   `FOLEVI_PASSWORD_RESET_URL`. That URL is not taken from the message.
6. **Idempotency.** `Idempotency-Key = "auth0-" + sha256(message_type | user_id | link)`. When
   Auth0 retries (`api.notification.retry` on 429, 5xx or network errors, up to 5 times), the key
   is the same, so Loops sends at most once within 24 h. A new ticket produces a new link and so a
   new key, which is correct.
7. **Minimal data.** The only data variables sent are `actionUrl` and `expiresInHours` (or `code`
   and `expiresInMinutes`). Logs contain the message type, the redacted recipient (`j***@e***.com`)
   and the status. They never contain the link or the code.
8. **Non-production isolation.** Unless `FOLEVI_EMAIL_ALLOWLIST_MODE=off` (prod only), only
   `@example.com`, `@test.com` and explicitly allowlisted addresses receive mail. A missing value
   fails closed.

We also make the Auth0 template bodies minimal (`<a href="{{ url }}">{{ url }}</a>`) so the
parsing input is deterministic, and unit tests cover each rejection case
(`packages/email/test/auth0-actions.test.ts`).

## Separation of identity and product email

|             | Identity / security                                                                | Product                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Templates   | `auth_*`, `security_new_device`, `account_deletion_*`                              | `workspace_invite`, `mention_notification`, `comment_notification`, `comment_digest`, `share_notification`                                      |
| Sender      | `Folevi <security@LOOPS_SENDING_DOMAIN>`                                           | `Folevi <hello@LOOPS_SENDING_DOMAIN>`                                                                                                           |
| Unsubscribe | never (`unsubscribable: false`, no unsubscribe or preferences link, test-enforced) | Folevi-side preference (`preferenceKey`) checked **before** sending. Every email links to `preferencesUrl` ("Manage notification preferences"). |
| Trigger     | Auth0 Action (auth_*) or Convex (security)                                         | Convex only                                                                                                                                     |
| Content     | one link or code, plus expiry                                                      | names, titles and at most a 140-character excerpt. Never note bodies.                                                                           |

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

## Fallback path: application-controlled tickets

**What it is.** The Auth0 custom provider Action drops every message (or is detached, with Auth0
email disabled). The Folevi backend (a Convex action) creates tickets through the Management API
and sends them with `sendTransactional()`:

- Verify email: `POST /api/v2/tickets/email-verification` with `{ user_id, client_id, result_url,
ttl_sec: 86400, includeEmailInRedirect: false }`. The resulting `{ticket}` is sent as
  `auth_verify_email.actionUrl`. It is triggered on sign-up detection (the first post-login deny)
  and from `/verify-email`.
- Reset password: `POST /api/v2/tickets/password-change` with `{ user_id (or email +
connection_id), client_id, result_url, ttl_sec: 3600, mark_email_as_verified: true }`, sent as
  `auth_password_reset`. It is triggered from a Folevi `/forgot-password` page.
- Scope `create:user_tickets` is already granted, so the switch needs no new grant.

**Switch to it when any of these is true.** Record the switch in this file.

1. The Custom Email Provider is not available on the plan we are on, or Auth0 deprecates it.
2. `link_not_found` or `code_not_found` drops happen in production and a template fix doesn't
   resolve them within 24 h. That would mean Auth0 changed the message format under us.
3. Auth0 retries prove insufficient: persistent `retry` exhaustion shows up in the logs during a
   Loops incident, with no way to replay.
4. We need content that depends on application state Auth0 does not have.

**Costs of switching.** We would need Folevi-owned `/forgot-password` and resend pages, rate
limiting, and a way to keep users away from Universal Login's built-in "forgot password" (text or
page customization). Blocked-account and breached-password notices have no ticket API, so they
would be dropped, and their information surfaced in-app instead.

**What we will not do**, even temporarily: re-enable Auth0's built-in or test email sender, or
route identity mail through a second email vendor.
