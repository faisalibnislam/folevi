# Backend (Convex, `convex/`)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- Production is `fastidious-clownfish-123` (never `--prod`; `handoff/guide.md` section 8). A merge to `main` deploys it with the website.
- Note text lives in `documentText` (PR 93). The owner ran `migrations:narrowDocumentText` on production on 2026-11-25; its first answer was `{ cleared: 100, done: false }` and it schedules its own next pages. Nobody checked that every page finished.
- Foli AI: Folevi Cloud routes each feature to Gemini, OpenAI or Anthropic (`convex/aiConfig.ts`, `convex/lib/ai/provider.ts`); a Folevi Server takes its provider from the server's settings (`serverRoute`, `convex/lib/ai/openaiCompatible.ts`).
- Foli AI on the person's own key (2026-11-27, `convex/lib/ai/ownKey.ts`, docs/AI_ASSISTANT.md "Your own AI key"): AI actions take `ownKey`; own-key holds hold and charge no credits on any plan, keep the hourly limit, and never store or log the key. Accounts with encryption on share their keys between devices sealed with the master key (`convex/e2ee/accountRecords.ts`).
- `convex/auth.config.ts` must not read environment variables (Convex refuses the deploy); the server bundle has its own (`server/bundle/auth.config.server.ts`).

## Next steps

- Confirm `narrowDocumentText` finished (no `documents` row with `searchText` that also has a `documentText` row).
- Own AI keys: run deep research inline (not scheduled) when it carries a key; a server owner switch to turn own keys off; the pricing branch's "Turn off Foli AI" must also stop own-key requests.
- `migrations:backfillListStats` is optional and speeds up existing folders (the owner's OK first).

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
