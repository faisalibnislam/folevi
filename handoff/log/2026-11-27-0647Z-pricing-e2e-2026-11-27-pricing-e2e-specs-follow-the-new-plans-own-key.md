# Pricing e2e specs follow the new plans

- Date: 2026-11-27 06:47 UTC
- Area: web
- Branch: claude/pricing-e2e-2026-11-27

The end-to-end specs that still asserted the old pricing now follow docs/PRICING_PLAN.md: admin, pricing, seo, billing, credits, devices, workspace-billing and home-editor. Prices are $2/$20, $4/$40 and $10/$100 with packs at $8 and $15; Pro has 150 credits and Pro AI 450; trial storage is 25 GB and Core 5 GB. Core no longer hides Foli AI, so credits.spec.ts now checks the Foli AI switch instead: off in Settings, Account hides every entry point in Personal, and off in a workspace's Privacy settings hides them in that workspace. devices.spec.ts checks that a third device on Free opens straight away (no plan limits devices). The pricing page defaults to yearly, and the spec starts there.

Product fixes: the credit pack errors in convex/billing.ts no longer say packs are for Pro and Pro AI. The pricing page's h1 read as "Folevi is free ." to screen readers (the period sat outside the circled word); the period is now inside it. The stale comment on tierEntitlements about a 2-device Free limit is gone. The iPhone Settings failure (web buttons on the own-key card) is fixed on claude/iphone-own-key-card, not here.

Running the specs locally while ports 3000 and 3210 are taken: the local backend picks 3212, the web build runs on 3002 with E2E_BASE_URL=http://app.localhost:3002, and TMPDIR must be short (the backend's Node runner can't open its socket under a long temp path).
