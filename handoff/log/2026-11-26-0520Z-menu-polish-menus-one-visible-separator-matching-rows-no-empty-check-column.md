# Menus: one visible separator, matching rows, no empty check column

- Date: 2026-11-26 05:20 UTC
- Area: web
- Branch: claude/menu-polish

Moved here from this branch's additions to `HANDOFF.md` when the handoff became a folder (PR 142). The lines are as the branch wrote them, from its current state, next steps and change log.

- Menus (2026-11-26): the owner checks a floating note's text menu, a folder's menu and the Vault's "..." menu in the
  next Mac build. Follow-up: make `e2e/note-menu.spec.ts` keep `data-desktop="mac"` the way
  `menu-geometry.spec.ts` does (`keepMarks`), so its Mac case really runs in the Mac look.
- 2026-11-26: **Menus polished on every platform** (owner's feedback on the Mac: "extra space" in a floating note's
  text menu, a folder menu's empty left column, the Vault's washed-out "..." menu). One separator for every menu
  (`.ui-menu-sep`: a hairline in the ink's colour, 6 px above and below; the Mac's 6/10 kept), visible on glass over
  a coloured note and in dark mode (the light grey `--color-line` vanished and read as a gap). The text menu's rows
  now match every other menu's (32 px, the body size, parts marked for the Mac's look). A check column only in a
  list of choices (`menuKeepsCheckColumn`); one toggle among actions shows its check at the end. A narrow window
  driven by a mouse (a floating note) keeps the desktop text menu (Paste, the Mac's spelling and Look Up), not the
  phone's. A menu in the Vault is solid in the Vault's colours on the Mac too. `WebStyles.swift` regenerated
  (`pnpm styles:gen`; also picks up an older `dialog.panel` change on iOS). Checked: `e2e/menu-geometry.spec.ts`
  (eight menus in six looks, the floating note and the Vault; 18 pass in Chromium and WebKit, and the same spec
  fails on the old code), note-menu, float-note and iphone-editor specs, unit suite (2274). Not checked in a Mac
  build. Found: `e2e/note-menu.spec.ts` sets the Mac look in an init script before `<html>` exists, so its "as the
  Mac draws it" case runs in the web look (the new spec's `keepMarks` shows the fix).

- 2026-11-26, merging main: `EditorContextMenu.tsx` conflicted with the spell check work (PR 143). Both kept: the `phone` line with `!pointedWithMouse()` from this branch, and the spelling settings hooks from main.
