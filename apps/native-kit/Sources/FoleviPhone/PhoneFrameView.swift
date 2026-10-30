// The iPhone frame (docs/IOS_REBUILD_PLAN.md, I1; the web's components/iphone/IphoneShell.tsx): one navigation
// stack per tab, each kept alive while another shows (a tab comes back where it was left), iOS's own push and edge
// swipe for Back, and the floating tab bar over them. What each route shows comes from `screen`.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviScreens

/// What the tab bar's Foli AI and + buttons do (TabBar.tsx): + opens New note, From template, New folder and Quick
/// task; on Tasks it goes straight to Quick task.
public struct PhoneFrameActions {
    public var openAI: @MainActor () -> Void
    public var newNote: @MainActor () -> Void
    public var fromTemplate: @MainActor () -> Void
    public var newFolder: @MainActor () -> Void
    public var quickTask: @MainActor () -> Void

    public init(openAI: @escaping @MainActor () -> Void = {}, newNote: @escaping @MainActor () -> Void = {}, fromTemplate: @escaping @MainActor () -> Void = {}, newFolder: @escaping @MainActor () -> Void = {}, quickTask: @escaping @MainActor () -> Void = {}) {
        self.openAI = openAI
        self.newNote = newNote
        self.fromTemplate = fromTemplate
        self.newFolder = newFolder
        self.quickTask = quickTask
    }
}

public extension EnvironmentValues {
    /// The frame's namespace for the zoom from a note's card or row into the note.
    @Entry var phoneZoom: Namespace.ID?
}

public extension View {
    /// A card or row a note opens from: the note zooms out of it (and back into it on the way back), as iOS's
    /// zoom transition does (the web's transitions.ts copies it).
    func phoneZoomSource(_ noteId: String) -> some View {
        modifier(ZoomSource(id: noteId))
    }
}

private struct ZoomSource: ViewModifier {
    let id: String
    @Environment(\.phoneZoom) private var zoom

    func body(content: Content) -> some View {
        if let zoom {
            content.matchedTransitionSource(id: id, in: zoom)
        } else {
            content
        }
    }
}

public struct PhoneFrameView<Screen: View>: View {
    @Bindable var model: PhoneFrameModel
    @Namespace private var zoom
    let menus: PhoneMenus
    let aiOn: Bool
    /// Whether the tab bar steps out of the way (the keyboard, Select).
    let tabBarHidden: Bool
    let actions: PhoneFrameActions
    let screen: (FrameRoute) -> Screen

    public init(model: PhoneFrameModel, menus: PhoneMenus, aiOn: Bool = true, tabBarHidden: Bool = false, actions: PhoneFrameActions = PhoneFrameActions(), @ViewBuilder screen: @escaping (FrameRoute) -> Screen) {
        self.model = model
        self.menus = menus
        self.aiOn = aiOn
        self.tabBarHidden = tabBarHidden
        self.actions = actions
        self.screen = screen
    }

    /// + : the Create menu over it (above, its right edge on the button's), or on Tasks a quick task.
    private func plus(_ from: CGRect) {
        if model.current == .tasks {
            actions.quickTask()
            return
        }
        menus.show([
            PhoneMenuEntry(.item("New note", icon: .filePlusCorner), action: actions.newNote),
            PhoneMenuEntry(.item("From template", icon: .layoutTemplate), action: actions.fromTemplate),
            PhoneMenuEntry(.item("New folder", icon: .folderPlus), action: actions.newFolder),
            PhoneMenuEntry(.item("Quick task", icon: .listPlus), action: actions.quickTask),
        ], from: from, side: .top, align: .end, minWidth: 248)
    }

    public var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                ForEach(PhoneTab.allCases) { tab in
                    stack(tab)
                        .opacity(tab == model.current ? 1 : 0)
                        .allowsHitTesting(tab == model.current)
                        .accessibilityHidden(tab != model.current)
                }
                // The tab bar floats over the home indicator and steps away for a note (which has its own bars),
                // the keyboard and Select (TabBar.tsx: 300 ms, cubic-bezier(0.32, 0.72, 0, 1)).
                let hidden = tabBarHidden || model.top.isNote || model.top == .web("/ai") || isAI(model.top)
                PhoneTabBar(current: model.current, aiOn: aiOn, pick: { model.pick($0) }, openAI: actions.openAI, plus: plus)
                    .padding(.leading, geo.safeAreaInsets.leading)
                    .padding(.trailing, geo.safeAreaInsets.trailing)
                    .padding(.bottom, max(10, geo.safeAreaInsets.bottom - 10))
                    .offset(y: hidden ? 64 * 1.4 + 20 : 0)
                    .opacity(hidden ? 0 : 1)
                    .animation(.timingCurve(0.32, 0.72, 0, 1, duration: 0.3), value: hidden)
                    .allowsHitTesting(!hidden)
                    .accessibilityHidden(hidden)
            }
            .ignoresSafeArea(edges: .bottom)
        }
        .overlay { PhoneMenuLayer(menus: menus) }
    }

    private func isAI(_ route: FrameRoute) -> Bool {
        if case .web(let p) = route { return p == "/ai" || p.hasPrefix("/ai/") }
        return false
    }

    /// A tab's stack: its first screen, then what was opened on top (bound to the model, so Back by the edge swipe
    /// pops the model too).
    private func stack(_ tab: PhoneTab) -> some View {
        let path = Binding<[PhoneStackEntry]>(
            get: { Array((model.stacks[tab] ?? []).dropFirst()) },
            set: { model.setPath($0, in: tab) }
        )
        let first = model.stacks[tab]?.first?.route ?? PhoneFrameModel.root(of: tab)
        return NavigationStack(path: path) {
            screen(first)
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: PhoneStackEntry.self) { entry in
                    destination(entry.route)
                }
        }
        .environment(\.phoneZoom, zoom)
    }

    /// A pushed screen; a note zooms out of the card it was opened from.
    @ViewBuilder
    private func destination(_ route: FrameRoute) -> some View {
        if case .note(let id) = route {
            screen(route).toolbar(.hidden, for: .navigationBar).navigationTransition(.zoom(sourceID: id, in: zoom))
        } else {
            screen(route).toolbar(.hidden, for: .navigationBar)
        }
    }
}
#endif
