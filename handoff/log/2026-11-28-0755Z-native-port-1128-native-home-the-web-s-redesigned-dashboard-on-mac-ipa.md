# Native Home: the web's redesigned dashboard on Mac, iPad and iPhone

- Date: 2026-11-28 07:55 UTC
- Area: mac
- Branch: claude/native-port-1128

## What changed

- Engine, revision 37: views `home.stats` (homeStats.get) and `home.prefs` (homePrefs.get), commands
  `home.setLayout` (null is Reset) and `home.setPinnedNote`. Fixtures, Swift and Kotlin API regenerated, engine
  tests in `test/engine/more.test.ts`.
- `FoleviScreens/Home/HomeDashboard.swift`: the block rules ported from `homeLayout.ts` (order, pairs, move, hide,
  unknown ids), the words (greeting, reading time, Up next), Foli DNA of the week, and `HomeDashboardModel`
  (`HomeModel.dashboard`, made lazily): stats, layout with an optimistic save, today's events, My tasks (a
  `TasksModel` on All), the graph once its block shows, and the capture field (`note.create` where it says,
  remembered per place; the task button uses `task.create`).
- `HomeDashboardViews.swift`: the shared pieces (top line, serif greeting, section head with the black tile, capture
  field, At a glance 2x3, Today card, Foli DNA map, Customize frame and Add a block). The serif is set with
  `homeSerif` so it survives the Mac's native look.
- Mac/iPad `WebHomeScreen` laid out as HomeDashboard.tsx (1,320 pt max, one row of cards with 24 pt gaps, paired
  rows 1fr / 1.15fr from 860 pt, My tasks as `PlannerTaskRow`). iPhone `PhoneHomeContent` in one column with
  `PhoneTaskLine`, then the places tiles, Tags and More.
- DemoEngine answers the new views and has two events today.

## Checked

- `swift build`; `swift test --filter "FoleviMacTests|FoleviDesignTests"`: all pass except three that fail the
  same way on the base commit 474f5d53 (`folderCards`, `phoneFolderCards`, `DnaAroundTests.pictures`
  dna-note-iphone-dark 1.07%). New `HomeDashboardTests` (8). `home-picture-*` re-recorded.
- iPhone: `PhoneHomeSnapshotTests` on the iOS Simulator (headless), references re-recorded, a new `-mid` one.
  FoleviPhone and FoleviMac build for the iOS Simulator.
- `npx vitest run test/engine` (171 pass), `tsc --noEmit`, both codegen `--check`.

## Left

- Shared with me and Templates blocks show a line and See all, not the web's lists; Pinned note picks from recent
  notes only.
- Catch me up still uses `ai.brief` (catchUp.run), not `ai.homeSummary`.
- Not looked at on a real iPad or iPhone; the folder-cards and dna-note snapshot drift predates this work.
