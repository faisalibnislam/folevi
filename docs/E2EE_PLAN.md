# End-to-end encryption plan (2026-10-21)

## Owner decisions

- Opt-in, every plan (Free included), Personal spaces and workspaces in the same release.
- Settings > Privacy has three levels:
  - **Standard**: as today.
  - **Encrypted, with the features you pick**: everything is encrypted; each feature that needs to read notes has its own switch.
  - **Fully encrypted**: no exceptions.
- Any folder or note can be marked **Always fully encrypted**, whatever the level.
- Feature switches: Foli AI (ask every time, or automatically; background AI such as Catch me up, related notes, suggestions and routines separately), Search everywhere (server search, including text found in files; off means search runs on each device), Apps and integrations (MCP, REST API, webhooks), Email-to-note, web clipper and notification previews.
- Titles, folder and tag names, icons and covers are encrypted with the content. The server sees only sizes, dates and structure.
- Recovery: approve from another device, recovery key, passkey, encryption passphrase. Turning encryption on requires at least two.
- Sharing: encrypted links (the note's key after # in the link, never sent to the server); invites share keys with the person's devices; Publish to the web makes a plain copy only on purpose, with a warning.
- Website: "Trust this browser" after the first unlock (passkey, passphrase or approval from another device), revocable from Settings > Devices; a public computer mode forgets it when the tab closes.
- Turning it on encrypts existing notes, attachments and history in the background; lowering the level or turning it off is allowed after a clear warning and re-checking a recovery method.
- Every screen explains in plain words what each choice means, what the server can and can't see, and what stops working.

## Approach (to be detailed by a design pass)

- **Keys:** each account has a master key; each space (Personal, each workspace) a space key; each note its own key, wrapped by the space key (so one note can be shared by link and keys can be rotated). Each device and trusted browser has its own key pair in the Keychain or a non-extractable browser key; the master key is wrapped to each trusted device, to the recovery key, to a passkey (WebAuthn PRF) and to a passphrase (Argon2id).
- **Sync stays per block:** each block is encrypted on its own (AES-256-GCM, with the note, block and revision bound in), so the existing sync engine, conflict handling and offline queue keep working; the server stores ciphertext and checks only sizes and structure.
- **Derived data moves to devices:** previews, search, links and backlinks, tasks and the calendar, collections, synced blocks, version diffs and exports are computed on the device, reusing the local mode backend (lib/local) that already does all of this over a device replica. The server becomes an encrypted sync and storage service for encrypted spaces.
- **Feature switches decide what plaintext leaves the device:** for example, Search everywhere uploads a search index for that space; Foli AI sends the text of one request; integrations keep a readable copy the integration may use. Locked folders never send anything.
- **Workspaces:** the space key is wrapped to each member's account key; removing a member rotates the key and re-encrypts new data at once and old data in the background; guests read through encrypted links.
- **Shared crypto:** one library for local mode's encrypted folder and account encryption (packages/local-store crypto, extended), with native implementations matching shared test vectors.
- **Reminders and notifications:** due dates for reminders are sent to the server only as times (no titles) when previews are off, so push notifications still arrive ("A reminder is due").
