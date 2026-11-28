# PR 192 merged with PR 190 and main, folder card snapshots re-recorded

- Date: 2026-11-28 09:46 UTC
- Area: mac
- Branch: claude/folder-note-thumbnails

By the PR manager session, so the folder thumbnails can land after PR 190.

- Merged PR 190's head (e51e2231, its end-to-end fixes and card polish) and main into this branch. Three files conflicted. `DocumentCard.tsx` and `WebNoteCard.swift`: PR 190's card-time footer size (14 px floor, 4 px chip padding) is kept for a full card, and a miniature (a note inside a folder card) still scales its footer with the card. `FolderCardArt.tsx`: this branch had only reformatted the conflicting lines, so PR 190's drawn folder back (`BackShape`), `--shadow-resting` and the unclipped front are taken as they are; the imports of both sides are kept.
- Six native reference images re-recorded, the ones this branch's log said would change: `folder-cards-light-macos`, `folder-cards-dark-macos`, `home-picture-light`, `home-picture-dark`, `list-header-folders-mac-dark`, `list-header-folders-ipad-dark`. A note in a folder is now the real note card, so in dark mode it has the card's dark paper where the old picture kept light paper. That matches `note-cards-dark-macos`.

Checked on the merge: generated-file checks, Convex and web typecheck, lint (no errors), root tests 1,688 passed, web tests 2,507 passed, `swift build --build-tests`, Mac tests 266 (one known flake, `TabPreviewStateTests`, passes alone), design tests 36, menu bar note tests 14.

Not checked: the end-to-end suite (CI runs it), the app-hosted tests, and the cards in a running Mac or iPhone app.
