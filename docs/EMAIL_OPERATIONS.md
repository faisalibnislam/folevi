# Email operations

This is the runbook for Folevi's transactional email. Everything, including identity email (email
confirmation and password reset from Folevi's built-in accounts), is rendered in this repository and sent
by the Convex backend through **Resend**. Resend also receives the mail people send to
`support@folevi.com` and `security@folevi.com`, which becomes support tickets. For why it is built this
way, see [EMAIL_DECISION.md](./EMAIL_DECISION.md).

Resend is the only provider. Mailtrap and, before it, Loops were used earlier; old rows in the admin
**Emails** log may still say `mailtrap` or `loops` (section 10 lists what is left to delete outside the
repository).

## 1. Set up Resend (production)

Do these in order. Nothing here is copied from this document into DNS: always copy the exact records
from Resend → **Domains** for your account.

1. **Add the sending domain.** Resend → **Domains** → **Add Domain** → `mail.folevi.com`. (Use a
   separate domain such as `mail-staging.folevi.com` if you ever send real mail from a non-production
   deployment; normally non-production only reaches test addresses, section 4.)
2. **Add its DNS records at the DNS host** (folevi.com's DNS is at Namecheap: **Domain List** → `folevi.com` → **Advanced DNS**; host names are relative, e.g. `resend._domainkey.mail`). Resend
   shows the records to add for `mail.folevi.com`: a **DKIM** TXT record on `resend._domainkey.mail`, and
   an **MX** and an **SPF** TXT record on `send.mail` for the return path. In Vercel the *Name* is the
   part before `.folevi.com` (for `resend._domainkey.mail.folevi.com` enter `resend._domainkey.mail`).
   - **SPF: one TXT record per name.** Resend's SPF record lives on `send.mail.folevi.com`, so it
     normally stands alone. If a name already has a `v=spf1 …` record, **merge** the `include:` into it
     instead of adding a second one; two SPF records on the same name make SPF fail.
   - **DMARC: keep ours.** `_dmarc.folevi.com` is Folevi's own policy (section 2). Don't replace it
     with a vendor value.
3. **Verify.** Back in Resend, **Verify** the domain. DNS can take up to a few hours; don't send until
   every record shows as verified.
4. **Turn off open and click tracking** in the domain's settings in Resend (Open tracking **off**,
   Click tracking **off**). Folevi's emails promise no tracking: no pixels, no rewritten links. Check this
   again after any change to the domain.
5. **Create the API key.** Resend → **API Keys** → **Create API Key** with **Full access**. A
   sending-only key can send but can't read received mail, so support email would never become tickets.
   Copy it once.
6. **Store it on Convex production** (never in Vercel, never `NEXT_PUBLIC_*`):
   ```sh
   npx convex env set RESEND_API_KEY --deployment <prod-deployment>   # prompts; paste the key
   npx convex env set EMAIL_REPLY_TO support@folevi.com --deployment <prod-deployment>   # a monitored mailbox
   ```
   From this moment Convex sends through Resend.
7. **Create the webhook.** Resend → **Webhooks** → **Add Webhook**:
   - URL: `https://<prod-deployment>.convex.site/webhooks/resend` (the deployment's `.convex.site` host,
     not `app.folevi.com`; for production that is
     `https://fastidious-clownfish-123.convex.site/webhooks/resend`)
   - Events: `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`,
     `email.failed`, `email.suppressed` and `email.received`. Leave opened and clicked off.

   Copy its **signing secret** (`whsec_…`) and store it:
   ```sh
   npx convex env set RESEND_WEBHOOK_SECRET --deployment <prod-deployment>   # prompts
   ```
   The endpoint answers `200` for a correctly signed request and `401` for anything else; the webhook's
   page in Resend shows the answer to each delivery.
8. **Receive support mail.** Point `folevi.com`'s MX at Resend's receiving (section 7a and
   [SUPPORT.md](./SUPPORT.md)).
9. **Send a test.** Trigger a real flow ("Forgot password" for your own account, or sign up with a real
   address). Then check: the email arrives (inbox, not spam), the logo shows, `Authentication-Results`
   has `dkim=pass` and `dmarc=pass`, the admin **Emails** log shows the attempt as *accepted* via
   Resend and, a few seconds later, **Delivered**.

`bash scripts/setup-production-env.sh` asks for the API key and the webhook signing secret with hidden
input and stores them on Convex ([DEPLOYMENT.md](./DEPLOYMENT.md)).

### Verification checklist

- [ ] `mail.folevi.com` shows **Verified** in Resend → Domains; open and click tracking are off.
- [ ] `RESEND_API_KEY` (full access) and `RESEND_WEBHOOK_SECRET` are set on Convex production; no
      `MAILTRAP_*` or `LOOPS_*` variable is left (the production build warns about them).
- [ ] The webhook points at `/webhooks/resend` on the production `.convex.site` host, with the seven
      events above, and its recent deliveries answered `200`.
- [ ] `dig MX folevi.com` shows only Resend's receiving MX.
- [ ] A password reset to your own address arrives, passes DKIM and DMARC, and shows **Delivered** in
      Admin → Emails.
- [ ] An email to `support@folevi.com` becomes a ticket in Admin → Support, with a confirmation in your
      inbox; replying to the confirmation adds to the same ticket.

## 2. Sending domain, alignment and DMARC

- **Dedicated subdomain:** `mail.folevi.com`. It keeps the reputation of `folevi.com` (human mail)
  separate from automated mail. The From domain comes from the manifest (`EMAIL_SENDING_DOMAIN` in
  `packages/email/src/manifest.ts`); a deployment can override it with the Convex env var
  `EMAIL_SENDING_DOMAIN`.
- **Alignment.** DKIM signs with `d=mail.folevi.com` (the From domain), so DKIM aligns. The return path
  is `send.mail.folevi.com`, under the From domain, so SPF aligns in relaxed mode too. DMARC passes if
  either aligns.
- **DMARC** (our own record):
  1. `_dmarc.folevi.com  TXT  "v=DMARC1; p=none; rua=mailto:dmarc-reports@folevi.com; fo=1"`; the
     subdomain inherits it unless `_dmarc.mail.folevi.com` exists.
  2. Read the aggregate reports for at least 2 weeks. Every legitimate source (Resend, and anything
     else that sends as folevi.com) must pass. The reports arrive through Resend's receiving like any
     other folevi.com mail; Folevi ignores them, so read them in Resend's received emails or point
     `rua=` at an address on another domain.
  3. Move to `p=quarantine; pct=25`, then `pct=100`, and consider `p=reject` after a clean month. Never
     tighten the policy while a legitimate source is failing.

## 3. Identities

| Identity                            | Used by                                 | Notes                                                                                   |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| `Folevi <security@mail.folevi.com>` | all `identity` and `security` templates | Required mail. No unsubscribe.                                                          |
| `Folevi <hello@mail.folevi.com>`    | all `product` templates                 | Folevi-side preferences, with a link to `preferencesUrl`.                               |
| `Folevi Support <support@mail.folevi.com>` | `support_ticket_received`, `support_reply` | Reply-To is always `support@folevi.com` (replies become ticket messages); see [SUPPORT.md](./SUPPORT.md). |
| `Folevi <support@mail.folevi.com>`  | `support_staff_notice`                  | To `SUPPORT_NOTIFY_EMAIL` only. No Reply-To, so it can't loop into a ticket.            |
| Reply-To                            | every other email, when `EMAIL_REPLY_TO` is set | A **monitored** mailbox (e.g. `support@folevi.com`). Never a no-reply address. |

The From name and address come from `emailManifest[key].sender` (and a template may fix its Reply-To with
`replyTo`); nothing is configured per template in Resend. Support templates are their own category
(`support`): never unsubscribable, never preference-gated, and the only subjects that carry a value (the
ticket number, "[Folevi #1042] …", so replies thread).

## 4. Environment separation

- **Non-production never reaches real people.** Outside production (`FOLEVI_ENV` ≠ `production`), live
  sends only go to `@example.com`, `@test.com` and exact addresses in `FOLEVI_EMAIL_ALLOWLIST`;
  everything else is recorded as `skipped / recipient_not_allowed` (`packages/email/src/policy.ts`).
  There is no sandbox inbox.
- **Identity email outside production** is also captured in the development mailbox (`/dev/mailbox`, needs
  `FOLEVI_DEV_MAILBOX_SECRET`), which is how local and automated test runs follow confirmation and reset
  links. The mailbox is off in production, and the production build fails if `FOLEVI_DEV_MAILBOX_SECRET`
  is set.
- Use a **separate API key per environment**, and leave `RESEND_API_KEY` unset where nothing should be
  sent at all (attempts are then recorded as `provider_not_configured`).

## 5. Templates

All fourteen templates (eleven account and product templates, three support templates) are compiled in
this repository; Resend stores no templates.

- **Copy and layout:** `packages/email/scripts/build-templates.ts` (one shared, table-based layout: soft
  canvas, white rounded card, logo, serif heading, black button with the link repeated as text, muted
  footer; dark mode for clients that honour `prefers-color-scheme`).
- **Subjects, preview text, senders, variables, fixtures:** `packages/email/src/manifest.ts`.
- **Generated output:** `packages/email/src/generated/templates.ts` (HTML + plain text per template, with
  `{{variable}}` placeholders). `renderEmail(key, vars)` validates the variables against the manifest,
  HTML-escapes every value, only accepts https (or app-relative) links, and throws on missing or unknown
  variables.
- **The only image is the logo**, from `https://folevi.com/brand/email/` (`folevi-logo@2x.png`, and
  `folevi-logo-dark@2x.png` for dark mode). They are rendered from `packages/design-tokens/brand/source/logo.svg` and `logo-dark.svg`
  by `node packages/design-tokens/scripts/brand-icons.mjs --only=logos` and served from
  `apps/web/public/brand/email/`. A deployment can point elsewhere with `EMAIL_BRAND_BASE_URL` (https only).

### Changing a template

1. Edit the copy in `scripts/build-templates.ts` and/or the subject, preview or variables in
   `src/manifest.ts`.
2. `pnpm --filter @folevi/email templates` (regenerates `src/generated/templates.ts`).
3. `pnpm --filter @folevi/email preview` and open `packages/email/preview/index.html` (every template with
   its fixture, light and dark; the logo loads from the local file). The preview folder is gitignored.
4. `pnpm --filter @folevi/email test` and `typecheck` (which fails if the generated module is stale). The
   tests check that every placeholder is declared and every required variable used, that identity and
   security email has no unsubscribe or preferences link, that the only images are the two logos from the
   brand path, that every button has its link as text, and that each template has a text version.
5. Open a PR. Security or identity copy needs a second reviewer. Deploying Convex ships the new copy, so there
   is nothing to upload anywhere.
6. Adding a **required** variable: update the callers in the same change (a send with a missing variable
   fails as `invalid_payload`).

## 6. Sending, retries and idempotency

- `convex/email.ts#sendTemplate` records an `emailSendAttempts` row, then calls `sendEmail()` from
  `@folevi/email`, which posts to `https://api.resend.com/emails`. The template key and attempt id go as
  the tags `template` and `attempt` (never personal data); they come back in webhooks. The returned
  email `id` is stored as the attempt's `providerMessageId`.
- **Retries:** 429 (honouring `Retry-After`), 408, 5xx, timeouts and connection errors are retried with
  exponential backoff (4 tries, ≤ 8 s apart); other 4xx are not.
- **Idempotency, twice over.** Every request carries `Idempotency-Key: folevi-<attempt id>`, so a retry
  of the same attempt (including after a timeout) can't send twice: Resend answers with the original
  result. Separately, each send has its own key (e.g. `auth-verify:…`, `notify:<id>`) and `beginAttempt`
  refuses a second attempt when one with that key was already accepted, or is still in flight (queued in
  the last 10 minutes). A failed attempt may be retried with the same key.
- **Logs** contain the template, provider, status, attempts, error code and request id, never the
  address (only `recipientHint` like `j***@e***.com` or a salted hash), the content or any key.
- **Error codes to alert on**, especially for `auth_verify_email` and `auth_password_reset` (without them
  people can't finish signing up or recover their account): `provider_not_configured`, `unauthorized`
  (bad or revoked key), `provider_rejected` (e.g. unverified domain), `invalid_payload`.

## 7. Webhooks and suppression

- **Endpoint:** `POST https://<deployment>.convex.site/webhooks/resend` (`convex/http.ts`). One endpoint
  for delivery events and received mail.
- **Verification:** Resend signs with Svix. `svix-signature` must hold the base64 HMAC-SHA256 of
  `<svix-id>.<svix-timestamp>.<raw body>`, keyed with the base64 part of `RESEND_WEBHOOK_SECRET` after
  `whsec_`, compared in constant time; `svix-timestamp` must be within 5 minutes of now. Missing secret,
  missing or wrong signature → `401`; signed but malformed body → `400`; over 256 KB → `413`.
- **Storage:** each event is deduplicated on its `svix-id` (stored as `webhookId` `resend:<svix-id>`, so
  Resend's retries are harmless) and stored in `emailProviderEvents` with the address **hashed** and the
  event name:

  | Resend event | Stored as | Effect |
  | --- | --- | --- |
  | `email.delivered` | `delivered` | |
  | `email.delivery_delayed`, `email.bounced` with type Transient | `soft_bounced` | none |
  | `email.bounced` with type Permanent | `bounced` | suppresses product email |
  | `email.complained` | `spam_complaint` | suppresses product email |
  | `email.failed` | `rejected` | |
  | `email.suppressed` | `suppressed` | suppresses product email (as a hard bounce) |

  The bounce type and subtype are kept as `bounceCategory`; SMTP text, subjects, IPs, user agents and
  clicked URLs are dropped.
- **Matching:** by the Resend email id first, then by the `attempt` tag (only when the event's hashed
  recipient and template agree with that attempt). The attempt's **Delivery** status in the admin
  Emails log follows the strongest event (a complaint after delivery stays a complaint; a delivery after a
  soft bounce shows as delivered).
- **Suppression:** a permanent bounce, a spam complaint or Resend suppressing the address adds the hashed
  address to `emailSuppressions`. Product email to it is then recorded as `skipped / recipient_suppressed`;
  identity and security email is never suppressed (people must always be able to confirm an address,
  reset a password or hear about a sign-in). To lift a suppression (the person fixed their mailbox), delete
  the row in the Convex dashboard (`emailSuppressions`, find it by `recipientHash` =
  `hashRecipient(address, FOLEVI_HASH_SALT)`), and remove the address from Resend's own suppression list
  too.
- **Rotating the secret:** rotate it in Resend, then `npx convex env set RESEND_WEBHOOK_SECRET …` right
  away; events signed with the old secret are refused and Resend retries them.

## 7a. Inbound email (support@ and security@folevi.com)

`folevi.com`'s MX points at Resend's receiving, so mail for every folevi.com address arrives there. For
each message Resend posts `email.received` to the same `/webhooks/resend` endpoint. The event carries
only metadata, so Convex reads the message from `GET https://api.resend.com/emails/receiving/{id}` with
`RESEND_API_KEY`, parses it (quoted history cut, auto-replies and bounces ignored) and files it with
`support.ingestInbound`: mail to `support@` and `security@folevi.com` becomes tickets, mail to other
folevi.com addresses is ignored. If the key is missing or Resend's API can't be reached the webhook
answers `503` and Resend retries. DNS, threading and loop protection are in [SUPPORT.md](./SUPPORT.md).

## 8. Environment variables

All on the **Convex** deployment (`npx convex env set NAME …`); none belong in Vercel.

| Name                         | Where                         | Purpose                                                                                           |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`             | Convex (required in production) | Resend API key with **full access**: sends all email and reads received mail. Selects Resend as the provider. |
| `RESEND_WEBHOOK_SECRET`      | Convex                        | Signing secret (`whsec_…`) for `/webhooks/resend`. Without it the endpoint refuses everything: no delivery tracking, no suppression, no tickets from email. |
| `EMAIL_REPLY_TO`             | Convex (optional)             | Reply-To on every email without a fixed one (a monitored mailbox).                                |
| `EMAIL_SENDING_DOMAIN`       | Convex (optional)             | Overrides the From domain (default `mail.folevi.com`).                                            |
| `EMAIL_BRAND_BASE_URL`       | Convex (optional)             | https base for the logo images (default `https://folevi.com/brand/email`).                        |
| `FOLEVI_EMAIL_ALLOWLIST`     | Convex, non-production        | Comma-separated exact addresses allowed besides `@example.com` / `@test.com`.                     |
| `FOLEVI_HASH_SALT`           | Convex                        | Salt for `hashRecipient()` (attempts, events, suppressions). Secret; never rotated without a migration. |
| `FOLEVI_DEV_MAILBOX_SECRET`  | Convex + `apps/web/.env.local`, non-production only | Enables the development mailbox for identity email (support mail is captured there too). |
| `SUPPORT_NOTIFY_EMAIL`       | Convex (optional)             | Staff address told about new tickets and requester replies.                                       |

`scripts/check-prod-env.mjs` (runs before every Vercel production build) fails when production has no
`RESEND_API_KEY`, and warns when `RESEND_WEBHOOK_SECRET` is missing and when any leftover `MAILTRAP_*` or
`LOOPS_*` variable is still set (unused; remove it).

## 9. Troubleshooting

| What you see | Likely cause and fix |
| --- | --- |
| Admin → Emails says **No email provider configured**; attempts fail as `provider_not_configured` | `RESEND_API_KEY` isn't set on this Convex deployment. |
| Attempts fail as `unauthorized` | The API key is wrong or was revoked. Create a new full-access key and set `RESEND_API_KEY`. |
| Attempts fail as `provider_rejected` | Resend refused the message; the attempt shows its reason. Usually `mail.folevi.com` isn't verified, or `EMAIL_SENDING_DOMAIN` names a domain Resend doesn't have. |
| Attempts fail as `idempotency_conflict` | Resend saw the same idempotency key with a different request. Not retried automatically; resend it from Admin → Emails (a new attempt gets a new key). |
| Attempts are `skipped / recipient_not_allowed` | A non-production deployment and a real address (section 4). Use a test address or add it to `FOLEVI_EMAIL_ALLOWLIST`. |
| Attempts are `skipped / recipient_suppressed` | The address bounced, complained or is suppressed by Resend (section 7). Lift it only once the person has fixed their mailbox. |
| Mail is *accepted* but never shows **Delivered** | The webhook isn't set up or is failing. Admin → Emails says when `RESEND_WEBHOOK_SECRET` is missing. In Resend → Webhooks, check the endpoint URL, the events and the answers: `401` means the secret on Convex doesn't match the endpoint's signing secret. |
| Mail lands in spam | Check `Authentication-Results` for `dkim=pass` and `dmarc=pass`, and that every record still shows as verified in Resend → Domains. |
| Email to `support@folevi.com` doesn't become a ticket | `dig MX folevi.com` must show only Resend's receiving MX, and the webhook must include `email.received`. Convex logs have one `support.inbound` line per message: `not_configured` (no API key; Resend retries), `fetch_401` or `fetch_403` (the key isn't full access), `ignored_mailbox`, `ignored_automated`, `ignored_own_domain`, `rate_limited` or `duplicate`. |

To look at a single message in more detail, open Resend → **Emails** and search by the email id (the
attempt's provider message id in Admin → Emails).

## 10. Leftovers from earlier providers (owner checklist)

The code no longer reads any `MAILTRAP_*` or `LOOPS_*` variable and has no `/webhooks/mailtrap`,
`/webhooks/mailtrap-inbound` or `/webhooks/loops` endpoint. What is left lives outside the repository:

- [ ] **Convex:** `npx convex env remove` each `MAILTRAP_*` and `LOOPS_*` variable on every deployment.
      The production build check warns while any is still set.
- [ ] **Mailtrap:** delete the webhooks, the inbound inbox and the `mail.folevi.com` sending domain, and
      revoke the API tokens.
- [ ] **DNS:** delete the old providers' records under `mail.folevi.com` (and their `include:` in any
      SPF record), and any MX record for `folevi.com` other than Resend's. Keep Resend's records and
      DMARC.
- [ ] **Loops:** delete the webhook and the sending domain if they still exist.

Old rows in the admin **Emails** log keep their provider and show as "Mailtrap (legacy)" or
"Loops (legacy)"; the database keeps their historical fields (see `convex/schema.ts`), which nothing
writes any more.
