# Support

How Folevi's support requests work: where they come from, how staff answer them, and how to set up
`support@folevi.com` so that email becomes tickets. Email sending in general is in
[EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md); roles and auditing in [ADMIN.md](./ADMIN.md).

## 1. How a ticket flows

```
folevi.com/support ─┐                                   ┌─ confirmation email "[Folevi #1042] We got your message"
app: Help / menu ───┼─ POST /api/support ─ support.submit ─┤  (from support@folevi.com, Reply-To support@folevi.com)
                    │   (web server)       (Convex)        └─ staff notified (in-app, and SUPPORT_NOTIFY_EMAIL if set)
email to support@ ──┴─ Resend receiving ─ POST <convex-site>/webhooks/resend (email.received) ─ support.ingestInbound
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
- **Staff replies** are emailed from `support@folevi.com` (Reply-To `support@folevi.com`) with `[Folevi #N] Reply from Folevi support`,
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
| Inbound: 20 messages an hour per sender; beyond that they're dropped (Resend keeps its copy) | `supportInbound` |
| Logs hold ticket numbers, counts and outcome codes, never addresses or message text | `support.ts`, `http.ts`, `/api/support` |
| Non-production never emails real people (test or allowlisted addresses only, [EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md) §4); support mail is also captured in the development mailbox | `lib/support`, `authEmails.recordDevMail` |

The confirmation quotes the requester's own message back to the address they typed, so a signed-out
visitor could make Folevi send their text to someone else's address. The per-address and per-client
limits keep that to a trickle, markup can't survive (angle brackets become ‹ ›), and the email says to
ignore it if you didn't write to us.

## 2. Inbound email: how it works

`folevi.com`'s MX points at Resend's receiving, so Resend receives the mail for every folevi.com address.
For each message it posts an `email.received` webhook to the same endpoint as delivery events. The event
carries only metadata (the Resend email id among it), so Convex then reads the message from Resend's
Received emails API (`GET https://api.resend.com/emails/receiving/{id}`), which returns it parsed: from,
to, cc, subject, text, HTML, headers and the RFC `Message-ID`.

`POST /webhooks/resend` (`convex/http.ts`), for `email.received`:

1. The Svix signature must verify under `RESEND_WEBHOOK_SECRET` ([EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md)
   §7). Missing secret, missing or wrong signature: `401`. Signed but malformed body: `400`. Bodies over
   256 KB: `413`.
2. The event is skipped if that Resend email was already filed. Otherwise the message is fetched with
   `RESEND_API_KEY` (full access). If the key is missing or Resend's API can't be reached, the answer is
   `503` and Resend retries; already-filed messages are skipped then. A message Resend no longer has is
   dropped.
3. `support.ingestInbound` files it:
   - **Duplicates** (same Resend email id, or same `Message-ID`) are ignored.
   - **Automatic mail** is ignored: `Auto-Submitted` other than `no`, `X-Autoreply`/`X-Autorespond`,
     `Precedence: bulk|junk|list|auto_reply`, bounces (`X-Failed-Recipients`, empty Return-Path,
     `multipart/report`), `mailer-daemon@`/`postmaster@` senders, and "Out of office" / "Undeliverable"
     style subjects.
   - Mail **from folevi.com** itself is ignored (no loops).
   - Only mail to `support@` (and `security@`, filed with the topic Security) becomes a ticket; mail
     addressed only to other folevi.com mailboxes is ignored. Mail for an email-to-note address
     (`n-<token>@folevi.com`) is routed to `emailNotes.receive` instead and never reaches support
     unless support@ is a recipient too. Mail whose To/Cc names no folevi.com
     address at all (forwarded, or Bcc) is treated as support.
   - **Threading:** `[Folevi #N]` in the subject **and** the sender equal to ticket N's requester adds the
     message to ticket N (reopening it). A tag from anyone else opens a new ticket instead.
   - Otherwise a new ticket with source `email` (subject without `Re:`/`Fwd:`), and a confirmation email.
   - Text: the plain-text part, else the HTML turned into text; quoted history is cut ("On … wrote:",
     `-----Original Message-----`, Outlook's `From:` block, lines starting with `>`). Capped at 20,000
     characters. Attachments are not imported (they stay in Resend).

## 3. Setting it up (owner checklist)

Do these once per environment that should receive support email (normally only production). Always copy
the exact records from Resend → **Domains** for your account.

### Sending support mail

Support mail comes **from `Folevi Support <support@folevi.com>`** with **Reply-To
`support@folevi.com`**, so replies come back to the support mailbox. `folevi.com` is Folevi's one Resend
domain, verified for sending and receiving (EMAIL_OPERATIONS.md), so nothing extra is needed to send.

### Receiving support@folevi.com

1. **First check where folevi.com mail goes today:** `dig MX folevi.com`. Receiving on Resend takes
   **all** mail for the domain. Folevi turns only `support@` and `security@` into tickets, and mail to
   people's email-to-note addresses (`n-<token>@folevi.com`) into notes (same MX and webhook, see
   [EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md) §7a); mail for any other folevi.com address
   (`dmarc-reports@`, …) stays in Resend's received emails and nothing else delivers it.
2. **Turn on receiving for `folevi.com`** in Resend → **Domains** (add the domain if it isn't there).
   Resend shows the MX record to add.
3. **Add the MX record at the DNS host** (folevi.com's DNS is at Namecheap: **Domain List** → `folevi.com` → **Advanced DNS**), on the apex
   (`@`, empty name), with the exact value and priority Resend shows. It must be the lowest-priority
   (most preferred) MX for `folevi.com`, and best the only one: remove any other MX records for `@`.
4. **Verify** in Resend, and confirm with `dig MX folevi.com`.

### Webhook and key

1. The same Resend webhook as sending ([EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md) §1, step 7) must
   include **`email.received`**, at `https://<prod-deployment>.convex.site/webhooks/resend` (the
   `.convex.site` host). There is no second webhook or secret for support.
2. `RESEND_API_KEY` must have **Full access**: a sending-only key can't read received mail, and every
   delivery would then fail (`fetch_401` or `fetch_403` in the logs).
3. Optional: `npx convex env set SUPPORT_NOTIFY_EMAIL team@example.com --deployment <prod-deployment>`
   (a staff address, not `support@` or `security@`).
4. Test: send an email to `support@folevi.com` from a personal address. Within a minute it shows as a new
   ticket in **Admin → Support**, with a confirmation in your inbox. Reply to that confirmation: the reply
   joins the same ticket. Convex logs show one `support.inbound` line per message with its outcome
   (`created`, `appended`, `duplicate`, `ignored_…`, `rate_limited`, `not_configured`, `fetch_<status>`).

### Rotating

- **Webhook secret:** shared with delivery events; see [EMAIL_OPERATIONS.md](./EMAIL_OPERATIONS.md) §7.
  Deliveries signed with the old one get `401` and Resend retries them.
- **API key:** create a new full-access key, set `RESEND_API_KEY`, then revoke the old one. Sending uses
  the same key.

## 4. Environment variables

All on the Convex deployment; none in Vercel.

| Name | Required | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | Yes (in production) | Full-access Resend key: sends all email and reads received mail. Without it inbound deliveries answer `503` (Resend retries). |
| `RESEND_WEBHOOK_SECRET` | For inbound email | Signing secret (`whsec_…`) of the Resend webhook. Without it `/webhooks/resend` refuses everything. |
| `SUPPORT_NOTIFY_EMAIL` | No | A staff address emailed on each new ticket and requester reply. |
| `FOLEVI_SERVER_SECRET` | Yes (already) | Lets `/api/support` call `support.submit`. |

`scripts/check-prod-env.mjs` fails a production build without `RESEND_API_KEY`, and warns when
`RESEND_WEBHOOK_SECRET` isn't set (email to support@ never becomes a ticket) and when
`SUPPORT_NOTIFY_EMAIL` is a support mailbox.

## 5. Where things live

| Piece | Path |
| --- | --- |
| Tables `supportTickets`, `supportMessages` | `convex/schema.ts` |
| Submit, requester list and replies, admin inbox, inbound filing | `convex/support.ts`, `convex/lib/support.ts` |
| Inbound webhook | `convex/http.ts` (`/webhooks/resend`, `email.received`) |
| Webhook signature and event parsing | `packages/email/src/providers/resendWebhook.ts` |
| Received-email fetch and parsing (message, quotes, auto-replies) | `packages/email/src/providers/inbound.ts` |
| Email to note (n- addresses, sharing this route) | `convex/emailNotes.ts`, `convex/lib/emailNotes.ts` |
| Templates `support_ticket_received`, `support_reply`, `support_staff_notice` | `packages/email/src/manifest.ts`, `scripts/build-templates.ts` |
| Web server route | `apps/web/src/app/api/support/route.ts` |
| Support page | `apps/web/src/app/(marketing)/support/page.tsx` |
| Form, dialog, "Your support requests" | `apps/web/src/components/support/` |
| Admin inbox and ticket | `apps/web/src/components/admin/SupportInboxView.tsx`, `SupportTicketView.tsx` |
| Tests | `tests/convex/support.test.ts`, `packages/email/test/support.test.ts`, `apps/web/e2e/support.spec.ts` |
