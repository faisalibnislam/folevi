# Website: Dropbox and Google Drive named as Mac, iPhone and iPad for now

- Date: 2026-11-27 04:50 UTC
- Area: web
- Branch: claude/storage-places-copy-early

The PR manager: the hosted Android 1.8.79 build has no Dropbox app key or Google Drive client ID, so those places are hidden there; the Windows and Linux builds lack them too (docs/DESKTOP_PARITY.md). Lines that tied Dropbox and Google Drive to every app or to Windows, Linux or Android now say they are in the Mac, iPhone and iPad apps for now, or name a folder you pick instead: seo.tsx (structured data), home Closing and FAQ, pricing FAQ and plan card, compare storage row, the notes-on-your-devices feature page and its FAQ, the apps docs, and the 1.7.78 changelog line (Windows and Linux did not get Dropbox and Google Drive; call recording and text in pictures are Windows only). Cut from claude/integration-2026-11-27c (PR 182) without the pricing pages, so it can ship before pricing; the same change on the pricing pages is in PR 178. test/storage-places-copy.test.ts. Checked: tsc, full vitest run (280 files pass).
