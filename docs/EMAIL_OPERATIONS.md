# Email operations

This is the runbook for Folevi's transactional email. It uses Loops, plus Auth0 through the
custom email provider. For why it is built this way, see [EMAIL_DECISION.md](./EMAIL_DECISION.md).

## 1. Sending domain

- **Use a dedicated subdomain:** `mail.folevi.com` for production and `mail-staging.folevi.com`
  for non-production. This keeps the reputation of `folevi.com` (which carries human mail from
  Google Workspace or similar) separate from automated mail. The value is recorded as
  `LOOPS_SENDING_DOMAIN`. That name is for documentation and configuration only; the From
  address is set per template inside Loops.
- In Loops, go to **Settings > Domain**, enter the subdomain, and **copy exactly the records
  Loops displays** into DNS: typically MX and TXT (SPF) records for the return-path or bounce
  host, and CNAME or TXT records for DKIM. **Do not copy values from this document or from
  another environment.** They are generated per team and domain. Wait for Loops to show the
  domain as verified before publishing any template.
- **Alignment.** The DKIM `d=` domain and the From domain are both `mail.folevi.com`, so DKIM
  aligns in relaxed mode. SPF aligns through the Loops-provided return-path subdomain under
  `mail.folevi.com`. DMARC passes if either one aligns. Check a received message's
  `Authentication-Results` header for `dkim=pass` and `dmarc=pass`.
- **DMARC.** This is our own record, not a vendor value.
  1. Start with `_dmarc.folevi.com  TXT  "v=DMARC1; p=none; rua=mailto:dmarc-reports@folevi.com; fo=1"`.
     The subdomain inherits it unless `_dmarc.mail.folevi.com` exists.
  2. Read the aggregate reports for at least 2 weeks. Every legitimate source (Loops, Workspace)
     must pass.
  3. Move to `p=quarantine; pct=25`, then `pct=100`, and consider `p=reject` after a clean month.
     Never tighten the policy while any legitimate source is failing.
- Set up the `dmarc-reports@` mailbox (or a DMARC report service) before publishing the record.

## 2. Identities

| Identity                            | Used by                                 | Notes                                                                                                                                                 |
| ----------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Folevi <security@mail.folevi.com>` | all `identity` and `security` templates | Required mail. No unsubscribe.                                                                                                                        |
| `Folevi <hello@mail.folevi.com>`    | all `product` templates                 | Folevi-side preferences, with a link to `preferencesUrl`.                                                                                             |
| Reply-To                            | every template                          | A **monitored** support mailbox (for example `support@folevi.com`, to be created). Never a no-reply address, because users do reply to security mail. |

Set the From name, From address and Reply-To on **each** Loops template. They must match
`emailManifest[key].sender`.

## 3. Environment separation

- Use **separate Loops teams** for production and non-production, if the Loops account allows
  multiple teams. Each team has its own API key, sending domain (`mail-staging.folevi.com`),
  template ids and webhook secret. A staging key can then never send from the production domain,
  and production metrics stay clean.
- If only one team is available, share the team, but keep the staging API key, template copies
  (prefixed `[staging]`) and webhook separate, and rely on the recipient allowlist.
- **The allowlist is enforced in code in every non-production environment:**
  - `sendTransactional(…, { policy: { environment, allowlist } })` only sends to `@example.com`,
    `@test.com` or exact allowlisted addresses. Any other address returns
    `skipped / recipient_not_allowed`.
  - The Auth0 Action applies the same rule when `FOLEVI_EMAIL_ALLOWLIST_MODE` is `test-domains`,
    or when it is unset.

## 4. Template lifecycle

The templates live in `packages/email/templates/<key>.mjml` and `.txt`. They are **generated** by
`packages/email/scripts/build-templates.ts` from the manifest and a shared layout.

1. **Author.** Edit the copy or layout in `scripts/build-templates.ts`, and edit variables,
   subject or preview text in `src/manifest.ts`. Then run
   `pnpm --filter @folevi/email templates`.
2. **Check.** Run `pnpm --filter @folevi/email test`, then `typecheck`, then `lint`. The contract tests check
   that:
   - every placeholder is declared and every required variable is used
   - identity and security templates contain no unsubscribe or preferences link
   - the fixtures validate
   - the generated files are current
3. **Review.** Open a PR. Security or identity copy needs a second reviewer.
4. **Import into Loops.** Loops expects a zip with `index.mjml` at the root:
   ```sh
   tmp=$(mktemp -d) && cp packages/email/templates/auth_verify_email.mjml "$tmp/index.mjml" \
     && (cd "$tmp" && zip -q auth_verify_email.zip index.mjml) && open "$tmp"
   ```
   In Loops, go to **Transactional > New**, open the editor, choose **Code** (styling), and
   upload the zip. Then:
   - Set Subject and Preview from the manifest.
   - Set From and Reply-To as in section 2.
   - Declare each data variable, and mark as optional exactly those with `required: false`.
     `@folevi/email` always sends optional variables, as `""` when absent.
5. **Plain text.** Loops documents no plain-text alternative for transactional email, so we treat
   it as a **limitation**. The `.txt` files are kept for review, accessibility and copy parity. If
   Loops adds a text part, paste the `.txt` there.
6. **Test send.** Use Loops' test send, or `sendTransactional` from a non-prod Convex deployment,
   to an `@example.com` seed inbox (or an allowlisted address) with `emailManifest[key].fixture`.
   Check light and dark mode (Apple Mail, Gmail web and iOS, Outlook). Check that the fallback URL
   line matches the button and that the preview text shows.
7. **Publish** the template in Loops. Unpublished templates return **400**.
8. **Record the id.** Put the `transactionalId` in the env var named by
   `emailManifest[key].envVar`, in every place that sends it:
   - **Convex** (`npx convex env set …`) for security and product templates.
   - **Auth0 Action secrets** for the `auth_*` templates. Then redeploy the Action.
   - **Vercel** only if `apps/web` ever sends directly (it should not).
9. **Verify.** Trigger the real flow once (see the smoke test in `infra/auth0/tenant-checklist.md`).
   Confirm `accepted` in the logs and `email.delivered` through the webhook.

### Rollback and id rotation

- To change a template, **duplicate** it in Loops, edit and publish the copy, then switch the env
  var to the new id. Rolling back means pointing the env var at the old id, which stays published
  until the new one has been live for 7 days, after which you archive it.
- Never edit a published production template in place for a variable change. A new required
  variable must ship in code **before** the template that uses it. Otherwise Loops returns
  `400 Missing required data variable`.
- `sendTransactional` returns `template_not_configured` for a missing or malformed id, and
  `template_not_found` for a 404. Both are non-retryable, so alert on them.

## 5. Monitoring

- **Loops dashboard:** open **Transactional**, select the template, and view its metrics (sends,
  deliveries, bounces, complaints; the UI labels may change). Check them weekly, and after every
  template change.
- **Folevi logs:** `sendTransactional` outcomes (`status`, `errorCode`, `attempts`,
  `httpStatus`), with no payload and no address. Log `redactEmail()` or `hashRecipient()` only.
- **Auth0 logs:** the custom-email-provider Action writes JSON lines with
  `src: "folevi.custom-email-provider"`. Alert on any `drop` with reason `link_not_found`,
  `code_not_found`, `template_not_configured` or `loops_http_4xx`.
- **Rate limit:** Loops allows 10 requests/s per team (headers `x-ratelimit-limit` and
  `x-ratelimit-remaining`). Send digests from a queue at 5/s or less.

## 6. Webhooks (delivery state)

- **Endpoint:** `https://<convex-site-url>/webhooks/loops`. This is the Convex HTTP action,
  where `<convex-site-url>` is the deployment's `.convex.site` URL. Configure it in Loops under
  **Settings > Webhooks**, and subscribe to `transactional.email.sent`, `email.delivered`,
  `email.softBounced`, `email.hardBounced` and `email.spamReported`.
- **Secret:** copy the signing secret (`whsec_…`) into the Convex env var `LOOPS_WEBHOOK_SECRET`.
- **Handler contract:**
  1. Read the **raw** body.
  2. Call `verifyLoopsWebhook({ id: Webhook-Id, timestamp: Webhook-Timestamp, signature: Webhook-Signature, rawBody, secret })`.
     If it fails, return 401.
  3. Dedupe on `Webhook-Id`. If already stored, return 200.
  4. Call `parseLoopsWebhook(rawBody)` and store `{eventName, eventTime, transactionalId, emailId, recipientHash: hashRecipient(recipient, FOLEVI_EMAIL_HASH_SALT)}`.
     Never store the raw address in event rows.
  5. Return 2xx quickly. Loops retries up to 8 times over about 28 h, and disables the endpoint
     after 5 days of failures.
- **Policy on events:**
  - `email.hardBounced` or `email.spamReported`: stop product notifications to that address
    (Folevi-side). Show an in-app banner asking the user to check their address.
  - Identity mail is still attempted, since Auth0 triggers it.
- **Rotating the secret:** rotate in Loops, then update `LOOPS_WEBHOOK_SECRET` within 24 h. The
  old secret stays valid for 24 h.

## 7. Environment variables

| Name                                                | Where                                   | Purpose                                                                                                                                         |
| --------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOOPS_API_KEY`                                     | Convex, Auth0 Action secret             | Bearer key for the transactional API. Test it with `GET https://app.loops.so/api/v1/api-key`. Keep a separate key per environment.              |
| `LOOPS_SENDING_DOMAIN`                              | docs / Loops settings (Convex optional) | `mail.folevi.com` or `mail-staging.folevi.com`. Informational: the From address is set per template in Loops.                                   |
| `LOOPS_WEBHOOK_SECRET`                              | Convex                                  | `whsec_…` signing secret for `/webhooks/loops`.                                                                                                 |
| `LOOPS_TRANSACTIONAL_AUTH_VERIFY_EMAIL_ID`          | Auth0 Action secret                     | `auth_verify_email`                                                                                                                             |
| `LOOPS_TRANSACTIONAL_AUTH_PASSWORD_RESET_ID`        | Auth0 Action secret                     | `auth_password_reset`                                                                                                                           |
| `LOOPS_TRANSACTIONAL_AUTH_BLOCKED_ACCOUNT_ID`       | Auth0 Action secret                     | `auth_blocked_account`                                                                                                                          |
| `LOOPS_TRANSACTIONAL_AUTH_BREACHED_PASSWORD_ID`     | Auth0 Action secret                     | `auth_breached_password`                                                                                                                        |
| `LOOPS_TRANSACTIONAL_AUTH_VERIFICATION_CODE_ID`     | Auth0 Action secret                     | `auth_verification_code` (code flows)                                                                                                           |
| `LOOPS_TRANSACTIONAL_SECURITY_NEW_DEVICE_ID`        | Convex                                  | `security_new_device`                                                                                                                           |
| `LOOPS_TRANSACTIONAL_ACCOUNT_DELETION_SCHEDULED_ID` | Convex                                  | `account_deletion_scheduled`                                                                                                                    |
| `LOOPS_TRANSACTIONAL_ACCOUNT_DELETION_COMPLETED_ID` | Convex                                  | `account_deletion_completed`                                                                                                                    |
| `LOOPS_TRANSACTIONAL_WORKSPACE_INVITE_ID`           | Convex                                  | `workspace_invite`                                                                                                                              |
| `LOOPS_TRANSACTIONAL_MENTION_NOTIFICATION_ID`       | Convex                                  | `mention_notification`                                                                                                                          |
| `LOOPS_TRANSACTIONAL_COMMENT_NOTIFICATION_ID`       | Convex                                  | `comment_notification`                                                                                                                          |
| `LOOPS_TRANSACTIONAL_COMMENT_DIGEST_ID`             | Convex                                  | `comment_digest`                                                                                                                                |
| `LOOPS_TRANSACTIONAL_SHARE_NOTIFICATION_ID`         | Convex                                  | `share_notification`                                                                                                                            |
| `FOLEVI_EMAIL_ENVIRONMENT`                          | Convex (suggested name)                 | `production`, `preview`, `development` or `test`, which becomes `SendPolicy.environment`. Treat anything other than `production` as restricted. |
| `FOLEVI_EMAIL_ALLOWLIST`                            | Convex, Auth0 Action secret             | Comma-separated exact addresses allowed outside production.                                                                                     |
| `FOLEVI_EMAIL_HASH_SALT`                            | Convex (suggested name)                 | Salt for `hashRecipient()`. It is secret, random, and never rotated without a migration.                                                        |
| `FOLEVI_EMAIL_ALLOWLIST_MODE`                       | Auth0 Action secret                     | `off` (production tenant only) or `test-domains`. If unset, it behaves as `test-domains`.                                                       |
| `AUTH0_LINK_HOSTS`                                  | Auth0 Action secret                     | Accepted link hosts, for example `auth.folevi.com,folevi.us.auth0.com`.                                                                         |
| `AUTH0_VERIFY_EMAIL_TTL_HOURS`                      | Auth0 Action secret                     | Default `24`. Must equal the Auth0 Verification Email URL lifetime.                                                                             |
| `AUTH0_RESET_PASSWORD_TTL_HOURS`                    | Auth0 Action secret                     | Default `1`. Must equal the Change Password URL lifetime.                                                                                       |
| `AUTH0_BLOCKED_ACCOUNT_TTL_HOURS`                   | Auth0 Action secret                     | Default `24`.                                                                                                                                   |
| `AUTH0_BREACHED_PASSWORD_TTL_HOURS`                 | Auth0 Action secret                     | Default `24`.                                                                                                                                   |
| `AUTH0_CODE_TTL_MINUTES`                            | Auth0 Action secret                     | Default `10`.                                                                                                                                   |
| `FOLEVI_PASSWORD_RESET_URL`                         | Auth0 Action secret                     | First-party https URL, used only for breached-password notices that have no Auth0 link.                                                         |

The Management API M2M credentials used by the backend (resend verification, tickets,
suspension) are named by the backend owners. The required scopes are listed in
`infra/auth0/README.md`.
