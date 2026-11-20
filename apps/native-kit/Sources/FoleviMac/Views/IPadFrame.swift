// The iPad's wide layout (docs/IOS_REBUILD_PLAN.md, I7), in the Mac's native look since the owner's 2026-11-19
// decision ("the same layout as the Mac", docs/MAC_NATIVE_LOOK.md; iPadOS 26 controls and touch sizes): the window's
// grey surface (the Mac's translucent frame) under everything; on it the strip along the top (the sidebar's button,
// Back and Forward, Home, Show All Tabs and the tabs in their track, the sync status and the bell), the sidebar under
// it at the leading edge, and the content card beside it with its controls floating in Liquid Glass at its top. On a
// note the page draws its own card and its panel on the surface (`data-ipad-native`, globals.css), as the Mac's
// does. The same views as the Mac's frame (FrameViews.swift lays them out with AppKit there); the note is the app's
// one Page View, handed in as `page`.
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
    @State private var regions = CardHitRegions()
    @MadeOnce private var notifications: NotificationsModel
    @MadeOnce private var tasks: ValueStore<TaskCounts>
    /// The sidebar's actions, made once: built in the body, new closures every time made the whole sidebar draw again
    /// with every change the frame saw.
    @State private var sidebarActions: WebSidebarActions
    /// The window's width (all the frame lays out by): read on its own, so a change of height (the keyboard coming
    /// up, a sheet) doesn't run the whole frame again as the GeometryReader round it did.
    @State private var width: CGFloat = 0
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
        let m = MacLook.containerMargin
        // The sidebar beside the card (the Mac's), unless it's hidden or the window is too narrow for it.
        let inline = !model.sidebarFloats && !model.sidebarHidden
        // A note's own panel (Style, Format, Insert, Foli AI) beside the note: the page takes the card's room to
        // the window's trailing and bottom edges and draws its card and the panel itself (the Mac's layout).
        let panel = Self.panelBeside(model, width: width - (inline ? MacLook.sidebarWidth : m))
        return ZStack(alignment: .topLeading) {
                WindowMaterial().ignoresSafeArea()
                VStack(spacing: 0) {
                    WebTopBar(model: model)
                        .frame(height: MacLook.titleBarHeight)
                    HStack(spacing: 0) {
                        if inline {
                            sidebar
                                .frame(width: MacLook.sidebarWidth)
                                .transition(.move(edge: .leading).combined(with: .opacity))
                        }
                        card
                            .padding(.leading, inline ? 0 : m)
                            .padding(.trailing, panel ? 0 : m)
                            .padding(.bottom, panel ? 0 : m)
                    }
                }
                .ignoresSafeArea(.container, edges: .bottom)
                // Too narrow for the sidebar beside the content: it slides over the card on the frame's surface, and
                // goes again with a tap beside it or once something in it is picked (the route changes).
                if model.sidebarFloats && model.sidebarOverlayShown {
                    Color.black.opacity(0.12)
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture { model.sidebarOverlayShown = false }
                        .transition(.opacity)
                    sidebar
                        .frame(width: MacLook.sidebarWidth)
                        .padding(.top, MacLook.titleBarHeight)
                        // A swipe back towards the edge puts it away, as iPadOS's own sidebar goes (IPAD-16).
                        .simultaneousGesture(DragGesture(minimumDistance: 20).onEnded { g in
                            if g.translation.width < -60, abs(g.translation.width) > abs(g.translation.height) { model.sidebarOverlayShown = false }
                        })
                        .background {
                            WindowMaterial()
                                .clipShape(UnevenRoundedRectangle(bottomTrailingRadius: MacLook.containerRadius, topTrailingRadius: MacLook.containerRadius, style: .continuous))
                                .nativeShadow(.overlay)
                                .ignoresSafeArea()
                        }
                        .ignoresSafeArea(.container, edges: .bottom)
                        .transition(.move(edge: .leading))
                }
            }
            // A swipe in from the left edge brings the floating sidebar out (IPAD-16: only its button did).
            .gesture(SidebarEdgePan { if model.sidebarFloats && !model.sidebarOverlayShown { model.sidebarOverlayShown = true } })
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

    /// A note's own panel is open beside it: the card wide enough to keep `inspectorMinContent` for the note.
    static func panelBeside(_ model: FrameModel, width: CGFloat) -> Bool {
        model.route.isNote && model.editorPanel != nil && width - MacLook.inspectorWidth >= MacLook.inspectorMinContent
    }

    /// A screen that draws itself in the other theme (the Vault: dark in a light window, light in a dark one).
    static func drawsOtherTheme(_ route: FrameRoute) -> Bool {
        if case .web(let path) = route { return path == "/vault" || path.hasPrefix("/vault/") }
        return false
    }

    private var sidebar: some View {
        WebSidebar(model: model, tasks: tasks, actions: sidebarActions)
            .defaultAppStorage(WebSidebarController.defaults)
    }

    /// The content card: the screen, its controls floating in glass at its top, toasts at its foot, Ask Foli AI in its
    /// corner. On a note the page draws its own card (and its panel beside it) on the frame's surface.
    private var card: some View {
        let note = model.route.isNote
        let shape = RoundedRectangle(cornerRadius: MacLook.containerRadius, style: .continuous)
        // Over a screen in the other theme (the Vault), the card's own chrome (its fill, the scroll edge, the glass
        // controls and their title, Ask Foli AI, toasts) takes that theme too, as the Mac's does
        // (ContentViewController.syncChromeAppearance); the screen keeps the window's (it flips its own colours).
        let chrome: ColorScheme = Self.drawsOtherTheme(model.route) ? (scheme == .dark ? .light : .dark) : scheme
        return ZStack(alignment: .top) {
            if note {
                page
            } else {
                ScreenRoot(model: model, models: models, route: model.route)
                    .clipShape(shape)
                // The soft scroll edge under the card's controls, where a screen's content runs on under its title.
                LinearGradient(stops: [.init(color: MacLook.Colors.container, location: 0), .init(color: MacLook.Colors.container, location: 0.55),
                                       .init(color: MacLook.Colors.container.opacity(0), location: 1)],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: MacLook.barHeight + 18)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: MacLook.containerRadius, topTrailingRadius: MacLook.containerRadius, style: .continuous))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                    .environment(\.colorScheme, chrome)
                CardControls(model: model, regions: regions)
                    .environment(\.colorScheme, chrome)
            }
            VStack {
                Spacer()
                ToastStack(model: model)
            }
            .environment(\.colorScheme, chrome)
            if model.overviewShown { TabOverviewLayer(model: model).clipShape(shape) }
        }
        .background {
            if !note {
                // The card's own fill and its quiet shadow (the Mac's ContentCard).
                shape.fill(MacLook.Colors.container).shadow(color: .black.opacity(0.03), radius: 5, y: 1)
                    .environment(\.colorScheme, chrome)
            }
        }
        // Foli AI's chat floats above the card, not inside it, so the card's rounded edge never cuts its shadow.
        .overlay(alignment: .bottomTrailing) {
            AiAskOverlay(frame: model, state: askAi)
                .environment(\.colorScheme, chrome)
        }
        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { h in
            // The floating chat ends under the card's own controls.
            let max = h - MacLook.barHeight - AiAskOverlay.panelLift
            if abs(askAi.maxHeight - max) > 0.5 { askAi.maxHeight = max }
        }
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
