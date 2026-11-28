# PR 190: end-to-end fixes

- Date: 2026-11-28 08:49 UTC
- Area: web
- Branch: claude/web-localhost-18f3da

The account e2e failures on PR 190, fixed.

Code fixed (the behaviour should hold):
- Home's "At a glance" (`HomeStats.tsx`): the week chart's `role="img"` sat on a `<dd>`, which broke the `<dl>`
  (axe `definition-list` on `/documents`). The `dd` now holds a span with the role.
- Settings search (`SettingsView.tsx`): `aria-controls` pointed at the results list even when it wasn't drawn
  (axe `aria-valid-attr-value` on Settings pages). It's set only while results show.
- Tasks (`TasksView.tsx`): the priority flag is `role="img"` with its "High priority" label.
- Holding a line on the iPhone (`EditorContextMenu.tsx`): the menu now opens 12 px from the held line, not 6. With
  the editor's new 17 px text the first move of a finger leaving the line landed on "Turn into", so the menu picked
  an item instead of giving way to lifting the block (`touch-long-press.spec.ts`).
- New note (`useCreateDocument.ts`): pressed while the sync engine was still starting (right after the page loaded,
  or after switching account) it did nothing. It now waits for the engine, up to 10 s. Found by
  `places-move.spec.ts`, which failed every time locally with the new Home.

Tests updated for changes the owner asked for:
- `ai-setting.spec.ts`, `credits.spec.ts`: the Foli AI switch is in Settings > Foli AI (the Account card was removed).
- `organize.spec.ts`: priority is a flag, checked by its accessible name "High priority", not a "High" chip.
- `organize-index.spec.ts`: the redesigned Home's Recent notes is a grid of at most 6 cards with no scroll arrows.
- `popups-on-top.spec.ts`, `menu-geometry.spec.ts`: Home's folder section is `home-folders-title` now.
- `folder-drag.spec.ts`: a list row's link is the whole row now (title, snippet, time, folder), so the note is
  picked by the link's first line, its title.

Not changed: `sidebar-more.spec.ts:24` (fixed by 51d9aca1) and `changes.spec.ts:112` passed locally as they are.

Checked: the whole account e2e project once on a local backend (port 3111, local `SITE_URL` to match, 4 workers):
362 passed, 25 skipped, 4 flaky that passed on retry (flowchart connectors and swimlanes, mind map at phone width,
tab switch), 1 failed (places-move, fixed above and passing since). Then the specs above again after the last
fix. The whole first CI job passes (generated-file checks, eslint, typechecks, vitest, web tests).
