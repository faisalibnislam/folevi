# Rebuilding a Mac screen to match the web (playbook)

How each native screen of Folevi for Mac is rebuilt so it looks exactly like the web app (owner, 2026-10-27:
"looks must match 100% with the web app"). Plan: `docs/MAC_REBUILD_PLAN.md`. Branch `mac-rebuild`.

The web app as the Mac app shows it is the reference: the Debug Mac app with `FOLEVI_WEB_FRAME=1` (the shipped
app's all-web frame, `<html data-desktop="mac">`), on the same scratch library, same engine and fonts as the
native frame. Only the note editor stays web (a WKWebView). Everything else is SwiftUI (AppKit where needed),
fed by the web engine through the bridge (`apps/web/src/lib/engine/protocol.ts`, Swift models from
`pnpm engine:gen`).

## Tools

| Tool | What it does |
| --- | --- |
| `node apps/mac/scripts/build.mjs` | Debug build (`Folevi Dev.app`, its own bundle id and data; never installed). |
| `node apps/web/scripts/build-shell.mjs` | The web export the Debug app carries (`apps/mac/web`). Rebuild after web changes. |
| `node apps/mac/scripts/screens.mjs [--fresh] [--only home,notes]` | Whole screens, web frame vs native frame, light and dark, 1280 x 820, real window captures (`screencapture -l`), diffed; report in `apps/mac/screens-report/index.html`. `--fresh` makes the scratch library again (`apps/mac/build/run/screens*`). Add a screen to `SCREENS` in the script. |
| `pnpm styles:gen --app --only <area>` | Reads computed styles of the live web app's elements (by selector) from the web frame, light and dark: `packages/design-tokens/match/app-styles/<area>.json` lists screens (links), elements (`selector`, `nth`, `parent`), optional `prepare` scripts (open a menu or dialog first) and CSS colour variables; results in `app-styles-cache/<area>.json`; all areas become `FoleviDesign/Generated/WebStyles.swift` (`WebStyles.named("id")`, `.vars["mac-hover"]`). Each style has x, y, size, padding, margin, radius, background, gradient, shadows, colour, opacity, font, line height, letter spacing, gap. |
| `pnpm styles:gen` | Regenerates WebStyles.swift from the component samples (`apps/web/src/app/dev/match/samples.tsx`, needs the `mac-rebuild-web-3012` dev server) and the caches. |
| `pnpm match` | Component specimens (type, icons, colours, buttons, controls, menu, dialog) web vs native. |
| `pnpm icons:gen` | The lucide icons apps/web imports, as `WebIcon` (draw with `WebIconView(.name, size:, strokeWidth:)`). |

## Building blocks (FoleviDesign `Web/`)

- `.webText(WebTextStyle)`: CSS text exactly (any weight, OpenType features, letter spacing as CSS computes it,
  CSS line boxes). `WebTextStyle.role(.body)`, `.display(.title2)`, `.caps`, or a computed style's `.text`.
  Add `.lineLimit(1)` for single lines (exact line box).
- `.webBox(style)` / `.webElement(style)`: background, gradient, border, every box-shadow layer.
- `WebButton`, `WebIconButton`, `WebSelectTrigger`, `WebTextField`, `WebMenuPanel`, `WebDialog`, `WebCard`,
  `WebChip`, `WebKbd`; `FolderGlyph`.
- FoleviMac `WebMenus.swift`: Folevi-drawn menus. `WebMenuButton`, `.webContextMenu { [WebMenuEntry] }`,
  `WebMenuWindow.show(...)`. Never the system's `.contextMenu` or `NSMenu` inside the window (the menu bar is
  the only system menu).
- Frame: `WebSidebar`, `WebTopBar`, `FrameSplitViewController` (the web layout). Screens are routed in
  `FoleviMac/Views/Screens.swift` (`ScreenRoot`). Content sits under the 56 pt glass top bar.

## Steps for a screen

1. Read the web component(s) for the screen in `apps/web/src/components/**` (structure, conditions, copy).
2. Add `app-styles/<area>.json` with the screen's link and the elements you need (rows, headers, cards, empty
   states), run `pnpm styles:gen --app --only <area>`, read the values (x, y tell you the layout).
3. Write the SwiftUI screen with those styles (`WebStyles.named(...)`), the same structure, the same copy (no em
   dashes; the assistant is "Foli AI"), the same icons (`WebIcon`), hover and press states, keyboard, menus.
   Data from the engine views the old native screen used (`FoleviScreens` models); add bridge views or commands
   in protocol.ts only when the data isn't there (then `pnpm engine:gen`, a fixture, contract tests).
4. Add the screen to `screens.mjs` `SCREENS`, rebuild, run `screens.mjs --only <id>`, look at the diff, fix,
   repeat. Target: under 1% of pixels differing, light and dark; explain anything left (live data, a clock).
5. Tests: `swift test` in apps/native-kit, `pnpm typecheck`, `pnpm test`. Commit your own files with
   `git commit <paths>`; a generated file (WebStyles.swift, EngineModels.swift) is regenerated, never hand-edited.

## Rules

Never touch the owner's real library, app data or Keychain (`~/Documents/Folevi Library`,
`~/Library/Application Support/Folevi`, "Folevi Safe Storage"): the scripts use `apps/mac/build/run/*` only.
Never push, deploy, notarize or publish. Never print secrets. No em dashes. iPhone and iPad are paused: don't
change their behaviour (shared Swift code is fine when iOS keeps building).
