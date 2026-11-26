# One control scale for every control (36 px, one corner, edge, weight, icon)

- Date: 2026-11-26 05:20 UTC
- Area: web
- Branch: claude/ui-scale

Moved here from this branch's additions to `HANDOFF.md` when the handoff became a folder (PR 142). The lines are as the branch wrote them, from its current state, next steps and change log.

**One control scale for every control (2026-11-26, branch `claude/ui-scale`).** The owner: "use consistent
rules/size/space for all UI elements"; All notes' toolbar is the reference. Every control that sits in a row (fields,
dropdowns, buttons, icon buttons, segmented switches, a dialog's footer) is 36 px (44 on touch), compact ones 28
(36 on touch), with one corner (10; a segment 6), one edge (1 px `--color-line` inside the box, `--control-ring`), one
weight per role (550 labels, 400 values), 16 px icons (14 compact and for a dropdown's chevron) at a 1.5 px stroke.
Tokens: `packages/design-tokens` `control` (CSS `--control-*`, Tailwind `h-control` / `h-control-sm` / `size-control`,
Swift `FoleviTokens.Control`); rules in `docs/DESIGN_SYSTEM.md` "Controls". `Button` sizes are now `md` (default),
`compact`, `icon`, `icon-compact` (`sm` is gone: its 222 uses are `md`). The Folders toolbar matches All notes (the
6 November tinted tray is gone; `RowTray` is a plain group). The Mac look's 28 pt buttons are gone (36 there too).
Checks: ESLint `folevi/control-scale` (error) and `apps/web/e2e/control-scale.spec.ts` (Chromium and WebKit; web, Mac
and Windows looks; light and dark; a dialog footer; touch 44; nothing under the window buttons). Before and after
shots: `docs/audits/control-scale-2026-11-26/`. Not checked: Vault and Settings in the browser audit (Vault needs a
set-up vault; their classes pass the lint), the running Mac, Windows and Linux apps, and the native Swift screens
(they copy the web's computed styles; see Next steps).

- Control scale follow-ups (2026-11-26): re-export the web's computed styles for the native Swift screens
  (`node scripts/web-styles.mjs --app`, reads the running Dev app) so they draw the 36 px controls; add Vault (a set-up
  vault) and Settings to `e2e/control-scale.spec.ts`; look over the editor's inline tools (collections, charts, table
  AI, audio) at 36, which the codemod moved from 32; once PR 137 is in, drop `rounded-chip` from the page picker's
  field in `CollectionEmbed.tsx` (left alone to keep clear of 137's change on the line above).
- 2026-11-26: **One control scale** (branch `claude/ui-scale`): control tokens (36 / 28, 44 / 36 on touch), one
  corner, edge, weight and icon stroke for every field, button, dropdown and segmented switch; Folders' toolbar now
  matches All notes; Button sizes `md`/`compact`/`icon`/`icon-compact`; ESLint `folevi/control-scale`; Playwright
  audit `e2e/control-scale.spec.ts`; docs/DESIGN_SYSTEM.md "Controls"; desktop parity row.
