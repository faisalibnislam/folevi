# Marketing headers readable in dark mode

- Date: 2026-11-27 03:07 UTC
- Area: web
- Branch: claude/dark-header-headline

Owner, 2026-11-27: the headline on /mac and /linux disappeared in dark mode.

Cause: the paper card (.mk-box.mk-tint, every marketing page's header card and some Home sections) always used the theme's light paper (--art-paper), while headings switch to near-white in dark mode. The dark pair (--art-paper-dark, --art-ink-dark) was already set on the card, as the note (.mk-note) uses it.

Fix (marketing.css): in dark mode the card uses --art-paper-dark with an edge in the dark ink, and its lede and muted text mix the dark ink and paper. The label sticker (.mk-eyebrow) also gets light text in dark mode (it kept its dark ink).

Checked in the browser (data-theme dark, after the 320 ms transition): /mac, /downloads, /pricing, /features/sharing and Home cards read near-white on #0e1d18; light mode unchanged. /linux uses the same card (PR 171). test/marketing-dark-paper.test.ts.
