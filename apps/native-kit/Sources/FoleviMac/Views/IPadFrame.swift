// The iPad's wide layout (docs/IOS_REBUILD_PLAN.md, I7): the web's desktop layout as the iPad app shows it in a
// window wide enough for the sidebar (lib/iphone.ts isIpadLayout, `<html data-ipad>`): the canvas, the sidebar
// 8 pt from the edges, the content as a rounded card beside it with its glass top bar and tab strip floating
// inside. The same views as the Mac's frame (FrameViews.swift lays them out with AppKit there); the note is the
// app's one Page View, handed in as `page`.
#if os(iOS)
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

    public init(model: FrameModel, @ViewBuilder page: () -> Page) {
        self.model = model
        self.page = page()
        let models = ScreenModels(frame: model)
        _models = State(initialValue: models)
        _askAi = State(initialValue: AiAskState(frame: model, feedback: models.feedback))
        _notifications = MadeOnce(wrappedValue: NotificationsModel(client: model.client, feedback: models.feedback))
        _tasks = MadeOnce(wrappedValue: model.client.watch(.tasksCounts(), snapshotKey: "tasks.counts"))
    }

    public var body: some View {
        let side = WebStyles.named("frame.sidebar").light
        let card = WebStyles.named("frame.content").light
        // The web's margins: 8 pt at the sides (the sidebar's left edge), the sidebar's measured top (the status
        // bar's room and 8), the home indicator's room below (on the iPad: 32 pt from the top, 20 from the bottom).
        let m = side.x
        return GeometryReader { g in
            let bottom = max(m, NSApp.keyWindow?.safeAreaInsets.bottom ?? g.safeAreaInsets.bottom)
            let inline = !model.sidebarFloats && !model.sidebarCollapsed
            ZStack(alignment: .topLeading) {
                WebCanvas()
                HStack(spacing: 0) {
                    if inline {
                        WebSidebar(model: model, tasks: tasks, actions: sidebarActions)
                            .frame(width: side.width)
                            .padding(.leading, side.x)
                            .transition(.move(edge: .leading))
                    }
                    content
                        .padding(.leading, inline ? card.x - side.x - side.width : m)
                        .padding(.trailing, m)
                }
                .padding(.top, side.y)
                .padding(.bottom, bottom)
                // Too narrow for the sidebar beside the content: it slides over it, on its own canvas, and goes
                // again with a tap beside it or once something in it is picked (the route changes).
                if model.sidebarFloats && model.sidebarOverlayShown {
                    Color.black.opacity(0.16)
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture { model.sidebarOverlayShown = false }
                        .transition(.opacity)
                    WebSidebar(model: model, tasks: tasks, actions: sidebarActions)
                        .frame(width: side.width)
                        .padding(.top, side.y)
                        .padding(.bottom, bottom)
                        .padding(.horizontal, side.x)
                        // A swipe back towards the edge puts it away, as iPadOS's own sidebar goes (IPAD-16).
                        .simultaneousGesture(DragGesture(minimumDistance: 20).onEnded { g in
                            if g.translation.width < -60, abs(g.translation.width) > abs(g.translation.height) { model.sidebarOverlayShown = false }
                        })
                        .background {
                            WebCanvas()
                                .clipShape(UnevenRoundedRectangle(bottomTrailingRadius: 20, topTrailingRadius: 20, style: .continuous))
                                .shadow(color: .black.opacity(0.18), radius: 24, x: 4, y: 0)
                                .ignoresSafeArea()
                        }
                        .transition(.move(edge: .leading))
                }
            }
            .ignoresSafeArea(.container, edges: .vertical)
            // A swipe in from the left edge brings the floating sidebar out (IPAD-16: only its button did).
            .gesture(SidebarEdgePan { if model.sidebarFloats && !model.sidebarOverlayShown { model.sidebarOverlayShown = true } })
            .onChange(of: g.size.width, initial: true) { _, width in
                let floats = width < IPadFrameMetrics.floatingSidebarBelow
                if floats != model.sidebarFloats {
                    model.sidebarFloats = floats
                    model.sidebarOverlayShown = false
                }
            }
        }
        .animation(.easeOut(duration: 0.18), value: model.sidebarCollapsed)
        .animation(.easeOut(duration: 0.22), value: model.sidebarOverlayShown)
        .animation(.easeOut(duration: 0.18), value: model.sidebarFloats)
        .background(WindowCatcher { FrameSheets.attach(model, window: $0) })
        .onChange(of: model.route, initial: true) {
            models.keep(only: Set(model.tabs.tabs.map(\.route)))
            // The route's own view of a kept screen (a Tasks view, a calendar day, the search's words), as the
            // Mac's frame does: /tasks/all opened on Today (IPAD-22).
            models.prepare(model.route)
            model.sidebarOverlayShown = false
        }
        // The page leaves the glass bar's room at its top (--native-inset-top), as the Mac's does, so a note's
        // paper starts below the bar instead of under it.
        // (Again once the note has drawn: at launch the page may not be listening yet when the route changes.)
        .onChange(of: model.route.noteId, initial: true) { _, id in
            if id != nil { model.editor(.insets(top: Double(Self.barRoom), bottom: 0)) }
        }
        .onChange(of: model.drawnNote) { _, id in
            if id != nil { model.editor(.insets(top: Double(Self.barRoom), bottom: 0)) }
        }
    }

    /// The bar's room at the page's top, as the web measures its main area (`frame.main`'s top padding, the Mac's
    /// value too): the bar and the 8-point gap under it, so the page never touches the bar.
    static var barRoom: CGFloat { WebStyles.named("frame.main").light.padding.top }

    /// The rounded card: the screen (or the note's page) under the glass bar, toasts at its foot.
    private var content: some View {
        let card = WebStyles.named("frame.content")
        let bar = WebStyles.named("frame.topbar").light
        let inset = bar.y - card.light.y
        return ZStack(alignment: .top) {
            Color.clear.webBox(card)
            ZStack {
                if model.route.isNote {
                    page
                } else {
                    ScreenRoot(model: model, models: models, route: model.route)
                }
            }
            WebTopBar(model: model)
                .frame(height: bar.height)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: bar.radius, style: .continuous))
                .padding(.horizontal, bar.x - card.light.x)
                .padding(.top, inset)
            VStack {
                Spacer()
                ToastStack(model: model)
            }
            if model.overviewShown { TabOverviewLayer(model: model) }
        }
        .clipShape(RoundedRectangle(cornerRadius: card.light.radius, style: .continuous))
        // Foli AI's chat floats above the card, not inside it, so the card's rounded edge never cuts its shadow.
        .overlay(alignment: .bottomTrailing) {
            AiAskOverlay(frame: model, state: askAi, launcher: false)
        }
    }

    private var sidebarActions: WebSidebarActions {
        var a = WebSidebarActions()
        a.notifications = { [model, notifications] _ in
            if FrameSheets.isShowing(model) { return FrameSheets.dismiss(model) }
            FrameDialogs.notifications(model, model: notifications)
        }
        a.account = { [model] _ in
            guard let window = NSApp.keyWindow else { return }
            AccountMenuWindow.show(model: model, in: window)
        }
        a.sync = { [model] anchor in
            guard let anchor else { return }
            PlannerPanel.popover(below: anchor) { _ in SyncPopover(model: model) }
        }
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
