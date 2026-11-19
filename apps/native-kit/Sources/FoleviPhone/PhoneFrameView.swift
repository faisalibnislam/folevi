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

public extension View {
    /// A screen that draws its own bar (a note, the Foli AI page, a screen the phone borrows from the iPad): iOS's
    /// navigation bar steps away for it, and Back's edge swipe stays on.
    func phoneOwnBar() -> some View {
        toolbar(.hidden, for: .navigationBar)
            .background { PhoneEdgeSwipeBack().frame(width: 0, height: 0) }
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
        if #available(iOS 26, *) {
            nativeBody
        } else {
            legacyBody
        }
    }

    /// What the tab bar's selection is: one of the three tabs, or search.
    private enum Selection: Hashable { case tab(PhoneTab), search }

    /// The tab bar steps away for a note (which has its own bars), the Foli AI page, the keyboard and Select.
    private func barHidden(_ route: FrameRoute) -> Bool {
        route.isNote || isAI(route) || (tabBarHidden && route == model.tabTop && !model.searching)
    }

    /// The native look (the owner, 2026-11-19): iOS 26's tab bar in Liquid Glass. Home, Tasks and Calendar, each
    /// with its own navigation stack, and search as a tab of its own (`role: .search`, at the bar's trailing end).
    /// Foli AI and + ride above the bar in its accessory (iOS's place for what belongs to the whole app, as a
    /// player's controls do): Ask Foli AI, and the Create menu (Quick task on Tasks).
    @available(iOS 26, *)
    private var nativeBody: some View {
        let selection = Binding<Selection>(
            get: { model.searching ? .search : .tab(model.current) },
            set: { s in
                switch s {
                case .search: if !model.searching { model.openSearch() }
                case .tab(let t): model.pick(t)
                }
            }
        )
        let hidden = barHidden(model.top)
        return TabView(selection: selection) {
            ForEach(PhoneTab.allCases) { tab in
                Tab(value: Selection.tab(tab)) {
                    stack(tab)
                } label: {
                    Label { Text(tab.label) } icon: { tab.icon.image(size: 24, strokeWidth: 1.9) }
                }
            }
            Tab(value: Selection.search, role: .search) {
                // (Search brings its own navigation stack with iOS's search field on it, PhoneSearchScreen: the
                // field takes the tab bar's place only when `.searchable` is on the tab's stack itself.)
                screen(.search(model.searchText))
                    .id(model.searchID)
                    .environment(\.phoneZoom, zoom)
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .modifier(FrameAccessory(enabled: !hidden && !model.searching) { accessory })
        .overlay { PhoneMenuLayer(menus: menus) }
    }

    /// Ask Foli AI and +, in the tab bar's accessory.
    @available(iOS 26, *)
    private var accessory: some View {
        PhoneFrameAccessory(aiOn: aiOn, onTasks: model.current == .tasks, actions: actions)
    }

    /// Before iOS 26: the floating tab bar drawn as the web's, over the stacks.
    private var legacyBody: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                ForEach(PhoneTab.allCases) { tab in
                    stack(tab)
                        .opacity(tab == model.current ? 1 : 0)
                        .allowsHitTesting(tab == model.current)
                        .accessibilityHidden(tab != model.current)
                }
                // The tab bar floats over the home indicator and steps away for a note (which has its own bars),
                // the keyboard and Select, on FoleviSpring.slide.
                let hidden = tabBarHidden || model.top.isNote || model.top == .web("/ai") || isAI(model.top)
                PhoneTabBar(current: model.current, aiOn: aiOn, pick: { model.pick($0) }, openAI: actions.openAI, plus: plus)
                    .padding(.leading, geo.safeAreaInsets.leading)
                    .padding(.trailing, geo.safeAreaInsets.trailing)
                    .padding(.bottom, max(10, geo.safeAreaInsets.bottom - 10))
                    .offset(y: hidden && !WebMotion.reduced ? 64 * 1.4 + 20 : 0)
                    .opacity(hidden ? 0 : 1)
                    .animation(FoleviSpring.slide, value: hidden)
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
                .toolbarVisibility(barHidden(first) ? .hidden : .automatic, for: .tabBar)
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
            // (The note draws its own bars, as the page asks: PhoneNoteBars.)
            screen(route).phoneOwnBar().toolbarVisibility(.hidden, for: .tabBar).navigationTransition(.zoom(sourceID: id, in: zoom))
        } else {
            screen(route).toolbarVisibility(barHidden(route) ? .hidden : .automatic, for: .tabBar)
        }
    }
}

/// The tab bar's accessory, shown only while the bar is (iOS 26.1 hides it on demand; on 26.0 it stays).
@available(iOS 26, *)
private struct FrameAccessory<A: View>: ViewModifier {
    let enabled: Bool
    @ViewBuilder let accessory: () -> A

    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: enabled) { accessory() }
        } else {
            content.tabViewBottomAccessory { accessory() }
        }
    }
}

/// Ask Foli AI (the flower and its words, the sheet grows out of it) and + (the Create menu, a system menu with
/// Folevi's icons; on Tasks a quick task straight away). Minimized with the tab bar while a list scrolls down, it
/// keeps the flower and + only.
@available(iOS 26, *)
struct PhoneFrameAccessory: View {
    let aiOn: Bool
    let onTasks: Bool
    let actions: PhoneFrameActions
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        HStack(spacing: 0) {
            if aiOn {
                Button(action: actions.openAI) {
                    HStack(spacing: 10) {
                        AiMarkGlyph(size: 22)
                        if placement != .inline {
                            Text("Ask Foli AI").font(.body).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.leading, 16)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .sheetZoomSource("ai")
                .accessibilityLabel("Foli AI")
            } else {
                Spacer(minLength: 0)
            }
            if onTasks {
                Button(action: actions.quickTask) { plusGlyph }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Quick task")
            } else {
                Menu {
                    Button(action: actions.newNote) { Label { Text("New note") } icon: { WebIcon.filePlusCorner.image() } }
                    Button(action: actions.fromTemplate) { Label { Text("From template") } icon: { WebIcon.layoutTemplate.image() } }
                    Button(action: actions.newFolder) { Label { Text("New folder") } icon: { WebIcon.folderPlus.image() } }
                    Button(action: actions.quickTask) { Label { Text("Quick task") } icon: { WebIcon.listPlus.image() } }
                } label: {
                    plusGlyph
                }
                .accessibilityLabel("Create")
            }
        }
    }

    private var plusGlyph: some View {
        Image(systemName: "plus")
            .font(.system(size: 19, weight: .semibold))
            .foregroundStyle(.primary)
            .frame(width: 52)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
    }
}

/// iOS turns Back's edge swipe off with the navigation bar hidden (a screen with its own bar): this puts it back on
/// the tab's stack, whenever there is a screen to go back to.
private struct PhoneEdgeSwipeBack: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Probe { Probe() }
    func updateUIViewController(_ probe: Probe, context: Context) { probe.hook() }

    final class Probe: UIViewController, UIGestureRecognizerDelegate {
        private weak var nav: UINavigationController?

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            hook()
        }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            hook()
        }

        func hook() {
            guard let nav = navigationController, let pop = nav.interactivePopGestureRecognizer else { return }
            self.nav = nav
            pop.isEnabled = true
            pop.delegate = self
        }

        func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            (nav?.viewControllers.count ?? 0) > 1
        }
    }
}
#endif
