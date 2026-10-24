---
name: e2ee-decisions
description: "2026-10-21 owner decisions for end-to-end encryption of account (cloud) notes, Personal and workspaces"
metadata:
  node_type: memory
  type: project
  originSessionId: ee4a0ce4-3926-4816-9973-b748c5332558
  modified: 2026-10-21T02:16:13.717Z
---

Owner asked (2026-10-21) for end-to-end encrypted notes in accounts. Decisions:
- Opt-in, with granular control and clear explanations in the UI. Settings > Privacy has three levels: Standard (as today), Encrypted with the features you pick, Fully encrypted. Any folder or note can also be marked "Always fully encrypted" whatever the level.
- Per-feature switches (each lets only that feature read what it needs): Foli AI (ask each time or automatic; background AI separately), Search everywhere (server search incl. text in files; off = search on device), Apps and integrations (MCP, REST API, webhooks), Email-to-note / web clipper / notification previews.
- Titles, folder and tag names, icons and covers are encrypted too; server sees only sizes, dates and structure.
- Personal spaces and workspaces in the same release (workspace key to members' devices; removing a member rotates the key; guests via encrypted links).
- Recovery: approve from another device, recovery key, passkey, encryption passphrase; turning encryption on requires at least two of these.
- Sharing: encrypted links (key after # in the URL, never sent to the server); invites share the key with the person's devices; Publish to the web makes a plain copy only on purpose, with a warning.
- Web: "Trust this browser" (first unlock with passkey/passphrase/approval, then remembered with a revocable device key; a public-computer mode forgets it).
- Every plan, Free included.
- Turning on encrypts existing notes, attachments and history in the background; lowering the level or turning off is allowed after a warning and re-checking a recovery method.

**Why:** privacy as a core promise without forcing everyone to lose cloud features.
**How to apply:** follow these when designing or building E2EE; local mode's encrypted folder ([[local-mode-decisions]]) already exists and should share crypto code. Ask before deviating.
