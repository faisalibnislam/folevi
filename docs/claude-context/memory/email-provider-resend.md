---
name: email-provider-resend
description: Folevi email is Resend only (Mailtrap/ImprovMX gone); one Resend domain folevi.com sends and receives; sending blocked on 2026-10-15 by Resend's pending "send" SPF records
metadata:
  type: project
---

Since 2026-10-14/15 all Folevi email goes through Resend; Mailtrap and ImprovMX are fully removed (DNS, Convex env, Mailtrap account webhooks/domain; user deleted the Mailtrap inbox).

- One Resend domain: **folevi.com** (sending + receiving). mail.folevi.com was deleted from Resend at the user's request. Senders: security@, hello@, support@folevi.com (EMAIL_SENDING_DOMAIN default in packages/email/src/manifest.ts).
- DNS at Namecheap (user's browser; I can edit via the Browser pane): TXT resend._domainkey, MX+TXT on `send`, CNAME rsend, MX @ inbound-smtp.us-east-1.amazonaws.com (9), TXT _dmarc `v=DMARC1; p=none; rua=mailto:dmarc-reports@folevi.com; fo=1`.
- Production Convex: RESEND_API_KEY (key "Folevi production (Convex)"), RESEND_WEBHOOK_SECRET (webhook → fastidious-clownfish-123.convex.site/webhooks/resend), EMAIL_REPLY_TO=support@folevi.com, SUPPORT_NOTIFY_EMAIL = user's Gmail. Vercel has no email vars (email is sent from Convex only).
- **Open issue (2026-10-15):** Resend shows folevi.com partially_verified: DKIM, rsend CNAME and receiving MX verified, but the two `send` records (SPF MX/TXT) stuck "pending" for hours though correct on the authoritative nameservers. Resend refuses all sends ("domain is not verified"), so production can receive but not send. User said "we will get back to resend later"; next step is Resend "Restart verification" or Resend support. After it verifies, test with a password reset and check `emailSendAttempts` on prod.
- Never touch the user's other Resend domains/keys/webhooks (taskeni, formkit, involets, meetrao).
