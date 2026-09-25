# Design system — “Warm Folio”

Folevi feels like good stationery on a warm desk: cream paper, cocoa ink, a touch of ember. Surfaces are
soft and slightly tactile (a subtle skeuomorphism): controls have a top highlight and a soft cast shadow,
panels have an inner white rim, and the page lifts off the canvas like a sheet of paper. Nothing is
glossy, nothing bounces, and every effect stays quiet enough that writing remains the focus.

**The web app is the reference. The Mac app always follows it** — same fonts, same colors, same radii,
same shadows, same layout and component vocabulary — while staying a native Swift/AppKit/SwiftUI app
(native menus, windows, keyboard, text system, accessibility).

## Source of truth

`packages/design-tokens/src/tokens.json` → `pnpm tokens` generates
`generated/tokens.css` (CSS custom properties; light/dark via `prefers-color-scheme` and `data-theme`),
`generated/tokens.ts`, and `apps/macos/Folevi/DesignSystem/Generated/FoleviTokens.swift`
(`FoleviColor`, `FoleviShadow`, `FoleviFontFamily`, `FoleviFontSize`, `FoleviTracking`, `FoleviRadius`,
`FoleviSpace`, `FoleviLayout`, `FoleviMotion`). CI fails when generated files are stale and runs the
contrast check (every semantic text pair ≥ 4.5:1 in both themes, focus ≥ 3:1).

## Type

| Role | Family | Web | Mac |
| --- | --- | --- | --- |
| All UI, headings, default document text | **Inter** 400/500/600/700 | `next/font/google` | bundled TTF (`Resources/Fonts`) |
| Document font “Serif” | **Source Serif 4** 400/600, italic | `next/font/google` | bundled TTF |
| Document font “Mono”, code | **JetBrains Mono** 400/600 | `next/font/google` | bundled TTF |

The Mac app never falls back to San Francisco or New York for product UI; it registers the bundled
fonts at launch. Licenses (SIL OFL 1.1) sit next to the font files.

Scale (px/pt): xs 12 · sm 13 · md 14 · body 16 · lg 18 · xl 22 · h3 20 · h2 25 · h1 32 · title 38 ·
display 56. Tracking: headings `tight` (−0.022em), titles/large UI `snug` (−0.012em), body `normal`
(−0.006em), small caps labels `caps` (+0.06em, 11px, semibold, uppercase).
Headings use `heading` (cocoa) color, weight 600. Page title: 38px, weight 650 (600 on Mac), `heading`.
Body text: 16px/1.6, `ink`.

## Color

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| canvas | `#FAF6F3` | `#15110F` | app background (with ambient glow) |
| sidebar | `#F5EEEA` | `#1B1513` | sidebar, inspector panel tint |
| surface | `#FFFFFF` | `#211A18` | the page sheet, cards, panels |
| surfaceRaised | `#FFFFFF` | `#2A221F` | menus, popovers, active pills |
| surfaceSunken | `#F3ECE8` | `#120E0D` | segmented tracks, inputs, wells |
| ink / heading | `#1D1814` / `#4A2F2C` | `#F6F0EC` / `#F7DDD1` | text / headings |
| inkMuted / inkFaint | `#6B5A56` / `#7A6863` | `#BCA8A2` / `#A89590` | secondary / tertiary text |
| line / lineStrong | `#EDE3DF` / `#D8C8C3` | `#352B28` / `#4D403C` | hairlines |
| accent / accentStrong | `#78534E` / `#4A2F2C` | `#F2C3B0` / `#FAD9CB` | primary buttons, links, selection chrome |
| accentSoft / accentSoftInk | `#F6E9E5` / `#5E3A35` | `#3A2723` / `#F6D5C8` | active nav, chips, hovers |
| ember / emberInk / emberSoft | `#F46036` / `#B0401B` / `#FDE9DF` | `#FF7A4D` / `#FF9C78` / `#3B221B` | highlights, badges, drop indicator, “today” |
| glowPeach / glowRose | `#FFD0AE` / `#EAD3E3` | `#5A3222` / `#3E2638` | ambient canvas glow only |
| moss · marigold · plum · coral | green · orange · mauve · coral | lifted for dark | page accents, tags, covers |

Page accents: the “Accent” page accent renders **ember**; moss, marigold, plum and coral render their
own color. A cover's own color (`cover.value`) wins over the page accent.

## Shape and depth

Radii: controlSmall 8 · control 10 · card 16 · sheet 22 · round (pills) 999.
Buttons, segmented controls, chips, search fields and the sync pill are **pills** (round).

Shadows (`--shadow-*` / `FoleviShadow.*`), each a stack of layers:

- `hairline` — a 1px ring instead of borders on light surfaces.
- `control` — inner top highlight + ring + tiny cast shadow: secondary buttons, active nav pill,
  segmented thumb, tiles.
- `primary` — inner top highlight, inner bottom shade, cast glow: primary (cocoa) buttons.
- `card` — inner rim + ring + soft drop: cards, inspector panel, tiles on hover.
- `sheet` — the document page lifted off the canvas.
- `pop` — menus, popovers, the command palette, dialogs.
- `lift` — an item being dragged.

Primary button fill: vertical gradient `accent` (lighter 6% at top) → `accent`; text `accentInk`, 13–14px
semibold. Pressed: shadow collapses to `control`, translateY(0.5px).

## Canvas

The canvas is `canvas` plus two very large, very soft radial glows — peach at the top right and rose at
the bottom left, ~35% opacity in light, ~50% in dark — fixed behind content. No textures, no lines.

## Layout (app)

```
┌ sidebar (sidebar tint, 264px) ┬───────────── toolbar (52px, transparent) ─────────────┬ inspector ┐
│ workspace switcher            │ ⟨ ⟩  Folder › Parent › 🌿 Page        [sync pill] … ⓘ │ (320px)   │
│ [ Search            ⌘K ]      ├────────────────────────────────────────────────────────┤ floating  │
│ (+ New page)                  │        ╭──────────── page sheet ────────────╮         │ card with │
│ ● All Documents  (active pill)│        │ cover                              │         │ segmented │
│   Tasks · Calendar · Daily…   │        │ icon  Title                        │         │ tabs      │
│ STARRED / FOLDERS / TAGS      │        │ blocks…                            │         │           │
│ account · help · settings     │        ╰────────────────────────────────────╯         │           │
└───────────────────────────────┴────────────────────────────────────────────────────────┴───────────┘
```

- **Sidebar**: `sidebar` tint, no hard border (a `line` hairline on its trailing edge). Items are 32px
  rows with 10px radius; hover = `accentSoft` at 60%; **active = a raised white pill** (`surfaceRaised`
  + `control` shadow) with `heading` text and the icon in ember. Section labels use the caps style.
  Search is a sunken pill with a ⌘K keycap. “New page” is a full-width secondary pill.
- **Toolbar**: 52px, transparent over the canvas. Back/forward pill pair, then the **breadcrumb**
  (workspace/folder › parents › current page with its icon; each crumb is a hover pill; the current
  crumb is `heading` semibold). Right side: presence, **sync pill** (sunken pill, status dot + label),
  comments, **Share** (primary pill), more (…), inspector toggle.
- **Page sheet**: `surface`, radius 22, `sheet` shadow, centered, readable width 640/760/960 + 128px
  padding, 24px from the toolbar; cover inside the sheet's top with the sheet radius; icon overlapping
  the cover edge on a raised rounded square (`control` shadow).
- **Inspector**: a floating card (`surface` at 88% + backdrop blur on web, `card` shadow, radius 16) with
  12px inset from the window edges. Header: **segmented control** of six icon tabs — Insert · Format ·
  Style · Outline · Info · Comments (sunken track, raised thumb with `control` shadow); the active tab's
  name is shown as a 15px semibold heading under it, with the close button.
  - **Insert**: search field, then sections (Basics, Lists, Media, Structure) of 4-column **tiles**
    (64px square, radius 14, `surface` + `control`, icon tinted per block family, label below 11px).
    Tiles are draggable into the page (see drag and drop) and insert after the current block on click.
  - **Format**: turn-into tiles, text marks, callout tone, code language.
  - **Style**: page font, width, accent swatches, background, card style, cover.
  - **Outline**: headings list, click to jump, the current section marked with an ember bar.
  - **Info**: words, characters, reading time, blocks, created/updated, backlinks, version history.
  - **Comments**: threads.
- **Views** (All Documents, Tasks, Calendar…): 32px header area with a large `title` heading in
  `heading`, filter chips (pills), content in cards with the `card` shadow.

## Components

- **Buttons**: primary (cocoa gradient pill), secondary (white pill + `control`), ghost (text, hover
  `accentSoft`), danger (destructive text; destructive-soft hover). Heights 28 (sm) / 34 (md) / 40 (lg).
- **Icon buttons**: 30px circles/pills, ghost; `aria-label` required; tooltips with shortcuts.
- **Segmented control**: sunken pill track, raised thumb that slides (180ms) under the active item.
- **Chips/tags**: pills, 24px, soft fills (`*-soft` + `*-ink`).
- **Menus/popovers/palette**: `surfaceRaised`, radius 14, `pop` shadow, 6px inner padding, 32px rows
  with 8px radius, hover `accentSoft`.
- **Dialogs**: radius 22, `pop` shadow, scrim `scrim` with 4px backdrop blur.
- **Inputs**: sunken pill (single line) or radius 12 (multi-line), focus ring 2px `focus` offset 2px.
- **Cards** (documents): `surface`, radius 16, `card` shadow; cover strip uses the page accent; hover
  lifts 1px with a slightly deeper shadow.
- **Sync status pill**: saved = moss dot, saving/syncing = ember pulsing dot, offline = faint dot,
  conflict/error = coral dot. Label always present (never color alone).

## Editor

- Blocks sit on a 24px indent grid. Hover shows a gutter with “+” and a grip (6-dot) in a small raised
  pill at the block's left.
- Callouts: `accentSoft`/tone fills with radius 14 and a subtle inner rim. Quotes: 3px ember bar.
  Code: `codeBg`, radius 12, JetBrains Mono 13.5px. To-dos: 18px rounded-square checks that fill with
  moss and a check mark; checked text muted with a strike.
- Selection: `selection` fill. Links: `accent` with an underline at 30% opacity, full on hover.

## Drag and drop (both clients)

Pointer-driven, not the platform's image-drag:
1. Press on the grip and move 4px → the block (with its nested children) **lifts**: a copy follows the
   pointer, scaled 1.02, rotated −0.6°, `lift` shadow, 96% opacity; the source block fades to 35%.
2. A 3px **ember drop line** with round caps glides (120ms) between blocks; its left edge shows the
   target indentation. Moving the pointer right/left of the block text by 24px increases/decreases the
   nesting (max one deeper than the block above).
3. Near the top/bottom 64px of the scroll area the page auto-scrolls, faster closer to the edge.
4. Release → the block moves (one undo step), the moved block briefly glows (ember-soft, 700ms).
   Escape cancels and the lifted copy returns to its origin.
5. Insert tiles use the same lift, drop line and nesting; releasing outside the page cancels.
6. Keyboard: ⌥⇧↑/↓ move the current block; the grip is also a button that opens block options.
7. Reduce Motion: no tilt/scale/glide; the drop line jumps; the glow is replaced by a static tint.

## Motion

140–220ms for UI, 320ms page transitions, `cubic-bezier(0.2, 0.7, 0.2, 1)`, no bounce. All motion is
disabled under `prefers-reduced-motion` / Reduce Motion (tokens collapse to 0ms).

## Brand

The mark is two offset leaves forming an F. In product UI it is drawn in `heading` with the middle leaf
in ember. The wordmark sets “Folevi” in Inter semibold, tracking tight.

## Accessibility

WCAG 2.2 AA: landmarks, labelled controls, visible focus (2px `focus` ring), no information by color
alone, targets ≥ 24×24 (44 on touch), `prefers-contrast: more` swaps hairlines to `lineStrong` and muted
text to `ink`. Axe runs in the e2e suite in both themes.
