# Import from Apple Notes: notes, folders, tags, every attachment, original dates

- Date: 2026-11-26 02:20 UTC
- Area: mac, web
- Branch: claude/apple-notes-originals

Moved from HANDOFF.md (PRs 138 and 139; 138 was closed and lands through 139). The owner asked for Apple Notes import in the Mac app, then for nothing to be left behind and for the original dates.

What changed:
- Settings > Import & export has "Import from Apple Notes…" with Stop (native Settings, SettingsDataSection.swift; the web Import screen shows it too when foleviDesktop.appleNotes is there).
- apps/native-kit/Sources/FoleviMac/Model/AppleNotesReader.swift reads Notes through its scripting interface (ScriptingBridge, off the main thread; per folder one Apple Event per property, then each note's body and attachments, 20 at a time within a 48 MB budget), never NoteStore.sqlite. macOS asks once (Info.plist NSAppleEventsUsageDescription, entitlement com.apple.security.automation.apple-events); "denied" offers Privacy & Security > Automation.
- Every attachment is saved out of Notes with its save command (a temporary folder removed right after; packages such as .pages as a ZIP; 512 MB cap) and goes where the note's HTML refers to it (cid:), the rest at the end: web images as images, everything else as file blocks. Link attachments stay links. Images the web can't show are made JPEG or kept as files.
- Notes' #tags become Folevi tags, every Notes folder is made (empty ones too), and the original dates are kept.
- Web: lib/import/appleNotes.ts converts each batch; importDocs (extracted from run.ts) imports it; engine run key data.importAppleNotes.
- imports.importText (Convex and local mode) takes optional createdAt, updatedAt (made safe by editor-schema importedDates), fileMap (Markdown resolveFile turns a link on its own line into a file block) and tags (ensureTag, ensureLocalTag). In a local library the note file keeps the original last change as doc.modifiedAt until the note changes (local-store importedModifiedAt; older apps ignore it).
- docs/DESKTOP_PARITY.md: Mac only (Windows and Linux have no Apple Notes).

Checked: apps/web/test/import-apple-notes.test.ts (fixtures in test/fixtures/apple-notes), apps/web/test/local-import-originals.test.ts, tests/convex/import-originals.test.ts, packages/editor-schema/test/markdown-import-files.test.ts, AppleNotesReaderTests.swift (7). On the branch with main merged: web 2,286, Convex 1,220, editor-schema 513, local-store 172 passed; tsc clean; Mac Debug build succeeded.

Left:
- Not run against a real Notes library (owner's rule: ask before driving Notes). Try it with a Notes account or macOS user made only for testing: a large library, big attachments, the "denied" path, and whether Notes (sandboxed) can save into Folevi's temporary folder.
- Whether checklist ticks are in Notes' HTML.
- A localized "Recently Deleted" folder name not in AppleNotesReader.recentlyDeleted would be imported.
- Only password-locked notes (Apple won't hand them over) and an attachment Notes can't save stay behind, each reported.
- Not released: Mac users get it with the next Mac release.
