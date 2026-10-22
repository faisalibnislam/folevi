# Several places at once (2026-10-22)

One library on this device ("Keep notes on my devices") plus any number of Folevi accounts, switchable without
signing out, on the web and in the Mac, iPhone, iPad and Android apps.

## Owner decisions (2026-10-21/22, fixed)

- **Where:** the switcher is the account menu at the bottom of the sidebar. Each place shows: accounts with
  avatar, name and email, their workspaces nested under them; the library with a Mac or phone icon, "On this
  Mac" (or this iPhone, iPad, phone) and where it syncs (iCloud, Dropbox, Drive, a folder); unread and reminder
  dots per place. The menu ends with: Sign in to another account, Move or copy notes..., Settings, Sign out of
  <name>.
- **What:** one library on the device plus any number of Folevi accounts. The website gets several accounts
  too; the library only exists in the apps.
- **Each place stays signed in** with its own data, settings and encryption keys. Switching needs no sign-in
  and is instant. Nothing crosses between places unless the person moves it.
- **After signing in from the library:** one screen asks "Move my notes into this account" or "Keep them
  separate on this Mac" (`components/migrate/MigrationGate.tsx`, first version in e32e2625).
- **Moving:** everything or picked folders and notes, in every direction (library to account, account to
  library, account to account), from the account menu ("Move or copy notes...") and from folder and note
  menus. Plus a Takeout file: any account (web or apps) downloads one file with everything (notes, files,
  history, folders, tags) that a library or another account can import.
- **Background:** reminders and notifications from every place arrive, labelled with the place, and clicking
  one switches to it. Quick Add (Mac window, iOS and Android widgets, share and tile) asks which place and
  remembers the last. Every place keeps syncing in the background, not only the open one.
- **Signing out of one account** removes that account's offline copy and keys from the device after warning
  about unsynced changes. Removing the library only forgets it and never deletes its folder.

## Words

- **Place:** the library on this device, or one Folevi account. A place id is `library` or `acct:<user id>`,
  where the user id is Better Auth's (the same on every device, so a push or a notification names it).
- **Open place:** the one a window shows. **Other places:** the rest, still signed in, kept up to date in the
  background where the platform allows it.
- An account's workspaces are inside the account (Personal plus team workspaces, as today); switching
  between Personal and a workspace of the same account is not a place switch.

## 1. What the code already gives us

- An account's data on the device is already keyed by its profile id: IndexedDB `folevi-<profileId>` (sync
  state, outbox, cached documents and queries, waiting uploads, the offline snapshot), tabs
  (`folevi:tabs:<profileId>`), the sync journal and its Web Locks. The E2EE key store (`folevi-e2ee`) keeps one
  record per profile.
- The library's data is `folevi-local-<libraryId>` plus the host's journal, and its folder.
- The move between modes is one generic copy (`lib/migrate/copy.ts`) from a `MigrationSource` to a
  `MigrationTarget`, both written against the public Convex functions, so it works with any client: a
  `ConvexReactClient`, a `LocalClient` over a library, or a plain Convex HTTP client.
- A page has one backend for its life (`BackendProvider`), and several singletons hang off that: the Convex
  client (`getConvexClient`), Better Auth's session atom, the E2EE key session and router, the current
  backend mode. That is why **switching reloads the page** into the other place instead of swapping clients
  under a live page. A reload of the bundled interface from local assets, with the place's data in IndexedDB,
  takes well under a second; on the website the service worker serves the shell. It reads as instant, and it
  guarantees nothing from the old place survives in memory.
- Better Auth 1.6.33 ships `multiSession` (`better-auth/plugins/multi-session`): every new session also gets a
  signed cookie `folevi.session_token_multi-<token>` holding the same value as the session cookie; endpoints
  list, set active and revoke them; a new sign-in of a user already in the jar replaces that user's old
  session; `maximumSessions` caps the jar (default 5). Its `/sign-out` hook ends **every** session in the jar,
  and its endpoints take the raw session token from the page. Both shape the web design below.

## 2. Sessions per account

### 2.1 Web

- **Server:** `convex/auth.ts` adds `multiSession({ maximumSessions: 10 })`. Ten is a cookie-size limit (each
  entry is about 200 bytes of Cookie header); the apps have no such limit.
- **The page pins its account.** Each tab opens one place. Better Auth's client (`lib/auth/client.ts`) sends
  every `/api/auth/*` request with `x-folevi-account: <user id>` (a `customFetchImpl`, `lib/places/pin.ts`).
  The `/api/auth` proxy (`lib/auth/server.ts`) swaps the request's session cookie for that account's multi
  cookie before it reaches Convex, so `get-session`, `convex/token`, Settings > Security and everything else
  act for the tab's own account whatever the browser's "active" cookie says. Without the swap, a tab on account
  A would get account B's Convex token after another tab switched, and A's screen would show B's data: the one
  failure this design must rule out.
  - The proxy finds the account's cookie through `folevi.places` (HTTP-only; `__Host-` on https), a small map
    of user id to a hash of the session token that the proxy writes itself. A miss asks Convex once
    (`multi-session/list-device-sessions`, server to server) and rewrites the map.
  - A pinned account that isn't in the jar (signed out in another tab, expired) gets a 401, and that tab says
    the session ended, exactly as today.
  - `get-session` answers are checked: a user id that isn't the pinned one is answered as "no session".
- **No session token reaches the page.** The plugin's own endpoints (`/api/auth/multi-session/*`) are refused
  by the proxy; the page uses Folevi's routes instead, which call them server to server:
  - `GET /api/places`: the accounts signed in on this browser (user id, name, email, image), no tokens;
  - `POST /api/places/keep`: before "Sign in to another account", makes sure the current session has its
    multi cookie (sessions made before the plugin was on don't; the cookie's value is the session cookie's
    own, so no secret is needed);
  - `POST /api/places/sign-out {userId}`: revokes that one session (`multi-session/revoke`), leaving the rest.
- **Signing in to another account:** `/signin?add=1` (and `/signup?add=1`) show the form even with a session
  cookie. The tab marks itself "adopt" (sessionStorage) before going, so after sign-in it opens the new
  account rather than the last one.
- **Which place a tab opens:** the tab's own pin (sessionStorage, survives reloads), else "adopt the active
  session" after an add, else the last place used in this browser (localStorage `folevi:places`), else the
  browser's active session. A new tab opens the last place, like Slack and Gmail.
- **The registry** (`folevi:places`, localStorage): for each account, user id, profile id, name, email,
  avatar, workspaces (name, logo), last opened. Written by the page of that account; read by every page for the
  switcher. No tokens, nothing secret; signing out of an account removes its entry.

### 2.2 The apps (Mac, iPhone, iPad, Android)

- The host keeps one bearer session per account, never in page JavaScript:
  - Mac: `secrets/auth.session.<placeId>.bin` (safeStorage), the old `auth.session.bin` adopted by the first
    account;
  - iOS: Keychain service `com.folevi.shell-auth`, account `session.<placeId>` (the old `session` adopted);
  - Android: the Keystore-encrypted store, key `session.<placeId>` (the old `session` adopted).
- `places.json` in the app's own storage (Mac `userData/places.json`, iOS Application Support, Android shared
  preferences) lists the library (set up or not) and each account (user id, profile id, name, email, avatar URL,
  workspaces for the menu, unread count), the open place, and Quick Add's last place. It replaces the old
  `mode`, which still reads and writes for older pages: `local` is the library, `account` an account.
- **Sign in to another account** runs the same PKCE sign-in as today; afterwards the host asks
  `/api/auth/get-session` with the new token for the user id. The same user signing in again replaces that
  account's token (and ends the old session); a new user becomes a new place. Signing in no longer ends the
  session another account holds (today's `authBridge.signIn` does, since there was only one).
- **A page is bound to its place by the host.** On the Mac the main process records which place each
  `webContents` shows; `auth.fetch`, `auth.convexToken`, the E2EE calls and the reminders all use the sender's
  place, never an id the page passes. iOS and Android have one web view, bound to the open place. The one
  exception is a move between two accounts, which asks for the other account's Convex token by name
  (`places.convexToken(id)`), and only from a page that is itself signed in.

## 3. Switching

1. The page flushes: the account's engine and outbox get up to two seconds to send what's queued (it stays
   queued on the device if they can't; nothing is lost), the library writes its notes to the folder.
2. Web: the tab's pin changes and the tab reloads. Other tabs stay where they are.
3. Apps: `places.switchTo(id)`; the host saves it and reloads every main window into that place (on the Mac,
   windows follow the open place, as they follow the mode today). Its content policy and network rules follow
   the place: the library's windows reach nothing but the app, an account's reach Folevi and Convex.
4. The switcher shows the place being opened at once; the new page starts from that place's own copy on the
   device (offline snapshot, cached documents), so it shows content before the network answers.

Clicking a workspace of another account switches place and opens that workspace (`folevi:context:<profileId>`).

## 4. Keeping places apart on the device

| What | Today | Change |
| --- | --- | --- |
| Account data (IndexedDB) | `folevi-<profileId>` | none |
| E2EE replicas | `folevi-e2ee-<scope id>`: Personal's (`personal:<profileId>`) already names its owner, but a workspace two accounts both belong to would share one copy (and one hosting window) | a workspace's gets `_<profileId>` (database, Web Lock and channel); the old shared copy is dropped (it's a cache the pull refills) |
| E2EE key store (web) | `folevi-e2ee`, one record per profile | none |
| E2EE device keys (Mac) | `userData/e2ee/device.bin`, one pair per Mac | per account: `userData/e2ee/accounts/<placeId>/`; the existing pair moves to the first account. Separate keys also stop the server from linking two accounts through one device key |
| E2EE device keys (iOS, Android) | one Keychain or Keystore entry | per account (`<placeId>` in the key alias) |
| Current workspace | `folevi:context` | `folevi:context:<profileId>` (the old one read once) |
| E2EE "start with the router" hint | `folevi:e2ee` | `folevi:e2ee:<profileId>` |
| iPhone tab stacks | `folevi:iphone-tabs` | per profile |
| Offline cold start | `folevi:last-account` | the registry's last place |
| The widgets' REST token (iOS, Android) | one | one per account (`setCredential` keyed by account) |

Sign-out of one account (`clearAccountData(profileId)`) deletes exactly that account's databases and keys;
`clearAllLocalData` stays for "sign out of everything".

## 5. Background

### 5.1 Web: a runner per other account

- Each other signed-in account gets a hidden same-origin iframe, `/place-sync?place=acct:<id>`, its own
  JavaScript realm (so its Convex client, key session and engine are its own). It pins itself from its URL,
  opens the account's engine, outbox and uploader (so whatever was queued when the person switched away
  still goes up), watches the account's notifications and unread count, and reports to the page over
  `postMessage`: unread count, reminders due, new notifications. It renders nothing.
- **One runner per account in the browser:** a tab showing account X holds the Web Lock `folevi-place:X` in
  shared mode; a runner asks for it exclusively, so it only runs while no tab shows X, and it steps aside (and
  its iframe is removed) as soon as one asks for it again.
- New notifications from another account show as a toast in the open place, labelled "In Work: Sam
  mentioned you", with Open (which switches and opens the note). The account's dot in the switcher shows its
  unread count.
- E2EE accounts: the runner unlocks only if this browser can do it silently (a trusted browser). If it can't,
  its queued edits wait until the account is opened, and the switcher's line says "Open to finish syncing".

### 5.2 Mac: hidden windows owned by the app

- The main process runs one hidden window per place that no main window shows: `app://folevi/place-sync?place=…`
  for an account (the same page as the web's runner), and `app://folevi/place-sync?place=library` for the library
  while an account is open (it hosts the library through the Web Lock `folevi-local-library` the windows
  already use, so it keeps writing the journal out to the folder, reading what other devices wrote and
  scheduling their reminders).
- The content policy for `place-sync` and Quick Add pages follows the `place` in their URL; main windows follow
  the open place. The network guard goes per `webContents` (`details.webContentsId`): a library page can't
  reach Folevi or Convex even while account runners in the same session can.
- Mac notifications from any place say which place in the title line ("Work · Sam mentioned you"); clicking
  one switches the main windows to that place and opens the note. The Dock badge is the sum of every place's
  unread count. Reminders scheduled by the library stay scheduled whichever place is open (today they're
  cleared when the mode changes to account).

### 5.3 iPhone, iPad, Android

The systems don't keep a web view running in the background, so:

- before switching away, the page flushes (§3); what's still queued goes up the next time that place opens;
- notifications come from the server by push, per account, as now (each account registers this device when
  it's open). New: the registration carries a label (`push.registerApns`/`registerFcm` `label`: the account's
  email when the device has more than one place), and the server puts it in the notification (APNs
  `subtitle`, FCM data `place` shown by the app). Every push carries the recipient's user id, so tapping it
  switches to that place first;
- the library's reminders are local notifications, labelled "On this iPhone" (iPad, phone);
- while the app is open, the page asks each account for its unread count once a minute with a short-lived
  Convex HTTP query (`notifications.unreadCount`, with that account's token from the host) for the dots.
  Never from the library's page, which reaches nothing but the app.

## 6. Quick Add

- **Mac:** the Quick Add window shows a place picker (the app's Select) above the form. Choosing another
  place reloads the window bound to it, and the choice is remembered (`places.json` `quickAddPlace`).
- **iOS:** the share extension gets a "Save to" picker of places (from the App Group's `places.json`, written by
  the app), defaulting to the last; account places use that account's device credential (the REST API, as
  today), the library queues in `LocalActions`. Widgets, Siri and Shortcuts use Quick Add's last place.
- **Android:** the share activity and the Quick Settings tile ask the same way; widgets follow the last place.

## 7. Moving and copying notes

### 7.1 The copy

`lib/migrate/copy.ts` grows three options, all tested in `tests/parity/migration.test.ts` style:

- **`pick`**: folder ids and note ids. A picked folder brings its subfolders and every note in them; a picked
  note brings the notes under it and the synced content and collection rows it needs.
- **`freshIds`**: block, note, folder and collection ids are globally unique on the server
  (`by_public_id`, `by_block_id`), so a copy into an account that might already hold them (account to account,
  a copy made twice, any Takeout import) gets new ids. New ids are derived from the old ones with a key made
  for that move (`<old id's time part><16 characters of HMAC(moveKey, old id)>`), so a copy that stops and goes
  on gives the same ids, and every reference inside the copied notes (page links, page blocks, synced blocks,
  collection blocks and relation values, parents) is rewritten. References to notes that didn't come along stay
  as they were (as today).
- **`move`**: once a note is copied, it goes to Trash where it came from (the source's own `moveToTrash`, so it
  can be restored for 30 days). Copy leaves the source alone.

The existing "Move my notes into this account" keeps today's behaviour (same ids, so links from elsewhere keep
working).

### 7.2 Where it runs

The copy needs both places' clients in one page:

- **account (open) and library:** the library opens beside the account (`openLibraryHere`, as the move does
  today). From the library's page, a move involving an account switches to that account first and runs there
  (the library's page can't reach Folevi), the move kept in `folevi:migration` so it picks up after the reload.
- **account (open) and another account:** the other account through a Convex HTTP client with its own token
  (web: the pinned token route; apps: `places.convexToken(id)`), refreshed every 10 minutes.
- **E2EE:** the open place's client is the E2EE router when it has encryption, so it reads and writes its
  encrypted spaces. The other account is only reached raw, so an encrypted space there can't be read or written:
  the dialog says to open that account and move from there, and lists its encrypted spaces as not available.

### 7.3 The interface

"Move or copy notes..." (account menu, and Move to another place... in folder and note menus) opens one dialog:
From (this place, and for an account Personal or a workspace), To (any other place, and for an account Personal
or a workspace you can edit), What (Everything, or pick folders and notes; from a folder or note menu that
item is picked), Move or Copy (Copy by default), Bring version history (on). Then the same progress, stop and
go-on, problems and summary as today's move screen.

## 8. Takeout

- **Format:** a library folder in a zip. `folevi-takeout.json` at the top (`format: "folevi-takeout"`, `v: 1`,
  the account's name and email, when, what's inside, the app version), then the library exactly as
  `packages/local-store` writes it (`folevi-library.json`, `notes/`, `files/`, `history/`, `index/`), never
  encrypted, plus `exported/server-only.json` (comments, sharing and workspace members, as the move to a library
  already writes). Workspaces come as top-level folders named after them, as in the move to a library. Opening
  the folder as a library works too, since it is one.
- **Download:** Settings > Import & export > Download a takeout file, on the web and in the apps, for an
  account. It builds the library in memory (`LibraryStore` over a memory folder, a `LocalClient` on it), copies
  the account into it with the copy above (Personal plus the workspaces the person manages, history on), and
  zips it with fflate. In a browser the file downloads; in the apps the host saves it (`shell.files.save`).
- **Import:** Settings > Import & export > Import a takeout file, in an account or the library: unzip into a
  memory folder, open it as a library, copy into this place with fresh ids (and into a folder named after the
  takeout, "Takeout from you@example.com, 22 Oct 2026"), so importing twice gives two copies, never a mix.
- **Limits:** the takeout is built in memory, so it is as large as the browser lets a page hold (about 2 GB of
  attachments in Chrome and Safari). Larger accounts are refused with how much is too much, and the server's
  own export (Settings > Export) stays there for them.

## 9. Signing out of one place

- **An account:** "Sign out of <name>" warns if anything of that account on this device hasn't synced (count
  from its own database, even if another place is open), then: its device credential and push registration go
  (the server forgets this device for that account), its session ends (web: `/api/places/sign-out`; apps: the
  host's `places.signOut(id)`), its databases, E2EE replicas, key store record and the app's keys for it are
  deleted, its registry entry goes. The tab (or app) opens the next place, or the sign-in page (web) or the
  first-launch choice (apps) when none is left.
- **The library:** "Remove from this Mac" (Settings > Library) writes out what's waiting, then forgets it: the
  library's copy on the device and its journal go, the folder stays exactly as it is (its files are the
  library), and setting it up again on the same folder brings everything back.

## 10. Server changes

- `convex/auth.ts`: `multiSession({ maximumSessions: 10 })`.
- `convex/push.ts`: `registerApns` and `registerFcm` take an optional `label` (40 characters); `convex/lib/apns.ts`
  and `fcm.ts` add it (APNs `alert.subtitle`, FCM data `place`) and every push carries `placeUserId`.
- Nothing else: moves and takeouts use public functions that exist, and their checks and limits apply.

## 11. Risks

1. **Data crossing between places** (a tab with one account's screen and another's token). Guarded by the pin on
   every auth request and the proxy's check of `get-session`, a Convex client per realm, page reload on switch,
   and e2e tests that switch in one tab while another stays.
2. **The plugin's sign-out ends every account.** Folevi never calls `/sign-out` for "Sign out of <name>"; it
   calls `/api/places/sign-out`. Plain `/sign-out` (no other accounts) behaves as before.
3. **Session tokens in the page.** The plugin's endpoints take tokens; the proxy refuses them from browsers,
   and only server routes call them.
4. **Hidden runners use memory** (one realm per account). Capped at nine on the web (ten accounts); on the Mac
   each is a hidden window that sleeps its timers when nothing is queued.
5. **Duplicate notifications** from two tabs: the Web Lock keeps one runner per account; a tab showing the
   account counts as its runner.
6. **Takeout size**: refused above what a page can hold, saying so.
7. **E2EE in the background**: only silent unlocks; otherwise the dot says to open the place.
8. **Old hosts and pages**: every new bridge field is optional; without `places` the apps behave as today (one
   account or the library).

## 12. Phased build

- **P0** this plan.
- **P1 web accounts:** server plugin; proxy pin, `/api/places*`; `lib/places` (registry, pin, switch, add, sign
  out of one); sign-in with `add=1`; the switcher in `WorkspaceMenu.tsx`; per-account storage keys and E2EE
  replica names; unit tests (proxy rewrite, registry, pin), e2e `places-web.spec.ts` (two accounts in one
  browser, switching, a second tab staying put, sign out of one).
- **P2 background on the web:** `/place-sync` runner, Web Locks, labelled toasts, dots; e2e.
- **P3 moves and Takeout:** `pick`, `freshIds`, `move` in the copy; the dialog; Takeout download and import;
  parity tests and e2e `places-move.spec.ts` (account to account, takeout round trip).
- **P4 Mac:** `places.json`, tokens and E2EE keys per account, the page's `places` bridge, binding per
  `webContents`, policy and network guard per place, hidden runners, labelled notifications and Dock badge, Quick
  Add's picker, library forget; desktop unit tests and e2e `places-shell.spec.ts` (FakeShell: library plus two
  accounts).
- **P5 iPhone, iPad, Android:** the same `places` bridge in Swift and Kotlin (tokens, keys, places file),
  switching, push label and tap to switch, the share and Quick Add pickers; built and run in the Simulator and
  on the emulators.
