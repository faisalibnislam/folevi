# Integration day: website pages, new pricing and own AI keys are in main and deployed

- Date: 2026-11-27 09:17 UTC
- Area: repo, release, web
- Branch: claude/handoff-integration-2026-11-27

The owner asked the PR manager to "Sync All Branches and make sure that they agree and ready to push" (2026-11-27), then approved merging the result when green, and approved the new pricing going live ("Yes, go live", after confirming the Polar prices were changed).

What landed, in order: PR 175 (1.8.80 version files), 165 and 176 on their own, 179 (release record), 180 (Space Cherries LLC as operator), 182 (integration part 1: 177 folder-drag test fix, 171 /windows and /linux, 170 what's-new copy; merged as 679905d3), and 178 (the full integration: 173 new pricing, 172 Foli AI on your own key, the Dropbox and Google Drive wording fix, and the fixes below; merged as ec4ae9f1). PRs 181 and 183 were closed unmerged (181 was a split that still held own keys; 183 was a fallback copy of the wording fix).

Found by putting the branches together, all fixed before merging: own keys ignored Foli AI being turned off for a person or a workspace once pricing changed what that check means (own-key session, 166922f5, with a test); ai:testOwnKey was not registered for local mode (c7efad26); the iPhone-look Foli AI settings rendered the web own-key card (8309a680); the own-key store created its IndexedDB database on a public computer, against the public-computer promise, caught by e2e/e2ee-unlock.spec.ts (e1a855f0: the store is created only when a key is saved, and never on a public computer); about 17 e2e tests still asserted the old plans and prices (pricing session, 4b251694), one of them hiding a real bug, the pricing page's h1 reading "Folevi is free ."; a lint error in convex/lib/plans.ts and a Mac test expecting an Upgrade link (a700687c); the share image line wrapped with Android in it (c48d035b). Own keys were held out of part 1 on the own-key session's advice: on the old plans they would have let a Core person or workspace send notes to AI.

Checked: CI green on 182 and on 178 (after one rerun of shard 6/8 for the places-web flake); on 178's tree locally lint, typecheck, Convex 1270, parity 352 and swift test --filter FoleviMacTests (266); on an earlier commit of the same branch the Mac debug build, the iOS simulator build and the Android compile with its JVM tests. Vercel's production deployment of ec4ae9f1 succeeded; /pricing, /windows, /linux, /features and /downloads fetched and read. Not checked: the site in a browser, Admin > Billing setup against Polar (needs an admin sign-in), a real purchase, the native builds on the final commit (the later commits changed web files only).

The auto-mode permission check refused cancelling other branches' CI runs; they were left to finish.
