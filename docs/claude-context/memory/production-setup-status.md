---
name: production-setup-status
description: "Folevi production setup as of 2026-09-29: Vercel, Convex prod, Namecheap DNS, Mailtrap sending, support@ via ImprovMX to Mailtrap Inbound; what's left"
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-09-29T17:17:32.717Z
---

State as of 2026-09-29 (late):

**Hosting and data**
- Vercel project `faisalibnislam/folevi` (Root Directory `apps/web`) serves `folevi.com` (site) and `app.folevi.com` (app); `www` redirects. Convex deploys inside the Vercel build.
- Convex prod deployment is `fastidious-clownfish-123`. Always pass `--deployment fastidious-clownfish-123`; in this checkout `--prod` hits the local backend.
- User `faisalibnislam@gmail.com` is super admin on prod, with 2FA on. `GEMINI_API_KEY` is set. Stripe is not set up yet.
- Account-model migration and clean-up are done in prod (verifier `ok: true`).

**Sending email (Mailtrap, free plan)**
- The free plan allows only one sending domain: `mail.folevi.com`, which is verified.
- All mail goes out through the Mailtrap API. Prod env has `MAILTRAP_API_TOKEN` and `MAILTRAP_WEBHOOK_SECRET`. Tracking, the footer and Auto BCC are off.
- Support mail is sent from `Folevi Support <support@mail.folevi.com>` with Reply-To `support@folevi.com`.
- Loops is fully removed.

**Receiving support@folevi.com (working 2026-09-29)**
- Mail to folevi.com goes to ImprovMX (free plan; MX `@` → mx1/mx2.improvmx.com; Namecheap Mail Settings is Custom MX). The aliases `support@` and `security@` forward to the Mailtrap-hosted inbound inbox `support-folevi-com-0fa0e07f@inbound-mailtrap.io` (inbox 3651, folder "Folevi support" 1333).
- From there a Mailtrap webhook calls `/webhooks/mailtrap-inbound`, which files each email as a ticket.
- Prod env has `MAILTRAP_INBOUND_WEBHOOK_SECRET` and `MAILTRAP_INBOUND_API_TOKEN`. `SUPPORT_NOTIFY_EMAIL` is set to the user's Gmail.
- Keep the MX record for host `mail` (→ inbound.smtp.mailtrap.io); it belongs to the sending domain. Never switch Namecheap Mail Settings to "Email Forwarding": that mode wipes the Custom MX records.
- DMARC lives on `_dmarc.folevi.com`.
- Tested: tickets #1001–1003 were created, and email replies thread back into their ticket.
- Google-hosted senders were delayed about 20 minutes after the MX records were first added, because of cached negative DNS answers.

**Left**
- Stripe keys.
- Unchecked on prod: revoking a session from a second browser, creating and revoking a public link, export.
- The user pasted an ImprovMX API key in chat on 2026-09-29. It is exposed: remind them to rotate it, and never use it.

**How to apply:** The user sets every secret themselves; I never use or enter keys. Commands run from the chat's `!` mode can't read typed input, so give `"$(pbpaste)"`-style commands, not `read -s`. This Mac's network blocks outbound port 25. See [[push-after-changes]].
