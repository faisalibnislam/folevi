# Own AI keys respect Foli AI turned off (person or workspace)

- Date: 2026-11-27 04:50 UTC
- Area: backend
- Branch: integration-fix

On the integration branch (PR 178): after PR 173, aiBlockedIn means Foli AI turned off (profiles.aiEnabled, workspaces.aiDisabled), but holdFor (convex/ai.ts) returned an own-key hold before checking it, so a workspace with Foli AI off still sent notes to AI when someone brought their own key. The check now runs first, for the request's place and every place it reads from. Test: tests/convex/ai-own-key.test.ts, the person and the workspace case refused with an own key and nothing sent (fails without the fix).

Own-key entry points checked: holdOwnKey (only from holdFor, now after the check); loadHoldRoute with a key (only for an own-key hold, which only holdFor makes); every action taking ownKey (ai.ts, aiChat, aiAgent, aiComplete, aiStudy, aiTodos, chartAi, fileText, flowchartAi, mindmapAi, stickiesAi, tableAi, wireframeAi) passes it only through beginRequest into ai.begin and holdFor; digests and routines call holdFor without a key. ai.testOwnKey still works with Foli AI off: it sends a fixed one-word prompt and no notes. Convex: 1270 passed, typecheck and lint clean.
