---
name: website-copy-voice
description: All website, help, blog and marketing copy (and every new page) follows the humanizer rules in a plain, calm, US-English voice
metadata:
  type: feedback
  modified: 2026-11-18
---

Every piece of folevi.com copy (landing, marketing pages, help/docs, blog, compare, template gallery, page titles, meta descriptions, Open Graph text), and every new page or text added later, is written in the owner's "human" style without being asked:

- The `/humanizer` skill's rules: no "not X but Y" contrasts, no one-line closers, no staged openers ("Here's the thing"), no forced triads, no em or en dashes, no inflated or sales words, no bold labels or decorative headings, no filler.
- Voice: plain and calm. Short, direct sentences, light warmth, no hype.
- Person: a mix. "We" for promises, policies and the blog; "Folevi" or "you" when describing features.
- US English spelling (color, organize, math, license). Keep the site's curly apostrophes.
- Sentence case for headings and buttons. Product, plan and template names keep their capitals.
- Rewrites keep every fact, feature name, number, price and claim.
- Legal pages (Privacy, Terms, AI policy): wording and spelling only, never change what they commit to. Changelog: past entries stay as published apart from spelling.

**Why:** on 2026-11-18 the owner asked for all landing, help and marketing text to "sound like human" and for the style to be remembered for future pages and texts; the choices above were theirs.

**How to apply:** check any copy you write or touch under `apps/web/src/app/(marketing)` and `apps/web/src/components/marketing` against these rules before committing. In-app, native-app and email copy were out of scope on 2026-11-18; ask before extending the pass to them. Related: [[no-em-dashes]], [[assistant-named-foli]].
