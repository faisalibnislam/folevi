# Window polish: Home always in view, pickers fit short windows, version history clears the window buttons

- Date: 2026-11-26 05:19 UTC
- Area: web
- Branch: claude/window-bar-clearance

Moved here from this branch's additions to `HANDOFF.md` when the handoff became a folder (PR 142). The lines are as the branch wrote them, from its current state, next steps and change log.

**1.7.78 (build 103) is released**, a Big update cut from PR 131's merge (`b11f3256`): the Mac feedback round 2
fixes and Float this note (PR 114, which carried PR 122), plus everything merged since 1.6.78 (the Windows and Linux
parity work in PR 113). Tag `v1.7.78` is local only (not pushed). What is live:

| Platform | 1.7.78 | Checked |
| --- | --- | --- |
| Web and Convex | Deployed by the merge (Vercel status success) | folevi.com, app.folevi.com, `/downloads` and `/signin` answer 200 |
| Mac | Published with `apps/mac/scripts/publish.mjs`: notarized, stapled, Sparkle feed and `mac/Folevi.dmg` on R2, delta from build 102 | Feed's first item is 1.7.78; `stapler validate` passes. Not opened on a Mac |
| iPhone and iPad | TestFlight, internal "Folevi team", delivery `1ce1048f-6e01-45b8-9da3-a4980ac34711` (the Capacitor app, `apps/mobile`) | Upload accepted. Not opened on a device |
| Windows | `windows/Folevi_1.7.78_x64-setup.exe` and `_arm64-setup.exe` plus the two stable names, from CI run 45680883507. Unsigned, as before. Update feeds `desktop/windows-*/latest.json` published (`packaging/desktop/publish-update-feed.sh`) | The stable x64 link serves the new file (same SHA-256); both feeds say 1.7.78 and carry a signature. Not installed on Windows |
| Linux | Six packages and `SHA256SUMS` (`upload-release.sh`); apt and rpm repositories rebuilt and uploaded; update feeds `desktop/linux-*/latest.json` published | Both AppImages pass `smoke-test.sh` in the VM (welcome screen); apt `Packages` lists 1.7.78 and `InRelease` verifies |
| Snap Store | arm64: revision 7 (1.7.78) on stable, built in the VM. amd64: revision 8 (1.7.78) on stable, built on Launchpad (the first `remote-build` lost its connection before building; a plain retry worked) | `snapcraft status folevi` in the VM |
| Android | NOT on Play yet. The signed bundle is at `~/Downloads/Folevi 1.7.78 Android/Folevi-1.7.78-103.aab`; the owner drags it into Play Console's internal testing | Version code and signer checked. Not run on a device or emulator |

Not done, and why:
- **Android on Play:** needs the owner's drag-in.
- **Hardware checks:** Float this note on a Mac (several panels, pin off and on, over a full-screen app), on a Windows
  PC and in Chrome; the first automatic update from 1.7.78 on Windows and Linux (1.6.78 and older have no updater, so
  those users install 1.7.78 by hand once).
- **Flaky Rust test:** `two_folder_fs_on_one_folder_never_lose_increments` failed once on Linux aarch64 during this
  release; worth a look.

- After 1.7.78 (2026-11-26): the owner drags `~/Downloads/Folevi 1.7.78 Android/Folevi-1.7.78-103.aab` into Play
  internal testing, then the hardware checks at the top of section 9. Next free version: 1.7.79 (or 1.8.79 for a Big
  update). Mac deltas need `apps/mac/release-archive/Folevi-1.7.78.zip` (kept).
- Float this note (released in 1.7.78): the owner tries it on the Mac
- 2026-11-26: **The caret follows the text's colour** in every field (`input`, `textarea`, editable text): left to
  "auto", WebKit in the apps drew the system's dark insertion point in the Vault's dark passcode field. Editors
  that colour their caret (the note's ember) keep it. Checked computed styles in a browser; not in a Mac build.
- 2026-11-26: **Window polish** (owner's feedback): Home stays in the tab strip before the tab arrows, never scrolled
  away (TabStrip.tsx; tests now find it by `[data-tab-home]`); pickers in a dialog (Move to folder, Move page, Add
  tag, Link a page) fit a short window: Dialog's new `fit` makes the body a column and the list (`min-h-0`) the one
  thing that scrolls, so its last row is never cut off; version history's top bar keeps room for the window buttons
  (`ui-window-bar`: a `ui-traffic-space` for the Mac, which DesktopBridge now prefers inside an open dialog, and
  `--win-caption-inset` on Windows). Checked: `e2e/window-polish-local.spec.ts` in Chromium and WebKit (fails
  without the Dialog fix). Not checked: version history in a build (local mode has none, so its step is skipped
  there); other full-window screens (onboarding, locked library, E2EE gate) not yet audited for the window buttons;
  AiGenerateDialog's and MovePlacesDialog's inner scroll areas left as they were.
- 2026-11-26: **Float this note, edge to edge** (owner's feedback on 1.7.78): the note's colour reaches every edge
  of the floating window (no white at the sides, under the bar or at the foot) and the bar wears the note's colour
  and ink (FloatNote reads them off the page). One web change covers the Mac, Windows and Linux windows and Chrome's
  floating window. Checked: `e2e/float-note.spec.ts` in Chromium and WebKit, with a plain note and an Irises note
  (edges 0 px, bar colour = note colour). Not checked in a Mac build; ships in the next release.
- 2026-11-26: **1.7.78 released** (Big update, build 103) from PR 131's merge (`b11f3256`): web and Convex
  deployed; Mac published; iPhone and iPad on TestFlight (delivery 1ce1048f); Windows installers, Linux packages,
  apt and rpm repositories and the four desktop update feeds published; Snap revisions 7 (arm64) and 8 (amd64) on stable; the Android
  bundle left for the owner's Play drag-in. Two things that needed working around: `apps/mobile` is outside the pnpm
  workspace, so run `pnpm install --ignore-workspace --frozen-lockfile` there before `npx cap sync`; and the x86_64
  AppImage smoke test in the VM's `/srv/jammy-amd64` chroot needs proc, sys, dev and dev/pts bind-mounted, and the
  AppImage's squashfs extracted (`unsquashfs -o <offset of "hsqs">`) and `AppRun` run, since Rosetta's binfmt rule
  doesn't match the AppImage header.
