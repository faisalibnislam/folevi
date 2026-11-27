# Foli AI on your own AI key (Anthropic, OpenAI, Gemini) on every plan

- Date: 2026-11-27 02:45 UTC
- Area: backend
- Branch: claude/cranky-lamport-c231f4

Step 5 of docs/PRICING_PLAN.md (Bring your own AI). Details: docs/AI_ASSISTANT.md, Your own AI key.

Backend: convex/lib/ai/ownKey.ts. AI actions take an optional ownKey { provider, apiKey, model }. beginRequest (convex/ai.ts) gives ai.begin only the provider and model; the hold is an own-key hold (aiCreditHolds.ownKey, no credits, plan block skipped, hourly limit kept). The key waits in action memory by hold id until metered() puts it on the meter's non-enumerable route. settleHold charges nothing and counts aiCreditPeriods.ownKeyRequests (usage card: Your key). ai.testOwnKey for Test key. Folevi Server: own keys work even with the server's AI off; admins-only still applies. Tests: tests/convex/ai-own-key.test.ts (key never in any table, scheduler args or logs; Free with no credits; Core; Gemini; hourly limit; hold guards; Test key).

Clients: web lib/ai/ownKey.ts (Keychain via new shell secrets.reveal on the Mac and iPhone shell, else sealed IndexedDB), useAiAction on 41 call sites, OwnKeyCard in Settings, Foli AI; engine commandsAi.ts and the ownAiKey settings query/runs; native cards SettingsOwnKey.swift (Mac, iPad) and PhoneOwnKey.swift (iPhone); usage card shows Your key.

Not done: keys aren't synced between devices (E2EE key material exists only for accounts with encryption on); digests, routines, deep research and transcription still use credits; secretsReveal for Windows/Linux (secrets.rs) and Android; a server owner switch to turn own keys off; the Mac app target and Mac ShellTests weren't built or run here (only native-kit for macOS and iOS); expect a rebase on claude/pricing-2026-11-27 (aiBlockedIn/tierHasAi, its Turn off Foli AI setting must also stop own-key requests).
