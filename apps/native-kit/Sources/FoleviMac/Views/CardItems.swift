// A screen's own controls in the card's glass controls (the owner, 2026-11-18, references 4 and 7): the screen on
// show hands CardControls its items, which it draws before the search capsule, each group its own glass capsule:
//
//   (+)  All notes  12  ..................  (▦ ▤ ☰)  (⇅ ˅)  (…)  (🔍 ˅)
//
// A screen describes its items with `.cardItems(key:)`; ScreenRoot gives it the slot (the frame and the screen's tab
// key) on the Mac's native look only, so the iPad's layout, which builds the same screens, never has one and keeps
// its controls in the screen. A screen with a slot leaves those controls out of its own header rows.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign
#if os(macOS)
import AppKit
#endif

/// One choice of a segmented group (a layout, a calendar view, a Tasks view).
struct CardOption: Identifiable {
    let id: String
    let title: String
    /// Drawn instead of the title in the capsule (a layout's symbol); the title stays its name and tooltip.
    var symbol: String? = nil
    var count: Int? = nil
}

#if os(macOS)
typealias CardAnchor = NSView
#else
typealias CardAnchor = UIView
#endif

/// One group of the card's controls, its own glass capsule.
struct CardGroup: Identifiable {
    enum Kind {
        /// A segmented choice: a glass segmented capsule; a pull-down where room is short.
        case segmented(options: [CardOption], selected: String, pick: @MainActor (String) -> Void)
        /// A pull-down (Sort: its symbol and a small chevron), opening a system menu.
        case pullDown(symbol: String, entries: @MainActor () -> [WebMenuEntry])
        /// One action: a glass round button (Add task, New folder, Calendars). It gets its own view to anchor a
        /// popover to (the "…" menu's, once it's folded in there).
        case button(symbol: String, badge: Bool, action: @MainActor (CardAnchor?) -> Void)
        /// The screen's secondary actions: "…", opening a system menu.
        case more(entries: @MainActor () -> [WebMenuEntry])
        /// A few related actions in one glass capsule (the calendar's ‹ Today ›).
        case actions([CardOption], run: @MainActor (String) -> Void)
    }

    let id: String
    /// Its accessible name and the menu heading it takes when folded into "…".
    let label: String
    /// Its tooltip (with the shortcut, where there is one).
    var help: String? = nil
    let kind: Kind

    static func segmented(_ id: String, _ label: String, _ options: [CardOption], selected: String, help: String? = nil, pick: @escaping @MainActor (String) -> Void) -> CardGroup {
        CardGroup(id: id, label: label, help: help, kind: .segmented(options: options, selected: selected, pick: pick))
    }

    static func pullDown(_ id: String, _ label: String, symbol: String, help: String? = nil, entries: @escaping @MainActor () -> [WebMenuEntry]) -> CardGroup {
        CardGroup(id: id, label: label, help: help, kind: .pullDown(symbol: symbol, entries: entries))
    }

    static func button(_ id: String, _ label: String, symbol: String, help: String? = nil, badge: Bool = false, action: @escaping @MainActor (CardAnchor?) -> Void) -> CardGroup {
        CardGroup(id: id, label: label, help: help, kind: .button(symbol: symbol, badge: badge, action: action))
    }

    static func actions(_ id: String, _ label: String, _ options: [CardOption], run: @escaping @MainActor (String) -> Void) -> CardGroup {
        CardGroup(id: id, label: label, kind: .actions(options, run: run))
    }

    static func more(_ label: String = "More", entries: @escaping @MainActor () -> [WebMenuEntry]) -> CardGroup {
        CardGroup(id: "more", label: label, help: label, kind: .more(entries: entries))
    }

    /// A sort pull-down: the choices checked, the current one ticked.
    @MainActor static func sort<T: Hashable>(_ options: [(T, String)], value: T, set: @escaping @MainActor (T) -> Void) -> CardGroup {
        .pullDown("sort", "Sort", symbol: "arrow.up.arrow.down", help: "Sort: \(options.first { $0.0 == value }?.1 ?? "")") {
            [WebMenuEntry.heading("Sort by")] + options.enumerated().map { i, o in
                WebMenuEntry(.item(o.1, checked: o.0 == value, id: "sort.\(i)")) { set(o.0) }
            }
        }
    }
}

/// What a screen hands the card's controls.
struct CardItems {
    /// Secondary text after the page title ("12", "Today · 3 open").
    var subtitle: String? = nil
    /// Controls right after the title (the calendar's ‹ Today ›).
    var leading: [CardGroup] = []
    /// The screen's controls, before the search capsule.
    var trailing: [CardGroup] = []
}

/// Where a screen's card items go: the frame and the screen's tab key. Set by ScreenRoot on the Mac's native look.
struct CardSlot {
    weak var frame: FrameModel?
    let owner: String
}

extension EnvironmentValues {
    @Entry var cardSlot: CardSlot? = nil
}

extension View {
    /// Hands the card's controls this screen's items whenever `key` (everything the items show) changes.
    func cardItems<K: Equatable>(key: K, _ make: @escaping @MainActor () -> CardItems) -> some View {
        modifier(CardItemsModifier(key: key, make: make))
    }
}

private struct CardItemsModifier<K: Equatable>: ViewModifier {
    let key: K
    let make: @MainActor () -> CardItems
    @Environment(\.cardSlot) private var slot

    func body(content: Content) -> some View {
        content
            .onAppear { push() }
            .onChange(of: key) { push() }
    }

    private func push() {
        #if os(macOS)
        guard let slot, let frame = slot.frame else { return }
        frame.cardItems[slot.owner] = make()
        #endif
    }
}
#endif

#if os(macOS)
// MARK: - Drawing them (CardControls)

/// How much room the card's controls have: everything as it is; segmented groups as pull-downs; or all of it in
/// one "…" menu (the search capsule always stays).
enum CardFit: CaseIterable {
    case full, compact, folded
}

/// A screen's groups, each its own glass capsule, at a fit.
struct CardGroupsView: View {
    let groups: [CardGroup]
    let fit: CardFit

    var body: some View {
        if fit == .folded {
            if !groups.isEmpty { CardMenuButton(label: "More", help: "More", symbol: "ellipsis", chevron: false) { anchor in Self.folded(groups, anchor: anchor) } }
        } else {
            ForEach(groups) { g in group(g) }
        }
    }

    @ViewBuilder private func group(_ g: CardGroup) -> some View {
        switch g.kind {
        case .segmented(let options, let selected, let pick):
            if fit == .full {
                CardSegmented(label: g.label, options: options, selected: selected, pick: pick)
            } else {
                let current = options.first { $0.id == selected }
                CardMenuButton(label: g.label, help: "\(g.label): \(current?.title ?? "")", symbol: current?.symbol, title: current?.symbol == nil ? current?.title : nil, chevron: true) { _ in
                    Self.choices(options, selected: selected, pick: pick)
                }
            }
        case .pullDown(let symbol, let entries):
            CardMenuButton(label: g.label, help: g.help ?? g.label, symbol: symbol, chevron: true) { _ in entries() }
        case .button(let symbol, let badge, let action):
            CardActionButton(label: g.label, help: g.help ?? g.label, symbol: symbol, badge: badge, action: action)
        case .more(let entries):
            CardMenuButton(label: g.label, help: g.help ?? g.label, symbol: "ellipsis", chevron: false) { _ in entries() }
        case .actions(let options, let run):
            CardSegmented(label: g.label, options: options, selected: "", pick: run)
        }
    }

    /// A segmented group's choices as menu items, the current one ticked.
    static func choices(_ options: [CardOption], selected: String, pick: @escaping @MainActor (String) -> Void) -> [WebMenuEntry] {
        options.map { o in
            WebMenuEntry(.item(o.count.map { $0 > 0 ? "\(o.title)  \($0)" : o.title } ?? o.title, checked: o.id == selected, id: "choice.\(o.id)")) { pick(o.id) }
        }
    }

    /// Every group in one menu: a heading for each, its choices, entries or action.
    static func folded(_ groups: [CardGroup], anchor: CardAnchor?) -> [WebMenuEntry] {
        var out: [WebMenuEntry] = []
        var actions: [WebMenuEntry] = []
        for (i, g) in groups.enumerated() {
            switch g.kind {
            case .segmented(let options, let selected, let pick):
                out.append(.separator(i))
                out.append(.heading(g.label))
                out += choices(options, selected: selected, pick: pick)
            case .pullDown(_, let entries):
                out.append(.separator(i))
                let e = entries()
                if e.first?.item.kind != .heading { out.append(.heading(g.label)) }
                out += e
            case .button(_, _, let action):
                actions.append(WebMenuEntry(.item(g.label, id: "action.\(g.id)")) { action(anchor) })
            case .more(let entries):
                out.append(.separator(i))
                out += entries()
            case .actions(let options, let run):
                out.append(.separator(i))
                out += options.map { o in WebMenuEntry(.item(o.title, id: "action.\(g.id).\(o.id)")) { run(o.id) } }
            }
        }
        if !actions.isEmpty { out = actions + [.separator(999)] + out }
        return out
    }
}

/// A segmented choice as a glass capsule: each choice a capsule inside it, the chosen one filled.
struct CardSegmented: View {
    let label: String
    let options: [CardOption]
    let selected: String
    let pick: @MainActor (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options) { o in
                let on = o.id == selected
                Button { pick(o.id) } label: {
                    Group {
                        if let symbol = o.symbol {
                            MacSymbol(symbol, size: 14, weight: .medium)
                        } else {
                            HStack(spacing: 5) {
                                Text(o.title).font(on ? MacLook.Text.body.weight(.semibold) : MacLook.Text.body)
                                if let n = o.count, n > 0 {
                                    Text("\(n)").font(MacLook.Text.small).monospacedDigit().foregroundStyle(MacLook.Colors.secondary)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, o.symbol == nil ? 12 : 10)
                    .frame(minWidth: 30, minHeight: MacLook.barControlHeight - MacLook.capsuleInset * 2)
                    .background { if on { Capsule().fill(MacLook.Colors.selection) } }
                    .contentShape(Capsule())
                }
                .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule()), active: !on))
                .foregroundStyle(MacLook.Colors.label)
                .foleviTooltip(o.title)
                .accessibilityLabel(o.title)
                .accessibilityValue(o.count.map { "\($0)" } ?? "")
                .accessibilityAddTraits(on ? [.isSelected] : [])
            }
        }
        .padding(.horizontal, MacLook.capsuleInset)
        .frame(height: MacLook.barControlHeight)
        .glassEffect(.regular.interactive(), in: .capsule)
        .fixedSize()
        .cardHitRegion()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

/// A glass capsule opening a system menu under it: a symbol (or a short title) and, for a pull-down, a small chevron.
struct CardMenuButton: View {
    let label: String
    let help: String
    var symbol: String?
    var title: String? = nil
    let chevron: Bool
    let entries: @MainActor (CardAnchor?) -> [WebMenuEntry]
    @State private var anchor: NSView?

    var body: some View {
        Button {
            guard let anchor else { return }
            WebMenuWindow.show(entries(anchor), width: 220, below: anchor, align: .end)
        } label: {
            HStack(spacing: 4) {
                if let symbol { MacSymbol(symbol, size: 14, weight: .medium) }
                if let title { Text(title).font(MacLook.Text.body.weight(.medium)) }
                if chevron { MacSymbol("chevron.down", size: 9, weight: .semibold).foregroundStyle(MacLook.Colors.secondary) }
            }
            .padding(.horizontal, chevron || title != nil ? 13 : 0)
            .frame(minWidth: MacLook.barControlHeight, minHeight: MacLook.barControlHeight)
            .background(MenuAnchor { anchor = $0 })
            .contentShape(Capsule())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Capsule())))
        .foregroundStyle(MacLook.Colors.label)
        .glassEffect(.regular.interactive(), in: .capsule)
        .fixedSize()
        .cardHitRegion()
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }
}

/// A glass round button for one action, with the view it's in for anything it opens beside it.
struct CardActionButton: View {
    let label: String
    let help: String
    let symbol: String
    var badge = false
    let action: @MainActor (CardAnchor?) -> Void
    @State private var anchor: NSView?

    var body: some View {
        Button { action(anchor) } label: {
            MacSymbol(symbol, size: 15, weight: .medium)
                .frame(width: MacLook.barControlHeight, height: MacLook.barControlHeight)
                .background(MenuAnchor { anchor = $0 })
                .overlay(alignment: .topTrailing) {
                    // (Something needs a look: a subscribed calendar that fails to load.)
                    if badge { Circle().fill(MacLook.Colors.red).frame(width: 7, height: 7).padding(7) }
                }
                .contentShape(Circle())
        }
        .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
        .foregroundStyle(MacLook.Colors.label)
        .glassEffect(.regular.interactive(), in: .circle)
        .cardHitRegion()
        .foleviTooltip(help)
        .accessibilityLabel(label)
    }
}
#endif
