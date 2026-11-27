# Website catches up with what shipped: spell check, self-hosting, Apple Notes import, AI providers, iOS 26

- Date: 2026-11-27 02:22 UTC
- Area: web
- Branch: claude/marketing-whats-new

Owner, 2026-11-27: update the marketing and compare pages for the new platforms and features; name all three AI providers on the legal pages; say iOS 26; add pages for the writing tools, self-hosting and Apple Notes import. Built on PR 165 (platform lines).

- New feature pages: /features/spell-check (spell check in nine languages, Tab prediction, the synced dictionary, Float this note on Mac, Windows, Chrome and Edge) and /features/self-hosting (Folevi Server, Beta, and Your own server sign-in in every app), each with its own app picture (features/WritingPictures.tsx) and icon, placed on the features index.
- New docs: /docs/writing-settings and /docs/your-own-server. Docs: Apple Notes in the import list; own key on Windows and Linux; AI models from Google, OpenAI and Anthropic.
- Import feature page: every import source (Notion, Evernote, Apple Notes on the Mac, Word, HTML, CSV, Markdown).
- Foli AI providers: Privacy, Security (subprocessors: Google, OpenAI, Anthropic), Terms, docs and the credits blog post name Google, OpenAI and Anthropic. Search and speech to text stay on Google. Terms and Privacy dated November 27, 2026; still draft notices.
- iOS 26: IOS_REQUIREMENT and the structured data.
- /apps: Windows and Linux update themselves (AppImage itself; .deb, .rpm and Snap through the package manager), Linux packages via signed apt and rpm repositories and the Snap Store, spell check on Windows and Linux, Apple Notes on the Mac. /downloads Linux note fixed. /server lists Windows and Linux. /mac lists Apple Notes import, spell check and Float this note. Home FAQ: spell check and self-hosting.
- Compare pages: Folevi side only (AI providers, import list, self-hosting in storage and apps), a self-hosting FAQ on both pages, updated 2026-11-27. Competitor facts not re-checked, so COMPARE_CHECKED is unchanged and no competitor row was added.
- test/whats-new-copy.test.ts.

Checked: full vitest (273 files), tsc, eslint; in the browser at desktop and 375 px: the two feature pages and their pictures, the features index, both docs pages, /server.

Left: Float this note on Linux is not claimed (only the archive says so). The changelog (PR 169) and /windows and /linux pages (separate PR) are their own pull requests.
