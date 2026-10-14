# Decision: how Folevi sends email

- **Status:** accepted, 25 Sept 2026 (Loops); identity path revised the same day when Auth0 was replaced
  by built-in accounts ([AUTH_DECISION.md](./AUTH_DECISION.md)); **provider changed to Mailtrap and
  templates moved into the repository, 29 Sept 2026; provider changed to Resend (sending and the
  support inbox), Oct 2026**
- **Scope:** all transactional email: identity (email confirmation, password reset), security, and
  product notifications
- **Code:** `packages/email` (manifest, template builder and generated templates, `renderEmail`,
  Resend sender, webhook verification, received-mail parsing), `convex/email.ts` (sending, attempt log,
  delivery events, suppressions), `convex/http.ts` (`/webhooks/resend`) and `convex/authEmails.ts`
  (identity email and the development mailbox)
- **Operations:** [EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md)

## Decision

1. **Templates live in the repository and are rendered by Folevi.** Every email's HTML and plain text is
   compiled at build time from one shared layout (`packages/email/scripts/build-templates.ts` →
   `src/generated/templates.ts`); `renderEmail()` fills in the variables at send time, HTML-escaping every
   value and accepting only https (or app-relative) links. The provider receives finished HTML + text.
2. **Resend sends it** (`mail.folevi.com`): one `POST https://api.resend.com/emails` per email with
   `from`, `to`, optional `reply_to`, `subject`, `html`, `text` and `tags` (`template` = the template key,
   `attempt` = our attempt id; no personal data), and an `Idempotency-Key` header of
   `folevi-<attempt id>`.
3. **Identity email** (confirmation, password reset) takes the same path: Better Auth (inside Convex,
   `convex/auth.ts`) creates the single-use link and hands it to Folevi's callback;
   `convex/authEmails.ts` sends it through `internal.email.sendTemplate` like every other email. The
   only data is the link and its lifetime.
4. **There is no silent fallback.** If an email can't be sent (no provider configured, recipient not
   allowed outside production, provider refusal), the attempt is recorded as failed or skipped and logged.
   Resend is the only provider; there is no second one to fall back to.
5. **Outside production, email never reaches real people.** Non-production deployments only send to
   `@example.com`, `@test.com` and addresses in `FOLEVI_EMAIL_ALLOWLIST` (`packages/email/src/policy.ts`);
   everything else is skipped. Identity email is also written to the development mailbox
   (`/dev/mailbox`) so tests can follow links.
6. **No tracking.** Emails contain no tracking pixels; open and click tracking are turned off on the
   Resend sending domain. The only image is the Folevi logo, served from `folevi.com/brand/email/`.
7. **Support mail comes in through the same provider.** `folevi.com`'s MX points at Resend's receiving;
   `email.received` webhooks turn mail to `support@` and `security@folevi.com` into tickets
   ([SUPPORT.md](./SUPPORT.md)).

## Why Resend, and why templates in the repo

- **Templates as code.** With Loops, each template had to be uploaded by hand as an MJML zip, published,
  and its id copied into an env var: eleven manual steps per change, and nine templates never made it.
  Rendering in the repo means a template change is a reviewed PR, tested (placeholders, escaping, link
  rules, images, text version) and shipped with the Convex deploy, with nothing to configure per template.
- **Plain-text part.** Resend takes `text` next to `html`, so every email has a real text version.
- **Idempotency key.** Resend honours an `Idempotency-Key` header, so a send that timed out can be
  retried safely; it can't go out twice.
- **Email ids, tags and signed webhooks.** Resend returns an email id on send, echoes our tags in its
  webhooks and signs them (Svix), so every delivery, bounce and complaint can be tied to the exact send.
- **Sending and receiving in one place.** The support inbox is a Resend receiving domain and arrives on
  the same signed webhook; the message is read, already parsed, from Resend's API.
- **One vendor, one domain, one reputation.** Identity, security and product mail share
  `mail.folevi.com` with separate sender identities (`security@`, `hello@`, `support@`).

Trade-offs accepted: there is no sandbox inbox, so non-production relies on the recipient policy (test
and allowlisted addresses only) and the development mailbox. Rendering in the repo means the copy is only
as good as our own client testing (Apple Mail, Gmail web and iOS, Outlook).

## Evidence

The facts this integration relies on (from Resend's documentation, Oct 2026; re-check them there before changing the integration):

| Fact | Source |
| --- | --- |
| `POST https://api.resend.com/emails` with `Authorization: Bearer <key>`; JSON `from`, `to[]`, `reply_to`, `subject`, `text`, `html`, `tags[]` (`{name, value}`, ASCII letters, numbers, `_` and `-`), `headers`. 200 → `{ id }`; errors `{ statusCode, name, message }` with 400/401/403/409/422/429/5xx. | https://resend.com/docs (Send Email) |
| `Idempotency-Key` header: a repeat with the same key within 24 hours returns the original result instead of sending again; the same key with a different body is a 409. | https://resend.com/docs (Idempotency keys) |
| Webhooks: one event per request, `{ type, created_at, data }`, retried on failure; signed with Svix (`svix-id`, `svix-timestamp`, `svix-signature` = `v1,<base64 HMAC-SHA256 of "id.timestamp.body">`, key = the secret after `whsec_`). Events used: `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`, `email.received`. | https://resend.com/docs (Webhooks, Verify webhook requests) |
| Receiving: `email.received` carries metadata only; `GET https://api.resend.com/emails/receiving/{id}` (full-access key) returns the parsed message: from, to, cc, subject, text, html, headers, message id. | https://resend.com/docs (Receiving emails) |

## How a send works

1. **Scheduling.** Callers schedule `internal.email.sendTemplate` (identity email via
   `internal.authEmails.send`), so the request that caused the email never waits on the provider.
2. **Preferences and suppression.** Product email honours Folevi-side preferences, and is not sent to an
   address that hard-bounced, complained or that Resend suppressed (`emailSuppressions`, by hashed
   address). Identity and security email is never suppressible.
3. **Idempotency.** Each send has a key derived from its cause (`auth-verify:<token hash>`,
   `notify:<notification id>`, `invite:<id>`…). `beginAttempt` refuses a second send when an attempt with
   that key was accepted or is still in flight; a failed attempt may be retried. Within one attempt,
   Resend's `Idempotency-Key` (`folevi-<attempt id>`) makes every retry of the request harmless.
4. **Minimal data.** Variables are names, titles, times and one link, never note bodies or comment
   text. Logs contain the template, provider, status and a redacted recipient, never the address, link
   or content.
5. **Retries.** 429 / 408 / 5xx, timeouts and connection errors are retried with backoff (4 tries);
   other 4xx are not.

## Separation of identity and product email

|             | Identity / security | Product |
| ----------- | ------------------- | ------- |
| Templates   | `auth_verify_email`, `auth_password_reset`, `security_new_device`, `account_deletion_*` | `workspace_invite`, `mention_notification`, `comment_notification`, `comment_digest`, `share_notification`, `access_changed` |
| Sender      | `Folevi <security@mail.folevi.com>` | `Folevi <hello@mail.folevi.com>` |
| Unsubscribe | never (no unsubscribe or preferences link, test-enforced) | Folevi-side preference checked **before** sending; every email links to `preferencesUrl` |
| Suppression | never suppressed | skipped after a hard bounce, spam complaint or Resend suppression |
| Content     | one link, plus expiry | names, titles and a link; never note or comment text |

## Delivery-state honesty

- A provider **2xx means "accepted by the provider"** and nothing more; it is recorded as `accepted`.
- **Delivered, soft bounce, bounce, spam complaint, rejected and suppressed** come only from **signed
  Resend webhooks** (`verifyResendSignature`, deduplicated on `svix-id`), matched to the send by email
  id or by the `attempt` tag the email carried. The UI never says "delivered" on the strength of an
  API response alone; "We've sent a link if the address exists" is the honest wording.

## History

- Until Sept 2026 identity email was rendered by Auth0 and relayed to Loops by an Auth0 Action; removed
  with Auth0.
- 25–29 Sept 2026: Loops transactional templates (MJML uploaded by hand, `{DATA_VARIABLE:…}`
  placeholders, one env var per template id). Replaced by in-repo rendering and Mailtrap.
- 29 Sept 2026: after the cutover was confirmed in production, the Loops code was removed. Old send
  attempts and webhook events from the Loops era stay in the database read-only (their `transactionalId`
  fields are no longer written).
- 29 Sept to Oct 2026: Mailtrap, replaced by Resend. Old rows still say `mailtrap`; what is left outside
  the repository is in EMAIL_OPERATIONS.md §10.
