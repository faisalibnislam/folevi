// The note's "…" menu on the iPhone, as the web's note page builds it (apps/web/src/components/doc/DocumentView.tsx
// useDocumentActions, grouped by noteMenu.tsx): the everyday items at the top, then a submenu for each kind of
// action (Connections, History, Move and copy, Share and export), then Archive and Move to Trash. A note in Trash
// offers Restore from Trash and Delete permanently… only. What the page offers comes from `editor.state`'s `menu`
// (contract revision 31); an older page without it gets the items every note had before.
import Foundation
import FoleviEngine

/// One row of the note's menu.
public enum NoteMenuItem: Hashable, Sendable {
    case bookmark(on: Bool)
    case info
    case find(replace: Bool)
    /// The note's flashcards to review (the count due now and new; 0: "Review this note’s cards").
    case review(cards: Int)
    /// "Make text in images searchable": the images Foli AI would read; `busy` while it reads them.
    case readImages(count: Int, busy: Bool)
    case related
    case dna
    case history
    case showEditors(on: Bool)
    case move(enabled: Bool)
    case copyTo
    case duplicate
    case moveToVault
    case export
    case present
    case print
    case saveAsTemplate
    case archive(on: Bool, enabled: Bool)
    case trash(enabled: Bool)
    case restore
    case deleteForever

    /// The web's words.
    public var title: String {
        switch self {
        case .bookmark(let on): on ? "Remove bookmark" : "Bookmark"
        case .info: "Info"
        case .find(let replace): replace ? "Find and replace…" : "Find in note…"
        case .review(let n): n > 0 ? "Review \(NoteMenuPlan.cardCount(n)) in this note" : "Review this note’s cards"
        case .readImages: "Make text in images searchable"
        case .related: "Related notes"
        case .dna: "Foli DNA"
        case .history: "Version history…"
        case .showEditors(let on): on ? "Hide editors" : "Show editors"
        case .move: "Move…"
        case .copyTo: "Copy to…"
        case .duplicate: "Duplicate"
        case .moveToVault: "Move to the Vault…"
        case .export: "Export…"
        case .present: "Present"
        case .print: "Print…"
        case .saveAsTemplate: "Save as template"
        case .archive(let on, _): on ? "Unarchive" : "Archive"
        case .trash: "Move to Trash"
        case .restore: "Restore from Trash"
        case .deleteForever: "Delete permanently…"
        }
    }

    /// A quieter second line (MenuItem.description).
    public var description: String? {
        guard case .readImages(let n, _) = self else { return nil }
        return "Foli AI reads \(n == 1 ? "1 image" : "\(n) images"). Uses AI credits."
    }

    /// Shown but not offered.
    public var disabled: Bool {
        switch self {
        case .readImages(_, let busy): busy
        case .move(let enabled), .archive(_, let enabled), .trash(let enabled): !enabled
        default: false
        }
    }

    public var danger: Bool {
        switch self {
        case .trash, .deleteForever: true
        default: false
        }
    }
}

/// A row of the menu as shown: an item, or a submenu of two or more.
public enum NoteMenuRow: Hashable, Sendable {
    case item(NoteMenuItem)
    case submenu(NoteMenuGroup, [NoteMenuItem])
}

/// The web's submenus, in order (noteMenu.tsx NOTE_SUBMENUS).
public enum NoteMenuGroup: String, Hashable, Sendable, CaseIterable {
    case connections = "Connections"
    case history = "History"
    case moveCopy = "Move and copy"
    case shareExport = "Share and export"
}

public enum NoteMenuPlan {
    /// What decides the menu.
    public struct Input: Sendable {
        public var meta: NoteMeta?
        /// `editor.state`'s `menu` for this note (nil: an older page, or not known yet).
        public var menu: NoteMenuState?
        /// The note's cards (`reviews { noteId }`): nil until known or when it has none; else due now plus new.
        public var reviewCards: Int?
        /// Foli DNA is on (the session's `graph` capability).
        public var graph: Bool

        public init(meta: NoteMeta?, menu: NoteMenuState?, reviewCards: Int?, graph: Bool) {
            self.meta = meta
            self.menu = menu
            self.reviewCards = reviewCards
            self.graph = graph
        }
    }

    public static func cardCount(_ n: Int) -> String { "\(n) card\(n == 1 ? "" : "s")" }

    /// The menu's sections (separators between them), each a list of rows.
    public static func sections(_ input: Input) -> [[NoteMenuRow]] {
        let meta = input.meta
        if meta?.inTrash == true {
            return [[.item(.restore), .item(.deleteForever)]]
        }
        let canEdit = meta?.canEdit ?? true
        // Can change the note itself (the web's canManage: "manage" or "write"); a page shared to read or comment can't.
        let full = canEdit && (meta.map { !["read", "comment"].contains($0.access) } ?? true)
        let mine = meta.map { $0.found && $0.space != nil } ?? false
        let template = meta?.kind == "template"
        // What the page runs: its own list, or (an older page) what every note had before revision 31.
        let offered: (NoteMenuAction) -> Bool = { action in
            if let menu = input.menu { return menu.actions.contains(action) }
            switch action {
            case .move, .copyTo, .duplicate, .delete: return full
            case .history, .find, .export, .present, .print: return true
            default: return false
            }
        }

        var top: [NoteMenuItem] = []
        if mine, let meta { top.append(.bookmark(on: meta.starred)) }
        top.append(.info)
        if offered(.find) { top.append(.find(replace: full)) }
        if let n = input.reviewCards { top.append(.review(cards: n)) }
        if let menu = input.menu, menu.readImages > 0 { top.append(.readImages(count: menu.readImages, busy: menu.readingImages)) }

        var connections: [NoteMenuItem] = []
        if input.menu?.related == true { connections.append(.related) }
        if input.graph && !template { connections.append(.dna) }

        var history: [NoteMenuItem] = []
        if offered(.history) { history.append(.history) }
        if offered(.showEditors) { history.append(.showEditors(on: input.menu?.showingEditors ?? false)) }

        var moveCopy: [NoteMenuItem] = []
        if full || offered(.move) { moveCopy.append(.move(enabled: offered(.move))) }
        if offered(.copyTo) { moveCopy.append(.copyTo) }
        if offered(.duplicate) { moveCopy.append(.duplicate) }
        if offered(.moveToVault) { moveCopy.append(.moveToVault) }

        var shareExport: [NoteMenuItem] = []
        if offered(.export) { shareExport.append(.export) }
        if offered(.present) { shareExport.append(.present) }
        if offered(.print) { shareExport.append(.print) }
        if offered(.saveAsTemplate) { shareExport.append(.saveAsTemplate) }

        var end: [NoteMenuItem] = []
        if mine, let meta {
            end.append(.archive(on: meta.archived, enabled: full || meta.archived))
            end.append(.trash(enabled: full))
        }

        // A group with one item shows that item in its place; one with none is left out (submenuOrItems).
        func group(_ g: NoteMenuGroup, _ items: [NoteMenuItem]) -> [NoteMenuRow] {
            items.count <= 1 ? items.map(NoteMenuRow.item) : [.submenu(g, items)]
        }
        let middle = group(.connections, connections) + group(.history, history) + group(.moveCopy, moveCopy) + group(.shareExport, shareExport)
        return [top.map(NoteMenuRow.item), middle, end.map(NoteMenuRow.item)].filter { !$0.isEmpty }
    }
}
