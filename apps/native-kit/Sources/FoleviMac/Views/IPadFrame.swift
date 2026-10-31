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

@MainActor
public struct IPadFrameView<Page: View>: View {
    @Bindable var model: FrameModel
    let page: Page
    @State private var models: ScreenModels
    @State private var askAi: AiAskState
    @State private var notifications: NotificationsModel
    @State private var tasks: ValueStore<TaskCounts>

    public init(model: FrameModel, @ViewBuilder page: () -> Page) {
        self.model = model
        self.page = page()
        let models = ScreenModels(frame: model)
        _models = State(initialValue: models)
        _askAi = State(initialValue: AiAskState(frame: model, feedback: models.feedback))
        _notifications = State(initialValue: NotificationsModel(client: model.client, feedback: models.feedback))
        _tasks = State(initialValue: model.client.watch(.tasksCounts(), snapshotKey: "tasks.counts"))
    }

    public var body: some View {
        let side = WebStyles.named("frame.sidebar").light
        let card = WebStyles.named("frame.content").light
        // The web's margins: 8 pt at the sides (the sidebar's left edge), the sidebar's measured top (the status
        // bar's room and 8), the home indicator's room below (on the iPad: 32 pt from the top, 20 from the bottom).
        let m = side.x
        return GeometryReader { g in
            ZStack(alignment: .topLeading) {
                WebCanvas()
                HStack(spacing: 0) {
                    if !model.sidebarCollapsed {
                        WebSidebar(model: model, tasks: tasks, actions: sidebarActions)
                            .frame(width: side.width)
                            .padding(.leading, side.x)
                            .transition(.move(edge: .leading))
                    }
                    content
                        .padding(.leading, model.sidebarCollapsed ? m : card.x - side.x - side.width)
                        .padding(.trailing, m)
                }
                .padding(.top, side.y)
                .padding(.bottom, max(m, NSApp.keyWindow?.safeAreaInsets.bottom ?? g.safeAreaInsets.bottom))
            }
            .ignoresSafeArea(.container, edges: .vertical)
        }
        .animation(.easeOut(duration: 0.18), value: model.sidebarCollapsed)
        .background(WindowCatcher { FrameSheets.attach(model, window: $0) })
        .onChange(of: model.route) { models.keep(only: Set(model.tabs.tabs.map(\.route))) }
    }

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
            AiAskOverlay(frame: model, state: askAi, launcher: false)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            if model.overviewShown { TabOverviewLayer(model: model) }
        }
        .clipShape(RoundedRectangle(cornerRadius: card.light.radius, style: .continuous))
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
