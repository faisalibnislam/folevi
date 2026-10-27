# Folevi for Mac: the native rebuild (plan, 2026-10-27)

**Status:** plan only. Nothing is built until the owner says go. Ships as **1.1.00**, one release.

The owner, 2026-10-27: "now back to mac app. I want it to be Native as much as Possible, use swift UI kit but
looks must match 100% with the web app. No different at all. Some part can be in webkit/webview. No
chrome/electron. we will have to rebuild the whole app."

And on account-free use: the Mac app "can work without folevi account and actually can be used as a normal note
app, separated from Folevi server, just like obsidian: Free without limits. No sign-up required. No strings
attached."

iPhone and iPad stay paused; Android is paused completely. This plan touches only the Mac app and the shared
pieces it needs.

Related: `docs/NATIVE_APP_PLAN.md` and `docs/NATIVE_CONTRACT_REQUESTS.md` (on `native-app`, the earlier native
plan this builds on), `docs/MAC_WEBKIT_PLAN.md`, `docs/MAC_RELEASE.md`, `docs/LOCAL_MODE_PLAN.md`,
`docs/MULTI_ACCOUNT_PLAN.md`, `docs/E2EE_DESIGN.md`, `docs/VAULT_PLAN.md`, `docs/DESIGN_SYSTEM.md`.

---

## 0. Owner decisions (2026-10-27, from the picker)

| Topic | Decision |
| --- | --- |
| Starting point | The `native-app` branch (about 40,000 lines of Swift in `apps/native-kit` plus the shipped `apps/mac` services). Bring it up to today's web, then make every screen match. |
| Data and sync | The web data layer (sync engine, offline outbox, E2EE, local library, several places) runs in one hidden, bundled web page; native screens read typed live views and send commands over the bridge. No second data layer in Swift. Fully offline, no server needed in local mode. |
| Editor | The note page is the web editor in a `WKWebView`. Native around it: title bar, tabs, menus, shortcuts, spelling, Look Up, drag and drop. |
| Toolkit | SwiftUI for screens, lists, settings and dialogs; AppKit for the window, title bar, split view, tab strip, long lists and drag and drop. |
| Exactness | Pixel match with the web on every screen (fonts, sizes, spacing, colours, icons, radii, menus). Mac behaviour stays Mac: traffic lights, the menu bar, native scrolling, Dock, keyboard focus, accessibility. |
| Sidebar | Solid like the web (pure white / near-black). Replaces the October "translucent sidebar" exception. |
| Menus | Folevi's own menus and selects, drawn natively (SwiftUI/AppKit), keyboard navigable. The top menu bar stays the real Mac menu bar. |
| Web parts | Only the note editor and what is drawn inside a note (mind maps, flowcharts, tables, embeds). Everything else native, including Vault, Foli AI, every Settings section (technical ones too), Graph and Reviews. Replaces the October decision to keep technical Settings, Graph and Reviews as web. |
| Local file format | Keep the `.fnote` library (block-level merge, every block type kept) plus Markdown export of a note, a folder or the whole library. |
| First launch | Two equal choices: "Keep notes on my Mac" (free, no account) and "Sign in to Folevi". |
| Vault without an account | Local Vault: passwords, files and notes encrypted on the Mac with the passcode; Health and Trash work; People, sharing and the server log hidden behind "Sign in to share". |
| Local sync and Foli AI | As planned in October: iCloud, Dropbox, Google Drive, any folder, or this Mac only. Foli AI on Apple's on-device model or the person's own OpenAI/Anthropic/Google key, sent straight from the Mac. No limits, no prices. |
| macOS | 15 Sequoia minimum (as today). |
| Distribution | Direct download only: Developer ID, notarized, DMG from folevi.com, Sparkle updates. |
| Migration | A normal Sparkle update: same bundle id `com.folevi.mac`, same data folders, version 1.1.00. Sign-ins, the local library, keys and unsent edits carry over. |
| Proof of matching | Automatic screenshot diffs: same fixture data, same window size, light and dark, web (Playwright) vs native (XCTest), a tight pixel threshold, side-by-side report per screen. Tokens, fonts and icons generated into Swift from `packages/design-tokens`. |
| Rollout | One release when complete. Internal builds for the owner as parts land. Today's 1.0.x app keeps getting web changes meanwhile. |
| Build order | Frame and editor glue, then first launch and local mode, then lists, Tasks/Calendar/Settings, Foli AI, Vault, the rest (section 6). |
| Staying equal | After 1.1.00, every web UI change gets its native Mac version in the same piece of work; the screenshot diffs run in CI and a mismatch fails the build. |
| iOS reuse | Shared where cheap: models, tokens, fonts and the bridge shared; screens Mac-first. iOS stays paused and is not rebuilt. |
| Mac extras kept | All: Quick Add panel, global hotkey, menu bar item, Dock badge and menu; Spotlight, Services, Share menu, Shortcuts/App Intents, drag in and out, Quick Look, text recognition; Touch ID lock, open at login with background sync; call recorder. |

---

## 1. Where things are

- **Shipped (1.0.04, `main`):** `apps/mac` is AppKit around the whole web app in a `WKWebView` on
  `app://folevi` (`MessageRouter`, `ShellRouter`), with native menus, Quick Add panel, status item, Sparkle,
  background places with timed wake, Touch ID lock, call recorder, Spotlight, Services, Electron migration.
  About 11,300 lines of Swift. Production web is at `b2e9ebf2`.
- **`native-app` branch (`c63c31d0`, worktree `../folevi-native`):** 68 commits on top of 1.0.04.
  `apps/native-kit` (Swift package): `FoleviEngine` (bridge client, generated models), `FoleviDesign` (tokens
  generated from `packages/design-tokens`, fonts, components), `FoleviScreens` (Home, lists, folders, Tasks,
  Calendar, search, notifications, places, Settings, sharing, Quick Add, onboarding, sign-in, app lock, a WIP
  Foli AI chat), `FoleviMac` (frame model, sidebar, tab strip, menus, popovers, move sheet). Bridge contract
  `apps/web/src/lib/engine/protocol.ts` at revision 12; Swift models from `pnpm engine:gen`.
- **What the branch is missing:** 51 commits of web work since 1.0.04 (about 370 changed files in
  `apps/web/src`): the Vault, Foli AI guardrails, the 50 MB file limit, folder sharing UI, the type and spacing
  scale, `.ui-invert`, and more. Its screens were built to "Folevi's look", not checked pixel by pixel against
  the web.
- **Known branch issues:** `RouterTests.testDebugIdentity` expects a stale version; `DragTypeTests` may fail a
  full `swift test`; the Vision OCR test times out on some Macs; `__Snapshots__` must not be cleared
  wholesale; xcodebuild tests can hang on the "wants to access Documents" prompt (the repo is in
  `~/Documents`).

---

## 2. Architecture

```
┌─────────────────────────── Folevi.app (AppKit app, SwiftUI screens) ───────────────────────────┐
│ Window (AppKit): title bar with traffic lights, solid sidebar, tab strip, split view           │
│   Native screens (SwiftUI): Home, notes, folders, search, Tasks, Calendar, Settings, Foli AI,  │
│   Vault, sharing, Templates, Trash, Graph, Reviews, onboarding, sign-in, dialogs, menus        │
│   Note page: WKWebView with the bundled web editor (content-only mode)                         │
│                                                                                                │
│ Engine page (hidden WKWebView, bundled, offline): FoleviClient, sync engine, outbox,           │
│   E2EE router, LocalClient (.fnote library), places  ◄── typed bridge (protocol.ts) ──► Swift  │
│                                                                                                │
│ Swift services: Keychain, E2EE device keys, library files (LocalFs), cloud folders, on-device  │
│   Foli AI, notifications, Sparkle, Quick Add, hotkey, Spotlight, Services, Touch ID, recorder  │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **One engine per process**, not one hidden page per place: the engine hosts every place (the local library
  and each account), so memory stays flat with several accounts (item 1 of the October memory plan).
- **Note pages** are web views created on demand and kept for open tabs only; hidden tabs unload and restore
  from state; memory pressure drops caches.
- **Local mode needs no server at all.** The engine page and the editor are bundled in the app; the library is
  files on disk through `LocalFs` (Swift, CryptoKit for the optional passphrase). Foli AI local uses Apple's
  on-device model or the person's own key from the Mac.
- **Vault:** the crypto stays in the engine (`lib/vault/*`); native screens get views and send commands. Local
  Vault is a new engine backend that keeps vault items in the library folder, encrypted with the passcode key
  (section 5.6). File previews use PDFKit, AVKit, Quick Look and native text/CSV views, decrypted in memory.

---

## 3. Matching the web exactly

### 3.1 One source for the look
- `packages/design-tokens/scripts/build.mjs` already writes `Tokens.swift`. Extend it to cover everything the
  web uses: the new type scale and spacing scale, radii, shadows, borders, motion durations and curves,
  `.ui-invert`, covers and folder colours. CI checks the Swift file is current (as with `engine:gen`).
- Fonts: Instrument Sans, Spectral and JetBrains Mono bundled at the exact weights the web loads, with the
  same line heights, letter spacing and font features. Text measured in a test against the browser's metrics
  for each role.
- Icons: the web's icon set exported to vector assets (PDF/SVG in the asset catalog) by a script, same stroke
  widths; no SF Symbols where the web has its own icon.
- Components in `FoleviDesign` mirror the web's `components/ui/*` one to one (Button, Select, Menu, Dialog,
  Popover, Tooltip, Input, Switch, Tabs, Avatar, Badge, Toast, Card, list rows), each with a gallery page.

### 3.2 Screenshot diffs
- **Fixtures:** the same fixture library (notes, folders, tasks, people, vault items) loaded into the web (dev
  test account on `peaceful-mockingbird-196` or the local backend) and into the Mac engine. Fixed clock,
  fixed avatars, no network.
- **Shots:** for each screen and state (empty, normal, long, hover, selected, menu open, dialog open), light
  and dark, at 1280x800 and 1680x1050 at 2x: Playwright in WebKit for the web, XCTest rendering the native
  window for the Mac. Traffic-light area masked.
- **Diff:** per-pixel with a small anti-aliasing tolerance; a screen passes under a tight threshold (start at
  0.5% of pixels differing, tighten as it settles). The report (`apps/mac/match-report/`, untracked) shows
  web, native and the diff side by side; I send it to the owner for each milestone.
- **CI:** after 1.1.00 the diffs run on every web UI change; a mismatch fails the build.

### 3.3 Behaviour that also has to match
Hover and press states, focus rings, keyboard shortcuts, menus and their order, empty states, truncation and
wrapping, drag and drop targets, animations (durations and curves from the tokens), toasts, and every piece
of copy (no em dashes; "Foli AI").

---

## 4. Work packages

Each package ends with its screenshot diffs passing and a short report to the owner.

**M0. Bring the branch up to date.** Merge `main` (`b2e9ebf2`) into a new branch `mac-rebuild` from
`native-app`, resolve conflicts, add contract requests for everything new on the web (Vault, folder sharing
UI, guardrails, 50 MB limit), regenerate models, fix the known test issues. Apply
`docs/ci-workflow-native.patch` once an account with `workflow` scope can push.

**M1. Design system to exact.** Tokens, fonts, icons and components (section 3.1); the diff harness (3.2)
with the component gallery as its first target.

**M2. Frame and editor glue.** Window, solid sidebar, tab strip (Home tab plus one per open page), back and
forward, title bar, split view, Folevi menus, the real menu bar, keyboard shortcuts, multiple windows, window
restore; the note page in content-only mode with native spelling, Look Up, drag and drop, find.

**M3. First launch, local mode and accounts.** The two-choice welcome; the local library (create, open,
choose folder, iCloud, Dropbox, Google Drive, this Mac only); sign-in (email and password, TOTP, Google,
Apple, PKCE); the account and place switcher; Move or copy notes; Markdown export; Takeout. Migration from
1.0.04 tested with scratch data only.

**M4. Lists.** Home (cards, Catch me up / Your week), All notes, folders and nested folders, folder cards,
Starred, Shared with me, Changes, Drafts, search and the command palette, Notifications, selection bar,
context menus.

**M5. Tasks, Calendar, Settings.** Tasks and their views, Calendar (week, month, subscriptions), every
Settings section native, including Webhooks, API tokens, Connected apps, AI export and workspace Data.

**M6. Foli AI.** Finish the native chat (panel and page), tools sheet, Continue, guardrail messages, credits
for accounts; on-device and own-key providers in local mode.

**M7. Vault.** Account Vault (Files & Notes, Health, Activity, People, Trash, Settings, sharing, one-time
links, previews) and the local Vault.

**M8. The rest.** Sharing dialogs and folder sharing, invitations, Templates, Archive, Trash, Graph, Reviews,
help, onboarding tips.

**M9. Mac extras.** Quick Add panel and hotkey, menu bar item, Dock badge and menu, Spotlight, Services,
Share menu, App Intents, Quick Look, text recognition, Touch ID lock, open at login with background sync,
call recorder.

**M10. Performance, tests, release.** Launch time, memory with several places, long lists, energy; full
`swift test`, `pnpm typecheck`, `pnpm test`, e2e, the diff suite; the upgrade test from 1.0.04; release
1.1.00 through `apps/mac/scripts/publish.mjs` only with the owner's OK.

---

## 5. Details worth fixing now

### 5.1 What stays web
Only the note page: the editor and everything drawn inside a note. Shared notes opened from a public link,
presentation mode and print use the same page.

### 5.2 Menus
The Mac menu bar is AppKit `NSMenu` (required by macOS). Every menu inside the window (right-click, dropdowns,
selects, the account menu) is a native Folevi menu matching the web's menu component, with type-to-select and
arrow keys.

### 5.3 Local library
`.fnote` files as specified in `docs/LOCAL_MODE_PLAN.md`; Markdown export of a note, a folder or everything.
Server-only features (sharing, public pages, comments with others, workspaces, email-in, MCP/REST, credits)
hidden with one "Sign in to Folevi to share and collaborate" note. No limits and no prices in local mode.

### 5.4 Accounts and places
One library on this Mac plus any number of accounts (`docs/MULTI_ACCOUNT_PLAN.md`): switcher in the account
menu, every place keeps syncing, reminders from every place, Quick Add asks which place.

### 5.5 Migration from 1.0.04
Same bundle id, team `7K32QQ2FX8`, same `~/Library/Application Support/Folevi` layout and Keychain items. The
update must keep sign-ins, keys, the library and unsent edits. Gate: install 1.0.04 with scratch data in a
scratch user folder, update to the new build, check everything is there. The owner's real library and app data
are never touched by tests.

### 5.6 Local Vault
Vault items stored in the library folder (`vault/`), encrypted with a key wrapped by the passcode and a recovery
key, using the same item and file formats as the account Vault so a library can move into an account later.
Health and Trash work; People, sharing and the signed activity log need an account.

---

## 6. Order and milestones

1. M0, M1 (foundation; first diff report on components)
2. M2 (frame and editor glue)
3. M3 (first launch, local mode, sign-in)
4. M4 (lists)
5. M5 (Tasks, Calendar, Settings)
6. M6 (Foli AI)
7. M7 (Vault)
8. M8 (sharing, Templates, Trash, Graph, Reviews)
9. M9 (Mac extras, in parallel with 6 to 8 where they don't touch the same files)
10. M10 (performance, tests, release)

Internal builds go to the owner after milestones 2, 3, 4 and 7 (signed for this Mac, not notarized or
published). Until 1.1.00, today's 1.0.x app keeps receiving web changes as before.

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Native drifts from the web over time | Tokens and icons generated, diffs in CI, the same-round rule after release. |
| Text renders slightly differently in Core Text than in WebKit | Match font features and metrics per role in a test; small anti-aliasing tolerance in the diff. |
| The branch is 51 web commits behind | M0 first, before any screen work. |
| Memory with several places and tabs | One engine for all places, editors only for open tabs, unload hidden tabs. |
| Data loss on upgrade | Upgrade gate from 1.0.04 with scratch data; engine and file formats unchanged. |
| Shared Swift code affects the paused iOS app | Mac-first; anything touching shared iOS files is flagged; iOS is not rebuilt or released. |

---

## 8. Hard rules for this work

Never push `main`, deploy, notarize or publish without the owner's OK. Never use `--prod` with the Convex CLI.
Never print secrets. Never touch `~/Documents/Folevi Library`, `~/Library/Application Support/Folevi` or the
"Folevi Safe Storage" Keychain item; tests use scratch folders and dev test accounts. No em dashes. The
assistant is "Foli AI". Commit with `git commit <paths>`.
