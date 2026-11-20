---
name: folevi-web-copy-voice
description: "All Folevi website, help, blog and marketing copy (new pages too) must follow the humanizer rules in a plain, calm, US-English voice"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 851de4e5-caac-4589-90e4-7cc3bf54f689
  modified: 2026-11-18T04:33:42.387Z
---

Every piece of Folevi website copy (landing, marketing pages, help/docs, blog, compare, template gallery, page titles, meta descriptions, Open Graph text), and every new page or text added later, is written in the owner's "human" style without being asked:

- Apply the `/humanizer` skill's rules: no "not X but Y" contrasts, no one-line closers, no staged openers, no forced triads, no dashes (no em or en dashes at all), no inflated or sales words, no bold labels or decorative headings, no filler.
- Voice: plain and calm. Short, direct sentences, light warmth, no hype.
- Person: a mix. "We" for promises, policies and the blog ("we don't sell your data"); "Folevi" or "you" when describing features.
- US English spelling (color, organize, math, license). Keep the site's curly apostrophes.
- Sentence case for headings and buttons.
- Keep every fact, feature name, number, price and claim when rewriting; reword and trim freely otherwise.
- Legal pages (Privacy, Terms, AI policy): wording and spelling only, never change what they commit to. Changelog: past entries stay as published (spelling fixes only).
- The assistant is always "Foli AI".

**Why:** 2026-11-18 the owner asked for all landing, help and marketing text to "sound like human" and to remember it for future pages and texts. Choices made in clickable questions that day.

**How to apply:** run the humanizer checks on any copy you write or touch under `apps/web/src/app/(marketing)` and `apps/web/src/components/marketing`, and on new pages. In-app, native and email copy were out of scope on 2026-11-18; ask before extending this pass to them. The repo also records this in `docs/claude-context/memory/website-copy-voice.md`. Related: [[folevi-keeps-com-bundle-ids]].
