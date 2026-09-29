# Support

How Folevi's support requests work: where they come from, how staff answer them, and how to set up
`support@folevi.com` so that email becomes tickets. Email sending in general is in
[EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md); roles and auditing in [ADMIN.md](./ADMIN.md).

## 1. How a ticket flows

```
folevi.com/support ─┐                                   ┌─ confirmation email "[Folevi #1042] We got your message"
app: Help / menu ───┼─ POST /api/support ─ support.submit ─┤  (from support@mail.folevi.com, Reply-To support@folevi.com)
                    │   (web server)       (Convex)        └─ staff notified (in-app, and SUPPORT_NOTIFY_EMAIL if set)
email to support@ ──┴─ Mailtrap Email Inbound ─ POST <convex-site>/webhooks/mailtrap-inbound ─ support.ingestInbound
```

- **Sources.** The public page (`/support`, signed out), the app (Help → **Contact support**, and **Contact
  support…** in the account menu), and email to `support@folevi.com`. Each ticket records its source:
  `web_form`, `in_app` or `email`.
- **Numbers.** Tickets get a sequential number starting at 1001 (a counter row in `systemSettings`,
  `support_ticket_counter`). Every email about a ticket has `[Folevi #N]` in its subject.
- **Accounts.** The account is attached only from the signed-in session (the web server forwards the session
  to Convex; the browser never sends an account id). Signed in, the ticket uses the account's address
  whatever the form says. A request sent signed out, or by email, is never linked to an account, because
  anyone can type an address or forge a From line. The ticket page tells staff when an account merely
  uses the same address.
- **Statuses.** `open` (waiting on us), `pending` (we replied; waiting on them), `closed`. A staff reply
  sets `pending`. A message from the requester (by email or from the app) reopens the ticket as `open`
  and marks it unread for staff.
- **Staff replies** are emailed from `support@mail.folevi.com` (Reply-To `support@folevi.com`) with `[Folevi #N] Reply from Folevi support`,
  threaded (In-Reply-To / References) to the requester's latest email when there is one. They also show in
  the requester's **Help → Your support requests** list (when the ticket came from their account), and
  they get an in-app notification.
- **Internal notes** are staff-only: never emailed, never shown to the requester.
- **Staff notifications.** Every active platform staff member (support staff, admins, owners) gets an
  in-app notification per ticket ("New support request #N" or "…has a new reply"), once until they read it.
  With `SUPPORT_NOTIFY_EMAIL` set, that address also gets a short notice (no message text, a link to the
  ticket) from the sending domain with no Reply-To. The support and security mailboxes and the requester's
  own address are never used for it, so a notice can't loop back into a ticket.

### Abuse and privacy controls

| Control | Where |
| --- | --- |
| The web server proves itself with `FOLEVI_SERVER_SECRET`; Convex refuses other callers | `support.submit` |
| Per client (hashed IP) 10 requests an hour; per requester address 5 an hour (also in-app replies) | `lib/rateLimit.ts`: `supportSubmit`, `supportSubmitEmail` (admin-tunable) |
| Honeypot field (`website`): filled in, the request is dropped with an answer that looks the same | `support.submit` |
| Lengths: name 80, message 10 to 5,000 characters, staff reply 10,000; control characters removed | `lib/support.ts` |
| The same answer whether or not an address has an account | `support.submit` |
| Inbound: 20 messages an hour per sender; beyond that they're dropped (Mailtrap keeps its copy) | `supportInbound` |
| Logs hold ticket numbers, counts and outcome codes, never addresses or message text | `support.ts`, `http.ts`, `/api/support` |
| Non-production never emails real people (sandbox or allowlist, [EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md) §4); support mail is also captured in the development mailbox | `lib/support`, `authEmails.recordDevMail` |

The confirmation quotes the requester's own message back to the address they typed, so a signed-out
visitor could make Folevi send their text to someone else's address. The per-address and per-client
limits keep that to a trickle, markup can't survive (angle brackets become ‹ ›), and the email says to
ignore it if you didn't write to us.

## 2. Inbound email: how it works

Mailtrap Email Inbound receives the mail, stores it in an inbound inbox and posts an `inbound_receiving`
webhook for each new message. The webhook carries ids only (`event: "inbound.message_received"`,
`event_id`, `inbox_id`, `message_id`, the sender's name), so Convex then reads the message from Mailtrap's
Messages API (`GET https://mailtrap.io/api/inbound/inboxes/{inbox_id}/messages/{id}`).

`POST /webhooks/mailtrap-inbound` (`convex/http.ts`):

1. `Mailtrap-Signature` must be the hex HMAC-SHA256 of the raw body under
   `MAILTRAP_INBOUND_WEBHOOK_SECRET`, compared in constant time. Missing secret, missing or wrong signature:
   `401`. Signed but malformed body: `400`. Bodies over 256 KB: `413`.
2. Each event is skipped if that Mailtrap message was already filed. Otherwise the message is fetched with
   `MAILTRAP_INBOUND_API_TOKEN`. If the token is missing or Mailtrap can't be reached, the answer is `503`
   and Mailtrap retries (every 5 minutes, up to 40 times); already-filed messages are skipped then.
3. `support.ingestInbound` files it:
   - **Duplicates** (same Mailtrap id, or same `Message-ID`) are ignored.
   - **Automatic mail** is ignored: `Auto-Submitted` other than `no`, `X-Autoreply`/`X-Autorespond`,
     `Precedence: bulk|junk|list|auto_reply`, bounces (`X-Failed-Recipients`, empty Return-Path,
     `multipart/report`), `mailer-daemon@`/`postmaster@` senders, and "Out of office" / "Undeliverable"
     style subjects.
   - Mail **from folevi.com** itself is ignored (no loops).
   - With a catch-all inbox every folevi.com address arrives. Only mail to `support@` (and `security@`,
     filed with the topic Security) becomes a ticket; mail addressed only to other folevi.com mailboxes is
     ignored. Mail whose To/Cc names no folevi.com address at all (forwarded, or Bcc) is treated as support.
   - **Threading:** `[Folevi #N]` in the subject **and** the sender equal to ticket N's requester adds the
     message to ticket N (reopening it). A tag from anyone else opens a new ticket instead.
   - Otherwise a new ticket with source `email` (subject without `Re:`/`Fwd:`), and a confirmation email.
   - Text: the plain-text part, else the HTML turned into text; quoted history is cut ("On … wrote:",
     `-----Original Message-----`, Outlook's `From:` block, lines starting with `>`). Capped at 20,000
     characters. Attachments are not imported (they stay in Mailtrap).

## 3. Setting it up (owner checklist)

Do these once per environment that should receive support email (normally only production). Always use
the values Mailtrap shows for your account.

### Sending support mail

Support mail comes **from `Folevi Support <support@mail.folevi.com>`** with **Reply-To
`support@folevi.com`**, so replies come back to the support mailbox. `mail.folevi.com` is already a verified
Mailtrap sending domain (EMAIL_OPERATIONS.md), so nothing extra is needed to send.

### Receiving support@folevi.com

**First check where folevi.com mail goes today:** `dig MX folevi.com`. A custom-domain catch-all inbox
takes **all** mail for the domain, so if folevi.com already receives mail elsewhere (for example Google
Workspace for people's own mailboxes), pointing its MX at Mailtrap moves all of it. In that case use
option B.

**A. folevi.com MX points at Mailtrap (catch-all inbox on folevi.com)**

1. Mailtrap → **Domains** → `folevi.com` → **Domain Verification** → turn on **Inbound domain receiving**,
   and add the **MX record** it shows at Namecheap (Advanced DNS → Mail settings: Custom MX, host `@`).
   Remove any other MX records for `@`.
2. Create the inbound inbox on that domain through the API (the Inbound UI is API-first; an account-level
   token is needed to create inboxes):
   ```sh
   curl -X POST https://mailtrap.io/api/inbound/folders -H 'Authorization: Bearer <account token>' \
     -H 'Content-Type: application/json' -d '{"name":"Support"}'
   curl -X POST https://mailtrap.io/api/inbound/folders/<folder_id>/inboxes -H 'Authorization: Bearer <account token>' \
     -H 'Content-Type: application/json' -d '{"name":"Support tickets","domain_id":<folevi.com domain id>}'
   ```
   The answer shows `"address": "*@folevi.com"`. Note the inbox id.
3. Mail for other folevi.com addresses (`security@`, `dmarc-reports@`, …) now lands in this inbox too.
   `security@` becomes a Security ticket; everything else is ignored by Folevi but kept in the Mailtrap
   inbox (read it with the Messages API). Consider sending DMARC reports (`rua=`) to an address on another
   domain.

**B. Keep folevi.com's mail provider and forward**

1. Create a hosted inbound inbox (no DNS needed): the same two API calls without `domain_id`. It gets an
   address like `support-xxxx@inbound-mailtrap.io`.
2. In the current mail provider, forward `support@folevi.com` to that address (keep a copy if you like).
   Forwarding keeps `To: support@folevi.com`, so Folevi files it as support.

### Webhook and token (both options)

1. Mailtrap → **Webhooks** → **Create New Webhook** (or `POST /api/webhooks` with
   `"webhook_type": "inbound_receiving"`, optionally `"inbound_inbox_id"`):
   - URL: `https://<prod-deployment>.convex.site/webhooks/mailtrap-inbound` (the `.convex.site` host)
   - Type: **Inbound Inboxes**, the support inbox; payload JSON.
2. Copy its **signing secret** and store it, and an API token that can **read** that inbound inbox:
   ```sh
   npx convex env set MAILTRAP_INBOUND_WEBHOOK_SECRET --deployment <prod-deployment>   # prompts
   npx convex env set MAILTRAP_INBOUND_API_TOKEN --deployment <prod-deployment>        # prompts
   ```
3. Optional: `npx convex env set SUPPORT_NOTIFY_EMAIL team@example.com --deployment <prod-deployment>`
   (a staff address, not `support@` or `security@`).
4. Test: send an email to `support@folevi.com` from a personal address. Within a minute it shows as a new
   ticket in **Admin → Support**, with a confirmation in your inbox. Reply to that confirmation: the reply
   joins the same ticket. Convex logs show one `support.inbound` line per webhook with outcome counts.

### Rotating

- **Webhook secret:** create a new secret in Mailtrap, then set `MAILTRAP_INBOUND_WEBHOOK_SECRET` right
  away. Deliveries signed with the old one get `401` and Mailtrap retries them.
- **API token:** create the new token, set `MAILTRAP_INBOUND_API_TOKEN`, then revoke the old one.

## 4. Environment variables

All on the Convex deployment; none in Vercel.

| Name | Required | Purpose |
| --- | --- | --- |
| `MAILTRAP_INBOUND_WEBHOOK_SECRET` | For inbound email | Signing secret of the `inbound_receiving` webhook. Without it `/webhooks/mailtrap-inbound` refuses everything. |
| `MAILTRAP_INBOUND_API_TOKEN` | For inbound email | Token that can read the inbound inbox's messages. Without it deliveries answer `503` (Mailtrap retries). |
| `SUPPORT_NOTIFY_EMAIL` | No | A staff address emailed on each new ticket and requester reply. |
| `FOLEVI_SERVER_SECRET` | Yes (already) | Lets `/api/support` call `support.submit`. |

`scripts/check-prod-env.mjs` warns when the inbound secret and token aren't set together, or aren't set
at all, and when `SUPPORT_NOTIFY_EMAIL` is a support mailbox. None of them fail the build.

## 5. Where things live

| Piece | Path |
| --- | --- |
| Tables `supportTickets`, `supportMessages` | `convex/schema.ts` |
| Submit, requester list and replies, admin inbox, inbound filing | `convex/support.ts`, `convex/lib/support.ts` |
| Inbound webhook | `convex/http.ts` (`/webhooks/mailtrap-inbound`) |
| Inbound parsing (payload, message, quotes, auto-replies) | `packages/email/src/providers/mailtrapInbound.ts` |
| Templates `support_ticket_received`, `support_reply`, `support_staff_notice` | `packages/email/src/manifest.ts`, `scripts/build-templates.ts` |
| Web server route | `apps/web/src/app/api/support/route.ts` |
| Support page | `apps/web/src/app/(marketing)/support/page.tsx` |
| Form, dialog, "Your support requests" | `apps/web/src/components/support/` |
| Admin inbox and ticket | `apps/web/src/components/admin/SupportInboxView.tsx`, `SupportTicketView.tsx` |
| Tests | `tests/convex/support.test.ts`, `packages/email/test/support.test.ts`, `apps/web/e2e/support.spec.ts` |
