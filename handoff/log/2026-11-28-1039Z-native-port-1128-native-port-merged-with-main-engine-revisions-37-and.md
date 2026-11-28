# Native port merged with main: engine revisions 37 and 38, 7 screen snapshots re-recorded

- Date: 2026-11-28 10:39 UTC
- Area: mac
- Branch: claude/native-port-1128

What changed:
- Merged main (PR 190 and PR 192) into the native port. PR 192 took engine revision 36 (FolderPreview fields), so
  this branch's `ai.settingsSearch` is now revision 37 and `home.stats`, `home.prefs`, `home.setLayout` and
  `home.setPinnedNote` are revision 38 (CONTRACT_REVISION 38). Fixtures and the Swift and Kotlin APIs regenerated.
- Re-recorded 7 FoleviScreens snapshots (home, home-type-xxxl, all-notes-cards light; folder and all-folders-tiles
  light and dark). Every difference is main's: the bare card date with no "Edited" (a0543a64) and PR 192's folder
  thumbnails. The other pictures were left as they were.

Checked: engine-codegen and Kotlin `--check`, handoff check, the web engine tests (171), web typecheck,
`swift build --build-tests` and every native-kit suite (257 screens, 278 Mac, design, menu bar note and the rest all
pass), the Mac Debug build, and the iOS simulator build.

Left: not run on a real device; native leftovers as in the earlier entries (Shared with me and Templates blocks are
one line, Pinned note picks from recents, Catch me up uses ai.brief, iPhone Settings' Return doesn't ask Foli AI).

