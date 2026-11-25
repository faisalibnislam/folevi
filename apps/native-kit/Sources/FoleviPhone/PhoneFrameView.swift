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
    /// The frame's size, for where the tab bar's + opens its menu from.
    @State private var frameSize: CGSize = .zero
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

    /// What the tab bar's selection is: one of the three tabs, or search. (Foli AI is never selected: it opens its
    /// sheet over the tab you're on.)
    private enum Selection: Hashable { case tab(PhoneTab), ai, search }

    /// The tab bar steps away for a note (which has its own bars), the Foli AI page, the keyboard and Select.
    private func barHidden(_ route: FrameRoute) -> Bool {
        route.isNote || isAI(route) || (tabBarHidden && route == model.tabTop && !model.searching)
    }

    /// The native look (the owner, 2026-11-19): iOS 26's tab bar in Liquid Glass. Home, Tasks and Calendar, each
    /// with its own navigation stack, then Foli AI (only for people who have it), and search as a tab of its own
    /// (`role: .search`, at the bar's trailing end). Foli AI opens its sheet over the tab you're on (the owner,
    /// 2026-11-19: Foli AI in the bottom bar, + at the top); + is in each tab's first screen's bar (rootCreate).
    @available(iOS 26, *)
    private var nativeBody: some View {
        let selection = Binding<Selection>(
            get: { model.searching ? .search : .tab(model.current) },
            set: { s in
                switch s {
                case .search: if !model.searching { model.openSearch() }
                case .ai: actions.openAI()
                case .tab(let t): model.pick(t)
                }
            }
        )
        return TabView(selection: selection) {
            ForEach(PhoneTab.allCases) { tab in
                Tab(value: Selection.tab(tab)) {
                    // Every screen's top bar ends in the search capsule (the owner, 2026-11-23), which opens Search.
                    stack(tab).environment(\.phoneOpenSearch, { model.openSearch() })
                } label: {
                    Label { Text(tab.label) } icon: { tab.icon.image(size: 24, strokeWidth: 1.9) }
                }
            }
            if aiOn {
                Tab(value: Selection.ai) {
                    // (Never shown: choosing the tab opens the sheet and the tab bar stays on the tab you're on.)
                    Color.clear
                } label: {
                    // The flower in its own colours, at the other tabs' icon size.
                    Label { Text("Foli AI") } icon: { Image(uiImage: AiMarkImage.uiImage(size: 22, canvas: 26)) }
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
        .onGeometryChange(for: CGSize.self) { $0.size } action: { frameSize = $0 }
        .phoneSideBarsReader()
        // A note's bottom bars, where the tab bar is (PhoneNoteBarsSlot): they trade places with it, not ride the page.
        // + floats over the bar's trailing end, above the search button (the owner, 2026-11-25: + beside the
        // tab bar, as today's app has it; iOS's bar holds five items at most, so it can't be a tab).
        .overlay(alignment: .bottomTrailing) {
            if !barHidden(model.tabTop) && !model.searching {
                PhoneCreateButton { plus(createFrom) }
                    .padding(.trailing, 22)
                    .padding(.bottom, 74)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .animation(WebMotion.reduced ? nil : .spring(response: 0.32, dampingFraction: 0.82), value: barHidden(model.tabTop) || model.searching)
        .overlay { PhoneNoteBarsLayer(model: model) }
        .overlay { PhoneMenuLayer(menus: menus) }
    }

    /// Where the floating + sits: its menu opens above it, its right edge on the button's.
    private var createFrom: CGRect {
        CGRect(x: max(0, frameSize.width - 22 - 52), y: max(0, frameSize.height - 74 - 52), width: 52, height: 52)
    }

    /// + in a tab's first screen's bar: none since 2026-11-25 (+ is in the tab bar). Before iOS 26 the drawn bar has
    /// its own.
    private func rootCreate(_ tab: PhoneTab) -> PhoneRootCreate? {
        if #available(iOS 26, *) { return nil }
        return PhoneRootCreate(aiOn: false, quickTaskOnly: tab == .tasks, openAI: actions.openAI, newNote: actions.newNote,
                               fromTemplate: actions.fromTemplate, quickTask: actions.quickTask)
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

    /// A tab's screens: its first screen, then what was opened on top (bound to the model, so Back by the edge swipe
    /// pops the model too).
    private func stack(_ tab: PhoneTab) -> some View {
        let first = model.stacks[tab]?.first?.route ?? PhoneFrameModel.root(of: tab)
        let path = Binding<[PhoneStackEntry]>(
            get: { Array((model.stacks[tab] ?? []).dropFirst()) },
            set: { model.setPath($0, in: tab) }
        )
        return NavigationStack(path: path) { root(tab, first) }
            .environment(\.phoneZoom, zoom)
    }

    /// A tab's first screen, and the screens pushed over it.
    private func root(_ tab: PhoneTab, _ first: FrameRoute) -> some View {
        screen(first)
            .environment(\.phoneRootCreate, rootCreate(tab))
            .toolbarVisibility(barHidden(first) ? .hidden : .automatic, for: .tabBar)
            .navigationDestination(for: PhoneStackEntry.self) { entry in
                destination(entry.route)
            }
    }

    /// A pushed screen; a note zooms out of the card it was opened from.
    @ViewBuilder
    private func destination(_ route: FrameRoute) -> some View {
        if case .note(let id) = route {
            // (The note draws its own bars, as the page asks: PhoneNoteBars; iOS's where bars are at the side.)
            // (The tab bar goes as the model opens a note and comes back as Back is pressed, not when the page has
            // finished leaving: it follows the model's top, so it and the note's bars trade places together.)
            screen(route).phoneNoteBar()
                .environment(\.phoneNoteBarsInFrame, true)
                .toolbarVisibility(model.top.isNote ? .hidden : .automatic, for: .tabBar)
                .navigationTransition(.zoom(sourceID: id, in: zoom))
        } else {
            screen(route).toolbarVisibility(barHidden(route) ? .hidden : .automatic, for: .tabBar)
        }
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

#if os(iOS)
/// The floating + (today's app's black + by Foli AI): a prominent Liquid Glass circle in Folevi's ink, 52 pt, with a
/// light tap.
@available(iOS 26, *)
struct PhoneCreateButton: View {
    let action: () -> Void
    @State private var taps = 0

    var body: some View {
        Button {
            taps += 1
            action()
        } label: {
            WebIcon.plus.image(size: 24, strokeWidth: 2.4)
                .frame(width: 52, height: 52)
                .contentShape(Circle())
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.circle)
        .tint(PhoneNativeLook.accent)
        .sensoryFeedback(.impact(weight: .light), trigger: taps)
        .accessibilityLabel("New")
        .accessibilityHint("Opens New note, From template, New folder and Quick task")
    }
}
#endif
