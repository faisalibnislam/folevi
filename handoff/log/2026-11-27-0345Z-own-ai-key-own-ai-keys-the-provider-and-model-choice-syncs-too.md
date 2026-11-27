# Own AI keys: the provider and model choice syncs too

- Date: 2026-11-27 03:45 UTC
- Area: web
- Branch: claude/own-ai-key

One more account record under kind aiKey, recordId "choice": { choice: { provider, model } | null }, sealed with the AMK like the keys (convex/e2ee/accountRecords.ts accepts the name). setOwnKeyChoice seals and pushes it; ownKeySync applies a newer one from another device (the newest change wins), checks its provider and model name, and seals this device's choice when the account has none (or only one from before a reset). Removing the key in use turns own keys off everywhere. New syncOwnKeysNow(), which Settings runs when the card opens. Tests: apps/web/test/e2ee/own-key-sync.test.ts (5 now), tests/convex/e2ee-account-records.test.ts. Full web suite 2399 passed. Not checked in the running apps.
