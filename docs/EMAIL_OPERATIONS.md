# Email operations

This is the runbook for Folevi's transactional email. Everything, including identity email (email
confirmation and password reset from Folevi's built-in accounts), is rendered in this repository and sent
by the Convex backend through **Mailtrap** (Email API, transactional stream). For why it is built this
way, see [EMAIL_DECISION.md](./EMAIL_DECISION.md).

Mailtrap is the only provider. Loops, the previous one, has been removed from the code; section 9 lists
what is left to delete outside the repository.

## 1. Set up Mailtrap for `mail.folevi.com` (production)

Do these in order. Nothing here is copied from this document into DNS: always use the values Mailtrap
shows for **your** account and domain.

1. **Add the sending domain.** Mailtrap → **Sending Domains** → **Add Domain** → `mail.folevi.com`.
   (Use a separate domain such as `mail-staging.folevi.com` if you ever send real mail from a
   non-production deployment; normally non-production uses the sandbox, section 4.)
2. **Add the DNS records at Namecheap** (Domain List → `folevi.com` → **Advanced DNS**). Mailtrap shows
   the records to add, typically: a **CNAME** (or TXT) for domain verification, **DKIM** CNAMEs, an
   **SPF** TXT and/or a return-path CNAME (bounce domain), and a DMARC record. At Namecheap the *Host*
   is the part before `.folevi.com` (for `<selector>._domainkey.mail.folevi.com` enter
   `<selector>._domainkey.mail`).
   - **SPF: one TXT record per name.** If `mail.folevi.com` already has a `v=spf1 …` TXT record,
     **merge** Mailtrap's `include:` into it instead of adding a second one. Two SPF records on the same
     name make SPF fail. Example shape (use Mailtrap's include):
     `v=spf1 include:<mailtrap-include> include:<other-provider> ~all`.
   - **DMARC: keep ours.** `_dmarc.folevi.com` is Folevi's own policy (section 2). Don't replace it with a
     vendor value; if Mailtrap asks for a DMARC record and one already exists, keep the existing one.
3. **Verify.** Back in Mailtrap, **Verify** the domain. DNS can take up to a few hours; don't send until
   every record shows as verified.
4. **Turn off open and click tracking** for the domain (Sending Domains → `mail.folevi.com` →
   **Tracking settings**: Open tracking **off**, Click tracking **off**). Folevi's emails promise no
   tracking: no pixels, no rewritten links. Check this again after any change to the domain.
5. **Create a sending API token.** Mailtrap → **API Tokens** (Settings → API Tokens) → **Add Token**,
   with access only to the **sending domain** `mail.folevi.com` (not account admin). Copy it once.
6. **Store it on Convex production** (never in Vercel, never `NEXT_PUBLIC_*`):
   ```sh
   npx convex env set MAILTRAP_API_TOKEN --deployment <prod-deployment>   # prompts; paste the token
   npx convex env set EMAIL_REPLY_TO support@folevi.com --deployment <prod-deployment>   # a monitored mailbox
   ```
   From this moment Convex sends through Mailtrap.
7. **Create the webhook.** Mailtrap → **Webhooks** (under the sending domain / Settings → Webhooks) →
   **Create**:
   - URL: `https://<prod-deployment>.convex.site/webhooks/mailtrap` (the deployment's `.convex.site`
     host, not `app.folevi.com`)
   - Stream: transactional; domain: `mail.folevi.com`
   - Events: **Delivery, Soft bounce, Bounce, Spam complaint, Reject, Suspension** (and Unsubscribe if
     offered). Leave Open and Click off.
   - Payload: JSON (JSON Lines also works).
   Copy its **signing secret** and store it:
   ```sh
   npx convex env set MAILTRAP_WEBHOOK_SECRET --deployment <prod-deployment>   # prompts
   ```
   Use Mailtrap's **Test** button: the endpoint answers `200` for a correctly signed request and `401` for
   anything else.
8. **Send a test.** Trigger a real flow ("Forgot password" for your own account, or sign up with a real
   address). Then check: the email arrives (inbox, not spam), the logo shows, `Authentication-Results`
   has `dkim=pass` and `dmarc=pass`, the admin **Emails** log shows the attempt as *accepted* via
   Mailtrap and, a few seconds later, **Delivered**.

## 2. Sending domain, alignment and DMARC

- **Dedicated subdomain:** `mail.folevi.com`. It keeps the reputation of `folevi.com` (human mail)
  separate from automated mail. The From domain comes from the manifest (`EMAIL_SENDING_DOMAIN` in
  `packages/email/src/manifest.ts`); a deployment can override it with the Convex env var
  `EMAIL_SENDING_DOMAIN`.
- **Alignment.** DKIM signs with `d=mail.folevi.com` (the From domain), so DKIM aligns. The return path
  is Mailtrap's bounce subdomain under `mail.folevi.com`, so SPF aligns in relaxed mode too. DMARC passes
  if either aligns.
- **DMARC** (our own record):
  1. `_dmarc.folevi.com  TXT  "v=DMARC1; p=none; rua=mailto:dmarc-reports@folevi.com; fo=1"`; the
     subdomain inherits it unless `_dmarc.mail.folevi.com` exists.
  2. Read the aggregate reports for at least 2 weeks. Every legitimate source (Mailtrap, Google
     Workspace) must pass.
  3. Move to `p=quarantine; pct=25`, then `pct=100`, and consider `p=reject` after a clean month. Never
     tighten the policy while a legitimate source is failing.

## 3. Identities

| Identity                            | Used by                                 | Notes                                                                                   |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| `Folevi <security@mail.folevi.com>` | all `identity` and `security` templates | Required mail. No unsubscribe.                                                          |
| `Folevi <hello@mail.folevi.com>`    | all `product` templates                 | Folevi-side preferences, with a link to `preferencesUrl`.                               |
| Reply-To                            | every email, when `EMAIL_REPLY_TO` is set | A **monitored** mailbox (e.g. `support@folevi.com`). Never a no-reply address. |

The From name and local part come from `emailManifest[key].sender`; nothing is configured per template
in Mailtrap.

## 4. Environment separation

- **Non-production never reaches real people.** Two layers, both in code (`packages/email/src/send.ts`):
  - With `MAILTRAP_SANDBOX_INBOX_ID` + `MAILTRAP_SANDBOX_TOKEN` set on a non-production deployment,
    **every** email goes to that Mailtrap **Email Sandbox** inbox (captured, never delivered), whatever
    the recipient. This is the recommended setup for previews and staging. The sandbox is ignored in
    production.
  - Otherwise (live token outside production) only `@example.com`, `@test.com` and exact addresses in
    `FOLEVI_EMAIL_ALLOWLIST` are sent; everything else is recorded as `skipped / recipient_not_allowed`.
- **Identity email outside production** is also captured in the development mailbox (`/dev/mailbox`, needs
  `FOLEVI_DEV_MAILBOX_SECRET`), which is how local and automated test runs follow confirmation and reset
  links. The mailbox is off in production, and the production build fails if `FOLEVI_DEV_MAILBOX_SECRET`
  is set.
- Use a **separate token per environment**. A sandbox token can't send real mail.

## 5. Templates

All eleven templates are compiled in this repository; Mailtrap stores no templates.

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
  `@folevi/email`. Mailtrap's `category` is the template key; `custom_variables` are
  `{ attempt: <attempt id>, template: <key> }` (never personal data). The returned `message_ids[0]` is
  stored as the attempt's `providerMessageId`.
- **Retries:** 429 (honouring `Retry-After`), 408 and 5xx are retried with exponential backoff (4 tries,
  ≤ 8 s apart); other 4xx are not. A request that times out on our side is **not** retried: Mailtrap may
  have accepted it and has no idempotency key.
- **Idempotency:** each send has an idempotency key (e.g. `auth-verify:…`, `notify:<id>`). `beginAttempt`
  refuses to send again when an attempt with that key was already accepted, or is still in flight (queued
  in the last 10 minutes). A failed attempt may be retried with the same key.
- **Logs** contain the template, provider, status, attempts, error code and request id, never the
  address (only `recipientHint` like `j***@e***.com` or a salted hash), the content or any token.
- **Error codes to alert on**, especially for `auth_verify_email` and `auth_password_reset` (without them
  people can't finish signing up or recover their account): `provider_not_configured`, `unauthorized`
  (bad or revoked token), `provider_rejected` (e.g. unverified domain), `invalid_payload`.

## 7. Webhooks and suppression

- **Endpoint:** `POST https://<deployment>.convex.site/webhooks/mailtrap` (`convex/http.ts`).
- **Verification:** `Mailtrap-Signature` must be the hex HMAC-SHA256 of the **raw** body with
  `MAILTRAP_WEBHOOK_SECRET`, compared in constant time. Missing secret, missing or wrong signature → `401`;
  signed but malformed body → `400`. Both `{ "events": [...] }` JSON and JSON Lines are accepted.
- **Storage:** each event is deduplicated on Mailtrap's `event_id` (so Mailtrap's retries are harmless) and
  stored in `emailProviderEvents` with the address **hashed**, the event name (`delivered`,
  `soft_bounced`, `bounced`, `spam_complaint`, `rejected`, `suspended`, `unsubscribed`), the bounce category
  and SMTP code. IPs, user agents, clicked URLs and SMTP response text are dropped.
- **Matching:** by provider message id first, then by the `attempt` custom variable (only when the event's
  hashed recipient and template agree with that attempt). The attempt's **Delivery** status in the admin
  Emails log follows the strongest event (a complaint after delivery stays a complaint; a delivery after a
  soft bounce shows as delivered).
- **Suppression:** a hard bounce, spam complaint or unsubscribe adds the hashed address to
  `emailSuppressions`. Product email to it is then recorded as `skipped / recipient_suppressed`;
  identity and security email still goes (people must always be able to confirm an address, reset a
  password or hear about a sign-in). To lift a suppression (the person fixed their mailbox), delete the
  row in the Convex dashboard (`emailSuppressions`, find it by `recipientHash` =
  `hashRecipient(address, FOLEVI_HASH_SALT)`), and remove the address from Mailtrap's own suppression list
  too.
- **Rotating the secret:** create the new secret in Mailtrap, then `npx convex env set
  MAILTRAP_WEBHOOK_SECRET …` right away; events signed with the old secret are refused and Mailtrap retries
  them.

## 8. Environment variables

All on the **Convex** deployment (`npx convex env set NAME …`); none belong in Vercel.

| Name                         | Where                         | Purpose                                                                                           |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `MAILTRAP_API_TOKEN`         | Convex (required in production) | Sending API token for `mail.folevi.com`. Selects Mailtrap as the provider.                      |
| `MAILTRAP_WEBHOOK_SECRET`    | Convex                        | Signing secret for `/webhooks/mailtrap`. Without it the endpoint refuses everything.              |
| `EMAIL_REPLY_TO`             | Convex (optional)             | Reply-To on every email (a monitored mailbox).                                                    |
| `MAILTRAP_SANDBOX_INBOX_ID`  | Convex, non-production only   | Email Sandbox inbox id (numeric). With the token below, all email is captured there.              |
| `MAILTRAP_SANDBOX_TOKEN`     | Convex, non-production only   | Token with access to that sandbox inbox. Ignored in production (the build check warns if set).   |
| `EMAIL_SENDING_DOMAIN`       | Convex (optional)             | Overrides the From domain (default `mail.folevi.com`).                                            |
| `EMAIL_BRAND_BASE_URL`       | Convex (optional)             | https base for the logo images (default `https://folevi.com/brand/email`).                        |
| `FOLEVI_EMAIL_ALLOWLIST`     | Convex, non-production        | Comma-separated exact addresses allowed besides `@example.com` / `@test.com` on a live token.     |
| `FOLEVI_HASH_SALT`           | Convex                        | Salt for `hashRecipient()` (attempts, events, suppressions). Secret; never rotated without a migration. |
| `FOLEVI_DEV_MAILBOX_SECRET`  | Convex + `apps/web/.env.local`, non-production only | Enables the development mailbox for identity email.                      |

`scripts/check-prod-env.mjs` (runs before every Vercel production build) fails when production has no
`MAILTRAP_API_TOKEN`, and warns when the Mailtrap webhook secret is missing, when sandbox variables are
set in production, and when any leftover `LOOPS_*` variable is still set (unused; remove it).

## 9. Removing Loops (owner checklist)

Loops was the provider before Mailtrap. The code no longer reads any `LOOPS_*` variable and no longer has
a `/webhooks/loops` endpoint. What is left lives outside the repository:

- [ ] **Convex:** `npx convex env remove` each `LOOPS_*` variable on every deployment (`LOOPS_API_KEY`,
      `LOOPS_WEBHOOK_SECRET` and the eleven `LOOPS_TRANSACTIONAL_*_ID`). The production build check warns
      while any is still set.
- [ ] **Loops:** delete the webhook, then the sending domain.
- [ ] **Namecheap:** delete the Loops DNS records (its DKIM/return-path/MX records under
      `mail.folevi.com`) and remove Loops' `include:` from the SPF record. Keep Mailtrap's records and DMARC.

Old rows in the admin **Emails** log that were sent through Loops still show as "Loops (legacy)"; the
database keeps their historical `transactionalId` fields (see `convex/schema.ts`), which nothing writes any
more.
