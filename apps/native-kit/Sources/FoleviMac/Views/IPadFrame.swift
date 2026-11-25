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
    /// sidebar floats over the content while the note's tools are open in the inspector, so the note keeps its room.
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
    /// The detail column's width (today's top bar gives its tabs the room its buttons leave).
    @State private var detailWidth: CGFloat = 0
    /// The note's tools in the inspector: shown, and which.
    @State private var toolsShown = false
    @State private var tool: IPadNoteTool = .format
    /// iOS lays the toolbar out in a column at the side (iPhone Duo open across, iOS 27.1): the whole toolbar goes
    /// there, the note's tools with it, and the sidebar stays beside the content.
    @State private var sideBars = false
    /// Whether iOS has said yet (it says once the frame has appeared and the phone has finished opening): until then
    /// the sidebar keeps its last state rather than slide away for a moment. (An iPad never puts bars at the side.)
    @State private var sideBarsKnown = UIDevice.current.userInterfaceIdiom == .pad
    /// Where the fold starts, partly closed (iPhone Duo; FoldSpan): the sidebar reaches it, so the list and the note
    /// each have a side of the fold, as Notes' split view does.
    @State private var foldMinX: CGFloat?
    /// When the frame last appeared or the sidebar switched between floating and beside: the split view reports its
    /// columns as it settles (it starts with the detail alone until the width is known), and that report isn't the
    /// person hiding the sidebar.
    @State private var settlingSince = Date.distantPast
    /// When the page last drew a note (its own panel request on load isn't the person asking for the tools).
    @State private var noteDrawnAt = Date.distantPast
    /// The toolbar's search field.
    @State private var searchText = ""
    @FocusState private var searchFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Compact (iPhone Duo closed, with this frame kept for when it opens): the split view folds into one column and
    /// says so, which isn't the person hiding the sidebar.
    @Environment(\.horizontalSizeClass) private var sizeClass
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
                .navigationSplitViewColumnWidth(min: 240, ideal: sidebarIdeal, max: max(340, sidebarIdeal))
                // (Today's sidebar has its own button at its top, and the toolbar shows one while it's away; its
                // menu has Show folders and Show document on a note.)
                .modifier(IPadNoSystemSidebarToggle(on: true))
        } detail: {
            detail
        }
        .modifier(IPadSplitStyle(floats: model.sidebarFloats))
        .readFold { foldMinX = $0?.minX }
        // A secondary click where nothing has a menu of its own: New note, Search, Ask Foli AI, Back, Forward.
        .appContextMenu(model)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { w in
            if abs(width - w) > 0.5 { width = w }
            updateSidebarFloats(w)
        }
        .onChange(of: sideBars) { updateSidebarFloats(width) }
        .onChange(of: inspectorShown.wrappedValue) { updateSidebarFloats(width) }
        // The native look for everything the frame draws (and, through MacLook.padWide, for what it presents), with
        // Folevi's black and white accent for what iOS tints (switches, a borderless button's words), never blue.
        .environment(\.macNativeLook, true)
        .tint(MacLook.Colors.accent)
        // Switches in their own colour: the accent can't fill one in dark mode (FoleviSwitchTint).
        .toggleStyle(NativeSwitchStyle())
        .onAppear {
            MacLook.padWide = true
            settlingSince = Date()
        }
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
            noteDrawnAt = Date()
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

    /// Today's tablet sidebar (Sidebar.tsx, the owner's 2026-11-25 pick: today's UI, natively): the wordmark, the
    /// sync status, the bell and the sidebar's button at its top, "Search or jump to…", the places, Folders, Tags,
    /// Archive and Trash, and the account at its foot; on a note, the note's own tools.
    private var sidebar: some View {
        WebSidebar(model: model, tasks: tasks, actions: sidebarActions)
            .defaultAppStorage(WebSidebarController.defaults)
            .environment(\.macNativeLook, false)
            .background((WebStyles.vars["color-sidebar"]?.resolve(scheme).color ?? Color(uiColor: .secondarySystemBackground)).ignoresSafeArea())
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
                // (Not while the window is about to change size, or just has: iPhone Duo folding shut, a rotation.)
                let quiet = min(Date().timeIntervalSince(settlingSince), Date().timeIntervalSince(model.windowResizedAt))
                guard width > 0, sizeClass != .compact, quiet > 1.5 else { return }
                if model.sidebarFloats {
                    model.sidebarOverlayShown = v == .doubleColumn || v == .all
                } else {
                    model.sidebarCollapsed = v == .detailOnly
                }
            }
        )
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
                    .environment(\.screensKeepControls, !sideBars)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .modifier(IPadTabsBar(model: model, shown: sideBars))
        .navigationTitle(CardControls.title(model))
        .modifier(IPadSubtitle(text: model.route.isNote || !sideBars ? nil : model.cardItems[model.route.tabKey]?.subtitle))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { IPadToolbar(model: model, inspectorShown: inspectorShown, tool: $tool, sideBars: sideBars, narrow: width > 0 && width < 760, detailWidth: detailWidth) }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { w in
            if abs(detailWidth - w) > 0.5 { detailWidth = w }
        }
        .readVerticalBars { side in
            sideBars = side
            sideBarsKnown = true
            updateSidebarFloats(width)
        }
        // (The toolbar's search field only in iOS's column at the side: in today's layout the sidebar has it.)
        .modifier(IPadToolbarSearch(on: sideBars, text: $searchText, focused: $searchFocused, open: openPalette))
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
            // (No floating button in today's layout: Foli AI is the toolbar's flower, as today's top bar has it.)
            AiAskOverlay(frame: model, state: askAi, launcher: sideBars)
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
            model.editor(.panelClose)
            // (A note opening asks for its panel by itself, the web's remembered inspector: today's tablet layout opens
            // a note with its outline in the sidebar and the page's dock, the tools shut until asked for.)
            // (Said by the page as the note registers and becomes ready: before it has drawn, or just after.)
            guard model.drawnNote != nil, model.drawnNote == model.route.noteId, Date().timeIntervalSince(noteDrawnAt) > 1.5 else { return }
            tool = t
            toolsShown = true
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
        .onChange(of: model.barSearchFocus) {
            if sideBars { searchFocused = true } else { CommandPalette.show(model) }
        }
    }

    /// The sidebar stays beside the content, as today's tablet layout keeps it on every iPad and on iPhone Duo open
    /// (Apple's HIG: the inner screen shows one more level of the hierarchy, as Mail and Notes do); the system's split
    /// view evens its columns out at the fold when the phone is partly closed. While the note's tools are open in a
    /// window under 1000 pt the three don't fit side by side: the sidebar steps aside for them and comes back after.
    private func updateSidebarFloats(_ w: CGFloat) {
        guard w > 0, sideBarsKnown else { return }
        // Today's tablet layout (Shell.tsx: the iPad's sidebar never folds away for width) keeps the sidebar beside
        // the content at every width the wide layout takes; only the note's tools in the inspector, which need the
        // room, send it over the content in a narrower window, and it comes back when they close.
        let floats = inspectorShown.wrappedValue && w < IPadFrameMetrics.floatingSidebarBelow
        if floats != model.sidebarFloats {
            settlingSince = Date()
            model.sidebarFloats = floats
            model.sidebarOverlayShown = false
        }
    }

    /// The sidebar's width: 280 pt, or up to the fold while the phone is partly closed.
    private var sidebarIdeal: CGFloat {
        if let x = foldMinX, x > 240, !model.sidebarFloats { return x }
        // (Today's tablet sidebar is 320 wide, Shell.tsx; a narrow window keeps more of itself for the content.)
        return width >= 800 ? 320 : 280
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
    /// Only with the toolbar in iOS's column at the side (iPhone Duo open across); otherwise the tabs are in the bar.
    var shown = true

    func body(content: Content) -> some View {
        if !shown {
            content
        } else if #available(iOS 26, *) {
            content.safeAreaBar(edge: .top, spacing: 0) { tabs }
        } else {
            content.safeAreaInset(edge: .top, spacing: 0) { tabs.background(.bar) }
        }
    }

    private var tabs: some View {
        WebTopBar(model: model, tabsOnly: true).frame(height: 44)
    }
}

/// The toolbar's search field (iPhone Duo's column at the side), opening the palette with what's typed.
private struct IPadToolbarSearch: ViewModifier {
    let on: Bool
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    let open: (String) -> Void

    func body(content: Content) -> some View {
        if on {
            content
                .searchable(text: $text, placement: .toolbar, prompt: "Search")
                .searchFocused(focused)
                .onSubmit(of: .search) { open(text) }
                .onChange(of: text) { _, q in if !q.isEmpty { open(q) } }
        } else {
            content
        }
    }
}

/// Takes the split view's own sidebar button away (today's layout has its own).
private struct IPadNoSystemSidebarToggle: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        // (And no bar over the sidebar: its own top row is today's, the wordmark, sync, bell and its button.)
        if on { content.toolbar(removing: .sidebarToggle).toolbar(.hidden, for: .navigationBar) } else { content }
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
