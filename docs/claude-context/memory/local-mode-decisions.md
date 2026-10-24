---
name: local-mode-decisions
description: "2026-10-20 owner decisions for the free no-account \"Keep notes on my devices\" mode in the Mac, iPhone and iPad apps"
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-20T13:13:33.058Z
---

Owner asked (2026-10-20) for a free, fully offline mode in the Mac, iPhone and iPad apps, chosen on first launch next to "Sign in to Folevi". Decisions from the Q&A:
- Name: "Keep notes on my devices", subline "Free forever. No account."
- Storage: a folder of files (one file per note plus a small index), so cloud folders sync per note.
- Sync: iCloud (one tap), built-in "Sync with Dropbox" and "Sync with Google Drive" (OAuth PKCE from the device, app folder / drive.file only, local mode only, not for signed-in users), "Choose a folder" (any folder; Files picker on iOS), or "This device only"; changeable in Settings.
- Foli AI in local mode: Apple on-device models by default, plus optional own API key (OpenAI, Anthropic, Google) sent straight from the device, never via Folevi.
- Switching: both ways (local to account by signing in and uploading; account to local by exporting into a folder).
- Server-only features (sharing, public pages, comments with others, workspaces, email-in, clipper, MCP/REST, credits) are hidden in local mode with one "Sign in to Folevi to share and collaborate" note.
- Apps ship the interface built in for everyone (start offline in both modes); updates come with app updates.
- Conflicts: merge per block; same block changed on two devices: newer wins, other kept in version history, "Changed on another device" notice.
- Privacy: optional Face ID/Touch ID app lock, and optional passphrase-encrypted sync folder (unrecoverable if lost).
- One local library per device for now. Mac, iPhone, iPad only; the website stays sign-in only.
- iOS: local mode never shows prices or upgrade prompts (see [[ios-app]]).

**Why:** owner wants a free, private Obsidian/Bear-style option alongside the paid cloud plans.
**How to apply:** follow these when building or changing local mode; ask before deviating. Related: [[mac-is-electron]], [[platforms-mac-ios-web-only]], [[pricing-2026-09-29]].
