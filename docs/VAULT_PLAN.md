# Vault: plan (2026-10-27)

A place in the sidebar for passwords, API keys and sensitive documents, on every plan, Free included. It is
always end-to-end encrypted, whatever the space's encryption level, opens with each person's own passcode,
and keeps a log of everything done in it for 3 years that nobody can remove. Web first (the iPhone, iPad and
Mac apps are paused; Android is paused completely).

The owner's decisions (2026-10-27) are in section 1. Sections 2 to 9 are the design. Section 10 is the
order of work. Section 11 lists the smaller points the owner accepted.

## 1. Decisions

| Topic | Decision |
| --- | --- |
| Where | One Vault per workspace (the team Vault) and one in each person's Personal. Every plan, Free included. |
| Access to a team Vault | Only people the owner or a custodian adds. Joining the workspace doesn't open it. Workspace admins have no access unless added. Guests never. |
| Roles | **Owner** (the workspace owner, always a custodian). **Custodian**: everything (add, edit, delete, share anything, add and remove members, move things out, export, read the whole log). **Member**: view everything, add passwords, notes and files, edit or delete only what they added, read their own log entries. |
| Who names custodians | A Vault setting the owner chooses: "Only the owner names custodians" (custodians add members) or "Custodians can name custodians too". |
| Passcode | Each person sets their own. It and the person's own encryption keys open the Vault together. First open: choose a passcode and save a recovery key. |
| Forgotten passcode | Either the person's own recovery methods, or any custodian re-grants access. Folevi can never open a Vault. |
| Auto-lock | After 5 minutes idle (custodians can set 1 to 30 for the team Vault), when the tab closes, the computer sleeps or the person signs out. |
| Sharing a note | With workspace members who aren't in the Vault, with people outside the workspace (a Folevi account, end-to-end encrypted, with an expiry date), and by one-time secret link (works once or until it expires). Folders are never shared. |
| Log | Everything (section 7). Owner and custodians read all of it, each member reads their own. Kept 3 years, then deleted automatically. Nobody can delete or edit an entry before then. |
| Notifications | To everyone in the Vault when files, notes or passwords are added or changed, and when people are added or removed. Text says who and what kind only ("Maya added a file to the Vault"), never an item's name. |
| Foli AI, search, apps | Never in the Vault: no Foli AI, no server search, no MCP, REST API, webhooks, email-to-note or clipper. Search inside the Vault runs on the device while it's unlocked. |
| Moving in and out | Anyone with access moves a regular note in (it's encrypted, the readable copy removed). Only custodians move something out, after a warning. Both logged. |
| Passwords | Item types (login, API key, card, bank account, secure note, SSH key, Wi-Fi, software licence, identity), generator, strength and breach check, 2FA codes (TOTP), import (1Password, Bitwarden, LastPass, browsers) and export. |
| Storage | Vault files count toward the plan's storage like any attachment. |
| Release | Everything at once (one release). |

## 2. What the Vault is (and isn't)

- **Its own place, not a folder.** A sidebar entry, **Vault**, with a lock icon, under Shared with Me. Route
  `/vault`. It isn't in the folder tree, All folders, Drafts, All notes, Recent, Starred, search, the graph,
  Changes, Catch me up, exports of the space, the device copy (Settings > Offline & sync), or anything Foli AI
  reads.
- **Three sections inside:** **Passwords & Credentials**, **Files & Notes** (folders and subfolders holding
  notes and any files: images, PDFs, md, txt, anything) and **Activity** (the log). Plus **People** (team
  Vault only) and **Settings**.
- **Locked by default.** Until unlocked, the page shows only "Vault" and the unlock screen. Nothing of the
  Vault's content, not even the number of items, is drawn before the passcode.

## 3. Encryption

Built on the end-to-end encryption that already exists (docs/E2EE_DESIGN.md: account keys, trusted devices,
approval codes, recovery methods, per-note keys, sealed files, encrypted links). The Vault adds one key layer
and a passcode layer.

```
Vault key VK(vault, v)            32 random bytes, a new version whenever someone loses access
 ├─ HKDF "vault/wrap"   → wraps item keys and the keys of vault notes
 ├─ HKDF "vault/meta"   → folder names, item titles, log details (sealed per entry)
 └─ HKDF "vault/mac"    → blind index for duplicate and reuse checks
   granted to each person with access as a double wrap:
     inner = sealed box to the person's account X25519 key (the existing account keys)
     outer = AES-256-GCM with a key from their passcode (Argon2id, m = 64 MiB, t = 3, p = 1, own salt)

Item key IK(item, v)              32 random bytes per password item, wrapped by VK "vault/wrap"
Note key NK(doc, v)               vault notes are sealed notes, their keys wrapped by VK (not the space key)
File key FK(file)                 as today, wrapped by the owning note's or item's key
```

- **Two things to open it.** The person's account private key lives only on their trusted devices; the
  passcode lives only in their head. The server holds the doubly wrapped grant and can't try passcodes,
  because it never has the account key. Someone with an unlocked laptop still needs the passcode.
- **Always encrypted.** A Standard workspace's Vault is end-to-end encrypted all the same. Opening a Vault the
  first time makes the person's encryption keys quietly if they have none (their own notes stay at their
  current level) and asks them to save a recovery key.
- **Recovery.** The recovery key opens the account keys (existing). A custodian's device can also re-grant:
  when a member resets their passcode, the member's new passcode-wrapped grant is completed by any online
  custodian's device (same pattern as workspace grants, E2EE_DESIGN §8.2). Personal Vaults have no custodian,
  so only the person's recovery methods work there.
- **Rotation.** Removing someone from the Vault, or demoting a custodian who leaves the workspace, makes VK
  v+1 for everyone left and re-wraps every item and note key; old versions are deleted once nothing uses them.
- **Unlock throttling.** Each unlock asks the server for the person's grant (`vault.unlock`), which is logged
  and rate-limited: 5 wrong passcodes in a row (reported by the device) lock that person's Vault for 15
  minutes, then 1 hour; custodians are notified after 10.
- **While unlocked.** Keys stay in memory only (non-extractable `CryptoKey`s where possible), never in
  IndexedDB. Locking drops them. Passwords are hidden until revealed; copying clears the clipboard after 30
  seconds.

## 4. Passwords & Credentials

- **Item types** with their own fields: Login (username, password, websites, 2FA secret), API key (key,
  secret, environment, expiry), Card, Bank account, Secure note, SSH key (private and public key, passphrase),
  Wi-Fi, Software licence, Identity. Any item can have custom fields (text, hidden, URL, date), tags, notes
  and attached files.
- **Generator**: random passwords (length, symbols) and passphrases (words). Shown in the password field.
- **Health**: weak, reused (compared by the blind index, never in readable form) and known-breached
  passwords, checked on the device with the same k-anonymity range check sign-up uses
  (`convex/lib/breachedPasswords.ts`: only 5 characters of a hash leave the device). A **Health** view lists
  what needs changing; API keys past their expiry date are listed too.
- **2FA codes**: the TOTP secret is stored in the item; the 6-digit code and its countdown are worked out on
  the device. Copying the code is logged.
- **History**: every change keeps the previous version of the item (who changed it, when), so an old password
  can be brought back. Kept as long as the item is, and listed in the log.
- **Import**: CSV and JSON exports of 1Password, Bitwarden, LastPass, Chrome, Safari and Firefox, parsed and
  encrypted on the device; a preview before anything is saved. Logged as one entry with the count.
- **Export**: custodians (and the owner of a Personal Vault) export an encrypted backup file protected by a
  passphrase they choose, or a plain CSV after a strong warning. Both logged.

## 5. Files & Notes

- **Folders and subfolders**, names encrypted. Not shareable (as decided). Custodians and the item's adder can
  rename, move and delete.
- **Notes** use the normal editor. Built as vault items (2026-10-27), not as documents of the space: a note's
  content is its item's sealed secrets, saved whole, each save keeping the version before. This keeps vault notes
  out of every list, sync feed and derived index by construction. Comments inside vault notes come later.
- **Files** of any kind, encrypted on the device before upload (the existing sealed-file path). Images and PDFs
  preview inside the Vault after unlocking; other files download. Downloading is logged.
- **Moving in**: "Move to Vault" in a note's and a file's menu. The note is sealed with a new key, its readable
  copies (search text, previews, mirrors, the device copy) are removed, and existing shares and public links
  on it are ended (with a warning listing them). **Moving out**: custodians only, after a warning, into a
  folder of the space.
- **Deleting**: items go to the Vault's own Trash for 30 days; only custodians empty it. Both logged.

## 6. Sharing a vault note

| Way | How | Rules |
| --- | --- | --- |
| A workspace member not in the Vault | The note's key is sealed to their account key (existing page grant, E2EE §8.4). They open just that note, read-only or editable, from Shared with Me. They never see the Vault. | Custodians, and members for notes they added. Optional expiry. |
| Someone outside the workspace | Same, as a guest; they need a Folevi account with encryption set up (an invitation waits until they have keys). | Expiry required (default 30 days). |
| One-time secret link | The existing encrypted link (key after `#`), plus: the server hands the wrapped key out once (or a set number of times, up to 10) and deletes it, and the link expires (1 hour to 30 days). Optional passcode on the link. | Read-only. Revocable until used. |

- Passwords items can be shared by one-time link too (a contractor gets one login, once).
- Every share is listed on the item (who, how, until when), revocable, and every open of a shared note or link
  is logged with who (or "someone with the link"), when, device and IP.
- Removing a share rotates that note's key (existing).

## 7. The log (everything)

### 7.1 What each entry keeps

| Field | Example |
| --- | --- |
| When | Exact time, to the millisecond, and the person's time zone |
| Who | Their name and email as they were at that moment, their Vault role (owner, custodian, member, or an outsider through a share or link) |
| What happened | The event (7.2) and whether it succeeded or failed, with the reason for a failure |
| Which item | Its kind (password item, note, file, folder) and its name and folder path, sealed with the Vault key so only people with access read them in the log |
| Details | What changed (which fields: "password, website", never the values), the old and new location for moves, the recipient, role and expiry for shares, the number of items for imports and exports, the file's type and size |
| Device | The device and browser (Chrome 141 on macOS 26), whether it's a trusted device or a public-computer session, the device id |
| Network | IP address and the approximate place it maps to (city, country) |
| Session | The unlock it belongs to, so every action can be read as part of one visit (unlocked at 9:02, opened 3 items, locked at 9:14) |
| Source | Server-seen (the server did it, so it can't be skipped) or device-reported (7.3) |
| Integrity | A hash of the entry and of the one before it (7.4) |

### 7.2 Events

- **Access**: unlock (and failed unlock attempts, with the count), lock (by hand, by auto-lock after idle, by
  closing the tab, by sleep, by sign-out), passcode set, changed, reset by recovery key, re-granted by a
  custodian, throttled after wrong attempts.
- **Viewing**: Vault opened, a section or folder opened, an item opened, a password or hidden field revealed,
  copied (which field), a 2FA code shown and copied, a note opened, a file previewed, downloaded, printed
  (where the browser tells us), a version from history viewed.
- **Changes**: item, note, file or folder added, edited (fields named), renamed, moved, restored from history,
  deleted, restored from the Vault's Trash, Trash emptied; a note moved in or out of the Vault; import,
  export.
- **Sharing**: a note shared (with whom, how, role, expiry), share changed or removed, share expired, a shared
  note opened by its recipient, a one-time link created, opened (each time), used up, expired, revoked.
- **People and settings**: someone added, removed, made custodian or member, left the workspace (access ended
  automatically), Vault key rotated, a setting changed (auto-lock time, who names custodians), notifications
  sent (to whom, about what).
- **Health**: a breached or weak password found (on the item, with the date).

### 7.3 What no software can record (said plainly in the Activity screen's help)

- A screenshot, a photo of the screen, someone reading over a shoulder, or text retyped by hand.
- Device-reported events (reveal, copy, print, preview, lock by idle) come from the person's browser. A
  modified browser could leave them out. Everything that needs the server (unlock, opening an item, its key or
  file, every change, every share and link open) is recorded by the server itself and can't be skipped.

### 7.4 Can't be removed, can't be changed

- One table, `vaultLog`, written only by internal server code. No function edits or deletes an entry, for
  anyone, including the owner and Folevi's admin tools. A static test fails if one is added.
- Each entry carries the hash of the previous entry of its Vault (a chain), and every day the server signs the
  latest hash; the Activity screen checks the chain and says "Log verified" or where it breaks.
- Deleted automatically 3 years after each entry (a daily cron). Entries stay when a person leaves, is
  removed or deletes their account (their name stays as it was), and for 3 years after a workspace is
  deleted.
- Owner and custodians read and filter everything (by person, item, event, date) and export it (CSV, PDF,
  signed JSON). Members see only their own entries.
- The privacy policy needs a line about this log (who can see it, 3 years).

## 8. Notifications

- Everyone with access to the Vault (except the person who did it) gets one in the bell, and by email and push
  if their settings allow: "Maya added a file to the Vault", "Sam changed a password in the Vault", "Lee
  added Ana to the Vault". The item's name shows only inside the Vault after unlocking.
- Bursts are grouped ("Maya added 12 files to the Vault"). A new Notifications setting, **Vault**, turns each
  channel on or off; custodians always get security notices (failed unlocks, a share to someone outside, an
  export).

## 9. Screens (web)

- **Sidebar**: Vault with a lock icon; a dot when there's something new since the last visit.
- **Unlock**: passcode field, "Forgot your passcode?" (recovery key, or ask a custodian), and nothing else.
- **First open**: three steps: what the Vault is, choose a passcode (a PIN of 6, 8 or 12 digits, 6 to start),
  save the recovery key (download or print, then type 4 of its words back).
- **Vault home**: the three sections, a search field (on the device), a lock button, the time until
  auto-lock.
- **Passwords & Credentials**: a list with type filters and Health; the item page with reveal, copy, 2FA code,
  history, files, shares.
- **Files & Notes**: folders and subfolders, cards for notes and files, drag and drop upload.
- **Activity**: the log with filters, the integrity check, export.
- **People** (team Vault): who has access and their role, add (only workspace members), remove, make
  custodian, re-grant after a reset, pending grants.
- **Settings**: auto-lock time, who names custodians (owner), notifications, export, the recovery reminder.
- **Health**, **Trash**.
- All of it in the design system: neutral chrome, custom controls only, the type and spacing scale, no em
  dashes.

## 10. Order of work

One release, built in this order so each part is tested on the one before it.

| # | Work | Contains |
| --- | --- | --- |
| V1 | Server model | Tables `vaults`, `vaultMembers`, `vaultGrants`, `vaultKeys`, `vaultFolders`, `vaultItems`, `vaultItemVersions`, `vaultShares`, `vaultLinks`, `vaultLog`, `vaultLogAnchors`; access rules in one place (like `lib/auth.ts`); every vault function checks access and writes the log. Additive schema only. |
| V2 | Keys and passcode | Vault key, double-wrapped grants, unlock and lock, throttling, rotation, custodian re-grant, recovery; crypto test vectors. |
| V3 | The log | Event writer, hash chain, daily signed anchor, 3-year cron, Activity screen, filters, export, integrity check; static test that nothing deletes. |
| V4 | Passwords | Item types, generator, health and breach check, TOTP, history, import, export. |
| V5 | Files & Notes | Folders, sealed vault notes in the editor, file upload and preview, move in and out, Trash. |
| V6 | People and roles | Owner, custodians, members, the custodian-naming setting, admins excluded, removal and rotation. |
| V7 | Sharing | Note grants to members and outsiders, one-time links with view limits, expiry, revocation. |
| V8 | Notifications | Events, grouping, the Vault notification setting. |
| V9 | Shut the other doors | Exclude the Vault from search, lists, AI, MCP, REST, webhooks, exports, the device copy, Changes, mirrors; tests that try each one. |
| V10 | Screens and copy | Sidebar, unlock, first open, all sections, empty states. |
| V11 | Checks | Unit and crypto tests, e2e with two and three accounts (owner, custodian, member, an outsider), the log's completeness test (every server function writes its event), an outside security review before release. |

## 11. Settled 2026-10-27 (the owner accepted these recommendations)

1. **Offline.** The Vault works online only in the first release (nothing of it on the device
   between visits). An encrypted offline copy can come later.
2. **Passcode.** A PIN of 6, 8 or 12 digits, each person's choice (6 to start): the owner's decision on
   2026-10-27, replacing "at least 8 characters, no 4 or 6 digit PINs". A stolen, unlocked laptop plus a
   short PIN is the weakest point, so a longer PIN is offered. Passcodes from before must change to a PIN at
   the next unlock. Touch ID or a passkey as a second way to unlock can come after the first release.
3. **At least two custodians.** Warn the owner while they're the only custodian ("If you lose
   your recovery key, nobody can open the team Vault").
4. **Access reviews.** Every 90 days, custodians get a reminder to check who has access.
5. **Browser autofill** (the web clipper extension filling logins): later, not in this release.
6. **Emergency access** for a Personal Vault (a trusted person who can request access after a waiting period):
   later, not in this release.
7. **An outside security review** before release.

## 12. Where it stands (2026-10-27)

V1 to V10 are built on the web and the Convex backend, behind the `vault` flag (off by default; on in dev).

V11 so far:

- **Unit and crypto tests.** `tests/convex/vault*.test.ts` cover every server function with several accounts
  (owner, custodian, member, a workspace member outside the Vault, someone outside the workspace).
  `apps/web/test/vault-*.test.ts` cover the device side. `packages/local-store/test/vault-vectors.test.ts` pins every
  derivation and wrap to `fixtures/vault-vectors.json` on both crypto backends, and checks them against node:crypto.
- **The log's completeness.** A static rule in `tests/convex/static/invariants.test.ts`: every Vault mutation calls
  `appendLog`. The three exceptions are listed with their reasons: the upload URL, the daily anchor and the 3-year
  expiry.
- **In a browser.** `apps/web/e2e/vault.spec.ts` (one account, plus a visitor without Folevi) covers:
  - set-up and the recovery key;
  - adding, revealing and copying;
  - locking, a wrong passcode and unlocking;
  - the log and its check;
  - Health and Trash;
  - a one-time link opened by the visitor and then used up;
  - a note in the editor;
  - the notification switch.

- **With three accounts.** `apps/web/e2e/vault-team.spec.ts` covers:
  - a team Vault, where the owner's device shares the key with a waiting member, who chooses a passcode and opens it;
  - an item shared with someone outside the workspace, opened from Shared with Me;
  - an edit that keeps the item's key, so the share still opens;
  - an item's history;
  - a regular note moved into the Vault and back out.

Fixed on the way:

- An edit gave an item a new key, which cut off everyone it was shared with. Edits now keep the item's key. Ending a
  share changes the key only when nobody else still holds it (another share, or a live link).
- A member waiting for the key now gets their account's encryption keys made, so a custodian can share with them.

Still to do before release:

- **An outside security review (§11.7). Required before the `vault` flag goes on in production.**
- Follow-ups: a Vault email template, and approximate location from the sign-in IP.
