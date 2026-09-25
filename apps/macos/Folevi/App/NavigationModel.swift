import Observation
import SwiftUI

enum SidebarItem: Hashable, Codable, Sendable {
    case all
    case tasks
    case calendar
    case daily
    case shared
    case templates
    case starred
    case archive
    case trash
    case folder(String)
    case tag(String)

    var title: LocalizedStringKey {
        switch self {
        case .all: return "All Documents"
        case .tasks: return "Tasks"
        case .calendar: return "Calendar"
        case .daily: return "Daily Notes"
        case .shared: return "Shared with Me"
        case .templates: return "Templates"
        case .starred: return "Starred"
        case .archive: return "Archive"
        case .trash: return "Trash"
        case .folder: return "Folder"
        case .tag: return "Tag"
        }
    }

    var systemImage: String {
        switch self {
        case .all: return "doc.on.doc"
        case .tasks: return "checklist"
        case .calendar: return "calendar"
        case .daily: return "sun.max"
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
        case .tasks: return "sidebar.tasks"
        case .calendar: return "sidebar.calendar"
        case .daily: return "sidebar.daily"
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
    var inspectorTab: InspectorTab = .format
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
        guard documentId != openDocumentId else { return }
        pushHistory(current)
        openDocumentId = documentId
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

    func toggleSidebar() {
        columnVisibility = columnVisibility == .detailOnly ? .all : .detailOnly
    }
}

enum InspectorTab: String, CaseIterable, Identifiable {
    case insert, format, style, info, comments
    var id: String { rawValue }
    var title: LocalizedStringKey {
        switch self {
        case .insert: return "Insert"
        case .format: return "Format"
        case .style: return "Style"
        case .info: return "Info"
        case .comments: return "Comments"
        }
    }
    var systemImage: String {
        switch self {
        case .insert: return "plus.square"
        case .format: return "textformat"
        case .style: return "paintpalette"
        case .info: return "info.circle"
        case .comments: return "text.bubble"
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
