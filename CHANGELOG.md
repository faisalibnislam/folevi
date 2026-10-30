# Changelog

Every Folevi release, newest first, written by `node scripts/version.mjs` from `CHANGELOG.json`.

Versions are MAJOR.UPDATE.PATCH, PATCH at least two digits: a Major release (2.0.00), a Big update (1.1.05 after 1.0.05) or a Small update (1.0.06 after 1.0.05).

## Version 1.2.05: Small update

Released 2026-10-30 10:05:05+06:00 (build 16, tag v1.2.05)

Foli AI on your Mac follows the same safety rules everywhere, notes feel quicker, and two fixes.

### Improved

- Foli AI with Apple Intelligence or your own key follows the same safety rules as Foli AI in your account, and says so plainly when it won't help with something.
- Notes, tabs and joined notes respond faster: a note isn't redrawn on every save, and the block handle follows the pointer without slowing typing.

### Fixed

- Settings shows your time zone when it's UTC (it was empty).
- Encrypted notes no longer stop with "This page couldn't load" while they unlock.

## Version 1.2.04: Big update

Released 2026-10-29 10:21:13+06:00 (build 15, tag v1.2.04)

Tabs that do more, on the web and the Mac: pin tabs, see a tab's page before you open it, see every tab at once, and work on up to three notes side by side.

### Added

- Pinned tabs: pin a tab from its pin or its menu; it stays at the start of the strip, half as wide, and closing other tabs keeps it.
- Tab previews: rest on a tab to see a picture of its page, then move along the strip to see the others at once.
- Tab Overview: every open tab as a picture, with search, close and a new note (the grid button, or Shift-Command-\).
- Joined notes: up to three notes side by side in one tab, resized with snapping, rearranged by their bars, folded into slim spines on narrow windows.
- Mac: editor text in five sizes, from Smaller to Larger.

### Improved

- Home is a single house icon at the start of the tabs.
- Tabs keep the same width whether they're open or not.
- Mac: the tab strip is glass over the page, with thin scroll bars that show only while scrolling.
- Mac: Settings is redesigned, with Folevi's own icons, each pane as tall as it needs and the version shown once.
- Mac: Vault passwords show the list and the open item side by side on wide windows.
- Tooltips are Folevi's own everywhere and never repeat what a button already says.
- Mac: Focus Mode is now Option-Command-\ (Shift-Command-\ shows all tabs).

## Version 1.1.04: Small update

Released 2026-10-29 06:18:23+06:00 (build 14, tag mac-v1.1.04, commit f6fd7767)

Mac tab strip and note card polish.

### Improved

- Mac tab strip: Home is pinned after Back and Forward, and only the tabs after it scroll
- Mac tab strip: New note sits as far from the right edge as the Back arrow from the left

### Fixed

- Note cards: the shadow animates with the card, so no pale band shows under a card as the hover ends

## Version 1.1.03: Small update

Released 2026-10-28 23:24:46+06:00 (build 13, tag mac-v1.1.03, commit e60b655f)

The Mac tab strip matches the web's, and the Vault unlocks encryption in place.

### Improved

- Mac tab strip matches the web's: only the tabs scroll, New note 4 pt from the edge
- The Vault unlocks encryption in place: one card, the ways to unlock, then the passcode (web and Mac)

## Version 1.1.02: Small update

Released 2026-10-28 20:40:07+06:00 (build 12, tag mac-v1.1.02, commit 0ebfebf8)

The Mac window and account button follow the web, and the note card star moves to the cover's corner.

### Improved

- Mac: the window follows the place's Settings > Appearance, as its page does
- Note cards: the star's tab sits in the cover's corner, as on the web
- Mac: the account button shows the profile picture or the workspace's logo, as on the web

## Version 1.1.01: Small update

Released 2026-10-28 14:07:22+06:00 (build 11, tag mac-v1.1.01, commit c12e62f4)

Mac tabs open, close and reorder as on the web.

### Improved

- Mac tabs: the whole tab opens it, a middle-click closes it, and tabs drag to reorder, as on the web

## Version 1.1.00: Big update

Released 2026-10-28 13:11:47+06:00 (build 10, tag mac-v1.1.00, commit fd5390b7)

Folevi for Mac rebuilt as a native app that matches the web.

### Added

- Folevi for Mac rebuilt as a native app that matches the web: the window frame, sidebar, top bar, tabs and menus drawn natively from the web's styles
- Native Home, note lists, folders, Tasks, Calendar, Search, Notifications, Settings, sharing, invitations and Quick Add on the Mac
- Every screen before the app (first launch, library setup, sign-in, offline, the Touch ID cover) native on the Mac
- Notes dragged from the Mac's lists to Finder go as Markdown files
- Decline a workspace or page invitation

### Improved

- Foli AI chat streams within its frame budget
- Editor text size applies on every page
- iPhone: 120 Hz on ProMotion iPhones and Folevi's own web view host instead of Capacitor

## Version 1.0.05: Small update

Released 2026-10-27 08:39:35+06:00 (build 9, commit 65af5aed)

The Vault, folder sharing on the web, and security hardening.

### Added

- The Vault: passwords and credentials, Files & Notes, people and roles, sharing items and one-time secret links, Health, notifications, item history, import and export
- Folder sharing on the web: Share in the folder menu and toolbar, shared folder and invitation pages, Shared with Me

### Improved

- A folder page shows its subfolders as folder cards
- The Ask Foli AI flower blooms now and then and while Foli AI works
- Security: patched libraries, Foli AI can't be steered into sending data out, a daily encrypted backup, sessions end after a password reset
- iPhone: sheets reach the screen's bottom edge, and a themed note's cover band has rounded corners

## Version 1.0.04: Small update

Released 2026-10-24 10:53:13+06:00 (build 8, commit f5f00a26)

Every note kept on the device.

### Added

- Every note kept on the device: background fill, instant opening, prefetch on intent, attachments, encrypted copies sealed at rest

### Improved

- A faster device copy feed from the server

## Version 1.0.03: Small update

Released 2026-10-24 10:15:13+06:00 (build 7, commit 5b64098b)

Foli AI for long notes, offline notes everywhere, and faster iPhone and iPad apps.

### Added

- Foli AI handles long notes: an outline, paged reading, batched edits and Continue

### Improved

- Foli AI's Ask chat fills the note's panel, with the composer at the bottom
- Notes written offline show at once everywhere and reach the server after reconnecting
- iPhone and iPad: faster taps and typing, a note zooms out of its card and back, sheets slide in from below, a sync status for touch
- The apps open the last-known folio at once, and their first screen loads 14 % less code

### Fixed

- Big pastes save reliably
- folevi.com opens your notes even without the signed-in hint cookie

## Version 1.0.02: Small update

Released 2026-10-23 13:26:12+06:00 (build 6, commit 5b7fc87d)

Faster sign-in with Google or Apple in the apps.

### Improved

- Sign-in in the apps: Continue with Google or Apple goes straight to that provider's page

## Version 1.0.01: Small update

Released 2026-10-23 10:53:55+06:00 (build 5, commit f94212bd)

Folevi for Mac is native only, uses less memory, and folders drag and drop.

### Added

- Sidebar folders: drag and drop for notes and folders (web, Mac, iPad)

### Improved

- Folevi for Mac is the native app only, downloaded from folevi.com and updated by Sparkle
- Mac memory: background places, Quick Add and hidden windows let go of what they don't need, and memory warnings are answered
- The account menu: places first, the rest in Settings
- First launch: Sign in to Folevi is the suggested choice

### Fixed

- Flowchart connectors: Reverse direction turns the arrow, and lines between close shapes stay straight

## Version 1.0.00: Major release

Released 2026-10-23 06:50:15+06:00 (build 4, tag mac-v1.0.00, commit 3832da01)

One version for every platform, and the first native Folevi for Mac.

### Added

- One version for every platform: the web, Folevi for Mac, iPhone and iPad and Android all show Folevi 1.0.00, never a build number
- The first native Folevi for Mac release
