# Changelog

Every Folevi release, newest first. Written by `node scripts/version.mjs` from `CHANGELOG.json`: edit that file, then run `node scripts/version.mjs sync`.

Versions are MAJOR.UPDATE.PATCH, shown as `#.#.##`: a Major release, a Big update or a Small update.

## 1.1.04 (2026-10-29)

Small update, build 14

- Mac tab strip: Home is pinned after Back and Forward, and only the tabs after it scroll
- Mac tab strip: New note sits as far from the right edge as the Back arrow from the left
- Note cards: the shadow animates with the card, so no pale band shows under a card as the hover ends

## 1.1.03 (2026-10-28)

Small update, build 13

- Mac tab strip matches the web's: only the tabs scroll, New note 4 pt from the edge
- The Vault unlocks encryption in place: one card, the ways to unlock, then the passcode (web and Mac)

## 1.1.02 (2026-10-28)

Small update, build 12

- Mac: the window follows the place's Settings > Appearance, as its page does
- Note cards: the star's tab sits in the cover's corner, as on the web
- Mac: the account button shows the profile picture or the workspace's logo, as on the web

## 1.1.01 (2026-10-28)

Small update, build 11

- Mac tabs: the whole tab opens it, a middle-click closes it, and tabs drag to reorder, as on the web

## 1.1.00 (2026-10-28)

Big update, build 10

- Folevi for Mac rebuilt as a native app that matches the web: the window frame, sidebar, top bar, tabs and menus drawn natively from the web's styles
- Native Home, note lists, folders, Tasks, Calendar, Search, Notifications, Settings, sharing, invitations and Quick Add on the Mac
- Every screen before the app (first launch, library setup, sign-in, offline, the Touch ID cover) native on the Mac
- Foli AI chat streams within its frame budget
- Notes dragged from the Mac's lists to Finder go as Markdown files
- Decline a workspace or page invitation
- Editor text size applies on every page
- iPhone: 120 Hz on ProMotion iPhones and Folevi's own web view host instead of Capacitor

## 1.0.05 (2026-10-27)

Small update, build 9

- The Vault: passwords and credentials, Files & Notes, people and roles, sharing items and one-time secret links, Health, notifications, item history, import and export
- Folder sharing on the web: Share in the folder menu and toolbar, shared folder and invitation pages, Shared with Me
- A folder page shows its subfolders as folder cards
- The Ask Foli AI flower blooms now and then and while Foli AI works
- Security: patched libraries, Foli AI can't be steered into sending data out, a daily encrypted backup, sessions end after a password reset
- iPhone: sheets reach the screen's bottom edge, and a themed note's cover band has rounded corners

## 1.0.04 (2026-10-24)

Small update, build 8

- Every note kept on the device: background fill, instant opening, prefetch on intent, attachments, encrypted copies sealed at rest
- A faster device copy feed from the server

## 1.0.03 (2026-10-24)

Small update, build 7

- Foli AI handles long notes: an outline, paged reading, batched edits and Continue
- Foli AI's Ask chat fills the note's panel, with the composer at the bottom
- Notes written offline show at once everywhere and reach the server after reconnecting
- iPhone and iPad: faster taps and typing, a note zooms out of its card and back, sheets slide in from below, a sync status for touch
- The apps open the last-known folio at once, and their first screen loads 14 % less code
- Big pastes save reliably
- folevi.com opens your notes even without the signed-in hint cookie

## 1.0.02 (2026-10-23)

Small update, build 6

- Sign-in in the apps: Continue with Google or Apple goes straight to that provider's page

## 1.0.01 (2026-10-23)

Small update, build 5

- Folevi for Mac is the native app only, downloaded from folevi.com and updated by Sparkle
- Mac memory: background places, Quick Add and hidden windows let go of what they don't need, and memory warnings are answered
- Sidebar folders: drag and drop for notes and folders (web, Mac, iPad)
- The account menu: places first, the rest in Settings
- First launch: Sign in to Folevi is the suggested choice
- Flowchart connectors: Reverse direction turns the arrow, and lines between close shapes stay straight

## 1.0.00 (2026-10-23)

Major release, build 4

- One version for every platform: the web, Folevi for Mac, iPhone and iPad and Android all show Folevi 1.0.00, never a build number
- The first native Folevi for Mac release
