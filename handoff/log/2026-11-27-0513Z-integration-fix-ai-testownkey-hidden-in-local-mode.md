# ai:testOwnKey hidden in local mode

- Date: 2026-11-27 05:13 UTC
- Area: web
- Branch: integration-fix

tests/parity/coverage.test.ts needs every Convex function the product calls to be ported or hidden for local mode. ai:testOwnKey (Test key on Folevi Cloud's own-key card) is now LOCAL_HIDDEN "aiServer" in apps/web/src/lib/local/registry.ts: a local library shows LocalAiSection and tests keys on the device (localAi.testKey). The engine's ownAiKey.test refuses outside account mode. Parity 352 passed, Convex 1270, web 2447.
