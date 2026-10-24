---
name: multi-account-decisions
description: 2026-10-21 owner decisions for switching between the library on this Mac and several Folevi accounts (web and Mac)
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-21T03:42:50.648Z
---

Owner asked (2026-10-21) to switch between local mode and cloud accounts and keep several at once. Decisions:
- Switcher lives in the account menu at the bottom of the sidebar (where the account selector is today). Each place: avatar, name, email, workspaces nested under accounts; the library shows a Mac icon, "On this Mac" and where it syncs; unread/reminder dots per place. Menu also has Sign in to another account, Move or copy notes..., Settings, Sign out of <name>.
- One library on this Mac + any number of Folevi accounts. Web gets multiple accounts too (the library only in the Mac app).
- Each place stays signed in with its own data, settings and keys; switching needs no sign-in.
- After signing in from the library: one screen asks "Move my notes into this account" or "Keep them separate on this Mac" (no forced move; Not now must never bounce back).
- Moving: choose everything or pick folders/notes, both directions; plus a Takeout file from any account (web or Mac) that a library or another account can import. (Owner did not pick "move vs copy" nor "direct copy to this Mac".)
- Background: reminders and notifications from every place (labelled, click switches), Quick Add asks which place, all places keep syncing.
- Signing out removes that account's offline copy and keys from the Mac after warning about unsynced changes; removing the library only forgets it, never deletes its folder.

**Why:** people mix a free private library with work/personal accounts, like Slack/Notion account switching.
**How to apply:** build after the E2EE work lands (shared files: desktop main/preload, Sidebar, AccountGate, convex provider, sync db); keys and E2EE state are per account ([[e2ee-decisions]], [[local-mode-decisions]]).
