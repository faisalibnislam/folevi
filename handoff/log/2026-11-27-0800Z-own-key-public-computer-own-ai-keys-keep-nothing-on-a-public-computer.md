# Own AI keys keep nothing on a public computer's disk

- Date: 2026-11-27
- Area: web
- Branch: claude/own-key-public-computer

What changed: `e2e/e2ee-unlock.spec.ts:36` found `folevi-own-ai-key` on a public computer's disk. The first own-key
sync after unlocking read the page store, and opening it created the database, key or no key.
- `lib/ai/ownKey.ts`: only saving a key creates the IndexedDB store. Reading, syncing and removing check that it
  exists first (`storeExists`, which aborts the upgrade a new database would need) and create nothing.
- On a public or shared computer (`sessionImpl().isPublic()`), keys never touch disk or the keychain. A key saved
  there or synced from another device is kept in this tab's memory (`ownKeySync.ts` keepInMemory), and it's
  still sealed for the person's other devices. Locking clears it, as before.
- `OwnKeyCard.tsx` says so on a public computer: "your key isn't saved here. It's kept in this tab until you
  close it."
- Sign-out and "Forget this browser" on a trusted computer already delete the store (`clearAllLocalData` calls
  `clearPageOwnKeys`), and `clearPublicDatabases` deletes it on a public computer's next load. Neither changed.

Checked: new `apps/web/test/e2ee/own-key-store.test.ts` (3 tests; all fail on the old code). The web suite passes
(2455), and web typecheck and eslint are clean. The e2e spec runs only in CI.

Left: the choice (provider and model) and when each key was last saved stay in localStorage on a public computer.
They hold no key.
