# Backend (Convex, `convex/`)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- Production is `fastidious-clownfish-123` (never `--prod`; `handoff/guide.md` section 8). A merge to `main` deploys it with the website.
- Note text lives in `documentText` (PR 93). The owner ran `migrations:narrowDocumentText` on production on 2026-11-25; its first answer was `{ cleared: 100, done: false }` and it schedules its own next pages. Nobody checked that every page finished.
- Foli AI: Folevi Cloud routes each feature to Gemini, OpenAI or Anthropic (`convex/aiConfig.ts`, `convex/lib/ai/provider.ts`); a Folevi Server takes its provider from the server's settings (`serverRoute`, `convex/lib/ai/openaiCompatible.ts`).
- Plans (2026-11-27, PR 173): Free 500 MB and 30 AI credits, Core $2 (5 GB, no credits), Pro $4 (10 GB, 150), Pro AI $10 (25 GB, 450), packs on every plan, no device limit. Core doesn't block AI; turning Foli AI off is `profiles.aiEnabled` or `workspaces.aiDisabled` (`aiBlockedIn`, `convex/lib/credits.ts`). Rules in `docs/BILLING.md`.
- `convex/auth.config.ts` must not read environment variables (Convex refuses the deploy); the server bundle has its own (`server/bundle/auth.config.server.ts`).

## Next steps

- Set the new prices on the existing Polar products (Admin > Billing setup), not new products: webhooks match by product id.
- Confirm `narrowDocumentText` finished (no `documents` row with `searchText` that also has a `documentText` row).
- `migrations:backfillListStats` is optional and speeds up existing folders (the owner's OK first).

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
