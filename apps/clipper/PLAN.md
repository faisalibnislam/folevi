# Folevi for Chrome: plan and feature checklist

**Paused by the owner, 2026-11-19.** Phase 1's first four items are done (1.1.0). Phase 2's search (popup and address bar, asking to read only when first used) is written but not tried in a browser and has no tests of its own yet.

Folevi already has a Chrome and Edge extension in this folder, the **Folevi Web Clipper** (1.1.0 on branch `chrome-extension`, Manifest V3). It's built and tested but not yet in the Chrome Web Store. This plan grows it into "Folevi for Chrome": first the quick wins, then features that read your notes, then the bigger ideas.

How it connects: through Folevi's own sign-in (OAuth 2.1 with PKCE) and the same connected-apps endpoint Claude and other apps use (`/mcp`). Folevi needs no new server API: the endpoint already offers 26 tools (search, recent notes, tasks, tags, folders, append to a note, and more). Today the clipper asks only to add new notes. Anything that reads your notes needs a wider permission, which Folevi's consent screen asks you to approve.

## Already done (1.0.0)

- [x] Clip the article you're reading as a clean note (Readability, then Markdown)
- [x] Clip just the part you selected
- [x] Clip a link (right-click "Clip to Folevi")
- [x] Pick the place (Personal or a workspace); it remembers your last pick
- [x] Notes land under your Inbox page, starting "Clipped from [page](link) on 19 November 2026"
- [x] Sign in with your Folevi account, stay signed in, sign out
- [x] Works in Chrome and Edge (one package for both stores)
- [x] Store listing text, permission reasons and privacy answers (`STORE.md`)
- [x] Unit tests, and an end-to-end test against the dev server

## Phase 1: quick wins (no new permissions), in progress (1.1.0)

- [x] **Quick note** in the popup: type a thought and save it to the Inbox, no page needed
- [x] **Keyboard shortcuts**: open the clipper (⌘⇧Y or Ctrl+Shift+Y) and clip at once (⌥⇧S or Alt+Shift+S)
- [x] **Open in Folevi** after saving (the popup's link)
- [x] **Your note on the clip**: a line of your own above the clipped text ("why I saved this")
- [ ] Clip **YouTube** with the video's link and the time you're at
- [ ] Clip a **PDF** open in the browser (its text, with the link)
- [ ] Better errors when offline: keep the clip and send it when you're back online

## Phase 2: reads your notes (asks for read permission once)

- [ ] (written, untested) **Search Folevi** from the address bar: type `fo` then a space and your words
- [ ] **Side panel**: recent notes and search beside any page, open a note in Folevi
- [ ] **Add to an existing note** instead of a new one (append the clip to a note you pick)
- [ ] **Choose the folder** and **add tags** when clipping
- [ ] **Add as a task**: turn the selected text into a task, with a due date
- [ ] "Already saved" hint when you open a page you clipped before

## Phase 3: bigger ideas

- [ ] **Highlight on the page**: mark several passages, then save them as one note with links back
- [ ] **Foli AI on clip**: a short summary or key points at the top of the note (with Foli AI on)
- [ ] **Screenshot clip**: the visible area or a region as an image in the note (needs image upload)
- [ ] Clip a whole **email** from Gmail or a **tweet thread** in a tidy form
- [ ] Firefox and Safari versions

## Publishing (your part)

- [ ] Chrome Web Store developer account (one-time fee) and a Microsoft Partner Center account for Edge
- [ ] A "Folevi for Chrome" section in the privacy policy at folevi.com/privacy (the text in `STORE.md` is ready)
- [ ] Store screenshots and a short promo image
- [ ] Your OK to upload, then the first submission (I prepare the zip with `pnpm package`)

## Decisions to make

- The name in the store: keep **Folevi Web Clipper**, or rename to **Folevi for Chrome** as it grows past clipping
- Phase 2's read permission: one wider sign-in for everyone, or ask only when someone first uses search or the side panel (recommended: ask when first used)
