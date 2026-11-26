# Web app and website (`apps/web`)

Keep this short and true: rewrite it when things change, and put history in `handoff/log/`.

## Current state

- Live at folevi.com and app.folevi.com from `main`; the sign-in page offers "Sign in to your own server", and `/downloads` lists every download.
- Closing a dialog or the command palette: the dialog closes first and its picture fades as an inert popover (`components/ui/closing.ts`), so the page takes the keyboard back at once.
- iPhone and Android swipe rows (`components/iphone/Swipe.tsx`) run on Pointer Events and close on a touch outside their list.
- Float this note shipped in 1.7.78 (`components/app/FloatNote.tsx`); the note's colour edge to edge (PR 135) merged after that release and is live on the web, not yet in a released app.
- One control scale (PR 141, docs/DESIGN_SYSTEM.md "Controls"): every row control is 36 px (44 on touch), compact 28; one corner, edge, weight and icon. `Button` sizes `md`/`compact`/`icon`/`icon-compact` (no `sm`). Enforced by ESLint `folevi/control-scale` and `e2e/control-scale.spec.ts`.
- CI's e2e suite is 8 shards on 2-CPU runners; `e2e/tab-switch.spec.ts` timed out once on 2026-11-25 and passed on a re-run.

- Spell check, suggestions and next-word prediction on Tab (PR 143, released in 1.8.78): Folevi's own checker in a worker, nine spelling languages plus Chinese prediction, the personal dictionary synced, Foli AI completions only when Foli AI is on and never for encrypted notes. The ghost word is CSS (`data-ghost`), never part of the text.

## Next steps
- Spell check and prediction: not yet tried in the native builds (Mac, iPhone, Windows) or on devices.

- Control scale: add Vault and Settings to `e2e/control-scale.spec.ts`; re-export the web's computed styles for the native Swift screens; drop `rounded-chip` from CollectionEmbed's page picker field after PR 137.
- Known gaps and failing specs listed before 2026-11-26 are in the archive's next steps; check each against `main` before trusting it.

Detail from before 2026-11-26 is in `handoff/archive/` (search it for this area's name); nothing there is kept up to date.
