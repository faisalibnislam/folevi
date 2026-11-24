// The iPad's wide layout (docs/IOS_REBUILD_PLAN.md, I7), native like the Mac's window since the owner's 2026-11-24
// pick (the Mac set its UI guide aside for a window built the way Finder and Notes are): iPadOS's own split view, the
// sidebar in its column (hidden and shown by the system's button, sliding over a narrow window), and the detail
// under the system toolbar in Liquid Glass (IPadToolbar: Back and Forward, the title and subtitle, the screen's own
// items, New note in Folevi's ink, sync and the bell, search). Folevi's tabs sit in a row of their own under the
// toolbar, as Safari's on iPadOS; a note's tools (Style, Format, Insert, Foli AI) are native panels in the system
// inspector (IPadNoteInspector). The same views as the Mac's frame for the screens; the note is the app's one Page
// View, handed in as `page`.
#if os(iOS)
import Combine
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The iPad frame's widths.
public enum IPadFrameMetrics {
    /// Narrower than this (every iPad in portrait but the 13-inch ones, Split View, Stage Manager windows), the
    /// sidebar floats over the content instead of taking a third of the width beside it.
    public static let floatingSidebarBelow: CGFloat = 1000
}

@MainActor
public struct IPadFrameView<Page: View>: View {
    @Bindable var model: FrameModel
    let page: Page
    @State private var models: ScreenModels
    @State private var askAi: AiAskState
    @MadeOnce private var notifications: NotificationsModel
    @MadeOnce private var tasks: ValueStore<TaskCounts>
    /// The sidebar's actions, made once: built in the body, new closures every time made the whole sidebar draw again
    /// with every change the frame saw.
    @State private var sidebarActions: WebSidebarActions
    /// The window's width (all the frame lays out by): read on its own, so a change of height (the keyboard coming
    /// up, a sheet) doesn't run the whole frame again as the GeometryReader round it did.
    @State private var width: CGFloat = 0
    /// The note's tools in the inspector: shown, and which.
    @State private var toolsShown = false
    @State private var tool: IPadNoteTool = .format
    /// The toolbar's search field.
    @State private var searchText = ""
    @FocusState private var searchFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme

    public init(model: FrameModel, @ViewBuilder page: () -> Page) {
        self.model = model
        self.page = page()
        let models = ScreenModels(frame: model)
        _models = State(initialValue: models)
        _askAi = State(initialValue: AiAskState(frame: model, feedback: models.feedback))
        let notifications = NotificationsModel(client: model.client, feedback: models.feedback)
        _notifications = MadeOnce(wrappedValue: notifications)
        _sidebarActions = State(initialValue: Self.sidebarActions(model, notifications: notifications))
        _tasks = MadeOnce(wrappedValue: model.client.watch(.tasksCounts(), snapshotKey: "tasks.counts"))
    }

    public var body: some View {
        // The system's split view (the owner, 2026-11-24: the iPad native like the Mac): the sidebar column, hidden and
        // shown by the system's own button, and the detail with iPadOS's toolbar, the tabs under it and the note's
        // tools in the system inspector. Narrow (portrait, Split View, Stage Manager) the sidebar slides over the
        // detail, as the system's does.
        NavigationSplitView(columnVisibility: columnVisibility) {
            sidebar
                .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 340)
                .toolbar { sidebarToolbar }
        } detail: {
            detail
        }
        .modifier(IPadSplitStyle(floats: model.sidebarFloats))
        // A secondary click where nothing has a menu of its own: New note, Search, Ask Foli AI, Back, Forward.
        .appContextMenu(model)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { w in
            if abs(width - w) > 0.5 { width = w }
            let floats = w < IPadFrameMetrics.floatingSidebarBelow
            if floats != model.sidebarFloats {
                model.sidebarFloats = floats
                model.sidebarOverlayShown = false
            }
        }
        // The native look for everything the frame draws (and, through MacLook.padWide, for what it presents), with
        // Folevi's black and white accent for what iOS tints (switches, a borderless button's words), never blue.
        .environment(\.macNativeLook, true)
        .tint(MacLook.Colors.accent)
        // Switches in their own colour: the accent can't fill one in dark mode (FoleviSwitchTint).
        .toggleStyle(NativeSwitchStyle())
        .onAppear { MacLook.padWide = true }
        .onDisappear { MacLook.padWide = false }
        .animation(MacLook.animation(reduceMotion), value: model.sidebarHidden)
        .animation(MacLook.animation(reduceMotion), value: model.sidebarOverlayShown)
        .animation(MacLook.animation(reduceMotion), value: model.sidebarFloats)
        .animation(MacLook.animation(reduceMotion), value: model.editorPanel != nil)
        .background(WindowCatcher { FrameSheets.attach(model, window: $0) })
        .onAppear {
            WebSidebarController.loadNoteToolsChoice(model)
            // The strip's bell and sync status open their popovers from here (the Mac's sidebar controller does it).
            model.showNotifications = { [model, notifications] anchor in
                if FrameSheets.isShowing(model) { return FrameSheets.dismiss(model) }
                // (A popover from the bell, as the Mac's.)
                FrameSheets.attach(model, popoverAnchor: anchor)
                FrameDialogs.notifications(model, model: notifications)
            }
            // (The system's popover from the cloud, as the bell's: the drawn panel had no surface of its own, so the
            // popover's words vanished over a light page and only the cloud showed.)
            model.showSync = { [model] anchor in
                if FrameSheets.isShowing(model) { return FrameSheets.dismiss(model) }
                FrameSheets.attach(model, popoverAnchor: anchor)
                FrameSheets.present(model, top: 52, leading: 12) { _ in SyncPopover(model: model) }
            }
        }
        // A memory warning lets go of the native side's own caches (card covers decoded, card line breaks), as the
        // Mac's does (apps/mac Memory.swift): what shows asks again.
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            CoverFiles.shared.relieve()
            WebLineLayout.shared.relieve()
        }
        .onChange(of: model.route, initial: true) {
            models.keep(only: Set(model.tabs.tabs.map(\.route)))
            // The route's own view of a kept screen (a Tasks view, a calendar day, the search's words), as the
            // Mac's frame does: /tasks/all opened on Today (IPAD-22).
            models.prepare(model.route)
            model.sidebarOverlayShown = false
        }
        // Nothing floats over a note, so its page keeps only a small gap at its top (MacLook.notePageTop), as the
        // Mac's does. (Again once the note has drawn: at launch the page may not be listening yet.)
        .onChange(of: model.route.noteId, initial: true) { _, id in
            if id != nil { model.editor(.insets(top: Double(MacLook.notePageTop), bottom: 0)) }
        }
        .onChange(of: model.drawnNote) { _, id in
            if id != nil { model.editor(.insets(top: Double(MacLook.notePageTop), bottom: 0)) }
        }
    }

    /// The bar's room at the page's top in the web-matched layout (the web's main padding).
    static var barRoom: CGFloat { WebStyles.named("frame.main").light.padding.top }

    /// A screen that draws itself in the other theme (the Vault: dark in a light window, light in a dark one).
    static func drawsOtherTheme(_ route: FrameRoute) -> Bool {
        if case .web(let path) = route { return path == "/vault" || path.hasPrefix("/vault/") }
        return false
    }

    private var sidebar: some View {
        WebSidebar(model: model, tasks: tasks, actions: sidebarActions)
            .defaultAppStorage(WebSidebarController.defaults)
    }

    /// The sidebar's place: the system's split view keeps it (shown, collapsed by its button, or sliding over a
    /// narrow window); the frame's own flags follow it so the keyboard and the menus keep working.
    private var columnVisibility: Binding<NavigationSplitViewVisibility> {
        Binding(
            get: {
                // (Not measured yet: the detail alone, so a narrow window doesn't open with the sidebar over it before
                // it knows it's narrow. Narrow, the sidebar slides over the detail when asked for.)
                if width == 0 { return .detailOnly }
                if model.sidebarFloats { return model.sidebarOverlayShown ? .doubleColumn : .detailOnly }
                return model.sidebarHidden ? .detailOnly : .doubleColumn
            },
            set: { v in
                if model.sidebarFloats {
                    model.sidebarOverlayShown = v == .doubleColumn || v == .all
                } else {
                    model.sidebarCollapsed = v == .detailOnly
                }
            }
        )
    }

    /// The sidebar column's own bar: on a note, the switch between the note's outline (and comments, tasks, files)
    /// and the folders in the sidebar.
    @ToolbarContentBuilder private var sidebarToolbar: some ToolbarContent {
        if model.route.isNote {
            ToolbarItem(placement: .topBarTrailing) {
                let tools = model.noteToolsShown
                Button { WebSidebarController.setNoteTools(model, shown: !tools) } label: {
                    Label(tools ? "Show folders" : "Show the note's outline", systemImage: tools ? "folder" : "list.bullet.rectangle")
                }
                .accessibilityValue(tools ? "Note outline" : "Folders")
            }
        }
    }

    /// The detail column: the screen or the note under the system toolbar, the tabs in a row of their own under it
    /// (Safari's on iPadOS), the note's tools in the inspector; toasts at the foot, the Foli AI chat in the corner.
    private var detail: some View {
        let note = model.route.isNote
        // Over a screen in the other theme (the Vault), the chrome takes that theme too, as the Mac's does.
        let chrome: ColorScheme = Self.drawsOtherTheme(model.route) ? (scheme == .dark ? .light : .dark) : scheme
        return Group {
            if note {
                page
            } else {
                ScreenRoot(model: model, models: models, route: model.route)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .modifier(IPadTabsBar(model: model))
        .navigationTitle(CardControls.title(model))
        .modifier(IPadSubtitle(text: model.route.isNote ? nil : model.cardItems[model.route.tabKey]?.subtitle))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { IPadToolbar(model: model, inspectorShown: inspectorShown) }
        .searchable(text: $searchText, placement: .toolbar, prompt: "Search")
        .searchFocused($searchFocused)
        .onSubmit(of: .search) { openPalette(searchText) }
        .onChange(of: searchText) { _, q in if !q.isEmpty { openPalette(q) } }
        .inspector(isPresented: inspectorShown) {
            IPadNoteInspector(model: model, tool: $tool, askAi: askAi)
                .inspectorColumnWidth(min: 300, ideal: 340, max: 440)
        }
        .overlay(alignment: .bottom) {
            ToastStack(model: model)
                .environment(\.colorScheme, chrome)
        }
        .overlay {
            if model.overviewShown { TabOverviewLayer(model: model) }
        }
        .overlay(alignment: .bottomTrailing) {
            AiAskOverlay(frame: model, state: askAi)
                .environment(\.colorScheme, chrome)
        }
        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { h in
            let max = h - AiAskOverlay.panelLift
            if abs(askAi.maxHeight - max) > 0.5 { askAi.maxHeight = max }
        }
        // A panel the page asks for (its bar's Style, Format, Insert, Foli AI) opens here, natively; the page's own
        // stays shut.
        .onChange(of: model.editorPanel) { _, panel in
            guard let panel, let t = IPadNoteTool(panel) else { return }
            tool = t
            toolsShown = true
            model.editor(.panelClose)
        }
        .onChange(of: note) { _, isNote in if !isNote { toolsShown = false } }
        #if DEBUG
        // FOLEVI_IPAD_TOOL=style|format|insert|ai: that tool in the inspector once a note is up (headless checks).
        .task {
            guard let t = ProcessInfo.processInfo.environment["FOLEVI_IPAD_TOOL"].flatMap(IPadNoteTool.init(rawValue:)) else { return }
            try? await Task.sleep(for: .seconds(4))
            tool = t
            toolsShown = true
        }
        #endif
        .onChange(of: model.barSearchFocus) { searchFocused = true }
    }

    /// The note's tools: shown on a note only.
    private var inspectorShown: Binding<Bool> {
        Binding(get: { toolsShown && model.route.isNote }, set: { toolsShown = $0 })
    }

    /// What's typed in the toolbar's search opens the palette with it (the Mac's and the old card's search).
    private func openPalette(_ query: String) {
        guard !query.isEmpty else { return }
        searchText = ""
        searchFocused = false
        CommandPalette.show(model, query: query)
    }

    private static func sidebarActions(_ model: FrameModel, notifications: NotificationsModel) -> WebSidebarActions {
        var a = WebSidebarActions()
        a.notifications = { [model, notifications] _ in
            if FrameSheets.isShowing(model) { return FrameSheets.dismiss(model) }
            FrameDialogs.notifications(model, model: notifications)
        }
        a.account = { [model] anchor in
            guard let window = NSApp.keyWindow else { return }
            AccountMenuWindow.show(model: model, in: window, anchor: anchor)
        }
        // (The same system popover as the strip's cloud: IPadFrameView's showSync.)
        a.sync = { [model] anchor in model.showSync?(anchor) }
        return a
    }
}

/// The tabs in a row of their own under the toolbar (Safari's on iPadOS 26), on the bar's own material: iOS 26 carries
/// the scroll edge effect under it; before that a plain bar material.
private struct IPadTabsBar: ViewModifier {
    let model: FrameModel

    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.safeAreaBar(edge: .top, spacing: 0) { tabs }
        } else {
            content.safeAreaInset(edge: .top, spacing: 0) { tabs.background(.bar) }
        }
    }

    private var tabs: some View {
        WebTopBar(model: model, tabsOnly: true).frame(height: 44)
    }
}

/// Wide: the sidebar beside the detail, both kept whole; narrow: the detail first, the sidebar sliding over it.
private struct IPadSplitStyle: ViewModifier {
    let floats: Bool
    func body(content: Content) -> some View {
        if floats { content.navigationSplitViewStyle(.prominentDetail) } else { content.navigationSplitViewStyle(.balanced) }
    }
}

/// The line under the title (iOS 26's navigation subtitle: a count, a date).
private struct IPadSubtitle: ViewModifier {
    let text: String?

    func body(content: Content) -> some View {
        if #available(iOS 26, *), let text, !text.isEmpty {
            content.navigationSubtitle(text)
        } else {
            content
        }
    }
}

/// A swipe in from the screen's left edge (the system's edge pan, so taps and scrolls near the edge are untouched).
private struct SidebarEdgePan: UIGestureRecognizerRepresentable {
    let opened: () -> Void

    func makeUIGestureRecognizer(context: Context) -> UIScreenEdgePanGestureRecognizer {
        let pan = UIScreenEdgePanGestureRecognizer()
        pan.edges = .left
        pan.cancelsTouchesInView = false
        return pan
    }

    func handleUIGestureRecognizerAction(_ pan: UIScreenEdgePanGestureRecognizer, context: Context) {
        if pan.state == .changed || pan.state == .ended, pan.translation(in: pan.view).x > 40 { opened() }
    }
}

/// Hands up the window the frame is in (dialogs attach to it).
private struct WindowCatcher: UIViewRepresentable {
    let found: (UIWindow?) -> Void

    final class Probe: UIView {
        var found: (UIWindow?) -> Void = { _ in }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            found(window)
        }
    }

    func makeUIView(context: Context) -> Probe {
        let v = Probe()
        v.isUserInteractionEnabled = false
        v.found = found
        return v
    }

    func updateUIView(_ v: Probe, context: Context) { v.found = found }
}
#endif

#if os(iOS)
/// One of the frame's screens on its own (the phone's fallback for a route it doesn't draw itself yet): the Mac's
/// screen for `route`, its links going through `model` (the phone forwards them to its own stacks).
@MainActor
public struct DeskScreen: View {
    let model: FrameModel
    let route: FrameRoute
    @State private var models: ScreenModels

    public init(model: FrameModel, route: FrameRoute) {
        self.model = model
        self.route = route
        _models = State(initialValue: ScreenModels(frame: model))
    }

    public var body: some View {
        ScreenRoot(model: model, models: models, route: route)
            // (No glass bar over it here: the phone's own bar sits above.)
            .safeAreaPadding(.top, -ContentViewController.barHeight)
            .background(WindowCatcher { FrameSheets.attach(model, window: $0) })
    }
}
#endif
