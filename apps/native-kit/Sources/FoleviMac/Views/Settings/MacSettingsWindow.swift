// The Mac's Settings window in the native look (docs/MAC_NATIVE_LOOK.md; the owner's guide, "Required Macloving
// Settings window style"): its own window with real traffic lights, a translucent category list on the left with a
// working search field under the traffic lights, the open category's compact title at the top of the right pane
// (in line with the traffic lights), and its grouped native controls in a readable column below. The list and the
// page scroll on their own. No sidebar toggle, no header band, no row of category icons.
//
// The app (apps/mac SettingsWindow) owns the NSWindow, gives it this look (MacSettingsWindowStyle) and hosts
// MacSettingsShell with the page: MacSettingsNativePane (the sections, on the front main window's engine), or the
// web page while no main window has the native frame.
//
// The iPad's wide layout shows the same shell in a large form sheet (IPadSettings.swift, the owner, 2026-11-19: "on
// iPad a sheet or full-screen settings with a category list"), its search field a SwiftUI one.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine

// MARK: - Categories

/// One row of the category list: a section, or an action (Help, Contact support).
public struct MacSettingsCategory: Hashable, Identifiable, Sendable {
    public var id: String
    public var title: String
    /// An SF Symbol at the compact sidebar scale.
    public var symbol: String
    /// Help and Contact support act; they don't open a page.
    public var action: Bool

    public init(id: String, title: String, symbol: String, action: Bool = false) {
        self.id = id
        self.title = title
        self.symbol = symbol
        self.action = action
    }
}

/// A group of categories under an optional heading (the workspace's name, Support).
public struct MacSettingsGroup: Hashable, Identifiable, Sendable {
    public var label: String?
    public var items: [MacSettingsCategory]
    public var id: String { label ?? "" }

    public init(label: String?, items: [MacSettingsCategory]) {
        self.label = label
        self.items = items
    }
}

public enum MacSettingsCategories {
    /// The action rows' ids.
    public static let help = "help"
    public static let contact = "contact"

    /// A category's symbol (the web's Settings icons, as SF Symbols).
    public static func symbol(_ id: String) -> String {
        switch id {
        case "desktop": "gearshape"
        case "account": "person.crop.circle"
        case "ai": "sparkles"
        case "billing", "workspace-billing": "creditcard"
        case "security": "checkmark.shield"
        case "privacy", "workspace-privacy": "lock"
        case "devices": "laptopcomputer.and.iphone"
        case "connected-apps": "powerplug"
        case "appearance": "paintpalette"
        case "notifications": "bell"
        case "sync": "arrow.triangle.2.circlepath"
        case "library": "books.vertical"
        case "data", "workspace-data": "arrow.up.arrow.down"
        case "about": "info.circle"
        case "workspace": "building.2"
        case "members": "person.2"
        case "workspace-guests": "person.badge.plus"
        case "this-device": "ipad"
        case help: "questionmark.circle"
        case contact: "lifepreserver"
        default: "gearshape"
        }
    }

    /// A category's name in the list. The Mac app's own settings are General here (the window's first category).
    public static func title(_ id: String) -> String {
        if id == "desktop" { return "General" }
        return MacSettingsSection(rawValue: id)?.label ?? id
    }

    /// The page's title: the category's, or the longer heading a workspace's General and Privacy have.
    public static func heading(_ id: String) -> String {
        if id == "desktop" { return "General" }
        return MacSettingsSection(rawValue: id)?.heading ?? id
    }

    /// The section a window opens for an asked id: the id, or the nearest this place has (a library's Library
    /// for an account's section; MacSettingsModel.shown).
    @MainActor
    public static func resolve(_ id: String, model: MacSettingsModel) -> String {
        model.shown(MacSettingsSection(rawValue: id)).rawValue
    }

    /// Whether the window's place is a library on this device's own (local mode).
    @MainActor
    public static func isLocal(_ model: MacSettingsModel) -> Bool { model.isLocal }

    /// The categories for the open place and space, as the web's Settings lists them (SettingsView.tsx), with the
    /// Mac's General first; then the workspace's; then Support (Help, Contact support, About).
    @MainActor
    public static func groups(_ model: MacSettingsModel) -> [MacSettingsGroup] {
        func item(_ s: MacSettingsSection) -> MacSettingsCategory { MacSettingsCategory(id: s.rawValue, title: title(s.rawValue), symbol: symbol(s.rawValue)) }
        var out: [MacSettingsGroup] = []
        for (i, g) in model.groups.enumerated() {
            var items = g.items
            if i == 0, let d = items.firstIndex(of: .desktop) { items.insert(items.remove(at: d), at: 0) }
            out.append(MacSettingsGroup(label: i == 0 ? nil : g.label, items: items.map(item)))
        }
        out.append(MacSettingsGroup(label: "Support", items: [
            MacSettingsCategory(id: help, title: "Help", symbol: symbol(help), action: true),
            MacSettingsCategory(id: contact, title: "Contact support…", symbol: symbol(contact), action: true),
            item(.about),
        ]))
        return out
    }
}

// MARK: - State

/// What the Settings window shows: its categories, the one open, the search and where it went.
@MainActor
@Observable
public final class MacSettingsState {
    public var groups: [MacSettingsGroup] = []
    /// The open category's id (a MacSettingsSection raw value).
    public var selection = ""
    public var query = "" {
        didSet { if query != oldValue { activeResult = 0 } }
    }
    /// A library (local mode): search finds a library's Foli AI cards.
    public var local = false
    /// The found card or row, lit for a moment.
    public private(set) var highlight: String?
    /// Where the page scrolls (an anchor; nil: the top), and a count that moves on every ask.
    public private(set) var scrollTarget: String?
    public private(set) var scrollSerial = 0
    /// The result Return opens (the arrow keys move it).
    public private(set) var activeResult = 0
    /// Moves when ⌘F asks for the search field.
    public private(set) var focusSearchSerial = 0
    /// The app follows a category opened here (the window's title, the web page), and runs an action row.
    @ObservationIgnored public var onSelect: (String) -> Void = { _ in }
    @ObservationIgnored public var onAction: (String) -> Void = { _ in }

    public init() {}

    /// The pages (not the action rows), in list order.
    public var categories: [MacSettingsCategory] { groups.flatMap(\.items).filter { !$0.action } }

    /// The row the list shows as open: the category, or the one it's listed under (a workspace's Import & export
    /// opened from File > Import in a space without the workspace's own list is under Import & export).
    public var listedSelection: String {
        if categories.contains(where: { $0.id == selection }) { return selection }
        if selection == "workspace-data" { return "data" }
        return selection
    }

    public var title: String { MacSettingsCategories.heading(selection) }

    public var results: [SettingsSearchResult] {
        SettingsSearch.results(query, categories: categories.map { ($0.id, $0.title) }, local: local)
    }

    /// Opens a category (from the list, the keyboard, a link on a page or the app): the page starts at its top.
    public func select(_ id: String) {
        guard !id.isEmpty else { return }
        if let c = groups.flatMap(\.items).first(where: { $0.id == id }), c.action {
            onAction(id)
            return
        }
        let changed = id != selection
        selection = id
        if changed {
            highlight = nil
            scrollTarget = nil
        }
        onSelect(id)
    }

    /// Opens a result: its category, scrolled to its card or row, lit for a moment.
    public func open(_ result: SettingsSearchResult) {
        select(result.entry.section)
        scrollTarget = result.entry.anchor
        scrollSerial += 1
        guard let anchor = result.entry.anchor else { return }
        highlight = anchor
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(MacSettingsLook.highlightSeconds))
            if self?.highlight == anchor { self?.highlight = nil }
        }
    }

    /// Return in the search field: the active result (the first, unless the arrows moved it).
    public func openActive() {
        let r = results
        guard !r.isEmpty else { return }
        open(r[min(activeResult, r.count - 1)])
    }

    public func moveActive(_ by: Int) {
        let n = results.count
        guard n > 0 else { return }
        activeResult = min(n - 1, max(0, activeResult + by))
    }

    /// The arrow keys in the category list.
    public func moveSelection(_ by: Int) {
        let ids = categories.map(\.id)
        guard !ids.isEmpty else { return }
        let i = ids.firstIndex(of: listedSelection) ?? (by > 0 ? -1 : ids.count)
        select(ids[min(ids.count - 1, max(0, i + by))])
    }

    public func focusSearch() { focusSearchSerial += 1 }
}

// MARK: - The window

#if os(macOS)
public enum MacSettingsWindowStyle {
    /// The window's first size and its smallest.
    public static var defaultSize: CGSize { MacSettingsLook.defaultSize }
    public static var minSize: CGSize { MacSettingsLook.minSize }

    /// A titled window drawn edge to edge under a transparent title bar, with an empty unified toolbar so the
    /// traffic lights sit in the middle of a toolbar-high band (the page's title shares it). Resizable, never full
    /// screen, no tabs. Host the content with `sizingOptions = [.minSize]`: MacSettingsShell's least size is the
    /// window's (a hosting view sets the window's least size itself, over contentMinSize).
    @MainActor
    public static func apply(_ window: NSWindow) {
        window.styleMask.insert([.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView])
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.titlebarSeparatorStyle = .none
        let toolbar = NSToolbar(identifier: "FoleviSettings")
        toolbar.allowsUserCustomization = false
        toolbar.displayMode = .iconOnly
        window.toolbar = toolbar
        window.toolbarStyle = .unified
        window.contentMinSize = MacSettingsLook.minSize
        window.tabbingMode = .disallowed
        window.collectionBehavior.insert(.fullScreenNone)
    }
}
#endif

/// The window's content: the category list and the page, each scrolling on its own.
public struct MacSettingsShell<Pane: View>: View {
    @Bindable var state: MacSettingsState
    /// The title bar's height when the host knows it better than the safe area (tests draw without a title bar).
    let chromeTop: CGFloat?
    let pane: Pane

    public init(state: MacSettingsState, chromeTop: CGFloat? = nil, @ViewBuilder pane: () -> Pane) {
        self.state = state
        self.chromeTop = chromeTop
        self.pane = pane()
    }

    public var body: some View {
        GeometryReader { geo in
            let top = max(chromeTop ?? geo.safeAreaInsets.top, MacSettingsLook.minChromeTop)
            HStack(spacing: 0) {
                MacSettingsSidebar(state: state, top: top)
                    .frame(width: MacSettingsLook.sidebarWidth)
                Rectangle().fill(MacLook.Colors.separator).frame(width: 1).accessibilityHidden(true)
                VStack(spacing: 0) {
                    MacSettingsHeader(title: state.title, height: top)
                    pane.frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .background(MacLook.Colors.window)
            }
            .ignoresSafeArea(.container, edges: .top)
        }
        // The window's least size (its hosting view hands it on: sizingOptions [.minSize]).
        .frame(minWidth: MacSettingsLook.minSize.width, minHeight: MacSettingsLook.minSize.height)
        .background {
            // ⌘F: the search field (the window takes key equivalents before the menu bar).
            Button("Search Settings") { state.focusSearch() }
                .keyboardShortcut("f", modifiers: .command)
                .opacity(0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("settings.window")
    }
}

/// The page's compact title, leading, on the column's edge, in line with the traffic lights. The band is also where
/// the window is dragged from.
struct MacSettingsHeader: View {
    let title: String
    let height: CGFloat

    var body: some View {
        Text(title)
            .font(MacLook.Text.title3Strong)
            .foregroundStyle(MacLook.Colors.label)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: MacSettingsLook.contentMaxWidth, alignment: .leading)
            .padding(.horizontal, MacSettingsLook.contentMargin + MacLook.Space.xs)
            .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
            .contentShape(Rectangle())
            .windowDrag()
            .accessibilityAddTraits(.isHeader)
    }
}

/// The category list: the search field under the traffic lights, then the categories in their groups, or the
/// search's results, or a line saying nothing matched.
struct MacSettingsSidebar: View {
    @Bindable var state: MacSettingsState
    let top: CGFloat
    @FocusState private var listFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: top).contentShape(Rectangle()).windowDrag()
            SettingsSearchField(state: state)
                .padding(.horizontal, MacLook.sidebarInset)
                .padding(.bottom, MacLook.Space.s)
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    if state.query.trimmingCharacters(in: .whitespaces).isEmpty {
                        categories
                    } else {
                        results
                    }
                }
                .padding(.horizontal, MacLook.sidebarInset - 2)
                .padding(.bottom, MacLook.Space.m)
            }
            .scrollIndicators(.automatic)
            .focusable()
            // (The list takes the arrow keys, but shows no focus ring: the system drew a heavy frame round the whole
            // column. The selected row is the cue, as in System Settings.)
            .focusEffectDisabled()
            .focused($listFocused)
            .onKeyPress(.downArrow) { state.moveSelection(1); return .handled }
            .onKeyPress(.upArrow) { state.moveSelection(-1); return .handled }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Settings categories")
        }
        .background(WindowMaterial().ignoresSafeArea())
    }

    @ViewBuilder private var categories: some View {
        ForEach(state.groups) { g in
            if let label = g.label { SidebarHeading(label).padding(.top, MacLook.Space.xs) }
            ForEach(g.items) { c in
                Button { state.select(c.id) } label: {
                    SidebarRow(c.title, symbol: c.symbol, selected: !c.action && c.id == state.listedSelection)
                }
                .buttonStyle(.plain) // (hover: SidebarRow draws its own)
                .foleviTooltip(c.action ? c.title : "")
                .accessibilityIdentifier("settings.category.\(c.id)")
            }
        }
    }

    /// The results as a filtered tree: each category with matches (its own row lit when its name matched), the
    /// matching cards and settings indented under it.
    @ViewBuilder private var results: some View {
        let found = state.results
        if found.isEmpty {
            VStack(alignment: .leading, spacing: MacLook.Space.xs) {
                Text("No Results").font(MacLook.Text.headline).foregroundStyle(MacLook.Colors.label)
                Text("Nothing in Settings matches “\(state.query.trimmingCharacters(in: .whitespaces))”. Try another word, like “dark mode” or “shortcut”.")
                    .font(MacLook.Text.small).foregroundStyle(MacLook.Colors.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 8)
            .padding(.top, MacLook.Space.s)
            .accessibilityElement(children: .combine)
        } else {
            let active = found.indices.contains(state.activeResult) ? found[state.activeResult].id : nil
            ForEach(Self.tree(found, categories: state.categories), id: \.category.id) { node in
                Button {
                    if let own = node.own { state.open(own) } else { state.select(node.category.id) }
                } label: {
                    SidebarRow(node.category.title, symbol: node.category.symbol, selected: node.own?.id == active)
                }
                .buttonStyle(.plain) // (hover: SidebarRow draws its own)
                ForEach(node.children) { r in
                    Button { state.open(r) } label: {
                        // Under its category, the label on the category's label's edge.
                        SidebarRow(r.entry.label, symbol: nil, selected: r.id == active)
                            .padding(.leading, MacLook.rowIconSlot + MacLook.rowIconGap)
                    }
                    .buttonStyle(.plain) // (hover: SidebarRow draws its own)
                    .foleviTooltip("\(r.entry.label), in \(r.category)")
                }
            }
        }
    }

    struct Node {
        var category: MacSettingsCategory
        var own: SettingsSearchResult?
        var children: [SettingsSearchResult]
    }

    static func tree(_ results: [SettingsSearchResult], categories: [MacSettingsCategory]) -> [Node] {
        categories.compactMap { c in
            let mine = results.filter { $0.entry.section == c.id }
            guard !mine.isEmpty else { return nil }
            return Node(category: c, own: mine.first { $0.entry.anchor == nil }, children: mine.filter { $0.entry.anchor != nil })
        }
    }
}

#if os(iOS)
/// The iPad's search field (the system's search look in SwiftUI): a clear button, Return opens the active result, the
/// arrow keys of a hardware keyboard move it, Escape clears it, ⌘F (MacSettingsState.focusSearch) puts the cursor in it.
struct SettingsSearchField: View {
    @Bindable var state: MacSettingsState
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(MacLook.Colors.secondary)
            TextField("Search", text: $state.query)
                .textFieldStyle(.plain)
                .font(MacLook.Text.body)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused($focused)
                .onSubmit { state.openActive() }
                .onKeyPress(.downArrow) { guard !state.query.isEmpty else { return .ignored }; state.moveActive(1); return .handled }
                .onKeyPress(.upArrow) { guard !state.query.isEmpty else { return .ignored }; state.moveActive(-1); return .handled }
                .onKeyPress(.escape) { guard !state.query.isEmpty else { return .ignored }; state.query = ""; return .handled }
                .accessibilityLabel("Search Settings")
                .accessibilityIdentifier("settings.search")
            if !state.query.isEmpty {
                Button { state.query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(MacLook.Colors.tertiary).padding(2) }
                    .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
                    .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: MacLook.compactControlHeight + 6)
        .background(MacLook.Colors.hover, in: Capsule())
        .onChange(of: state.focusSearchSerial) { focused = true }
    }
}
#else
/// The system's search field: a clear button, Escape clears it, Return opens the active result, the arrow keys
/// move it, ⌘F (MacSettingsState.focusSearch) puts the cursor in it.
struct SettingsSearchField: NSViewRepresentable {
    let state: MacSettingsState

    func makeCoordinator() -> Coordinator { Coordinator(state: state) }

    func makeNSView(context: Context) -> NSSearchField {
        let field = NSSearchField()
        field.placeholderString = "Search"
        field.font = .systemFont(ofSize: NSFont.systemFontSize)
        field.controlSize = .large
        // (The window doesn't open with the cursor in the search field and its focus ring lit: System Settings
        // doesn't either. ⌘F and a click put it there.)
        field.refusesFirstResponder = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak field] in field?.refusesFirstResponder = false }
        field.sendsSearchStringImmediately = true
        field.sendsWholeSearchString = false
        field.delegate = context.coordinator
        field.target = context.coordinator
        field.action = #selector(Coordinator.changed(_:))
        field.setAccessibilityLabel("Search Settings")
        field.setAccessibilityIdentifier("settings.search")
        context.coordinator.focusSerial = state.focusSearchSerial
        return field
    }

    func updateNSView(_ field: NSSearchField, context: Context) {
        context.coordinator.state = state
        if field.stringValue != state.query { field.stringValue = state.query }
        if context.coordinator.focusSerial != state.focusSearchSerial {
            context.coordinator.focusSerial = state.focusSearchSerial
            DispatchQueue.main.async {
                field.window?.makeFirstResponder(field)
                field.currentEditor()?.selectAll(nil)
            }
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSSearchFieldDelegate {
        var state: MacSettingsState
        var focusSerial = 0
        init(state: MacSettingsState) { self.state = state }

        @objc func changed(_ sender: NSSearchField) {
            if state.query != sender.stringValue { state.query = sender.stringValue }
        }

        func controlTextDidChange(_ note: Notification) {
            guard let field = note.object as? NSSearchField else { return }
            changed(field)
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            switch selector {
            case #selector(NSResponder.insertNewline(_:)):
                state.openActive()
                return true
            case #selector(NSResponder.moveDown(_:)):
                guard !state.query.isEmpty else { return false }
                state.moveActive(1)
                return true
            case #selector(NSResponder.moveUp(_:)):
                guard !state.query.isEmpty else { return false }
                state.moveActive(-1)
                return true
            case #selector(NSResponder.cancelOperation(_:)):
                // Escape clears a search; on an empty field it goes on to the window (which closes).
                guard !state.query.isEmpty else { return false }
                state.query = ""
                (control as? NSSearchField)?.stringValue = ""
                return true
            default:
                return false
            }
        }
    }
}
#endif

// MARK: - The native page

/// The open category's page: its groups in a readable column that scrolls on its own, scrolled to what the search
/// found. The Settings window's native look and found-highlight go down to every section from here.
public struct MacSettingsNativePane: View {
    let model: MacSettingsModel
    @Bindable var state: MacSettingsState

    public init(model: MacSettingsModel, state: MacSettingsState) {
        self.model = model
        self.state = state
    }

    public var body: some View {
        let section = model.shown(MacSettingsSection(rawValue: state.selection))
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    Color.clear.frame(height: 0).id(Self.top)
                    SettingsContent(model: model, section: section, windowed: true)
                }
                .frame(maxWidth: MacSettingsLook.contentMaxWidth, alignment: .topLeading)
                .padding(.horizontal, MacSettingsLook.contentMargin)
                .padding(.top, MacLook.Space.xs)
                .padding(.bottom, MacLook.Space.xxl)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.automatic)
            .id(section)
            // The list follows the place (a workspace opened or left while the window is open).
            .onChange(of: MacSettingsCategories.groups(model), initial: true) { _, groups in
                if state.groups != groups { state.groups = groups }
                state.local = model.isLocal
            }
            .onAppear { scroll(proxy) }
            .onChange(of: state.scrollSerial) { scroll(proxy) }
        }
        .environment(\.settingsNative, true)
        .environment(\.settingsWindowed, true)
        // (The same control size as the main window's screens.)
        .controlSize(MacLook.controlSize)
        .environment(\.settingsHighlight, state.highlight)
        .environment(\.settingsLineBreaks, model.lineBreaks)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.settings")
    }

    static let top = "settings.top"

    /// Goes to the found card or row: now, and again as the section's data arrives and lays the page out.
    private func scroll(_ proxy: ScrollViewProxy) {
        let target = state.scrollTarget ?? Self.top
        let serial = state.scrollSerial
        proxy.scrollTo(target, anchor: .top)
        guard state.scrollTarget != nil else { return }
        for delay in [0.15, 0.45, 0.9] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                guard state.scrollSerial == serial else { return }
                withAnimation(.smooth(duration: 0.2)) { proxy.scrollTo(target, anchor: .top) }
            }
        }
    }
}
#endif
