// The screens in the tab stacks: Home and the note lists from FoleviScreens (N7), Shared with Me and Changes, with
// their bar items put where UIKit wants them, and the frame's own small screens for what later packages fill:
// Tasks and Calendar (N10), search (N11) and the web pages that stay web (Reviews, Graph) in the Page View under
// native bars.
//
// The root bar (web iphone/RootBar.tsx) on Home, Tasks and Calendar: the avatar on the left (the account and places
// sheet) and, on the right, one pill with the sync status, the bell (notifications) and "…" (the screen's menu).
// On iOS 26 the system groups those items into one glass capsule; the avatar keeps no glass of its own.
import SwiftUI
import UIKit
import WebKit
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// What the root bars' buttons do (the frame presents the sheets).
@MainActor
struct RootBarActions {
    var account: () -> Void
    var notifications: () -> Void
    var sync: () -> Void
}

@MainActor
enum RootBar {
    /// The avatar: the person (initials until avatars are drawn from `avatarUrl`), opening the account sheet.
    static func avatar(_ phone: PhoneModel, action: @escaping () -> Void) -> UIBarButtonItem {
        let item = barItem(RootAvatar(phone: phone, action: action))
        item.accessibilityIdentifier = "root-avatar"
        return item
    }

    static func bell(action: @escaping () -> Void) -> UIBarButtonItem {
        let item = UIBarButtonItem(image: UIImage(systemName: "bell"), primaryAction: UIAction { _ in action() })
        item.accessibilityLabel = "Notifications"
        item.accessibilityIdentifier = "root-bell"
        return item
    }

    static func sync(action: @escaping () -> Void) -> UIBarButtonItem {
        let item = UIBarButtonItem(image: UIImage(systemName: "checkmark.icloud"), primaryAction: UIAction { _ in action() })
        item.accessibilityLabel = "Sync status"
        item.accessibilityIdentifier = "root-sync"
        return item
    }

    static func more(_ menu: UIMenu) -> UIBarButtonItem {
        let item = UIBarButtonItem(image: UIImage(systemName: "ellipsis"), menu: menu)
        item.accessibilityLabel = "More"
        item.accessibilityIdentifier = "root-more"
        return item
    }

    /// Redraws the bell's unread count and the sync icon.
    static func update(bell: UIBarButtonItem, sync: UIBarButtonItem, phone: PhoneModel) {
        let unread = phone.places.value.flatMap { p in p.places.first { $0.id == p.current }?.unread } ?? 0
        if #available(iOS 26.0, *) {
            bell.badge = unread > 0 ? .count(unread) : nil
        } else {
            bell.image = UIImage(systemName: unread > 0 ? "bell.badge" : "bell")
        }
        bell.accessibilityValue = unread > 0 ? "\(unread) unread" : nil
        sync.image = UIImage(systemName: phone.syncIndicatorSymbol)
        sync.accessibilityValue = phone.sync.value?.label
        let attention = phone.sync.value.map { $0.state == .error || $0.state == .conflict } ?? false
        sync.tintColor = attention ? Chrome.coral : nil
    }
}

private struct RootAvatar: View {
    let phone: PhoneModel
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Avatar(name: phone.profileName.isEmpty ? "Folevi" : phone.profileName, size: 34)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(Color.black.opacity(0.12), lineWidth: 0.5))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Account and places")
        .accessibilityIdentifier("root-avatar")
    }
}

// MARK: - Home

final class HomeScreenController: HostedScreen<AnyView> {
    let home: HomeModel
    private let phone: PhoneModel
    private let actions: RootBarActions
    private lazy var bell = RootBar.bell(action: actions.notifications)
    private lazy var syncItem = RootBar.sync(action: actions.sync)
    private var observer: Observer?

    init(home: HomeModel, phone: PhoneModel, navigator: ScreenNavigator, feedback: ScreenFeedback, actions: RootBarActions) {
        self.home = home
        self.phone = phone
        self.actions = actions
        super.init(rootView: AnyView(HomeScreen(model: home).environment(\.screenNavigator, navigator).environment(\.screenFeedback, feedback)))
        title = HomeScreen.title
        navigationItem.largeTitleDisplayMode = .always
        navigationItem.leftBarButtonItem = RootBar.avatar(phone, action: actions.account)
        let more = RootBar.more(UIMenu(children: [UIDeferredMenuElement.uncached { [weak self] done in done(self?.menu() ?? []) }]))
        navigationItem.rightBarButtonItems = [more, bell, syncItem]
    }

    @MainActor required dynamic init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.accessibilityIdentifier = "home"
        observer = Observer { [weak self] in
            guard let self else { return }
            RootBar.update(bell: self.bell, sync: self.syncItem, phone: self.phone)
            if #available(iOS 26.0, *) { self.navigationItem.subtitle = self.home.eyebrow }
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        PhoneMetrics.firstFrame(home.value == nil ? "empty" : (home.home.isStale || home.home.status != .live ? "snapshot" : "live"))
    }

    /// Home's "…": New folder, All folders, Graph (web IphoneHome's menu).
    private func menu() -> [UIMenuElement] {
        var items: [UIMenuElement] = []
        if home.canEdit {
            items.append(UIAction(title: "New Folder", image: UIImage(systemName: "folder.badge.plus")) { [weak self] _ in self?.home.dialogs.open(.newFolder(parent: nil)) })
        }
        items.append(UIAction(title: "Refresh", image: UIImage(systemName: "arrow.clockwise")) { [weak self] _ in
            guard let self else { return }
            Task { await self.home.refresh() }
        })
        if home.graphOn {
            items.append(UIAction(title: "Graph", image: UIImage(systemName: "point.3.connected.trianglepath.dotted")) { [weak self] _ in self?.actions.open(.graph) })
        }
        return items
    }
}

private extension RootBarActions {
    func open(_ route: ScreenRoute) { PhoneFrameController.current?.open(route, source: nil) }
}

// MARK: - Note lists

final class ListScreenController: HostedScreen<AnyView> {
    let list: NotesListModel
    private weak var tabs: PhoneTabsController?
    private var observer: Observer?
    private let trailing: UIBarButtonItem
    private let leading: UIBarButtonItem
    private let navigatorEnv: ScreenNavigator

    init(list: NotesListModel, navigator: ScreenNavigator, feedback: ScreenFeedback, tabs: PhoneTabsController?) {
        self.list = list
        self.tabs = tabs
        self.navigatorEnv = navigator
        trailing = barItem(NotesListTrailingItems(model: list).environment(\.screenNavigator, navigator))
        leading = barItem(NotesListLeadingItems(model: list).environment(\.screenNavigator, navigator))
        super.init(rootView: AnyView(NotesListScreen(model: list).environment(\.screenNavigator, navigator).environment(\.screenFeedback, feedback)))
        navigationItem.largeTitleDisplayMode = .always
        navigationItem.rightBarButtonItem = trailing
        tabBarRoom = PhoneTabsController.room
    }

    @MainActor required dynamic init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        observer = Observer { [weak self] in
            guard let self else { return }
            let selecting = self.list.selecting
            self.title = selecting ? self.list.selectionStatus : self.list.title
            self.navigationItem.hidesBackButton = selecting
            self.navigationItem.leftBarButtonItem = selecting ? self.leading : nil
            if selecting { self.tabs?.hideReasons.insert("select") } else { self.tabs?.hideReasons.remove("select") }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if list.selecting { list.selecting = false }
    }
}

// MARK: - Shared with Me, Changes

final class SharedScreenController: HostedScreen<AnyView> {
    init(model: SharedListModel, navigator: ScreenNavigator, feedback: ScreenFeedback) {
        super.init(rootView: AnyView(SharedListScreen(model: model).environment(\.screenNavigator, navigator).environment(\.screenFeedback, feedback)))
        title = model.title
        navigationItem.largeTitleDisplayMode = .always
        tabBarRoom = PhoneTabsController.room
    }

    @MainActor required dynamic init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not used") }
}

final class ChangesScreenController: HostedScreen<AnyView> {
    init(model: ChangesModel, navigator: ScreenNavigator, feedback: ScreenFeedback) {
        super.init(rootView: AnyView(ChangesScreen(model: model).environment(\.screenNavigator, navigator).environment(\.screenFeedback, feedback)))
        title = "Changes"
        navigationItem.largeTitleDisplayMode = .always
        tabBarRoom = PhoneTabsController.room
    }

    @MainActor required dynamic init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not used") }
}

// MARK: - Tasks and Calendar (N10 fills them)

final class TabRootPlaceholder: HostedScreen<AnyView> {
    private let phone: PhoneModel
    private let bell: UIBarButtonItem
    private let syncItem: UIBarButtonItem
    private var observer: Observer?

    init(title: String, symbol: String, message: String, phone: PhoneModel, actions: RootBarActions, id: String) {
        self.phone = phone
        bell = RootBar.bell(action: actions.notifications)
        syncItem = RootBar.sync(action: actions.sync)
        super.init(rootView: AnyView(PlaceholderRoot(symbol: symbol, title: title, message: message).accessibilityIdentifier(id)))
        self.title = title
        navigationItem.largeTitleDisplayMode = .always
        navigationItem.leftBarButtonItem = RootBar.avatar(phone, action: actions.account)
        navigationItem.rightBarButtonItems = [bell, syncItem]
        tabBarRoom = PhoneTabsController.room
    }

    @MainActor required dynamic init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        observer = Observer { [weak self] in
            guard let self else { return }
            RootBar.update(bell: self.bell, sync: self.syncItem, phone: self.phone)
        }
    }
}

private struct PlaceholderRoot: View {
    let symbol: String
    let title: String
    let message: String
    var body: some View {
        ScrollView {
            EmptyState(systemImage: symbol, title: title, message: message)
                .padding(.top, 80)
                .frame(maxWidth: .infinity)
        }
        .background(DS.color.canvas)
    }
}

// MARK: - Search (N11 replaces it with the full screen)

final class SearchScreenController: HostedScreen<AnyView> {
    init(client: EngineClient, prompt: String, navigator: ScreenNavigator) {
        super.init(rootView: AnyView(PhoneSearchView(client: client, prompt: prompt).environment(\.screenNavigator, navigator)))
        title = "Search"
        navigationItem.largeTitleDisplayMode = .never
        tabBarRoom = PhoneTabsController.room
    }

    @MainActor required dynamic init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not used") }
}

private struct PhoneSearchView: View {
    let client: EngineClient
    let prompt: String
    @State private var text = ""
    @State private var hits: [SearchHit] = []
    @State private var searched = false
    @FocusState private var focused: Bool
    @Environment(\.screenNavigator) private var navigator

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass").foregroundStyle(DS.color.inkFaint)
                TextField(prompt, text: $text)
                    .foleviFont(.body)
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("search-field")
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 40)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(DS.color.surfaceSunken))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            List(hits, id: \.id) { hit in
                Button {
                    navigator.prepareNote(hit.id)
                    navigator.open(.note(id: hit.id), nil)
                } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(hit.title.isEmpty ? "Untitled" : hit.title).foleviFont(.headline).foregroundStyle(DS.color.heading).lineLimit(1)
                        if !hit.snippet.isEmpty {
                            Text(hit.snippet).foleviFont(.callout).foregroundStyle(DS.color.inkMuted).lineLimit(2)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(DS.color.canvas)
            }
            .listStyle(.plain)
            .scrollDismissesKeyboard(.immediately)
            .overlay {
                if searched && hits.isEmpty && !text.isEmpty {
                    EmptyState(systemImage: "magnifyingglass", title: "No notes found", message: "Try other words.")
                }
            }
        }
        .background(DS.color.canvas)
        .onAppear { focused = true }
        .task(id: text) {
            let q = text.trimmingCharacters(in: .whitespaces)
            guard !q.isEmpty else { hits = []; searched = false; return }
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled else { return }
            if let v = try? await client.query(.search(text: q)) {
                hits = v.hits
                searched = true
            }
        }
    }
}

// MARK: - Web pages (Reviews, Graph) in the Page View with native bars

final class PageScreenController: UIViewController, PageViewOwner {
    private let page: FoleviEngine.WebPage
    private let model: PhoneModel
    private let pageHost: PageViewHost
    private var holder: PageViewHolder!
    var pageViewContainer: UIView { holder.view }

    init(page: FoleviEngine.WebPage, title: String, model: PhoneModel, pageHost: PageViewHost) {
        self.page = page
        self.model = model
        self.pageHost = pageHost
        super.init(nibName: nil, bundle: nil)
        self.title = title
        extendedLayoutIncludesOpaqueBars = true
        navigationItem.largeTitleDisplayMode = .never
        navigationItem.backButtonDisplayMode = .minimal
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Chrome.canvas
        holder = PageViewHolder.install(in: self)
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        holder?.match(view.safeAreaInsets)
        if pageHost.isOwned(by: self) { model.editor(.insets(top: Double(view.safeAreaInsets.top.rounded()), bottom: Double(view.safeAreaInsets.bottom.rounded()))) }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        pageHost.adopt(by: self)
        model.showWebPage(page)
    }

    func pageViewWillLeave(_ pageView: WKWebView) {}
}
