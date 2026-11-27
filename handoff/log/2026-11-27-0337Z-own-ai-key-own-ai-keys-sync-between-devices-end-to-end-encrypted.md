# Own AI keys sync between devices, end-to-end encrypted

- Date: 2026-11-27 03:37 UTC
- Area: web
- Branch: claude/own-ai-key

For accounts with encryption set up, each own AI key is sealed on the device with the account master key (AMK account/records, context record/account/<profileId>/aiKey/<provider>) and kept in the new e2eeAccountRecords table (convex/e2ee/accountRecords.ts: list, put, remove; owner only, current epoch only, 4 KB, rate rule e2eeAccountRecords; deleted with the account). apps/web/src/lib/ai/ownKeySync.ts syncs when the key session unlocks (AccountGate) and before a request with no key: opens keys saved elsewhere, forgets removed ones (removal leaves an empty row), seals again keys only this device has or sealed before a reset. Public computers keep synced keys in memory only. Accounts without encryption keep keys per device. The provider and model choice is still per device.

Tests: tests/convex/e2ee-account-records.test.ts (3), apps/web/test/e2ee/own-key-sync.test.ts (4, with accountRecords in keysFakeServer.ts). Full suites: Convex 1263 passed; web 2397 passed (spellcheck-scan timing test failed once under load, passes alone). convex/_generated/api.d.ts regenerated against the dev deployment (also picked up lib/deployment, lib/freshSession, lib/pushEndpoints that main hadn't regenerated).

Not checked in the running apps.
