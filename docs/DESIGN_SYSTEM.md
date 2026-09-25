# Design system — “The Living Folio”

Folevi is a living folio: thoughts begin as loose leaves, gain structure, and stay easy to return to.
The visual language is quiet editorial typography, thin index lines, offset folio layers, small
registration marks and gentle page motion. Craft is a quality benchmark only; no assets, copy, layouts or
trade dress are borrowed.

## Tokens

Source: `packages/design-tokens/src/tokens.json` → `pnpm tokens` generates
`generated/tokens.css` (CSS custom properties, light/dark via `prefers-color-scheme` and `data-theme`),
`generated/tokens.ts`, and `apps/macos/Folevi/DesignSystem/Generated/FoleviTokens.swift` (dynamic
`NSColor`s). CI fails if generated files are stale and runs the contrast check.

### Color

Light: canvas `#F4F1E9` (warm mineral paper), surface `#FBFAF6` (ivory), raised `#FFFFFF`, ink `#18201C`
(charcoal-green), accent `#3159D8` (deep ultramarine) with soft `#DDE6FF`; document accents moss, marigold,
plum, coral, each with `-ink` (text) and `-soft` (fill) variants.
Dark is designed, not inverted: canvas `#101411`, surface `#171C18`, raised `#202621`, ink `#F2F0E9`,
accent `#88A4FF`; document fills are desaturated and code keeps its own readable surface.

AA adjustments from the starting palette (all verified by `contrast.mjs` — 54 pairs pass):
`inkMuted` `#5F6962` and `inkFaint` `#636B64` (light) so secondary text reaches 4.5:1 on every surface;
`warning` `#885809`, `success` `#2C6B46`, `destructive` `#A33A3A` so status text passes on its soft fill.

### Type

- Web marketing display: Instrument Serif (open license, self-hosted and subset by `next/font`).
- Product UI: Inter (self-hosted by `next/font`).
- Serif documents: display serif for headings; body in a text serif (`Iowan Old Style`, `New York`,
  `Charter`, Georgia) for legibility.
- macOS: system San Francisco for UI and the platform serif (`.serif` design) for editorial headings;
  Apple fonts are never bundled.
- Body 16px / 1.55 on web; editor readable width 640 / 760 / 960px (narrow / default / wide per document).

### Space, radius, elevation

8pt grid with 4pt optical exceptions. Radii: controls 6–7px, cards 12px, sheets 14px — no pill buttons.
Separation comes from tone and hairlines; shadows are rare and soft (sheets, menus, dialogs).
Touch targets are ≥44px on coarse pointers; every pointer target is ≥24×24px (WCAG 2.5.8).

### Motion

140–220ms for UI, up to 320ms for page transitions; `cubic-bezier(0.2, 0.7, 0.2, 1)`; no bounce.
Motifs: a loose leaf settling into the folio (`folio-settle`), sheets rising (`folio-rise`). All motion
is disabled under `prefers-reduced-motion` (tokens collapse to 0ms). Mac honors Reduce Motion and
Reduce Transparency.

## Brand

The mark is two offset leaves forming an F: a tall page (stem and top bar with a leaf-shaped end) and a
smaller leaf set slightly apart as the middle bar. It is monochrome by default (the middle leaf may take
the accent), and legible at 16px. Sources: `apps/web/src/components/brand/FoleviMark.tsx`,
`apps/web/public/icon.svg`, PWA icons in `apps/web/public/icons`, and the Mac app icon generated in
`apps/macos`. The wordmark sets “Folevi” in Instrument Serif.

## Components (web)

`components/ui`: Button / IconButton (labels required), Dialog (native `<dialog>`: focus trap, Escape,
inert background), MenuButton (WAI-ARIA menu), Toast (polite live region, Undo actions), PromptDialog.
App: Shell (resizable/collapsible sidebar 248–320px, drawer below 768px, inspector 320px), SyncStatus
(fixed width so status changes never shift layout), CommandPalette (combobox pattern with highlighted
matches), document cards that carry each page's accent, font and card style.

## Accessibility

WCAG 2.2 AA is the bar: semantic landmarks and headings, labelled controls, error associations, visible
focus rings, no information by color alone, `prefers-contrast: more` strengthens lines and muted text.
Automated axe checks run in the e2e suite in light and dark; see `docs/TESTING.md` for the manual pass.
Copy avoids concatenated sentences (Intl formats dates and relative times) so it can be localized.
