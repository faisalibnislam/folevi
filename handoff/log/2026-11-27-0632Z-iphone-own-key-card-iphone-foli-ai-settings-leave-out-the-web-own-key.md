# iPhone Foli AI settings leave out the web own-key card

- Date: 2026-11-27 06:32 UTC
- Area: web
- Branch: claude/iphone-own-key-card

What changed: the iPhone-look branch of `AiSection.tsx` no longer renders `<OwnKeyCard />`. The card uses web buttons
(`.ui-btn`), which broke `e2e/iphone-settings.spec.ts:49` (nativeOnly on the Foli AI screen) in PR 178. The iPhone
app sets its own key on its native screen (native-kit `PhoneOwnKey.swift`). Web, Mac, Windows and Linux still show the card.

Checked: new `apps/web/test/iphone-ai-settings.test.tsx` (fails without the change, passes with it); web typecheck and
eslint clean. The e2e spec itself was not run here: another session's local Convex backend holds the shared
anonymous instance on port 3210, so CI runs it.

Left: nothing.
