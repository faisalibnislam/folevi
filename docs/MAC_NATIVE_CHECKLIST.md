# Folevi for Mac: native UI checklist (2026-11-18)

Where the Mac app already uses native SwiftUI, AppKit and Liquid Glass, where it still draws its own and could go
native, and where it can't. Asked for by the owner on 2026-11-18, during the polish pass on branch
`mac-native-look` (`docs/MAC_NATIVE_LOOK.md` has the look's rules). Made from a read of the code; file references
are under `apps/native-kit/Sources/FoleviMac/Views/` unless they say otherwise.

- `[x]` native today
- `[ ]` custom today, a native part would fit (effort S, M or L; risk in words)
- `[-]` stays custom, with the reason

Icons are a rule of their own: the owner asked for Folevi's web icons everywhere the web has one (so web and Mac
match) and the Foli AI flower for Foli AI. So "native" below never means SF Symbols; `MacSymbol`
(`Look/MacLookComponents.swift`) draws Folevi's icon for a symbol name and the system's only where Folevi has none.

## 1. Window frame

- [x] Window, traffic lights, translucent material (`NSWindow`, `NSVisualEffectView` `.sidebar`).
- [x] Title bar strip buttons, tabs, the + and the bell: SwiftUI on the material, system font, quiet hover.
- [x] The open tab: Liquid Glass capsule.
- [x] Tab context menu: `NSMenu`.
- [-] Tabs as `NSWindow` tabs: no. Each system tab is its own window and engine; Folevi's joined notes, pinned
  icon tabs, per-place and folder tabs, per-tab Back and Forward, pictures and the Tab Overview have no system
  equivalent (owner decision).
- [-] The strip as an `NSToolbar`: no. The tabs would be one custom toolbar item, and dragging, hit testing and
  the traffic lights' place would all need redoing (L, high risk, no visible gain).
- [x] Sidebar rows, headings, footer: SwiftUI, system font, system colours.
- [-] Sidebar as `List(.sidebar)` or `NavigationSplitView`: no, by the owner's Mac UI guide (a drawn scroll view,
  so the material is continuous with the card's margins and the folder tree keeps its own drag and drop).
- [ ] Sidebar account button and folder sort as SwiftUI `Menu` (they already open an `NSMenu`; only the trigger
  is custom). S, low.
- [-] The content card: a drawn rounded surface. It is the owner's two-layer window profile; no system part.
- [x] The card's controls: Liquid Glass in one `GlassEffectContainer`.
- [ ] The card's glass buttons as `.buttonStyle(.glass)` and its segmented groups as `Picker(.segmented)` in
  glass. S to M, low (the segments' count badges would go).
- [ ] The card's search as an `NSSearchField` in the glass capsule. S to M. (`.searchable` needs a system toolbar,
  which can't live in the card.)
- [ ] The scroll edge effect as `.scrollEdgeEffectStyle(.soft, for: .top)` on the SwiftUI screens instead of the
  masked `NSVisualEffectView` (`ScrollEdgeBand`, `FrameViews.swift`). M. Not possible over the web note.
- [ ] Note inspector: its tab picker as `Picker(.segmented)` (S, loses the unread dot), its Find field as
  `NSSearchField` (S), its task ticks as `Toggle(.checkbox)` (S), its contents as `List` or `OutlineGroup` (M).
- [-] The inspector as SwiftUI `.inspector`: no. It needs a SwiftUI scene or a split view item, and the note
  page's own panel shares that column (L, high risk).
- [ ] Scroll bars follow System Settings: today `MacScrollers.useOverlay` forces "when scrolling"
  (`FoleviDesign/Web/MacScrollers.swift`). S, but it was the owner's own request on 2026-10-29: owner's call.
- [ ] Tooltips as the system's (`.help`, `NSView.toolTip`) instead of `foleviTooltip` (94 call sites, one choke
  point). S to M. It is already drawn like the system's; going native loses the shortcut key cap and its timing,
  and a standing owner rule says "always use our native tooltip": owner's call.
- [ ] Tab preview under the pointer as an `NSPopover`. M, medium risk (flicker moving between tabs).
- [ ] Tab Overview: `NSSearchField`, system buttons. M. Its grid of pages has no system equivalent.

## 2. Menus and popovers

- [x] Menu bar, Dock menu, menu bar item: `NSMenu`.
- [x] Every row menu, context menu, the account menu, folder and tag menus, sort menus: `NSMenu`
  (`WebMenus.swift` builds them), with the system Share submenu.
- [x] Sync popover: `NSPopover` with system parts.
- [ ] Select triggers drawn by Folevi over an `NSMenu` (`PlannerSelect`, `WebBareSelect`, `VaultSelect`,
  `FieldSelect`, about 25 places) as `Picker(.menu)`. S each, low.
- [ ] Notifications popover content (All and Unread tabs, Accept and Decline, empty state) as
  `Picker(.segmented)`, system buttons and `ContentUnavailableView`. M, low.
- [ ] Calendar's, the date's, the time's and the time zone's popovers (`PlannerPanel`, a borderless panel) as
  `NSPopover`. M, medium risk (focus and the month grid's keys).

## 3. Sheets, dialogs, alerts, palette, toasts

- [x] Sheets: real window sheets (`beginSheet`), Escape, Return and Command-period handled.
- [x] Sheet and screen push buttons: the system's, one size (large, 28 pt), one shape (capsule).
- [x] Move or copy notes: `Picker`, `ProgressView`.
- [x] Settings confirmations: `NSAlert`.
- [x] Toasts: Liquid Glass capsule. (macOS has no system toast.)
- [ ] One prominent button style: three exist today (`.borderedProminent` with a tint, `MacProminentButtonStyle`,
  `NativeAccentButtonStyle`). They now share a size and shape; merging the code is S. `.glassProminent` is an
  option if the black and white accent reads well on it.
- [ ] Delete and discard confirmations in the main window as `NSAlert` sheets (they are drawn sheets today). S to
  M, low.
- [ ] The dialogs' own Close button: sheets normally have none. S.
- [ ] Folder picker (Move folder): `NSSearchField` and `List` or `OutlineGroup`. M.
- [ ] Sharing dialog: role as `Picker(.menu)`, switches as `Toggle(.switch)`, lists as `Form(.grouped)`. M.
- [ ] Planner dialogs (edit task, add task): real sheets instead of `PlannerPanel.dialog`, dates and times as
  `DatePicker`. M. `DatePicker` can't hold "no date", so it needs a Clear.
- [ ] Vault dialogs as real sheets. M.
- [-] Folder colour: a fixed 25-colour grid. `ColorPicker` picks any colour, which the folder palette doesn't
  allow.
- [-] Command palette: no system palette exists. It is already system type with `Picker(.menu)` filters; its
  result list could become `List(selection:)` (M, medium risk for the keyboard).

## 4. Screens in the card

- [x] Every screen's title, section titles, headings, body text: the system font in four sizes.
- [x] Text fields, checkboxes, push buttons through the shared components (`WebButton`, `WebTextField`,
  `WebCheckboxStyle` under `NativeChrome`).
- [x] Folders and Tags search: `NSSearchField`.
- [x] Multi-select bar: Liquid Glass capsule.
- [ ] Empty states (about 32 places: `WebEmptyState`, `MoreEmptyState`, `PlannerEmpty`, `VaultEmpty`) as
  `ContentUnavailableView`. S each.
- [ ] List layouts (All notes, Folders, Shared, Changes, Vault lists, the Graph's List) as `Table` with sortable
  columns. M to L, medium risk (multi-selection drag, the hover menus).
- [ ] Task tick as `Toggle(.checkbox)`. S. The priority colours on the tick would go.
- [ ] Vault: passcode fields as `SecureField`, its tabs as `Picker(.segmented)`, its selects as `Picker(.menu)`.
  M to L.
- [ ] Foli DNA: its tool buttons and zoom controls as glass buttons (they float over the map), filters as
  `Picker(.menu)`, search as `NSSearchField`, steppers as `Stepper`. M to L, low to medium.
- [ ] Reviews' rating buttons as system buttons with shortcuts. S.
- [ ] Help's shortcut list as `Form(.grouped)` or `Table`. M.
- [ ] Spinners as `ProgressView` where the web's arc is still drawn (Foli AI). S.
- [-] Note and folder cards: Folevi's content. They keep Folevi's fonts and art (see the open question below).
- [-] Calendar's month and week grids: no stock calendar grid in SwiftUI or AppKit.
- [-] The Vault's inverted theme (dark in a light window): a Folevi feature. The card's chrome now follows it.
- [-] Foli DNA's map: a drawn canvas.
- [-] Foli AI's thread (Markdown, streaming, change cards): a Folevi feature.

## 5. Settings window

- [x] Its own `NSWindow`, an `NSSearchField`, `Toggle(.switch)`, `Picker(.menu)`, `Picker(.segmented)`, `Slider`,
  rounded text fields, checkboxes, `ProgressView`, `NSOpenPanel`, `NSAlert`.
- [ ] Groups as `Form { Section }.formStyle(.grouped)` with `LabeledContent` instead of the drawn `FormGroup` and
  `FormRow` (58 cards). M to L, medium risk (the search's highlight anchors).
- [ ] Category list as `List(.sidebar)`. M.
- [ ] Time zone picker: `NSPopover`, `List`, `NSSearchField`. M.
- [-] Shortcut recorder: no stock recorder control.

## 6. Other windows

- [x] Migration window, updates (Sparkle's own), save and open panels, download alerts.
- [x] Quick Add: system type, `Picker(.segmented)` priority, `Picker(.menu)` place. Its icons are Folevi's.
- [ ] Quick Add's date and time as `DatePicker` in `NSPopover`. M.
- [ ] Sign-in, first launch, library setup, locked library (`WebGateScreen`): now system font; still drawn buttons,
  fields and switch. `Form`, `SecureField`, the system's Sign in with Apple button: M to L, medium risk (every
  button drives the web page behind it).
- [-] Quick Add's parsing chips ("tomorrow 9am"): no system equivalent.

## 7. The note page (web)

Native around it: the title bar strip, the sidebar, Back and Forward in glass, the inspector, toasts.

- [ ] The floating bar at the page's foot (Foli AI, Insert, Format, Style, Share, more) as a Liquid Glass capsule
  drawn natively over the page. This is the clearest place left for glass. L, medium to high risk (it must keep
  the editor's selection on a click, and follow joined notes and the compact mode).
- [ ] The note's "..." menu as `NSMenu` (`NoteMenu.build` already exists, unused). S to M.
- [ ] Share from an open note through the native share sheet (lists already use it; a note opens the web's). M.
- [ ] Export, Move, Version history as sheets. M to L each.
- [ ] The editor's right-click menu as `NSMenu` through the bridge. L.
- [-] The editor, the slash menu, the selection bubble, block handles, comments anchored to blocks, live carets,
  the Style, Format and Insert panels: bound to the editor's state and the note's own fonts. They stay web.

## 8. Liquid Glass

Where it is now: the open tab, the card's controls (Back, Forward, a screen's own controls, search), Ask Foli AI's
button, the multi-select bar, toasts.

Where it fits next (controls floating over content), in the order of what you'd see most:

1. The note's floating bar (section 7).
2. Foli DNA's zoom controls, tool row, selection bar and time-lapse bar.
3. The floating Foli AI chat's surface and its composer.
4. The Tab Overview's search field and Done.
5. Home's carousel arrows and a card's hover "..." chip.
6. The floating note window's pin.

Where it must not go (Apple's rule: glass is the navigation layer, never the content): note and folder cards, list
rows, the card itself, the inspector's rows, Settings groups, sheet bodies, the Vault's canvas, the calendar grid,
chat messages.

## 9. Open questions for the owner

1. **Note and folder cards' fonts.** "System fonts throughout the app, any font in the editor" (2026-11-18) was
   applied to all interface text. Note cards and folder cards still show Spectral and Instrument Sans, because
   they are small pictures of notes and the earlier decision the same day kept them. Say the word and they become
   the system font too.
2. **Tooltips and scroll bars**: both are custom by earlier owner rules (see section 1).
3. **Sidebar as a floating glass panel** (macOS 26's own sidebars are): it would replace the two-layer profile of
   the owner's Mac UI guide. Not done; worth a mockup if wanted.

## 10. Found on the way

- `SidebarViewController.swift` (the old `NSOutlineView` sidebar), `TabStripView.swift`, `HoverButton`,
  `NoteMenu.build`, `TopBar`, `BarGroup` and `BarIconButton` look unused. Not removed in this pass.
- A Folevi struct named `ColorPicker` (`Planner/CalendarSubscriptions.swift`) hides SwiftUI's.
