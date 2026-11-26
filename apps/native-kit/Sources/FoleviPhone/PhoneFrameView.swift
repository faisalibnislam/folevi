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

    /// What the tab bar's selection is: one of the three tabs, or search. (Foli AI is never selected: it opens its
    /// sheet over the tab you're on.)
    private enum Selection: Hashable { case tab(PhoneTab), ai, search }

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
                // (On the next turn: set inside the tab bar's own selection callback, the sheet's state change
                // wasn't drawn until the next touch, so Foli AI's sheet came up only when something else was tapped.)
                case .ai: Task { @MainActor in actions.openAI() }
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
        // Foli AI's tab never becomes the selected one: the tab bar is told not to select it and its sheet opens
        // instead, so the screen doesn't blank to the tab's empty page and back before the sheet comes up (the
        // owner's video, 2026-11-25).
        .background { TabActionTabs(title: "Foli AI") { actions.openAI() }.frame(width: 0, height: 0) }
        .phoneSideBarsReader()
        // A note's bottom bars, where the tab bar is (PhoneNoteBarsSlot): they trade places with it, not ride the page.
        .overlay { PhoneNoteBarsLayer(model: model) }
        .overlay { PhoneMenuLayer(menus: menus) }
    }

    /// + in a tab's first screen's bar (the owner, 2026-11-25: at the top, before the sync and the bell, with iOS's
    /// own menu).
    private func rootCreate(_ tab: PhoneTab) -> PhoneRootCreate? {
        guard #available(iOS 26, *) else { return nil }
        return PhoneRootCreate(aiOn: false, quickTaskOnly: tab == .tasks, openAI: actions.openAI, newNote: actions.newNote,
                               fromTemplate: actions.fromTemplate, quickTask: actions.quickTask, newFolder: actions.newFolder)
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
                let hidden = tabBarHidden || model.top.isNote || model.top == .web("/ai") || PhoneTabStackView<Screen>.isAI(model.top)
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

    /// A tab's screens, as a view of its own: it reads only its own tab's stack, so opening a screen in one tab
    /// doesn't draw the other tabs' stacks (or the tab bar) again.
    private func stack(_ tab: PhoneTab) -> some View {
        PhoneTabStackView(model: model, tab: tab, zoom: zoom, tabBarHidden: tabBarHidden, rootCreate: rootCreate(tab), screen: screen)
    }
}

/// One tab's navigation stack: its first screen, then what was opened on top (bound to the model, so Back by the
/// edge swipe pops the model too).
private struct PhoneTabStackView<Screen: View>: View {
    let model: PhoneFrameModel
    let tab: PhoneTab
    let zoom: Namespace.ID
    /// Whether the tab bar steps out of the way (the keyboard, Select).
    let tabBarHidden: Bool
    let rootCreate: PhoneRootCreate?
    let screen: (FrameRoute) -> Screen

    static func isAI(_ route: FrameRoute) -> Bool {
        if case .web(let p) = route { return p == "/ai" || p.hasPrefix("/ai/") }
        return false
    }

    var body: some View {
        let entries = model.entries(of: tab)
        // (Read here, so a tab switch or search draws this tab's bar visibility again.)
        let onShow = model.current == tab && !model.searching
        let top = entries.last?.route
        let first = entries.first?.route ?? PhoneFrameModel.root(of: tab)
        let path = Binding<[PhoneStackEntry]>(
            get: { Array(model.entries(of: tab).dropFirst()) },
            set: { model.setPath($0, in: tab) }
        )
        return NavigationStack(path: path) {
            screen(first)
                .environment(\.phoneRootCreate, rootCreate)
                .toolbarVisibility(barHidden(first, onShow: onShow, top: top) ? .hidden : .automatic, for: .tabBar)
                .navigationDestination(for: PhoneStackEntry.self) { entry in
                    destination(entry.route, onShow: onShow, top: top)
                }
        }
        .environment(\.phoneZoom, zoom)
    }

    /// The tab bar steps away for a note (which has its own bars), the Foli AI page, the keyboard and Select.
    private func barHidden(_ route: FrameRoute, onShow: Bool, top: FrameRoute?) -> Bool {
        route.isNote || Self.isAI(route) || (tabBarHidden && onShow && route == top)
    }

    /// A pushed screen; a note zooms out of the card it was opened from.
    @ViewBuilder
    private func destination(_ route: FrameRoute, onShow: Bool, top: FrameRoute?) -> some View {
        if case .note(let id) = route {
            // (The note draws its own bars, as the page asks: PhoneNoteBars; iOS's where bars are at the side.)
            // (The tab bar goes as the model opens a note and comes back as Back is pressed, not when the page has
            // finished leaving: it follows the stack's top, so it and the note's bars trade places together.)
            screen(route).phoneNoteBar()
                .environment(\.phoneNoteBarsInFrame, true)
                .toolbarVisibility(onShow && top?.isNote == true ? .hidden : .automatic, for: .tabBar)
                .navigationTransition(.zoom(sourceID: id, in: zoom))
        } else {
            screen(route).toolbarVisibility(barHidden(route, onShow: onShow, top: top) ? .hidden : .automatic, for: .tabBar)
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
                // The accent's own ink: black on the light accent in dark mode, white on the dark one in light.
                .foregroundStyle(PhoneNativeLook.onAccent)
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

#if os(iOS)
import UIKit

/// Makes one tab of the SwiftUI `TabView` around it an action: its tab bar controller is told not to select it, and
/// `action` runs instead. SwiftUI's own delegate keeps everything else (a proxy forwards to it).
struct TabActionTabs: UIViewRepresentable {
    let title: String
    let action: @MainActor () -> Void

    func makeUIView(context: Context) -> Finder { Finder() }

    func updateUIView(_ view: Finder, context: Context) {
        view.title = title
        view.action = action
        view.attach()
    }

    final class Finder: UIView {
        var title = ""
        var action: (@MainActor () -> Void)?
        private var proxy: TabActionDelegate?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            attach()
        }

        func attach() {
            guard window != nil else { return }
            // (After SwiftUI has set up its controller and delegate.)
            DispatchQueue.main.async { [weak self] in self?.install() }
        }

        private func install() {
            var responder: UIResponder? = self
            while let r = responder, !(r is UITabBarController) { responder = r.next }
            // (The tab view's controller is usually beside this view rather than above it: look down from the root.)
            func find(_ vc: UIViewController?) -> UITabBarController? {
                guard let vc else { return nil }
                if let t = vc as? UITabBarController { return t }
                for child in vc.children { if let t = find(child) { return t } }
                return find(vc.presentedViewController)
            }
            guard let tabs = (responder as? UITabBarController) ?? find(window?.rootViewController), let action else { return }
            if let proxy, tabs.delegate === proxy {
                proxy.title = title
                proxy.action = action
                return
            }
            let p = TabActionDelegate(original: tabs.delegate, title: title, action: action)
            proxy = p
            tabs.delegate = p
        }
    }
}

/// Refuses the action tab (by its title) and runs its action; every other question goes to SwiftUI's delegate.
final class TabActionDelegate: NSObject, UITabBarControllerDelegate {
    weak var original: UITabBarControllerDelegate?
    var title: String
    var action: (@MainActor () -> Void)?

    init(original: UITabBarControllerDelegate?, title: String, action: @escaping @MainActor () -> Void) {
        self.original = original
        self.title = title
        self.action = action
    }

    func tabBarController(_ tabBarController: UITabBarController, shouldSelectTab tab: UITab) -> Bool {
        if tab.title == title {
            MainActor.assumeIsolated { action?() }
            return false
        }
        return original?.tabBarController?(tabBarController, shouldSelectTab: tab) ?? true
    }

    func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
        if viewController.tabBarItem.title == title {
            MainActor.assumeIsolated { action?() }
            return false
        }
        return original?.tabBarController?(tabBarController, shouldSelect: viewController) ?? true
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (original?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let original, original.responds(to: aSelector), !super.responds(to: aSelector) { return original }
        return super.forwardingTarget(for: aSelector)
    }
}
#endif
