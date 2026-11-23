---
name: macloving-mac-ui
description: Build, review, and repair polished native macOS interfaces in SwiftUI and AppKit. Use for Macloving Mac UI, macOS window design, Liquid Glass, padding, spacing, nested corners and capsules, icon centering, truncated text, toolbars, compact sidebars, settings, forms, dialogs, shadows, animation, timeline alignment, inspector boundaries, horizontal table overflow and edge fades, row separators, and visual QA. Apply the supplied Macloving app rules for About, onboarding, installers, versions, signing, and release checks when working on Macloving apps. Apply the required Macloving inspector and Settings styles and the main-window profile within authorized work. Preserve app behavior and verify the rendered result.
---

# Macloving Mac UI

Build native macOS UI with deliberate geometry, clear hierarchy, restrained materials, and stable interaction. Treat visual defects as implementation defects. Complete authorized repairs; support a review-only request with findings instead of edits.

All 120 checklist rules are incorporated as acceptance requirements where applicable. Use section 13 for the complete catalogue and rule IDs. Apply overlapping checks through the same component contract; do not create competing padding, state, or layout systems.

This skill is self-contained. It combines selected practices from the sources below with Faisal's concrete examples and his complete window guide and current Macloving app rules. Other skills are optional. Do not claim this prevents every defect or guarantees pixel-perfect output.

## Contents

1. Authority and scope
2. Work cycle and evidence
3. Layout contracts and measurement
4. Spacing and nested shapes
5. Icons, text, and selection
6. Toolbars, sidebars, forms, and windows
7. Materials, outlines, and shadows
8. Motion and performance
9. Regression catalogue and completion gate
10. Source notes
11. Original window design guide
12. Macloving app rules
13. Complete UI acceptance catalogue
14. Dedicated Macloving onboarding rules

## 1. Authority and scope

- Follow the current user request and the project's applicable instructions. Preserve unrelated work, app data, commands, shortcuts, accessibility, and business behavior.
- Before changing or building a Macloving app, read the complete app rules in section 12. They take priority over generic guidance and older preferences on the same topic, including About, version format, signing, and release workflow. Newer explicit owner instructions can override them. Do not impose Macloving identifiers, branding, membership, packages, or distribution policy on unrelated apps.
- For Macloving onboarding, also read section 14 completely. Enforce its page types, template ownership, optional-permission labels, keyboard shortcuts, style hook, and screenshot-review requirements alongside the base app rules.
- Keep compliance scoped to authorized work. These rules do not authorize a release, version bump, signing change, package upgrade, website publication, or push. Follow the specified next-release rollout for onboarding and installer changes; do not re-release merely for visual polish.
- For a new main window or an authorized window redesign, use the embedded Macloving window profile. For a small repair or audit, do not migrate unrelated screens or change the window architecture.
- Require the section 6 Macloving inspector, compact sidebar, and Settings profiles whenever creating, redesigning, or repairing those surfaces. Treat them as current owner requirements, not optional inspiration. They supersede older conflicting styling allowances on those subjects. Apply them to the affected shared components; record unrelated screens needing migration without silently expanding the task to other apps.
- Give Macloving Settings its required sidebar-and-content layout with native window behavior and controls. Do not wrap Settings, About, alerts, sheets, or menu bar popovers in the main-window shell. For Macloving apps, About specifically means the shared MaclovingKit `MaclovingAbout`, not a bespoke window or the standard macOS About panel. Preserve native presentations for the other surfaces.
- Read the deployment target and installed SDK before coding. The window profile needs macOS 26+. Do not silently raise an existing target. If incompatible, continue independent audit work and ask whether to retain compatibility or adopt the profile.
- Treat the original guide's numeric design choices as project preferences, not universal Apple requirements. Its reference code is illustrative and must compile and behave correctly in the actual project.
- The consolidated rules above the original guide clarify its implementation traps. Do not treat anecdotal API limitations, font mappings, or accessibility claims as universal facts.
- Do not install dependencies, replace architecture, erase preferences, delete tests, commit unrelated work, release, or change version numbers merely to satisfy this skill. Follow the task's existing authorization and project workflow.

## 2. Work cycle and evidence

1. Read project instructions and inspect version-control status. For Macloving apps, follow the app rules for one session per app, exclusive folder use, work on `main`, tests, and a committed handover. Do not switch branches over another person's edits or commit unrelated work. Resolve actual ownership conflicts first. For other projects, isolate work where needed. Ask only when an actual conflict, missing input, or product decision blocks progress.
2. Map the affected surfaces and states: main window, toolbar, sidebar, content, inspector, settings, sheets, popovers, empty/loading/error states. Inventory commands before migrating chrome. Read the relevant categories in section 13 before implementation. For a whole-app audit, assess all 120 checks; for a focused repair, assess the affected categories and verification checks. Record Pass, Fail, Not verified, or Not applicable with evidence or a reason. Do not add unrelated features just to make a check applicable.
3. Reproduce the reported state. Record window size, appearance, selection/focus state, display scale, and relevant content. Keep screenshots and recordings scoped to the app.
4. Identify the responsible shared component and its layout contract. Inspect parent constraints, intrinsic sizes, modifier order, safe areas, background bounds, and state before choosing a fix.
5. Repair the cause at the shared component or token level. Check its other callers. Avoid unrelated modernization.
6. Build, render, inspect, measure uncertain details, and exercise the interaction. Repeat until the acceptance checks pass or a specific blocker remains.
7. Report changed components, before/after evidence, tests run, and unverified states. A clean build is not visual verification.

Label findings as **observed**, **measured**, **inferred cause**, or **user-reported**. Screenshots can show clipping and spacing; they do not establish animation quality, hit testing, focus order, or exact point measurements without scale and bounds. Do not diagnose photographed red/green distortion, annotations, or cursor overlays as app rendering bugs without confirmation.

## 3. Layout contracts and measurement

Create or reuse one small set of named metrics and reusable components. Record the relationships before editing:
- Surface and role; outer padding; internal padding; height/minimum height; shape; icon slot; label behavior; selection/hover/press/focus styling; narrow-layout behavior; accessibility behavior.
- Reuse components for toolbar groups, icon buttons, capsule selectors, sidebar rows, form rows, and modal surfaces. Do not independently recreate each instance.
- Use one owner for each inset. Inspect native control padding, scroll insets, safe areas, and outer padding before adding more. Avoid default stack gaps where exact relationships matter.
- Keep the visual background, layout frame, hit region, focus ring, and shadow envelope distinct. Measure like-for-like boundaries in one coordinate space.
- Work in points. Convert screenshot pixels using the actual backing scale; do not assume every capture is 2×. An enlarged or photographed image cannot supply exact layout values.
- Prefer layout guides and constraints over offset patches. Use temporary debug outlines to reveal actual frames. An optical correction must be small, documented, component-local, and checked in every state.
- For a truly one-device-pixel hairline, derive thickness from local display scale and verify pixel placement. A one-point separator is different. Do not round every frame indiscriminately.
- Make content respond to its available window region, not a global screen width. Use measured fit and intrinsic sizing; avoid importing iOS size-class assumptions into macOS.

## 4. Spacing and nested shapes

### Equal exposed edges
When the design calls for a trailing control to have balanced top, bottom, and trailing clearance, enforce one shared inset:
`topGap = bottomGap = trailingGap = inset`.
A 40 pt outer bar and 28 pt visible button imply `(40 - 28) / 2 = 6 pt` vertical clearance; use 6 pt trailing clearance for that contract. These are teaching values, not the Macloving toolbar defaults.
Use parent padding and one child size to derive this relationship. Account for strokes and the actual visible surface. Do not make every layout symmetric: leading text space, reading alignment, and deliberate hierarchy can differ.

### Nested rounded rectangles
For a uniform inward offset of circular rounded corners:
`innerRadius = max(0, outerRadius - inset)`.
Clamp radii to half the corresponding shape's shorter dimension. Example: outer radius 16, inset 4, inner radius 12.
This describes an offset contour, not a universal formula for any child inside a card. Continuous corners/squircles, nonuniform insets, strokes, and unrelated child proportions need an inset path or visual verification. Do not apply the outer window radius to every nested control.

### Capsule selectors
For a horizontal pill track and pill selection, use capsules for both. With outer height H and inset p, the selected surface height is H − 2p. Example: 36 pt track, 3 pt inset, 30 pt selection; circular cap radii are 18 and 15 pt.
Keep the same inset around the first and last selected segments, including end caps. Define widths from text and padding or an intentional equal-width rule. Keep the track, visible selection, hit targets, and focus affordances separate. Do not fill a capsule track with an arbitrary small-radius rectangle.

### Spacing rhythm
Use a small named spacing scale and role-specific relationships. Respect the window profile's explicit 10/12/14 pt values; do not force them onto a different grid.
Size ordinary cards to their content plus padding. Use flexible height for actual scrolling/resizable work areas. Do not force every card to fill remaining height or make every list shrink to its rows.
Align section headings, paragraph starts, field labels, separators, and repeated actions to deliberate guides. Provide enough corner clearance for multiline content. Preserve useful whitespace; eliminate unexplained voids.

## 5. Icons, text, and selection

### Icon alignment
Use consistent icon slots, symbol scale, and weight within a control family. Center the visible symbol as well as its frame. Equal frames do not guarantee optical balance for asymmetric artwork.
For SF Symbols, prefer system font/image scale behavior. Preserve aspect ratio for imported icons and account for transparent asset margins.
Check normal, hover, pressed, selected, disabled, and keyboard-focused states. Backgrounds must not move or change the symbol's alignment. Do not demand identical silhouettes or manually offset every symbol.

### Text containment
Show essential action labels fully at supported window sizes. For `Auto-scr…`, inspect competing widths, layout priority, internal padding, and fixed frames before changing the font.
Choose a deliberate adaptation: flexible neighboring content, content-sized control, a clear compact label approved for that role, or an overflow menu for secondary commands. Do not hide essential actions or shrink text indiscriminately.
Use wrapping for explanatory text; use intentional truncation for long user content, paths, or filenames with a way to reveal the full value. A tooltip complements an action label; it does not repair an unreadable primary control.
Use `fixedSize` or layout priority only after checking the total width budget; unconstrained text can overflow its parent. Set minimum window size from the required layout and verify it.
Test long localized text, English and Bangla examples, larger text where supported, multiline content, and empty values. Respect actual font ascent, descent, and line height. Bangla marks and tightly stacked lines must not collide or clip.
Keep user content fonts independent from interface typography. Semantic font styles are roles, not guaranteed numeric equivalents; verify effective metrics when applying the embedded 11/13/15/22 pt profile.

### Selection and focus
Support active and inactive window selection states. A gray inactive selection is not automatically a bug.
Keep all selected row text, icons, badges, and secondary metadata legible. Verify the actual selected background rather than assuming semantic styles alone guarantee contrast.
Distinguish hover, selection, pressed state, and keyboard focus. Preserve visible focus indicators and accessible names. Use native Buttons, Menus, Toggles, and selection semantics where possible; avoid replacing them with generic tap gestures.

### Row separators and rounded highlights
Treat the separator and row highlight as one visual contract. For the Macloving rounded-row style, hide the separators immediately above and below a hovered or selected row when they touch or intersect its rounded surface. Alternatively, leave deliberate clearance outside the highlight; never leave straight lines cutting through rounded corners.

- Model each inter-row separator as one shared boundary. The line above row i may belong to row i−1, the list itself, or an overlay. Changing only row i's bottom line is incomplete.
- If either adjacent row has a highlight that requires suppression, keep that shared separator hidden. Restore it only when neither neighbor requires suppression. Cover different rows being selected and hovered at once.
- Change separator visibility without changing row height, padding, scroll position, or hit targets. Prevent leftover lines as hover moves between rows. Preserve genuine keyboard focus indicators.
- Test first, middle, last, and neighboring rows in normal, hovered, selected, focused, and inactive-window states, in applicable light/dark appearances. Preserve structural borders that do not collide with the highlight.

## 6. Toolbars, sidebars, forms, and windows

### Toolbars and settings navigation
Reserve stable space for toolbar icons and labels. Selecting a row, showing details, switching tabs, or loading data must not accidentally collapse or crop navigation.
Keep related controls grouped, their heights and baselines coordinated, and the primary action intentionally prominent. The Macloving main-window profile uses capsule controls. Macloving Settings uses the required left-category navigation below; do not substitute the older oversized horizontal icon toolbar. Unrelated apps can retain their native Settings navigation.
Give each control one material owner. Align hover surfaces and chevrons with their control, not the adjacent group.
Budget width for title/navigation, groups, search, primary action, gaps, and margins. Adapt before essential labels truncate. Preserve search scopes, keyboard Find, menu commands, and clear-search behavior when replacing native toolbar search.

### Sidebars and split regions
Use one indentation step per hierarchy level and consistent disclosure, icon, label, and badge columns. Make parent/child hierarchy readable without wasting width.
Reserve footer space with an appropriate layout inset. Let the list scroll independently; the last item must be reachable above status and bottom actions. A footer may visually overlay a scrolling background but must not cover the final reachable content.
Give each pane/header a clear owner. A divider may stop below a shared header or span a pane-specific header; choose the intended structure and make endpoints deliberate. Do not extend every divider blindly.
Keep selection and scroll position stable during updates. Restore saved widths only if valid; clamp or migrate incompatible widths instead of routinely erasing all stored layout preferences.

### Required compact Macloving sidebar scale

Use the right-hand Diet Image sidebar in the supplied side-by-side comparison as the visual size reference. The larger Fontwell navigation icons and labels on the left are a rejected scale. This comparison governs navigation chrome, not Fontwell's font specimens or any app's document, canvas, or reading text.

- Use the existing owner guide's point-based baseline: **13 pt row labels, 14 pt symbols in an 18 pt icon column, 8 pt icon-to-label gap, 28 pt single-line row height, 8 pt selection corners, and 12 pt outer horizontal inset**. Use 11 pt semibold section headings and secondary counts. These are declared Macloving defaults, not measurements inferred from screenshot pixels or universal Apple values.
- Keep ordinary labels regular; use restrained semibold for selected labels when appropriate. Do not enlarge a selected label or icon. Do not inherit title fonts, large control sizes, or symbol scales from a parent view. Verify actual font metrics rather than assuming a semantic SwiftUI font always equals the intended point size.
- Reuse one row component and token set across main navigation and Settings category lists. Preserve optical symbol centering, consistent stroke weight, aligned labels/counts, hierarchy indentation, and equal selection insets. Keep the whole row clickable and preserve native focus and keyboard behavior.
- Preserve the main-window guide's sidebar width where that profile applies. Fit Settings category width to its longest essential localized label and content minimums; do not enlarge its text/icons to fill extra width. Use planned wrapping or a wider sidebar when necessary instead of clipping or shrinking essential labels.
- Treat this as the default density, not a reason to defeat accessibility or an explicitly supported user size preference. Larger text may require a taller row and wider layout; keep the same relationships and verify containment. Do not use whole-view scaling to simulate compact controls.
- Compare at the same backing scale, window activity, and user size setting. The left app in the comparison is inactive: its dimming is not a target color or proof of an opacity bug. Check selected/unselected and active/inactive states in both appearances. Preserve meaningful status colors without making every icon oversized or saturated.

### Required Macloving inspector style

Use the supplied Torrentia light and dark inspector references as the required visual family for all Macloving side inspectors: one inset, rounded, flat panel with an optional capsule tab strip. This applies to details/properties inspectors, not the left navigation sidebar or the Settings window. Do not invent an inspector in an app that does not need one.

- **Panel:** place it below the toolbar, with deliberate top/right/bottom clearance and one consistent gutter from the main content. Reserve its width in the parent layout. Use continuous rounded corners and a quiet theme-aware fill. Start from the owner guide's 18 pt panel radius; verify the actual point geometry and surrounding insets. Avoid a heavy border, double outline, floating shadow, glass panel, or a flush rectangle substituted for this profile.
- **Shared construction:** reuse the same inspector container, spacing tokens, and tab component across affected callers. Use existing shared-package APIs only after verifying them; do not invent a `MaclovingKit` API name. Keep panel width and outer geometry stable across empty, populated, loading, error, and multi-selection states.
- **Tabs:** when multiple actual sections need tabs, inset a quiet capsule track near the panel top. Use a capsule selected segment with equal top/bottom/end clearance, derived as `selectedHeight = trackHeight - 2 * inset`. Center symbols optically in consistent slots. Keep usable hit targets, accessible names, tooltips, selection semantics, keyboard navigation, and visible focus. Adapt deliberately when tabs cannot fit; never clip icons. Do not copy the reference's seven tabs or create a redundant one-tab strip.
- **Body:** keep tab chrome stationary while long inspector content scrolls independently. Align headings, values, dividers, and controls to shared interior guides. Give the final row bottom clearance. Center a simple no-selection icon/title/help group within the body below the tabs, not within the whole window. An app-level overview can instead use the supplied Downloads inspector's structured heading and aligned summary rows; preserve its existing meaning and do not fabricate data.
- **Appearance:** preserve identical geometry in light and dark. Use semantic fills/text and the system or explicitly configured app accent; the reference's teal is not a required hardcoded brand color. Keep selected symbols and secondary copy legible, including increased contrast and reduced transparency. Do not copy low-contrast pixels blindly.
- **Behavior:** an existing inspector toggle must control only the inspector, reflect its state, and leave the main navigation sidebar's always-visible policy intact. Preserve selection, keyboard focus, scroll position, and valid width preferences. Do not add a toggle or new collapsible behavior merely because a screenshot contains one.
- **Acceptance:** check first/middle/last tabs, empty and realistic populated content, long localized labels, narrow/default/wide layouts, inspector transitions, both appearances, active/inactive states, keyboard focus, and relevant accessibility settings. A screenshot that resembles the reference is not evidence that these interactions work.

### Table and inspector boundary contract

Treat the Diet Image screenshot's clipped Status heading and awkward table/inspector seam as required regressions to reproduce. The screenshot establishes a visible problem, not whether the cause is an overlay, an oversized table, or an incorrect clip. Inspect the actual layout before diagnosing it.

- **Reserve pane width in layout.** An ordinary persistent inspector must participate in width allocation. After subtracting outer insets, make `availableInnerWidth = tableViewportWidth + gutterWidth + inspectorWidth + separateDividerWidth`; count a separate divider only if it occupies additional layout space. Opening or resizing the inspector must update the table viewport. Do not place a persistent inspector over table headers, rows, or footer controls with an overlay or z-order patch. An explicitly designed temporary overlay is a separate interaction and must not masquerade as this split layout.
- **Protect the table's last column.** Keep headers, cells, separator endpoints, and resize handles aligned within the same viewport. Essential headings such as Status must not end at an accidental hard clip. Budget column widths, adapt secondary content, or provide intentional horizontal scrolling with synchronized header/body behavior and a way to reach every column. In a deliberately scrolled overflow viewport, a partially visible edge column is allowed only with the overflow affordance and full reveal behavior below. Validate saved column widths and all pane minimums against the available width; preserve user preferences where valid.
- **Use the required inspector boundary.** For a Macloving inspector, use the inset rounded panel and deliberate gutter defined above. Define the gutter once in the parent layout. Do not place its rounded surface over a flush table edge. Other non-inspector split regions or unrelated native windows may use a straight shared seam with one divider; that is not an alternative Macloving inspector style.
- **Share the intended edge.** The table header, scrolling rows, and table-owned footer/status bar must use the same trailing boundary. The inspector uses its own bounds. A full-window footer is allowed only when the layout intentionally defines it that way. Align adjoining top/bottom edges when they represent a shared region; do not independently offset each strip.
- **Give divider endpoints a reason.** A divider below a shared toolbar may stop at the content boundary. A pane-specific header can require a different endpoint. Never extend the divider through shared controls just to make the line continuous. Avoid duplicate dividers, hairline gaps, corner slivers, or double borders where surfaces meet.
- **Keep the width contract during transitions.** Opening, closing, resizing, and restoring the inspector must not produce transient overlap, cropped headers, detached footers, or stale hit regions. Keep divider/resize hit targets usable and keyboard focus visible. Respect reduced motion without sacrificing the final layout.
- **Verify the boundary on screen.** Test inspector open and closed; minimum, default, and wide supported window sizes; both appearances; long headers/values; valid and stale saved column widths; first and last columns; and horizontal scrolling where supported. Capture the whole window and a close view of the seam. Exercise resizing and toggling in the running app. Add geometry assertions for the shared viewport edges when practical.
- **Do not pass a cosmetic concealment.** Clipping away the last column, shrinking essential text, adding unrelated padding, or moving only the header does not resolve the width contract. Mark the repair unverified until the relevant visual and interaction checks have run. Preserve the existing main-window profile and app behavior.

### Required horizontal table overflow and edge fade

Use the supplied Downloads table/inspector screenshot as the visual reference for a **subtle horizontal edge fade** where table content continues beyond its viewport. The image shows the intended soft boundary before the inspector; it does not prove scrolling, focus, or column accessibility. Enforce the following behavior when a Macloving table overflows horizontally, including when opening an inspector reduces its width.

**Resolve older wording explicitly:** this owner-approved overflow cue is an additional permitted functional scroll-edge effect under catalogue **V05**. Its gradient mask is also an explicit exception to the original window guide's blanket removal of gradients. Preserve those source texts as provenance, but apply this newer, narrower contract. Decorative gradients, duplicated haze, and fades that conceal layout defects remain prohibited. If the original screenshots are unavailable in a future session, implement the written contracts and report reference-image matching as unverified; do not claim to have inspected missing images.

- **Real overflow first:** give the table a real horizontal scroll range and keep the inspector outside it. One shared content width, column layout, and scroll offset must drive the header and body. Retain sensible column minimums; do not squash essential labels or put the inspector over the last column. Keep the scrollbar or another clear native scrolling affordance available. A fade alone must never conceal an unreachable column.
- **State-driven edges:** show a trailing fade only while more content exists beyond that edge. Show a leading fade only after scrolling away from the leading edge. Remove both when content fits. In logical coordinates, let `maximumOffset = max(0, contentWidth - viewportWidth)` and clamp the observed offset for elastic overscroll. Fade start when `offset > tolerance`; fade end when `offset < maximumOffset - tolerance`. Derive a small tolerance from actual layout precision and map logical edges correctly in right-to-left layouts.
- **Restrained geometry:** anchor a short gradient to the viewport edge, never to a moving column or the inspector. Define one named fade-width token, starting around 16–24 pt for evaluation, and constrain it for narrow viewports. This is an adjustable design starting point, not a measurement from the image. Keep most of the table fully legible. Reach the table's actual background smoothly before the gutter; do not create a visible white strip, dark halo, hard line, or broad washout.
- **Consistent composition:** coordinate header and scrolling row fades at the same edge and width. Include scrollable separators/highlights deliberately so no thin line sticks through the fade. Prefer a suitable mask or background-aware composition; never assume the background is white. Keep fixed/pinned columns, toolbar actions, table-owned footer controls, inspector, scroll indicators, and keyboard focus decoration out of an indiscriminate whole-container mask. Use one effect per relevant viewport layer rather than separate gradients in every cell.
- **Full reveal:** scrolling to either limit must reveal the first/last column completely with no remaining fade over its content. Programmatic and keyboard reveal must move a focused cell/control into the fully readable region, not merely beneath the fade. Reserve ordinary content clearance where needed and account for native insets once. Preserve scroll gestures, hit testing, selection, resize handles, and accessibility; a decorative overlay must not intercept input or enter the accessibility order.
- **Stable updates:** recompute overflow after resizing, opening/closing the inspector, changing/reordering columns, restoring widths, changing fonts/localization, or changing data. Clamp invalid offsets without resetting valid user position. Avoid flicker, stale fade strips, delayed header alignment, repeated cell layout, or root-level animations during scrolling. Do not let bounce briefly reveal content underneath the inspector.
- **Verify before passing:** test no overflow, overflow at the start/middle/end, all columns reachable, first/last columns fully revealed, inspector open/closed, minimum/default/wide windows, changed/restored widths, long text, both appearances, right-to-left layout when supported, keyboard focus/reveal, trackpad/mouse scrolling, and native scrollbar visibility settings. Check increased contrast and reduced transparency; if the fade compromises readability, reduce/disable it while retaining clear scroll affordances. Record actual runtime results rather than treating the reference screenshot as proof.

### Timelines and editor alignment
Define shared guides for the canvas, transport controls, track header, ruler, clip lanes, and inspector. Treat the user's Video track example as an alignment regression to reproduce; do not invent an exact offset or cause from the screenshot alone.

- Center the track icon-and-label group against its actual clip lane, excluding the ruler/header above it. Use a consistent icon slot, icon/text gap, baseline relationship, and gutter inset. Check the visible glyph as well as its frame.
- Give ruler ticks, clips, playhead, and hit testing one content origin and time-to-position mapping. Include track-header width and content inset once; share zoom and horizontal-scroll offsets. In a scrolled or trimmed view, align to the displayed time range rather than pinning zero on screen. Recompute consistently on resize or zoom; avoid independent offset patches.
- Center playback controls within their intended editing/canvas region, independent of unequal side groups. Two flexible spacers around unequal groups do not guarantee centering. Coordinate time text, editing buttons, transport, and zoom controls vertically.
- Align intended shared panel edges and outer insets, including timeline/inspector bottom edges when they share a boundary. Preserve deliberate differences specified by the component contract.
- Verify short and long track labels, multiple lanes, resizing, zoom, scroll, and selection/focus. Measure layout guides before applying a small optical correction.

### Forms and settings
Use shared label/value/action alignment and consistent row padding. At narrow widths, switch a whole row to a planned two-line or stacked layout, with enough height and clear grouping.
A wrapped `Trusted device` value/action should not fall into the next row or appear detached from its label. Align baselines for adjacent text and centers for controls as appropriate.
Separate dense lists from spacious explanation blocks by role. Avoid huge empty card interiors and inconsistent paragraph insets.
Verify all content is reachable by scrolling and keyboard. A partly visible row at a scroll boundary is acceptable if normal scrolling reveals it; trapped or overlapped content is not.

### Required Macloving Settings window style

Use the supplied Torrentia Settings example as the required **structure**: persistent left category navigation with search, a compact leading-aligned page title, and grouped native controls in the right content pane. Apply all spacing, shape, type, alignment, accessibility, and interaction rules in this skill to improve its polish. The example is not blanket approval of every pixel or permission to copy torrent-specific categories.

- **Window and navigation:** preserve real traffic lights and native Settings/menu/window behavior. Keep category navigation visible; remove the floating sidebar toggle and oversized empty sidebar/header region shown in the rejected Diet Image Settings example. Place search below the traffic-light clearance and above the category list with deliberate spacing. Do not replace this layout with a horizontal gallery of oversized category icons or wrap it in the main-window content-card shell.
- **Category rows:** use the compact sidebar scale above, shared icon slots, consistent row insets, and a restrained rounded selected row. Keep long category names readable and maintain active/inactive selection and focus. Use only categories meaningful to that app. If an About category exists, route it through the required shared About presentation without inventing a second About UI.
- **Search:** provide working settings search that reaches the relevant page/control and supports clear, keyboard, and no-results states. Do not add a decorative search field. Keep existing search behavior where it meets this contract; when building the specified Settings layout, include its real search behavior in the implementation.
- **Header and content:** use a compact page title aligned to the leading content region. Do not center a hero-sized title above a tall blank strip. Establish shared content-edge and text guides for titles, group surfaces, section labels, row labels, helpers, and trailing controls; make any text inset inside a card intentional. Keep the first group close enough to the title to read as one page. Use a sensible readable content width rather than stretching typography and row padding with the window.
- **Grouped forms:** size cards from their content and shared insets. Keep labels leading, controls trailing, baselines/centers appropriate, and row heights consistent for the same content role. Use native toggles, pop-up choices, segmented controls, and radio groups. Separate unrelated groups with the shared spacing rhythm; avoid huge empty card tails, tightly crowded corners, accidental oversized rows, or separators crossing rounded highlights.
- **Nested shapes and text:** apply the inset-radius relationship where contours truly nest, and capsule geometry when the control track is a capsule. Give multiline helpers their own readable space under the related setting or group. Do not turn an explanation into an unlabeled control row. At narrow sizes, reflow the complete label/value/action group without overlap or truncated essential choices.
- **Scroll and footer:** allow the category list and long settings content to scroll independently without hiding the title/search unexpectedly. Keep the final setting reachable. If an existing Restore Defaults action belongs in a bottom footer, align it with the content's trailing guide and reserve its height/insets; never overlay it on the form. Preserve its scope and confirmation behavior. Do not add reset functionality simply to imitate the example. Useful window whitespace is allowed; oversized blank header bands and forced empty card height are not.
- **Consistency and evidence:** reuse the Settings shell and form components across affected Macloving apps, while preserving app-specific behavior. Keep light/dark geometry, compact typography, appearance choices, native keyboard/focus, and accessibility consistent. Test all affected categories, search, long labels, wrapping, footer reachability, resizing, and category switching without unexplained window-size jumps. Verify appearance changes live. Do not declare completion from compilation alone.

### Macloving onboarding implementation contract

Use the complete dedicated onboarding rules in section 14 when onboarding is created, changed, audited, or prepared for the next release. They add concrete requirements to the base app policy; prefer them for onboarding-specific details. The product-wide MaclovingKit minimum of 0.5.0 remains compatible with their 0.4.0 onboarding minimum: do not downgrade a newer compatible package or upgrade a package without task authorization.

Keep the shared template responsible for the window, layout, keyboard, VoiceOver, once-only state, and Help entry; the app supplies page content and supported style configuration. Verify the actual MaclovingKit README, installed version, and APIs before calling `OnboardingStyle` or `MaclovingOnboarding.writeSnapshots(to:pages:)`. Use the documented equivalent if the installed API differs; do not invent an API or reimplement the template to bypass it.

For optional permissions, keep a clearly named Open System Settings action and use Not Now for the skip/continue action until permission is granted. Refresh live status when returning from System Settings. Never label the permission-grant action as a skip action. Preserve Return, Escape where allowed, and Command-[ navigation without intercepting text composition or unrelated editing commands.

Generate every page's light and dark snapshots from the running app using the verified snapshot API, for example behind a DEBUG-only launch argument. Compare with the approved `onboarding-review/` references when available. Snapshot generation does not verify keyboard flow, permission changes, accessibility, or once-only/reopen behavior; test those separately. Submit every page in both appearances for owner review before release. Continue authorized implementation and testing before that review; do not ship until the owner approves. This policy does not itself authorize a release.

### Window profile integration
Apply the original guide below to main-window redesigns: continuous translucent frame/sidebar, opaque rounded content container, restrained glass controls, and system accent.
Preserve real traffic lights, window movement, standard menu behavior, keyboard focus, drag selection, and reordering. Reserve actual traffic-light clearance; never assume a screenshot's titlebar geometry fits every window configuration.
Do not enable background dragging across interactive content. Use a verified noninteractive drag region. Treat the guide's observations about drag APIs as project-specific; test the current implementation.
When applying the always-visible sidebar profile, remove its hide affordances as requested; do not remove sidebar toggles from unrelated native windows.
Check light/dark, active/inactive, resize, fullscreen where supported, and first-run/empty states. Keep shell clipping from hiding popovers, focus rings, and intended elevated controls.
For custom AppKit bridges, use the framework's sizing lifecycle, persistent coordinators where needed, and cleanup for resources actually installed. Verify intrinsic sizing and state updates rather than imposing arbitrary frames.

## 7. Materials, outlines, and shadows

Prefer system presentation for dialogs and sheets. Use native Liquid Glass APIs only where available and intended; do not imitate them with stacks of blur, white overlays, gradients, and shadows.
For the main profile, keep content opaque and glass on controls. Use the required flat, rounded inspector surface and its theme-aware capsule tab strip; do not give the whole inspector a glass shadow or second outline. Preserve the guide's untinted regular material and system accent choices. Keep table edge fades tied to the actual background and overflow state, never a fixed white overlay.
Distinguish `GlassEffectContainer` interaction spacing from HStack layout spacing; changing one does not set the other. Verify that separate groups do not unintentionally merge at rest.
For each surface, identify who owns fill/material, clipping, border, shadow, and focus:
- Match the outline to the visible surface and account for stroke placement.
- Clip inner content where required; keep the intended outer shadow outside that clip.
- Avoid adding a manual outer shadow to an already shadowed native sheet or window.
- Inspect lower corners and all edges on contrasting backgrounds for a second capsule, ring, halo, or offset silhouette.
- For a ghost shape below a modal, inspect duplicate backgrounds, nested glass surfaces, shadow paths, masks, stale transition layers, and window-level shadows. Treat these as hypotheses until verified.
Preserve a legitimate keyboard focus ring. Check Reduce Transparency and Increase Contrast, using system adaptations or legible fallbacks where needed. Do not tune materials from a single flattened window-only capture.

## 8. Motion and performance

Treat animation complaints as user-reported until observed in a running app or recording. Specify trigger, moving elements, stationary elements, interruption behavior, and reduced-motion behavior.
Use native control/presentation motion when it suits the component. For custom motion, begin with restrained, prompt transitions; validate timing by interaction rather than declaring one duration universally correct.
Scope animations to the changing element or transaction. Do not animate the entire root hierarchy because a count, selection, or loading flag changed. Preserve stable view and list identity.
On repeated input, transition from the current visible state without snapping back, queuing stale effects, or leaving duplicate highlights. Keep hit targets and keyboard behavior usable during motion.
Test opening/closing, switching tabs, showing details, hover/press, fast repeats, interrupted transitions, loading completion, and resize. Check the midpoint as well as the final frame.
Honor Reduce Motion; maintain state clarity with an appropriate reduced transition. Do not disable all animation as a blanket performance fix.
For stutter, inspect expensive work during view updates, broad state invalidation, image decoding, geometry feedback loops, repeated layout, and excessive material effects. Narrow the cause before restructuring.
Use Instruments or equivalent runtime evidence when needed. Compare the same workload/build before and after. Record measured changes; do not claim a frame rate or performance improvement from source inspection or still images.

## 9. Regression catalogue and completion gate

Use these user-derived cases as required checks whenever the related component changes:

| Case | Acceptance |
|---|---|
| Trailing button feels squeezed against the right edge | Intended top/bottom/trailing inset relationship holds for visible bounds |
| Rounded rectangle selection inside pill tabs | Capsule selection matches track inset and end-cap geometry |
| Export icon looks low in its hover circle | Frame and optical centering verified; no state-induced shift |
| Separators cut into rounded hover/selection corners | Both adjacent shared boundaries are hidden or clearly separated; no layout jump or lost focus indicator |
| Video label or playback controls feel misaligned | Label aligns with clip lane; transport with intended region; ruler, clips, playhead, and hit tests share one time mapping |
| Essential label reads Auto-scr… | Full label or deliberate approved adaptation at supported sizes |
| Feeds toolbar loses its icons after selection | Navigation remains fully visible with stable intended geometry |
| About paragraphs crowd rounded card edges | Consistent readable text inset and heading alignment |
| Checkbox card has a large unexplained empty tail | Height follows content unless a documented workspace purpose requires it |
| Sidebar hierarchy is ambiguous | Predictable nesting, icon columns, and label alignment |
| Bottom status overlaps last sidebar item | Footer reserves space; final row is fully reachable |
| Bangla lines look cramped | Font metrics, wrapping, and line spacing preserve readable glyphs |
| Resume banner blocks article metadata | Placement permits essential content to remain readable/reachable |
| Form values/actions wrap awkwardly | Deliberate row reflow with correct grouping and height |
| Panel divider ends look accidental | Endpoints match shared or independent header structure |
| Inspector clips the Status heading or appears pasted over the table | Width reserved in parent layout; header/rows/footer share viewport; required rounded inspector with deliberate gutter; open/close/resize states verified |
| Inspectors drift between apps or show square selections inside pill tabs | Shared rounded flat panel, consistent insets, capsule track/selection where tabs exist, stable light/dark geometry |
| Wide table ends abruptly or fades out unreachable columns | True horizontal scrolling; synchronized header/body; state-driven edge fades; every column fully revealable; no fade at the reached limit |
| Sidebar text/icons look oversized beside the approved compact app | Shared 13 pt label / 14 pt symbol baseline, 18 pt icon slot, 28 pt default rows; accessibility-aware adaptation; document/font specimens unchanged |
| Settings has a floating sidebar toggle or oversized blank header | Persistent compact category sidebar and real search; leading page title; grouped aligned forms; reachable footer; both appearances checked |
| Circle/ring appears beneath modal shadow | One intentional surface silhouette; no duplicate layer artifact |
| Primary action shape differs accidentally | Shape follows its component contract and main-window profile |
| Animation feels jumpy or unfinished | Runtime check covers interruption, mid-transition geometry, and reduced motion |
| Macloving About differs between apps or displays a build number | Shared MaclovingAbout, adaptive full logo and links, exact version without build number |
| Onboarding is inconsistent or unreviewed | Shared template owns layout/flow; real bundle icon; optional Not Now; Return/Esc/Command-[; live permission status; supported style hook; all pages reviewed light/dark before release |
| Installer or listing drifts from app identity | Designed DMG and correct icon/typography; code-checked claims; no build numbers or duplicate information |

Validate the changed component in light and dark, minimum/default/wide supported window sizes, relevant focus/selection states, realistic long content, and applicable accessibility settings. Test active/inactive material behavior where affected. Do not run every possible combination for an unrelated tiny change, but do not omit the state that caused the bug.
Capture a whole-window image for context and a close crop for spacing. Confirm screen capture permissions; capture only the intended app region. Inspect real composited translucency when window-only capture is insufficient.
For measured equality, record actual bounds, expected values, scale, and a justified tolerance. Do not invent pixel precision from a photograph. Use geometry assertions for key shared relationships and approved visual baselines when practical. A baseline must be reviewed before it becomes the standard.
Keep meaningful interaction tests. Update changed expectations after checking behavior; do not delete a failing test merely to obtain green checks.
Classify completion as **verified**, **partially verified**, or **blocked**. State missing evidence briefly and continue independent checks. Never say screenshots were inspected or animation was tested unless that happened.
For Macloving release-related work, apply the app policy's gates, including owner review of onboarding. Do not run release actions without the owner's direct instruction in that app's session. Verify paths, assets, signing configuration, and shared package APIs against the actual checkout.
For any changed table/inspector boundary, apply the explicit section 6 width, inspector-style, and overflow/fade contracts; do not mark the fix verified from a build alone. For Settings or sidebar work, verify the required structure and compact scale rather than relying on resemblance alone. For onboarding work, apply the dedicated policy and distinguish snapshot evidence from runtime flow/accessibility evidence.
Before finishing, search other uses of the repaired component. Document intentional exceptions in the component contract so the next repair does not undo them. Include the applicable catalogue IDs in the audit or handover. A Not applicable result needs a product-specific reason, and a Not verified result stays open; neither is a pass.

## 10. Source notes

Researched 8 November 2026. This is an original, curated synthesis of selected methods, not a verbatim merger or an endorsement by the authors. The source skills are not runtime dependencies. Check current Apple documentation and the project's SDK when an API matters.

| Source | Selected contribution |
|---|---|
| [SwiftUI Expert — Antoine van der Lee](https://github.com/AvdLee/SwiftUI-Agent-Skill) | Layout constraints, local environment inputs, component/state boundaries, animation scope, availability checks |
| [Apple Design — dickwu](https://github.com/dickwu/apple-design-skill) | Screenshot/code review, design craft, guideline-backed findings, evidence limits |
| [SwiftUI Performance Audit — Thomas Ricouard](https://github.com/Dimillian/Skills/tree/main/swiftui-performance-audit) | Symptom classification, identity/layout investigation, runtime validation |
| [Claude Code Apple Skills — Ravi Shankar](https://github.com/rshankras/claude-code-apple-skills) | macOS-specific review and AppKit/SwiftUI integration concerns |
| [SwiftUI Pro — Paul Hudson](https://github.com/twostraws/SwiftUI-Agent-Skill) | Focused reviews, accessibility, localization, and avoiding unrelated rewrites |
| [Apple macOS HIG](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos) | Windowing, keyboard/pointer use, menu commands, native behavior |
| [Apple Liquid Glass documentation](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views) | Materials, shape grouping, modifier order, and effect-container behavior |
| [Claude Code skills documentation](https://code.claude.com/docs/en/skills) | Skill packaging and invocation |
| Faisal's screenshots and conversation | Concrete spacing, shape, clipping, hierarchy, layering, and motion regression cases |
| Faisal's approved Torrentia inspector and Settings examples, 8 November 2026 | Required rounded inset inspector family in both appearances; persistent category-based Settings structure; rejected floating toggle and oversized header |
| Faisal's Downloads table/inspector example, 8 November 2026 | Soft horizontal overflow edge before the inspector; consolidated rules add verifiable scrolling and full-column reveal behavior |
| Faisal's side-by-side Fontwell / Diet Image comparison, 8 November 2026 | Diet Image's compact navigation scale is preferred; reject oversized Fontwell sidebar icons/text while preserving font specimens and inactive-window behavior |
| Faisal's macOS window guide, included with this skill | Preferred main-window design and numerical profile |
| Faisal's MACLOVING-APP-RULES.md, supplied 8 November 2026 | Identity/signing, shared About/onboarding, installer, versions, releases, listings, and app-session workflow |
| Faisal's onboarding-rules.md, supplied 8 November 2026 | Detailed shared-template page types, permission labels, keyboard flow, non-native style configuration, and snapshot-review workflow |

Do not inherit unrelated iOS defaults, speculative version assumptions, broad architectural mandates, or universal bans from source skills. Apply macOS-specific evidence and the actual deployment target. These online sources may change; treat the link list as provenance, not an automatic update mechanism.

## 11. Original window design guide

The following user-supplied guide is included verbatim. Read it when applying the main-window profile. Use the consolidated rules above to interpret its sample implementation. Its typography numbers are target metrics to verify, its accessibility-identifier warning is a diagnostic prompt rather than a universal rule, and its test/capture/drag observations must be checked against the actual app and toolchain. Native control behavior, authorized task scope, and truthful verification remain required.

<!-- BEGIN USER WINDOW GUIDE -->
# Prompt: apply the translucent-frame window design to a macOS app

Paste everything below this line into Claude Code, in the app's folder. It stands alone and needs no other project.

---

Apply the window design below to this macOS app. This is a visual change, not a reorganization: every feature, screen, keyboard shortcut and menu command must still work afterward. The one exception is the sidebar's hide button and Hide Sidebar menu item, which are removed on purpose.

The app must target macOS 26 or later, because the design uses Liquid Glass. If it targets an earlier version, stop and ask me.

## Start here

1. Read the app's project instructions (CLAUDE.md, README) and follow them. They win over this prompt if they conflict.
2. Read the app's window, root view, sidebar, toolbar and color code, then every screen's toolbar and search setup.
3. List every toolbar item, `.searchable`, `.navigationTitle`, sidebar item, side panel, sheet and custom color or font. Each toolbar item and search field needs a new home, so use this list as your checklist.
4. Ask me anything that is genuinely ambiguous, using clickable options. Likely questions: which screen's main action gets the prominent button, and whether a screen with unusual chrome should be exempt. Pick sensible defaults for everything else and tell me what you picked.
5. Check `git status`. Don't start on top of someone else's uncommitted work, and don't switch or merge branches without asking.

## The design

Picture two layers:

```
+------------------------------------------------------+
| o o o  translucent window material                   |
|         +------------------------------------------+ |
| sidebar | [nav] [path]        [actions] [search]   | |
|         |                                          | |
| (no     |  opaque rounded container                | |
| card of |  holds the top bar and the whole screen  | |
| its     |                                          | |
| own)    |                                          | |
|         +------------------------------------------+ |
+------------------------------------------------------+
```

- **Translucent:** the sidebar and the margins around the container are one continuous surface, with no divider between them.
- **Normal:** everything else sits in one opaque container.
- **Glass:** only the controls in the top bar and small floating controls are Liquid Glass.

### Exact values

| Element | Value |
|---|---|
| Window | `.windowStyle(.hiddenTitleBar)` |
| Window background | `NSVisualEffectView`: `.sidebar` material, `.behindWindow`, `.followsWindowActiveState` |
| Container fill | `Color(nsColor: .controlBackgroundColor)` |
| Container corners | 12 pt, `.continuous` |
| Container margin | 12 pt on the top, right and bottom. With a sidebar, the sidebar's edge is the left side. Without one, 12 pt on the left too, and a taller strip on top (see Sidebar) |
| Container shadow | Black at about 2% opacity, radius 5, y 1 |
| Top bar padding | 14 pt top and sides, 10 pt bottom |
| Top bar controls | 36 pt tall, capsules, 10 pt apart |
| Sidebar | 228 pt wide, fixed, always visible |
| Sidebar content | Starts 46 pt from the top, 12 pt side padding |
| Sidebar rows | 28 pt tall, 8 pt corners, 14 pt icons in an 18 pt column, 8 pt icon-to-text gap |
| Sidebar headings | `.subheadline.weight(.semibold)`, secondary color |

### Type

Use the system font, in these four sizes only. Never use a custom font for interface text.

| Size | Style | Use |
|---|---|---|
| 11 pt | `.subheadline` | Secondary text, captions, sidebar headings |
| 13 pt | `.body`, `.headline` (semibold) | Almost everything |
| 15 pt | `.title3` | Section titles |
| 22 pt | `.title` | Large numbers and hero text, used rarely |

Replace `.caption`, `.caption2`, `.footnote` and `.callout` with `.subheadline` or `.body`, and `.largeTitle` and `.title2` with `.title` or `.title3`. Replace `.system(size:)` on text with one of the four. Larger sizes are fine on SF Symbols, because those are icons. User content such as a document, a font preview or a code editor keeps its own fonts.

### Color

Use system colors and my accent color from System Settings. Nothing is tinted.

| Role | Color |
|---|---|
| Window | `.windowBackgroundColor` |
| Container, cards | `.controlBackgroundColor` |
| Hairlines | `.separatorColor` |
| Text | `.labelColor`, `.secondaryLabelColor`, `.tertiaryLabelColor` |
| Hover fills, bar tracks | `.quaternaryLabelColor` |
| Selection, progress | `.controlAccentColor` |
| Status | `.systemGreen`, `.systemOrange`, `.systemRed` |

Remove custom palettes, navy or brand tints, gradients, tinted glass, and color assets and tests that only served them. Make the `AccentColor` asset empty so the system accent applies. Colors that carry meaning in content, such as chart series, can stay. Keep color roles in one small file so views never use literals.

### Glass

- Top bar controls: `.glassEffect(.regular.interactive(), in: .capsule)` inside one `GlassEffectContainer`.
- Search field and breadcrumb: `.glassEffect(.regular, in: .capsule)`.
- A screen's single main action, if it has one: `.buttonStyle(.glassProminent)` with `.buttonBorderShape(.capsule)`. Use at most one per screen, and don't add a main action where there isn't an obvious one.
- Sidebar: the selected row, cards and bottom buttons can be glass. Use `.regular`, never tinted.
- Don't put glass on panels inside the container, because it casts a shadow onto the card. A side panel is a flat fill: `quaternaryLabelColor` at about 60%, 18 pt corners.

### Sidebar

- It's always visible, with no toggle. Add `CommandGroup(replacing: .sidebar) {}` to remove the menu item.
- Draw it directly with a `ScrollView`, not `List` or `NavigationSplitView`, because those add their own surface and divider.
- Pin anything that should stay reachable (an Add button, a status card) in a `.safeAreaInset(edge: .bottom)`, so the rest scrolls behind it.
- Keep every sidebar item and its badges, keyboard access and accessibility identifier.
- If the app has no sidebar, don't add one. Use the frame and container only, and replace the 12 pt top margin with a strip above the card, tall enough to hold the traffic lights (about 28 pt). The strip also gives the window a place to drag from.

### Top bar

Each screen draws its own top bar as the first thing inside the container, then its content.

- Leading: navigation capsule, or a title with the subtitle under it (`.headline` and `.subheadline`).
- Then a flexible `Spacer(minLength: 8)`.
- Trailing: main action, grouped icon buttons, then search.
- Group related buttons into one capsule. Don't leave stray gaps.
- Keep a `.help` tooltip and an accessibility label on every icon button, and keep existing accessibility identifiers.
- A breadcrumb should fit its content, with no empty space inside the capsule. Scroll it only when the path is too long.

## Reference code

Adapt these to the app. They're a starting point, not code to paste unchanged.

```swift
import AppKit
import SwiftUI

enum Metrics {
    static let sidebarWidth: CGFloat = 228
    static let containerMargin: CGFloat = 12
    static let containerRadius: CGFloat = 12
    static let barControlHeight: CGFloat = 36
    static let trafficLightsInset: CGFloat = 46
}

/// The translucent surface behind the sidebar and the container's margins.
struct WindowMaterial: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .sidebar
        view.blendingMode = .behindWindow
        view.state = .followsWindowActiveState
        return view
    }
    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}

struct MainWindowView: View {
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Metrics.containerRadius, style: .continuous)
        HStack(spacing: 0) {
            SidebarView()
                .frame(width: Metrics.sidebarWidth)
            DetailView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(nsColor: .controlBackgroundColor), in: shape)
                .clipShape(shape)
                .shadow(color: .black.opacity(0.02), radius: 5, y: 1)
                .padding([.top, .trailing, .bottom], Metrics.containerMargin)
        }
        .ignoresSafeArea()
        .containerBackground(for: .window) { WindowMaterial() }
    }
}

/// Draw this first inside each screen's VStack(spacing: 0).
struct TopBar<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) { content }
        }
        .padding(.horizontal, 14)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity)
    }
}

struct BarGroup<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        HStack(spacing: 0) { content }
            .padding(.horizontal, 3)
            .frame(height: Metrics.barControlHeight)
            .glassEffect(.regular.interactive(), in: .capsule)
    }
}

struct BarButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @State private var isHovered = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .padding(.horizontal, 8)
            .frame(minWidth: 32, minHeight: Metrics.barControlHeight - 6)
            .opacity(isEnabled ? 1 : 0.35)
            .background(isHovered && isEnabled ? Color(nsColor: .quaternaryLabelColor) : .clear, in: Capsule())
            .contentShape(Capsule())
            .onHover { isHovered = $0 }
    }
}

struct BarSearchField: View {
    @Binding var text: String
    var prompt: String
    var focus: FocusState<Bool>.Binding
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField(prompt, text: $text).textFieldStyle(.plain).focused(focus)
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: Metrics.barControlHeight)
        .frame(minWidth: 170, idealWidth: 260, maxWidth: 300)
        .glassEffect(.regular, in: .capsule)
    }
}
```

Menus in the bar: `Menu` with `.menuStyle(.button)`, `.buttonStyle(BarButtonStyle())`, `.menuIndicator(.hidden)` and `.fixedSize()`, using a symbol plus a small `chevron.down`.

## Traps

These all cost real time on the first app. Check each one.

1. **Don't set `window.isMovableByWindowBackground = true`.** It looks like the obvious way to move a window with no title bar, but it takes drags away from content, so drag selection and reordering silently stop working. The window already moves from the strip along its top edge. `WindowDragGesture` and an NSView calling `performDrag` did not work inside the top bar or margins in my testing, so don't assume they do.
2. **The system toolbar can't go inside the card.** It stays pinned to the window's top edge. Attempts to run the card up behind it leave the controls poking out. Draw the bar in the view, and use an `HStack` rather than `NavigationSplitView`.
3. **Search and Find.** Removing `.searchable` loses ⌘F. Use `@FocusState` and point the app's Find command at the field. Keep search scopes, as a menu inside the field or a new control.
4. **Dead modifiers.** `.navigationTitle`, `.navigationSubtitle`, `.toolbar`, `.toolbarBackgroundVisibility` and `.searchToolbarBehavior` do nothing or fail to build once the toolbar is gone. Move their content into the top bar and delete them.
5. **Accessibility identifiers.** An `.accessibilityIdentifier` on a screen's root overrides the IDs of everything inside it, which breaks UI tests and hurts VoiceOver. Add `.accessibilityElement(children: .contain)` right before it.
6. **Saved column widths.** A narrower layout plus old `@SceneStorage` column data can hide table columns. Rename the storage key to reset them.
7. **Text on selected rows.** Don't force fixed colors in table rows, or text stays dark on a blue selection. Use the system's hierarchical styles (`.primary`, `.secondary`).
8. **Minimum width.** A fixed sidebar plus a side panel can squeeze the content. Set a sensible `contentMinSize`, and check the narrowest window.
9. **Other windows.** Settings, About, sheets, alerts and menu bar popovers keep their normal system look. Only the main window gets this layout. Check that the first-run screen still looks right with no title bar.

## Verify

Don't call it finished until each of these is done, and tell me honestly about any you couldn't do.

1. It builds with no new warnings, and the unit tests pass. Fix or remove tests that relied on the old chrome or palette, and say which.
2. Go back through your checklist from Start here. Every toolbar item, search field and menu command should have a home and still work.
3. Screenshot every main screen in light and dark, and look at them. Use the app's sample or fixture data if it has any.
4. Check the window on screen, not only with `screencapture -l`, which hides translucency. `screencapture -R x,y,w,h` shows the real result. The sidebar and margins should match, with no divider.
5. Confirm the toolbar sits fully inside the container on every screen, nothing clips at the corners, and scrolled content stays inside the card.
6. Confirm the window moves from its top strip and that drags inside content still work.
7. Test real mouse drags with posted `CGEvent`s, and only after checking the app is frontmost, or the events land on whatever window is in front. Don't press on a control by accident. XCUITest's `press(forDuration:thenDragTo:)` may send only a mouse-down and a mouse-up here, so don't trust it for drags. `window.sendEvent` works for SwiftUI gestures but can't test window moves.
8. Don't run UI tests while another app's are running on this Mac. They fight over the mouse and keyboard, and they take over mine, so ask before a long run.

## Finish

Commit locally. Don't push, tag, bump the version, notarize or release unless I ask. Then tell me in plain language:

- what changed
- anything you left as it was, and why
- which branch the work is on
- what you couldn't check
<!-- END USER WINDOW GUIDE -->

## 12. Macloving app rules

Read these complete rules before changing or building a Macloving app. They are the owner's current product/workflow requirements, preserved verbatim. The MaclovingKit 0.5.0 requirement is a minimum from this policy; inspect the actual installed version/API and do not downgrade a newer compatible package. Verify paths on the owner's Mac before use. Resolve real conflicts with newer owner instructions instead of silently inventing policy.

<!-- BEGIN USER APP RULES -->
# Macloving app rules

Every rule set so far for Macloving apps, current and future. Collected 2026-11-08 from the shared app rules
(`~/Documents/GitHub/Macloving/CLAUDE.md`), the global Apple rules and the decisions recorded along the way.

## Identity and signing

- **Bundle IDs:** `com.macloving.<app>` (lowercase app name). Extensions are `com.macloving.<app>.<extension>`, App
  Groups `group.com.macloving.<app>` and iCloud containers `iCloud.com.macloving.<app>`.
- **Never change** a shipped app's bundle ID, Sparkle key (`SUPublicEDKey`) or the slug in `macloving.json` without
  asking. Shipped copies depend on them.
- **Signing:** team 7K32QQ2FX8 with automatic signing. Never use team 558GMKM4KY or the "Emily Lien" certificate.
- **Distribution:** direct download through macloving.app only (Developer ID, notarized, Sparkle updates). No Mac
  App Store for Macloving apps.
- **Apple silicon only:** every app builds with `ARCHS = arm64`. If a package brings in a Universal framework, such
  as Sparkle, thin it to arm64 in a scheme post-action like MacAuth's `script/thin-frameworks.sh`. The release
  script refuses any build with Intel code.
- **Access:** an app is either free or included in the membership, never a mix. Free apps need no sign-in or
  licence. Membership apps sign in with Macloving and work on up to 6 Macs per account.

## About window and versions

- **One About window:** use the shared native About window from MaclovingKit (`MaclovingAbout`; `MaclovingCommands`
  adds it automatically). Never write a custom About window or use the standard macOS About panel.
- **What it shows:**
  - the app's icon and name
  - "Version 1.0.0"
  - the Macloving logo
  - "© <year> Macloving. All rights reserved."
  - the links Website (macloving.app) · Support (macloving.app/support) · Privacy Policy (macloving.app/privacy)
- **Macloving logo:** the full logo, heart and wordmark, sits just above the links. It uses the dark-text logo in
  light mode and the white-text logo in dark mode. Files:
  `~/Documents/GitHub/Airly Studio/macloving/design/brand/macloving-logo-for-light-mode.png` and
  `macloving-logo-for-dark-mode.png`.
- **Versions:** show the version exactly as set: MAJOR.MINOR.PATCH, such as 1.0.0 or 1.12.3, with each part up to 3
  digits.
- **Never show a build number anywhere:** not in the About window, an About tab in Settings, other screens, release
  reports or macloving.app pages. So "Version 1.2.0", never "Version 1.2.0 (4)". `CFBundleVersion` still exists
  for Sparkle; it's just never displayed.
- **About tabs in Settings:** allowed, but they follow the same version rule. Prefer the shared About window over a
  second About screen.

## Onboarding

Every app's first-run onboarding is redone to a high standard **at its next release**, and it must never look like
AI slop.

- **Review first:** before the release, send the owner screenshots of every onboarding page in light and dark mode,
  and wait for the OK. Onboarding the owner hasn't seen never ships.
- **Shared template:** build it with `MaclovingOnboarding` from MaclovingKit 0.4.0 or later (0.5.0 adds the About logo, so use 0.5.0). The app supplies only
  its pages: welcome, features, permission, choices, shortcut, custom and done.
- **Icon:** always the app's real, current icon, read from its own bundle (`NSApp.applicationIconImage`). Never a
  copied, old or placeholder image.
- **Type:** the system font (SF), native Mac, with a clear hierarchy: one title per page and short body text.
- **Non-native apps:** if an app's own windows use custom fonts, colours and controls, its onboarding follows the
  app's look through the template's style hook. It can use fonts the app already bundles, but no new fonts are added
  just for onboarding. Every other onboarding rule still applies.
- **Content:** usually 2 to 4 pages, each with one job: what the app does, the one or two things to set up, and how
  to start. Use plain, specific words, with no hype, no filler and no em dashes. Don't repeat what another page or
  the app already says.
- **Permissions:** explain why in one sentence, offer a button that opens the right System Settings pane, and show
  the live status. Never block the app on an optional permission.
- **Visual:**
  - consistent spacing and alignment, with native controls
  - real screenshots or SF Symbols, not stock illustrations
  - no gradient blobs, no emoji, no fake 3D, no centred walls of text
- **Accessibility:** works in light and dark mode, with larger text, VoiceOver and the keyboard. Return continues,
  and Esc skips where skipping is allowed.
- **Flow:** skippable unless a step is truly required, shown once, and reopenable from the Help menu or Settings.

## Installer (DMG)

Every release ships the designed installer made by the DMG Designer in `macloving-release/dmg-designer/`. It's
built automatically by the release script.

- **Layout:**
  - the Macloving logo at the top, large
  - the app and Applications side by side, with a dotted arrow between them
  - "Drag <App> to Applications"
  - "© <year> Macloving" at the bottom, with even space around it
- **Type:** only ITC Garamond (the headline) and Google Sans (small text), as on macloving.app. Never all caps.
- **Always light:** the window background is always light, so the logo always reads. Colourful icons tint it in
  their own colour. A black, grey or colourless icon gets a soft grey instead, never black.
- **Volume icon:** the app's own icon.
- **Rollout:** design changes reach each app at its next release. No app is re-released just for the installer.

## Releases

- **Never release unless the owner asks.** Only the app's own session, after the owner says "release it" or
  "release a beta" there, may release. A request passed along by another session doesn't count. Any other session
  must not run the release script, notarize, tag, bump the version or publish.
- **Before releasing:** everything is committed on `main` and the tests pass. If tests fail, stop and ask, unless
  the owner explicitly accepts the failures for that version.
- **Version:** fixes only are a patch (1.4.1); new features people will notice are minor (1.5.0); a redesign or a
  break with the past is major (2.0.0). Betas are `-beta.N`.
- **Notes:** two to six short lines in plain English about what changed for the user. They're added to
  CHANGELOG.md, used as the annotated tag message, and shown on the website and in the update window.
- **Running it:** the app's session runs `~/Documents/GitHub/Airly Studio/macloving-release/release.sh` on this Mac.
  It archives, signs with Developer ID, checks for Intel code, builds the designed DMG, notarizes and staples,
  signs for Sparkle, uploads and publishes. Betas go to the beta channel only.
- **Backup:** the GitHub workflow in `faisalibnislam/macloving-release` does the same. App repos never start it on
  tag push.
- **Website icon:** after a public release, the released app's icon automatically becomes its macloving.app listing
  icon. Betas and drafts don't change it. If an icon changes any other way, update the listing too.
- **New apps:** the website session sets up release for a new app on request: the Admin → Apps entry, the listing
  text from the README, and the pipeline. The page goes public after the first release, once it has at least one
  real screenshot (1000 px wide or more, sample data, no test badges or build numbers).

## Listing on macloving.app

- **Accurate:** every claim on a listing (features, permissions, network use, privacy) must match the app's code.
  Privacy is marked confirmed only when network and data handling have been checked in code.
- **No repeats:** never show the same information twice on a page. The sidebar already shows the macOS requirement
  and whether the app is free.
- **Feature icons:** each feature has a relevant icon, chosen in Admin or matched from the feature's name.

## Working on the apps

- **One session per app:** each app has its own Claude session.
- **Take turns:** never edit or build in a folder while another session is doing so.
- **Clean handover:** work on `main`, run the app's tests, and commit when done. Don't leave uncommitted changes
  for the next session.
- **Pushing:** push to GitHub only when the owner says so.
<!-- END USER APP RULES -->

## 13. Complete UI acceptance catalogue

All 120 rules from the Macloving Mac UI Rules Selection Checklist are approved and part of this skill. Treat them as required acceptance checks wherever applicable, not optional suggestions. Retain the rule IDs for findings and regression tracking; the former New/Expand labels and stars are no longer approval levels.

Apply these rules to existing or explicitly requested product capabilities. Do not add multiple windows, toolbar customization, table resizing, editing, menu-bar utilities, localization, or other features solely to satisfy a check. For a focused fix, assess the affected categories plus verification; for a whole-app audit, assess every category. Mark each assessed rule Pass, Fail, Not verified, or Not applicable with evidence or a short reason. Inclusion in this skill never means an app passed.

Read the relevant categories before implementation. Keep a coverage record for a whole-app audit so no category is silently skipped. Fix shared-component causes; recheck related callers. Use the existing work cycle and completion gate instead of duplicating their instructions in each finding. Preserve the owner's main-window profile, attached app policy, and current task scope when generic guidance differs.

The rules below are original Macloving QA requirements informed by the linked Apple guidance. The links provide context, not a claim that Apple mandates every sentence or project preference. Verify SDK availability against the actual project when implementing APIs.

### Categories

- Windows and lifecycle: W01–W06
- Resizing and density: R01–R06
- Geometry and spacing details: G01–G06
- Typography and localization: T01–T06
- Icons and images: I01–I06
- Toolbars and navigation: B01–B06
- Lists and tables: L01–L06
- Selection and interaction states: S01–S06
- Scrolling and pinned content: V01–V06
- Forms and precise controls: F01–F06
- Menus and keyboard commands: M01–M06
- Sheets popovers and dialogs: P01–P06
- Empty loading error and offline states: E01–E06
- Pointer and drag and drop: D01–D06
- Keyboard and accessibility: K01–K06
- Color materials and contrast: C01–C06
- Animation and responsiveness: A01–A06
- Editors canvases and timelines: X01–X06
- Settings utilities and menu bar apps: U01–U06
- Verification and regression checks: Q01–Q06

### Windows and lifecycle

- **W01** — Restore windows onto a connected display; recover safely when the saved monitor is missing.
- **W02** — Keep traffic lights, title, and toolbar clear during fullscreen, tiling, and title-bar appearance changes.
- **W03** — Distinguish Close, Minimize, Hide, and Quit; reopening a window should restore the intended app state.
- **W04** — Keep main, key, and inactive-window appearances correct when an auxiliary panel receives focus.
- **W05** — Keep multiple windows independent: selection, search, focus, and sheets must affect the intended window.
- **W06** — Open utility windows at content-appropriate sizes and positions; avoid unexplained giant blank areas.

Guidance: [windows](https://developer.apple.com/design/human-interface-guidelines/windows) · [designing for macos](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos).

### Resizing and density

- **R01** — Define which regions compress, wrap, scroll, or move to overflow before essential controls collide.
- **R02** — Check the entire supported resize range, including widths just before and after a layout changes.
- **R03** — Prevent layout oscillation: a wrapping label or scrollbar must not repeatedly trigger competing sizes.
- **R04** — Keep column minimums compatible with the window minimum; resizing must not trap content in inaccessible panes.
- **R05** — Preserve readable content widths on very wide windows instead of stretching every paragraph and control.
- **R06** — Treat native control density and effective hit areas separately; do not enlarge every visible control indiscriminately.

Guidance: [layout](https://developer.apple.com/design/human-interface-guidelines/layout) · [windows](https://developer.apple.com/design/human-interface-guidelines/windows).

### Geometry and spacing details

- **G01** — Align multiline labels by a deliberate first baseline or row center, rather than mixing both within one form.
- **G02** — Reserve stable space for changing counts, durations, badges, and progress labels so adjacent controls do not drift.
- **G03** — Distribute leftover grid width consistently; the last tile must not become visibly wider or more tightly padded.
- **G04** — Keep pop-up arrows, disclosure triangles, and trailing accessory slots aligned even when neighboring rows have no accessory.
- **G05** — Keep helper and error messages visually attached to their field; larger gaps should separate unrelated settings.
- **G06** — Check separator thickness, stroke placement, and corner seams on different display scales, including window movement between displays.

Guidance: [layout](https://developer.apple.com/design/human-interface-guidelines/layout) · [buttons](https://developer.apple.com/design/human-interface-guidelines/buttons).

### Typography and localization

- **T01** — Use stable-width numerals where changing times or measurements would otherwise make the interface wobble.
- **T02** — Test emoji, combining marks, mixed scripts, and fallback fonts for cropped ascenders, descenders, and broken baselines.
- **T03** — Test right-to-left layout using semantic leading/trailing alignment; mirror directional controls without mirroring logos or photographs.
- **T04** — Format dates, decimals, units, and plural counts for the locale; do not concatenate English-shaped fragments.
- **T05** — Preserve recognizable filename extensions and paths when truncating; provide full-value access without resizing the window.
- **T06** — Check placeholder, selected, disabled, and edited text for consistent metrics; avoid font substitutions that change control height.

Apply RTL mirroring according to meaning. Preserve media playback direction, time axes, physical coordinates, clocks, logos, and photographs when mirroring would change their meaning; test mixed-direction text and editable values.

Guidance: [typography](https://developer.apple.com/design/human-interface-guidelines/typography) · [right to left](https://developer.apple.com/design/human-interface-guidelines/right-to-left) · [text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields).

### Icons and images

- **I01** — Use the same symbol for the same action across toolbar, menu, inspector, and onboarding.
- **I02** — Normalize apparent icon scale across filled, outlined, and imported artwork without distorting aspect ratio.
- **I03** — Verify every symbol exists on the deployment target; missing symbols need an intentional fallback.
- **I04** — Load correctly scaled image assets; avoid blurry raster icons and stale cached app artwork.
- **I05** — Keep badges anchored to the visible icon and prevent them from touching nearby labels or clipping at corners.
- **I06** — Keep thumbnail aspect, fit/fill behavior, placeholder size, and loaded image size consistent.

Guidance: [sf symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols) · [buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) · [right to left](https://developer.apple.com/design/human-interface-guidelines/right-to-left).

### Toolbars and navigation

- **B01** — For native toolbars, use the system overflow behavior; avoid a second competing overflow control.
- **B02** — Keep labels and symbols grouped so two neighboring actions do not look like one combined button.
- **B03** — Keep toolbar customization and saved arrangements valid where supported; respect the fixed Macloving sidebar profile.
- **B04** — Choose whether a segmented control selects one option, selects several, or performs momentary actions; do not mix modes.
- **B05** — Keep navigation history, pane selection, and the displayed title synchronized after Back, Forward, and keyboard navigation.
- **B06** — Explain icon-only commands with meaningful accessibility labels and tooltips, including individual segments.

For the Macloving main window, keep the approved custom in-content top bar. Native toolbar overflow rules apply only to actual native toolbars. In the custom bar, adapt the available width deliberately and keep essential actions reachable without adding competing overflow controls.

Guidance: [toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) · [segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls).

### Lists and tables

- **L01** — Keep column headers, cells, separators, and resize handles aligned while horizontally scrolling.
- **L02** — Make sorting direction clear and repeatable; preserve the selected item when rows reorder.
- **L03** — Support useful column resizing and sensible minimum widths in data tables, where applicable.
- **L04** — Keep alternating row fills consistent after filtering, insertion, and reordering; selection must remain visually distinct.
- **L05** — Handle zero, one, and many rows intentionally; avoid orphaned separators or stripes extending into blank space.
- **L06** — Make rename/edit states fit the same row geometry, with predictable commit, cancel, and focus behavior.

Guidance: [lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables).

### Selection and interaction states

- **S01** — Define how row selection interacts with embedded buttons, checkboxes, and menus; one click must not trigger two actions.
- **S02** — Use expected Command-click and Shift-click behavior when multiple selection is supported.
- **S03** — Clear stale hover or pressed states after scrolling, opening a menu, switching windows, or moving the pointer out.
- **S04** — Show mixed values clearly in inspectors editing several objects; do not display a misleading single value.
- **S05** — Ensure context-menu actions target the indicated item or selection, not an unrelated previously selected row.
- **S06** — Keep selected states understandable when hover is elsewhere, the window is inactive, or the accent color changes.

Guidance: [focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection) · [lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables).

### Scrolling and pinned content

- **V01** — Test automatic and always-visible scrollbars; neither mode may cover text, resize columns unexpectedly, or clip controls.
- **V02** — Give each nested scroll region a clear purpose; avoid unpredictable wheel capture or competing scroll directions.
- **V03** — Keep pinned headers and footers from covering the first or last reachable item, including keyboard-focused items.
- **V04** — Maintain a useful scroll anchor when images load or rows are inserted; do not jump the reader unexpectedly.
- **V05** — Use scroll-edge effects only to separate floating controls from scrolling content; avoid decorative or duplicated haze.
- **V06** — Keep scroll-edge treatment aligned across adjacent panes when they share a header boundary.

Guidance: [scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views) · [layout](https://developer.apple.com/design/human-interface-guidelines/layout).

### Forms and precise controls

- **F01** — Give fields persistent labels; a disappearing placeholder must not be the only explanation.
- **F02** — Show actionable validation near the field without erasing entered data or shifting unrelated controls abruptly.
- **F03** — Allow valid intermediate editing states in numeric fields; apply locale-aware formatting without fighting the caret.
- **F04** — For precise values, pair a slider with an exact value entry or stepper when useful; keep them synchronized.
- **F05** — Make checkbox, radio, toggle, and pop-up behavior match the choice being made; distinguish preferences from immediate actions.
- **F06** — Indicate whether changes apply immediately or require Save; disable Save only for a clear reason.

Guidance: [text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields) · [sliders](https://developer.apple.com/design/human-interface-guidelines/sliders) · [buttons](https://developer.apple.com/design/human-interface-guidelines/buttons).

### Menus and keyboard commands

- **M01** — Keep command names, availability, and effects consistent between menu bar, toolbar, and context menu.
- **M02** — Use menu separators to group related commands; avoid empty groups and multiple adjacent separators.
- **M03** — Use ellipses when a command needs further input, rather than attaching them to every menu label.
- **M04** — Keep main-menu unavailable commands discoverable; use context-menu availability rules appropriate to the current target.
- **M05** — Avoid conflicting shortcuts and preserve standard editing commands, Undo/Redo, Find, and app-level commands.
- **M06** — Use consistent icon treatment within menu groups and keep submenu depth shallow.

Guidance: [menus](https://developer.apple.com/design/human-interface-guidelines/menus) · [context menus](https://developer.apple.com/design/human-interface-guidelines/context-menus).

### Sheets popovers and dialogs

- **P01** — Anchor popovers to the triggering control and keep them usable near screen edges or after window movement.
- **P02** — Avoid stacked or cascading popovers; switching between related popovers should not require unnecessary extra clicks.
- **P03** — Define dismissal clearly: Cancel, completion, outside click, and Escape must preserve or discard edits intentionally.
- **P04** — Attach a sheet to the correct parent window and leave other app windows usable where the platform allows.
- **P05** — Choose dialog size from content; keep explanation and actions reachable without covering the whole parent unnecessarily.
- **P06** — Make Return activate the intended safe default action; never accidentally make a destructive action the default.

Guidance: [sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) · [popovers](https://developer.apple.com/design/human-interface-guidelines/popovers) · [buttons](https://developer.apple.com/design/human-interface-guidelines/buttons).

### Empty loading error and offline states

- **E01** — Distinguish no data, no selection, no search results, loading, failure, and offline; each needs the right explanation.
- **E02** — Give empty states one useful next action and size them for their actual pane rather than the whole window.
- **E03** — Use real progress when measurable and an honest waiting state otherwise; never fabricate a percentage.
- **E04** — Keep loading placeholders close to final content geometry to prevent large layout jumps.
- **E05** — Show retries, cancellation, and recovery where useful; preserve prior content and input after a recoverable failure.
- **E06** — Prevent duplicate submissions and contradictory success/error messages when operations finish out of order.

Guidance: [loading](https://developer.apple.com/design/human-interface-guidelines/loading) · [progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators) · [layout](https://developer.apple.com/design/human-interface-guidelines/layout).

### Pointer and drag and drop

- **D01** — Make the visible control and its hit area agree; remove dead spots and overlapping targets.
- **D02** — Use appropriate resize, text, drag, copy, and forbidden cursors; restore the normal pointer when the context changes.
- **D03** — Show one clear valid drop target or insertion marker, and remove it when dragging leaves or is canceled.
- **D04** — Make the drag preview recognizable and correctly offset; avoid sudden jumps away from the pointer.
- **D05** — Support controlled edge autoscroll during dragging, with copy/move feedback matching the final operation.
- **D06** — Keep dragging, resizing, clicking, and text selection from fighting over the same interaction region.

Guidance: [drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop) · [buttons](https://developer.apple.com/design/human-interface-guidelines/buttons).

### Keyboard and accessibility

- **K01** — Test keyboard navigation with the relevant system access settings; focused controls must remain visible and reachable.
- **K02** — Restore focus to the triggering control after a sheet or popover closes; choose a sensible neighbor after deleting an item.
- **K03** — Prevent background refresh from stealing text-field focus or moving the insertion point.
- **K04** — Expose correct accessibility names, values, states, and grouping; decorative icons must not create duplicate announcements.
- **K05** — Provide a keyboard alternative to dragging and custom pointer-only gestures where the task requires them.
- **K06** — Announce meaningful status and validation changes without announcing every animation frame or progress tick.

Guidance: [accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) · [focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection).

### Color materials and contrast

- **C01** — Check non-default accent colors and increased contrast, not just the app's usual blue selection.
- **C02** — Pair color-coded meaning with a label, shape, or symbol so state remains understandable without color.
- **C03** — Test translucent controls over bright, dark, detailed, and moving backgrounds, not only a plain desktop.
- **C04** — Keep enabled secondary actions distinguishable from disabled controls; excessive dimming must not imply the wrong state.
- **C05** — Avoid material or color flashes when changing appearance, activating a window, or restoring it.
- **C06** — Check elevated surfaces, menus, and mixed AppKit/SwiftUI content for coherent appearance and contrast.

Guidance: [color](https://developer.apple.com/design/human-interface-guidelines/color) · [materials](https://developer.apple.com/design/human-interface-guidelines/materials) · [accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).

### Animation and responsiveness

- **A01** — Keep feedback immediate even if the underlying task is slow; animation must not delay accepting the next action.
- **A02** — Make entering and exiting motion preserve spatial relationships; views should not appear to come from unrelated places.
- **A03** — Avoid hover animation that restarts continuously while moving across a control's internal subviews.
- **A04** — Check changing content during transitions: text, clipping, corners, and shadows must remain coherent between endpoints.
- **A05** — Pause unnecessary offscreen animation and expensive decorative work; measure impact on actual interaction.
- **A06** — Test launch, wake, and restore for blank flashes, stale layers, and controls that become usable late.

Guidance: [motion](https://developer.apple.com/design/human-interface-guidelines/motion) · [loading](https://developer.apple.com/design/human-interface-guidelines/loading).

### Editors canvases and timelines

- **X01** — Keep selection overlays and resize handles aligned after canvas rotation, zoom, scrolling, and backing-scale changes.
- **X02** — Keep timeline ruler labels legible at different zoom levels; adjust tick density instead of overlapping labels.
- **X03** — Reserve space for clip trim handles, lane controls, and selected outlines at the first and last visible positions.
- **X04** — Keep thumbnails and waveforms inside the correct lane and synchronized with duration changes.
- **X05** — Keep zoom centered on the intended anchor, such as the pointer or playhead, without unexpected viewport jumps.
- **X06** — Show disabled editing actions and mixed inspector values correctly when nothing, one object, or several objects are selected.

Guidance: [sliders](https://developer.apple.com/design/human-interface-guidelines/sliders) · [drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop) · [layout](https://developer.apple.com/design/human-interface-guidelines/layout).

### Settings utilities and menu bar apps

- **U01** — Keep Settings navigation and search behavior consistent; switching panes must not create accidental window-size jumps.
- **U02** — Show dependencies between settings clearly; disabled options should make their reason understandable.
- **U03** — Keep menu-bar utility icons recognizable across light/dark backgrounds, selection, and supported display scales.
- **U04** — Reposition utility popovers correctly when displays change; avoid detached panels opening offscreen.
- **U05** — Keep permission status current after returning from System Settings; show restart requirements only when real.
- **U06** — Keep status counts, badges, and app/Dock indicators consistent with the current app state.

Guidance: [windows](https://developer.apple.com/design/human-interface-guidelines/windows) · [popovers](https://developer.apple.com/design/human-interface-guidelines/popovers) · [menus](https://developer.apple.com/design/human-interface-guidelines/menus).

### Verification and regression checks

- **Q01** — Test permission, membership, and feature-flag states for missing controls that leave broken spacing or inaccessible actions.
- **Q02** — Include realistic stress data: empty values, huge counts, long names, slow images, failed requests, and mixed scripts.
- **Q03** — Compare screenshots at the same window size, appearance, content, focus state, and display scale.
- **Q04** — Separate unavoidable system rendering differences from regressions; review changed visual baselines before accepting them.
- **Q05** — Test mouse, trackpad, and keyboard paths, plus other input methods the product actually supports.
- **Q06** — Test text composition with input methods; do not submit, run shortcuts, or destroy marked text while someone is composing.

Guidance: [accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) · [windows](https://developer.apple.com/design/human-interface-guidelines/windows) · [layout](https://developer.apple.com/design/human-interface-guidelines/layout).

## 14. Dedicated Macloving onboarding rules

Read these complete owner rules for onboarding work. They supplement the base app rules in section 12; section 6 explains implementation and version reconciliation. Preserve their next-release timing and owner screenshot approval gate.

<!-- BEGIN USER ONBOARDING RULES -->
# Macloving onboarding rules

Owner decisions of 2026-11-08. They apply to every current and future Macloving app.

## When

- Redo each app's first-run onboarding as part of its next release, before running the release steps.
- Send the owner screenshots of every onboarding page in light and dark mode, and wait for the OK. Never ship
  onboarding the owner hasn't seen.

## Template

- Build it with the shared template in MaclovingKit: the product `MaclovingOnboarding` (kit 0.4.0 or later; 0.5.0
  adds the logo in the About window).
- The app supplies only its pages' content. The kit handles the window, layout, keyboard, VoiceOver, showing once,
  and the Help menu item.
- Page types:

  | Page | Use it for |
  | --- | --- |
  | Welcome | The first page: the app's icon, what the app does, up to three highlights |
  | Features | How it works: SF Symbol rows, optionally a real screenshot of the app |
  | Permission | One macOS permission: why it's needed, Open System Settings, live status |
  | Choices | A few switches for the app's settings (open at login, menu bar) |
  | Shortcut | The app's keyboard shortcut as key caps, optionally with the app's own recorder |
  | Custom | The app's own content under the standard title (a first snippet, a folder picker) |
  | Done | The last page: how to start, and where things are |

- How to adopt it is in the MaclovingKit README, section "Onboarding (MaclovingOnboarding)".

## Icon

- Always the app's real, current icon, read from its own bundle (`NSApp.applicationIconImage`).
- Never a copied, old or placeholder image of it.

## Type

- The system font (SF), native Mac, with a clear hierarchy: one title per page and short body text.
- Bundle no fonts for onboarding. The exception is a non-native app's own fonts (see below).

## Content

- Few pages, usually two to four. Each page has one job:
  - what the app does
  - the one or two things to set up (a permission, a shortcut, a folder)
  - how to start
- Plain, specific words: no hype, no filler, no em dashes.
- Don't repeat on one page what another page or the app already says.

## Permissions

- Explain why in one sentence.
- Offer a button that opens the right System Settings pane.
- Show the live status ("Not allowed yet" or "Allowed"). It updates on its own.
- Never block the app on an optional permission. An optional permission's button reads "Not Now" until it's granted.

## Look

- Consistent spacing and alignment, and native controls.
- Real screenshots or SF Symbols, never stock illustrations.
- No gradient blobs, no emoji, no fake 3D, no centred walls of text.
- Works in light and dark mode, with larger text, and with VoiceOver.

## Keyboard and flow

- Return continues, Esc skips (where skipping is allowed), ⌘[ goes back.
- Always skippable, unless a step is truly required for the app to work.
- Shows once.
- Can be reopened from the Help menu (Help › Welcome to <App>) or from Settings.

## Apps with a non-native design

Some apps are designed without native macOS UI. Judge from the app's own UI: if its main windows use custom fonts,
colours and controls, its onboarding follows the app's look instead of the native one.

- It still uses the `MaclovingOnboarding` template. It passes its own fonts, colours, buttons and background
  through `OnboardingStyle`, in both light and dark mode.
- It may use the fonts the app already ships, but adds no new fonts just for onboarding.
- Every other rule above still applies:
  - real icon from the bundle
  - few pages, one job each
  - permission pages with live status
  - keyboard and VoiceOver
  - light and dark mode
  - skippable, shown once, reopenable
  - screenshot review
  - no gradient blobs, emoji or stock art

## Screenshot review

- `MaclovingOnboarding.writeSnapshots(to:pages:)` renders every page to light and dark PNG files.
- Call it from the running app (for example behind a DEBUG launch argument), so the window is active and controls
  draw in their real colours.
- The approved reference screenshots of the template are in the shared notes folder, under `onboarding-review/`.
<!-- END USER ONBOARDING RULES -->