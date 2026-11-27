# New pricing: every app is free, pay only for Folevi Cloud

- Date: 2026-11-27 03:49 UTC
- Area: backend
- Branch: claude/pricing-2026-11-27

Branch claude/pricing-2026-11-27, PR 173. Plan: docs/PRICING_PLAN.md; rules: docs/BILLING.md.

- Prices (owner, 2026-11-27): Free 500 MB and 30 AI credits a month; Core $2 a month or $20 a year (5 GB, no credits); Pro $4 / $40 (10 GB, 150 credits); Pro AI $10 / $100 (25 GB, 450 credits). Credit packs 500 for $8 and 1,000 for $15 on every plan. No device limit on any plan (an admin override still works).
- Core no longer blocks Foli AI. Turning it off is a setting: profiles.aiEnabled for a person, workspaces.aiDisabled for a workspace (workspaces.setAiDisabled, Settings > Workspace > Privacy), both enforced in aiBlockedIn (convex/lib/credits.ts).
- There are no paying users yet, so nobody is kept on old terms.
- Copy updated: pricing page (yearly by default), home, Foli AI, compare, features, docs, support, server, downloads, terms, blog, in-app, admin, Mac and iPhone.
- Tests: Convex 1258 passed; web passes apart from the spell-check timing test, which flakes under full load.

Left for the owner: review the terms page wording (plan and Foli AI paragraphs); set the new prices on the existing Polar products (Admin > Billing setup shows what Polar should have; webhooks match by product id, so don't create new products); ship Mac and iPhone builds for the string changes. Own AI keys on Folevi Cloud are PR 172.
