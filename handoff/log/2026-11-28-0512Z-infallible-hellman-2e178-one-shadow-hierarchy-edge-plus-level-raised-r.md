# One shadow hierarchy: edge plus level (raised, resting, lifted, floating, overlay) in tokens, web, Mac and iPhone; guard test

- Date: 2026-11-28 05:12 UTC
- Area: web
- Branch: claude/infallible-hellman-2e178f

Changed: `tokens.json` shadow now has edges (`hairline`, new `edge`, `control`, `primary`) and five drop-only levels
(`raised`, `resting`, `lifted`, `floating`, `overlay`); `card`, `cardDrop`, `sheet`, `pop`, `lift`, `--glass-shadow`,
`--liquid-shadow` and `--shadow-dock` are gone. Every app shadow on the web (`globals.css`, editor CSS, about 45
components) and in `apps/native-kit` (`FoleviShadow`, `NativeShadow`, note and folder cards, liquid glass, about 25
one-off `.shadow`s) uses a level. Menus are lighter (`floating`), dialogs a step higher (`overlay`), Mac menus no
longer lighter than web cards. Report: `docs/SHADOWS.md`. Guard: `apps/web/test/shadow-scale.test.ts`.

Checked: web vitest (285 files pass), `pnpm tokens` check and contrast, `swift build` of FoleviDesign,
FoleviScreens, FoleviMac and FoleviPhone. Looked at Home, a card's context menu, the command palette and an open
note in light and dark on a dev server (app.localhost:3007), and the Mac web-frame values by setting its
attributes. Not run: the Mac or iPhone apps themselves, snapshot tests.

Left: the website (`marketing.css`) keeps its own scale; `WebStyles.swift` needs `pnpm styles:gen`; PR 190's Home
shadows need moving onto the levels when it lands (the guard test will flag them).
