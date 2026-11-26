# One control scale for every control

- Date: 2026-11-26 05:43 UTC
- Area: web, mac, windows, linux
- Branch: claude/ui-scale

The owner (2026-11-26): "use consistent rules/size/space for all UI elements"; All notes' toolbar is the reference.

What changed (PR 141):
- Every control that sits in a row (fields, dropdowns, buttons, icon buttons, segmented switches, a dialog's footer)
  is 36 px (44 on touch), compact ones 28 (36 on touch), with one corner (10; a segment 6), one edge (1 px
  `--color-line` inside the box, `--control-ring`), one weight per role (550 labels, 400 values), 16 px icons (14
  compact and for a dropdown's chevron) at a 1.5 px stroke. Rules: docs/DESIGN_SYSTEM.md "Controls".
- Tokens: packages/design-tokens `control` (CSS `--control-*`, Tailwind `h-control` / `h-control-sm` /
  `size-control`, Swift `FoleviTokens.Control`), and `shadow.cardDrop`.
- `Button` sizes are `md` (default), `compact`, `icon`, `icon-compact`; `size="sm"` is gone (its 222 uses are `md`).
- The Folders toolbar matches All notes (the 6 November tinted tray is gone; `RowTray` is a plain group). The Mac
  look's 28 pt buttons are gone (36 there too). Toolbars carry `data-toolbar`.
- A codemod moved about 340 controls onto the scale (`h-7` to `h-12`, `px-3.5`, `w-8 h-8`, redundant
  `pointer-coarse:h-11`); the rest by hand, including two that came in from main (AppSocialSignIn, WritingSection).

Checked:
- ESLint `folevi/control-scale` (error): 0 errors on the merged tree.
- `apps/web/e2e/control-scale.spec.ts`, headless, Chromium and WebKit: every toolbar control on 7 screens in the
  web, Mac and Windows looks, light and dark; a dialog footer; touch 44; nothing clickable under the Mac's window
  buttons or Windows' caption buttons. 6 of 6 pass.
- tsc, vitest (2274 passed), tokens `--check` and contrast. Related e2e (mac-polish, folder-tabs-local,
  foli-dna-local, hover-everywhere-local, note-menu) pass, except mac-polish's WebKit focus-ring test, which fails on
  main too.
- Before and after shots: docs/audits/control-scale-2026-11-26/.

Left:
- Vault and Settings aren't in the browser audit (Vault needs a set-up vault); their classes pass the lint.
- The native Swift screens copy the web's computed styles: re-export them from the running Dev app
  (`node scripts/web-styles.mjs --app`) so they draw the 36 px controls.
- Look over the editor's inline tools (collections, charts, table AI, audio) at 36, moved from 32.
- After PR 137 is in, drop `rounded-chip` from the page picker's field in CollectionEmbed.tsx.
- Not run in the real Mac, Windows or Linux apps.
