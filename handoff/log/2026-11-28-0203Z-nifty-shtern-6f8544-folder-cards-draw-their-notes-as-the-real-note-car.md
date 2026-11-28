# Folder cards draw their notes as the real note cards

- Date: 2026-11-28 02:03 UTC
- Area: web
- Branch: claude/nifty-shtern-6f8544

Owner request, 28 November 2026: the notes peeking out of a folder card should look exactly like the main note cards. Stacked on PR 190 (folder and note card polish).

- Server: each folder preview now carries the note's style, first blocks (preview), page shape, kind and last edit, stored in listStats.previews (all optional, so older entries still validate; they fill in when the note is next saved) and sent by organization.index from stats or from the pages (convex/organization.ts previewOf). The on-device backend (apps/web/src/lib/local/functions/organization.ts) sends the same. documents.preview's validator is now shared as vPreviewLines (convex/lib/validators.ts).
- Engine protocol revision 36: FolderPreview gains updatedAt, style, preview, shape and kind (all with defaults). Swift and Kotlin models regenerated (pnpm engine:gen), fixtures regenerated, engine tests updated.
- Web: FolderCardArt's FolderNote draws NoteCardFace at the note card's 25:27 shape, 70% of the folder's width, no folder chip, keeping the fan, tilt and hover rise. NoteCardFace asks Convex for image covers, so pages that draw folder cards without the app (the site's Folders replica, /dev/folder-states, /dev/card-looks) use the shared server-less client in lib/convex/offline.tsx.
- Native: FolderCardModel.Note carries the same fields and builds a NoteCardModel; WebFolderNote draws WebNoteCard with the phone's fixed card type sizes off, so Mac, iPad and iPhone match the web.

Not done: the dev Convex deployment was not pushed from this branch, so the live app on localhost still gets the old previews (cards then use the default look) until this lands. Native snapshot tests not run; folder card reference images will change.
