# Decision: how Folevi sends email

- **Status:** accepted, 25 Sept 2026 (Loops); identity path revised the same day when Auth0 was replaced
  by built-in accounts ([AUTH_DECISION.md](./AUTH_DECISION.md)); **provider changed to Mailtrap and
  templates moved into the repository, 29 Sept 2026**
- **Scope:** all transactional email: identity (email confirmation, password reset), security, and
  product notifications
- **Code:** `packages/email` (manifest, template builder and generated templates, `renderEmail`,
  Mailtrap sender, webhook verification), `convex/email.ts` (sending, attempt log, webhooks,
  suppressions) and `convex/authEmails.ts` (identity email and the development mailbox)
- **Operations:** [EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md)

## Decision

1. **Templates live in the repository and are rendered by Folevi.** Every email's HTML and plain text is
   compiled at build time from one shared layout (`packages/email/scripts/build-templates.ts` →
   `src/generated/templates.ts`); `renderEmail()` fills in the variables at send time, HTML-escaping every
   value and accepting only https (or app-relative) links. The provider receives finished HTML + text.
2. **Mailtrap sends it** (Email API, transactional stream, `mail.folevi.com`): one `POST /api/send` per
   email with `from`, `to`, optional `reply_to`, `subject`, `html`, `text`, `category` (the template key)
   and `custom_variables` (our attempt id and template key — no personal data).
3. **Identity email** (confirmation, password reset) takes the same path: Better Auth (inside Convex,
   `convex/auth.ts`) creates the single-use link and hands it to Folevi's callback;
   `convex/authEmails.ts` sends it through `internal.email.sendTemplate` like every other email. The
   only data is the link and its lifetime.
4. **There is no silent fallback.** If an email can't be sent (no provider configured, recipient not
   allowed outside production, provider refusal), the attempt is recorded as failed or skipped and logged.
   The only other provider path is the **Loops legacy fallback during the cutover** (used when
   `MAILTRAP_API_TOKEN` is unset and `LOOPS_API_KEY` is set), which is removed afterwards.
5. **Outside production, email never reaches real people.** Non-production deployments send to the
   Mailtrap **Email Sandbox** when `MAILTRAP_SANDBOX_INBOX_ID` + `MAILTRAP_SANDBOX_TOKEN` are set (captured,
   never delivered); otherwise only to `@example.com`, `@test.com` and allowlisted addresses. Identity
   email is also written to the development mailbox (`/dev/mailbox`) so tests can follow links.
6. **No tracking.** Emails contain no tracking pixels; open and click tracking are turned off on the
   Mailtrap sending domain. The only image is the Folevi logo, served from `folevi.com/brand/email/`.

## Why Mailtrap, and why templates in the repo

- **Templates as code.** With Loops, each template had to be uploaded by hand as an MJML zip, published,
  and its id copied into an env var — eleven manual steps per change, and nine templates never made it.
  Rendering in the repo means a template change is a reviewed PR, tested (placeholders, escaping, link
  rules, images, text version) and shipped with the Convex deploy, with nothing to configure per template.
- **Plain-text part.** Loops documents no plain-text alternative for transactional mail; Mailtrap takes
  `text` next to `html`, so every email now has a real text version.
- **Message ids and webhooks.** Mailtrap returns `message_ids` on send and signs webhooks with an
  HMAC-SHA256 of the raw body, so every delivery, bounce and complaint can be tied to the exact send.
- **Sandbox.** Mailtrap's Email Sandbox gives previews and staging a place to send real renders without
  any chance of reaching a real inbox.
- **One vendor, one domain, one reputation.** Identity, security and product mail share
  `mail.folevi.com` with separate sender identities (`security@`, `hello@`).

Trade-offs accepted: Mailtrap has **no idempotency key**, so Folevi's own attempt log is the guard
against double sends (below), and a request that times out is not retried. Rendering in the repo means
the copy is only as good as our own client testing (Apple Mail, Gmail web and iOS, Outlook).

## Evidence

The facts this integration relies on (from Mailtrap's API documentation, Sept 2026 — re-check them there before changing the integration):

| Fact | Source |
| --- | --- |
| `POST https://send.api.mailtrap.io/api/send` with `Api-Token` or `Authorization: Bearer`; JSON `from`, `to[]`, `reply_to`, `subject`, `text`, `html`, `category`, `custom_variables`, `headers`. 200 → `{ success: true, message_ids: [...] }`; errors `{ success: false, errors: [...] }` with 400/401/403/429/5xx. | https://api-docs.mailtrap.io (Email Sending API) |
| Sandbox: `POST https://sandbox.api.mailtrap.io/api/send/{inbox_id}`, same body, captured in the inbox. | https://api-docs.mailtrap.io (Email Sandbox API) |
| Webhooks: `{ events: [...] }` or JSON Lines, ≤ 500 events per request, retried on failure; `Mailtrap-Signature` = hex HMAC-SHA256 of the raw body with the webhook's signing secret. Events: delivery, soft bounce, bounce, suspension, unsubscribe, open, click, spam complaint, reject. | https://help.mailtrap.io (Webhooks) |

## How a send works

1. **Scheduling.** Callers schedule `internal.email.sendTemplate` (identity email via
   `internal.authEmails.send`), so the request that caused the email never waits on the provider.
2. **Preferences and suppression.** Product email honours Folevi-side preferences, and is not sent to an
   address that hard-bounced, complained or unsubscribed (`emailSuppressions`, by hashed address).
   Identity and security email is never suppressible.
3. **Idempotency.** Each send has a key derived from its cause (`auth-verify:<token hash>`,
   `notify:<notification id>`, `invite:<id>`…). `beginAttempt` refuses a second send when an attempt with
   that key was accepted or is still in flight; a failed attempt may be retried.
4. **Minimal data.** Variables are names, titles, times and one link — never note bodies or comment
   text. Logs contain the template, provider, status and a redacted recipient, never the address, link
   or content.
5. **Retries.** 429 / 408 / 5xx and connection errors are retried with backoff (4 tries); other 4xx are
   not; a timed-out request is not retried (it may have been accepted).

## Separation of identity and product email

|             | Identity / security | Product |
| ----------- | ------------------- | ------- |
| Templates   | `auth_verify_email`, `auth_password_reset`, `security_new_device`, `account_deletion_*` | `workspace_invite`, `mention_notification`, `comment_notification`, `comment_digest`, `share_notification`, `access_changed` |
| Sender      | `Folevi <security@mail.folevi.com>` | `Folevi <hello@mail.folevi.com>` |
| Unsubscribe | never (no unsubscribe or preferences link, test-enforced) | Folevi-side preference checked **before** sending; every email links to `preferencesUrl` |
| Suppression | never suppressed | skipped after a hard bounce, spam complaint or unsubscribe |
| Content     | one link, plus expiry | names, titles and a link; never note or comment text |

## Delivery-state honesty

- A provider **2xx means "accepted by the provider"** and nothing more; it is recorded as `accepted`.
- **Delivered, soft bounce, bounce, spam complaint, reject and suspension** come only from **signed
  Mailtrap webhooks** (`verifyMailtrapSignature`, deduplicated on `event_id`), matched to the send by
  message id or by the attempt id the email carried. The UI never says "delivered" on the strength of an
  API response alone; "We've sent a link if the address exists" is the honest wording.

## History

- Until Sept 2026 identity email was rendered by Auth0 and relayed to Loops by an Auth0 Action; removed
  with Auth0.
- 25–29 Sept 2026: Loops transactional templates (MJML uploaded by hand, `{DATA_VARIABLE:…}`
  placeholders, one env var per template id). Replaced by in-repo rendering and Mailtrap; the Loops path
  remains only as a marked legacy fallback until the cutover is complete (EMAIL_OPERATIONS.md §9).
