import Observation
import SwiftUI

enum SidebarItem: Hashable, Codable, Sendable {
    /// Home: the dashboard.
    case all
    case drafts
    case notes
    case folders
    case tasks
    case calendar
    case shared
    case templates
    case starred
    case archive
    case trash
    case folder(String)
    case tag(String)

    var title: LocalizedStringKey {
        switch self {
        case .all: return "Home"
        case .drafts: return "Drafts"
        case .notes: return "All notes"
        case .folders: return "Folders"
        case .tasks: return "Tasks"
        case .calendar: return "Calendar"
        case .shared: return "Shared with Me"
        case .templates: return "Templates"
        case .starred: return "Starred"
        case .archive: return "Archive"
        case .trash: return "Trash"
        case .folder: return "Folder"
        case .tag: return "Tag"
        }
    }

    var titleString: String {
        switch self {
        case .all: return String(localized: "Home")
        case .drafts: return String(localized: "Drafts")
        case .notes: return String(localized: "All notes")
        case .folders: return String(localized: "Folders")
        case .tasks: return String(localized: "Tasks")
        case .calendar: return String(localized: "Calendar")
        case .shared: return String(localized: "Shared with Me")
        case .templates: return String(localized: "Templates")
        case .starred: return String(localized: "Starred")
        case .archive: return String(localized: "Archive")
        case .trash: return String(localized: "Trash")
        case .folder: return String(localized: "Folder")
        case .tag: return String(localized: "Tag")
        }
    }

    var systemImage: String {
        switch self {
        case .all: return "house"
        case .drafts: return "tray"
        case .notes: return "doc.on.doc"
        case .folders: return "folder"
        case .tasks: return "checklist"
        case .calendar: return "calendar"
        case .shared: return "person.2"
        case .templates: return "square.on.square.dashed"
        case .starred: return "star"
        case .archive: return "archivebox"
        case .trash: return "trash"
        case .folder: return "folder"
        case .tag: return "tag"
        }
    }

    var accessibilityId: String {
        switch self {
        case .all: return "sidebar.all"
        case .drafts: return "sidebar.drafts"
        case .notes: return "sidebar.notes"
        case .folders: return "sidebar.folders"
        case .tasks: return "sidebar.tasks"
        case .calendar: return "sidebar.calendar"
        case .shared: return "sidebar.shared"
        case .templates: return "sidebar.templates"
        case .starred: return "sidebar.starred"
        case .archive: return "sidebar.archive"
        case .trash: return "sidebar.trash"
        case .folder(let id): return "sidebar.folder.\(id)"
        case .tag(let id): return "sidebar.tag.\(id)"
        }
    }
}

enum BrowserLayout: String, CaseIterable, Identifiable, Sendable {
    case grid, compact, list
    var id: String { rawValue }
    var title: LocalizedStringKey {
        switch self {
        case .grid: return "Cards"
        case .compact: return "Compact"
        case .list: return "List"
        }
    }
    var systemImage: String {
        switch self {
        case .grid: return "square.grid.2x2"
        case .compact: return "square.grid.3x3"
        case .list: return "list.bullet"
        }
    }
}

enum BrowserSort: String, CaseIterable, Identifiable, Sendable {
    case updated, created, title
    var id: String { rawValue }
    var title: LocalizedStringKey {
        switch self {
        case .updated: return "Last Edited"
        case .created: return "Date Created"
        case .title: return "Title"
        }
    }
}

/// Per-window navigation: sidebar selection, open document, back/forward history, inspector.
@MainActor
@Observable
final class NavigationModel {
    struct Location: Hashable, Codable {
        var sidebar: SidebarItem
        var documentId: String?
    }

    var selection: SidebarItem = .all {
        didSet {
            if !isRestoring && oldValue != selection {
                pushHistory(Location(sidebar: oldValue, documentId: openDocumentId))
                openDocumentId = nil
            }
        }
    }
    var openDocumentId: String?
    var showInspector = false
    var inspectorTab: InspectorTab = .insert
    var columnVisibility: NavigationSplitViewVisibility = .all
    var showFind = false
    var layout: BrowserLayout = BrowserLayout(rawValue: UserDefaults.standard.string(forKey: "browserLayout") ?? "") ?? .grid {
        didSet { UserDefaults.standard.set(layout.rawValue, forKey: "browserLayout") }
    }
    var sort: BrowserSort = BrowserSort(rawValue: UserDefaults.standard.string(forKey: "browserSort") ?? "") ?? .updated {
        didSet { UserDefaults.standard.set(sort.rawValue, forKey: "browserSort") }
    }
    var showHistory = false
    var showExport = false

    private var back: [Location] = []
    private var forward: [Location] = []
    private var isRestoring = false

    var canGoBack: Bool { !back.isEmpty }
    var canGoForward: Bool { !forward.isEmpty }

    private var current: Location { Location(sidebar: selection, documentId: openDocumentId) }

    private func pushHistory(_ loc: Location) {
        back.append(loc)
        if back.count > 100 { back.removeFirst() }
        forward.removeAll()
    }

    func open(_ documentId: String) {
        addTab(documentId)
        guard documentId != openDocumentId else { return }
        pushHistory(current)
        openDocumentId = documentId
    }

    // MARK: Tabs

    /// Open notes as tabs (the web's tab strip), remembered for the main window.
    var tabs: [String] = [] {
        didSet { if persistsTabs, let tabsKey { UserDefaults.standard.set(tabs, forKey: tabsKey) } }
    }
    /// Where this scope's tabs are remembered; each scope (Personal, each workspace) has its own, as on the web.
    private var tabsKey: String?

    /// Shows a scope: its own tabs, and (when switching, not at launch) its Home with fresh history.
    func enterScope(_ key: String, goHome: Bool) {
        guard persistsTabs else { return }
        let newKey = "openTabs.\(key)"
        guard newKey != tabsKey else { return }
        tabsKey = newKey
        tabs = (UserDefaults.standard.array(forKey: newKey) as? [String]) ?? []
        guard goHome else { return }
        back.removeAll()
        forward.removeAll()
        isRestoring = true
        selection = .all
        openDocumentId = nil
        isRestoring = false
    }
    /// Document windows keep their own tabs out of the saved list.
    let persistsTabs: Bool

    init(persistsTabs: Bool = true) {
        self.persistsTabs = persistsTabs
        if !persistsTabs { tabs = [] }
    }
    private static let maxTabs = 8

    func addTab(_ documentId: String) {
        guard !tabs.contains(documentId) else { return }
        tabs.append(documentId)
        // Drop the oldest tabs that aren't open.
        while tabs.count > Self.maxTabs, let drop = tabs.first(where: { $0 != openDocumentId && $0 != documentId }) {
            tabs.removeAll { $0 == drop }
        }
    }

    /// Closes a tab; closing the open note opens its neighbour, or goes back to the list.
    func closeTab(_ documentId: String) {
        guard let index = tabs.firstIndex(of: documentId) else { return }
        tabs.remove(at: index)
        guard documentId == openDocumentId else { return }
        if tabs.isEmpty {
            closeDocument()
        } else {
            let next = tabs[min(index, tabs.count - 1)]
            pushHistory(current)
            openDocumentId = next
        }
    }

    /// Forgets tabs for notes that no longer exist here (deleted or never synced).
    func pruneTabs(existing: Set<String>) {
        let kept = tabs.filter { existing.contains($0) }
        if kept != tabs { tabs = kept }
    }

    func closeDocument() {
        guard openDocumentId != nil else { return }
        pushHistory(current)
        openDocumentId = nil
    }

    func goBack() {
        guard let loc = back.popLast() else { return }
        forward.append(current)
        restore(loc)
    }

    func goForward() {
        guard let loc = forward.popLast() else { return }
        back.append(current)
        restore(loc)
    }

    private func restore(_ loc: Location) {
        isRestoring = true
        selection = loc.sidebar
        openDocumentId = loc.documentId
        isRestoring = false
    }

    var sidebarVisible: Bool { columnVisibility != .detailOnly }

    func toggleSidebar() {
        columnVisibility = columnVisibility == .detailOnly ? .all : .detailOnly
    }
}

enum InspectorTab: String, CaseIterable, Identifiable {
    case insert, format, style, outline, info, comments
    var id: String { rawValue }
    var title: LocalizedStringKey {
        switch self {
        case .insert: return "Insert"
        case .format: return "Format"
        case .style: return "Style"
        case .outline: return "Outline"
        case .info: return "Info"
        case .comments: return "Comments"
        }
    }
    var systemImage: String {
        switch self {
        case .insert: return "plus"
        case .format: return "textformat"
        case .style: return "paintpalette"
        case .outline: return "list.bullet.indent"
        case .info: return "info.circle"
        case .comments: return "bubble.left"
        }
    }
}

// MARK: - Focused values (menu commands reach the active window/editor)

struct NavigationFocusKey: FocusedValueKey { typealias Value = NavigationModel }
struct EditorFocusKey: FocusedValueKey { typealias Value = EditorModel }

extension FocusedValues {
    var navigation: NavigationModel? {
        get { self[NavigationFocusKey.self] }
        set { self[NavigationFocusKey.self] = newValue }
    }
    var editor: EditorModel? {
        get { self[EditorFocusKey.self] }
        set { self[EditorFocusKey.self] = newValue }
    }
}
