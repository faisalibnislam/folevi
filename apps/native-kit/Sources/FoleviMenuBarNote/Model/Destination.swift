// Where a new note from the menu bar goes (owner decisions, 2026-11-28): Personal or a team workspace, and a folder in
// it, or no folder for that workspace's Drafts, the default. Always shown in the panel and remembered per place. The
// Mac app (the host) lists the choices from the note's own page (apps/web lib/desktop/menuBarNote.ts).
import AppKit
import Foundation

public struct NoteDestination: Codable, Equatable, Sendable {
    /// "personal" or the workspace's id.
    public var space: String
    public var spaceName: String
    /// Nil: the workspace's Drafts.
    public var folderId: String?
    public var folderName: String?

    public init(space: String, spaceName: String, folderId: String? = nil, folderName: String? = nil) {
        self.space = space
        self.spaceName = spaceName
        self.folderId = folderId
        self.folderName = folderName
    }

    public static let personalDrafts = NoteDestination(space: "personal", spaceName: "Personal")

    /// "Personal › Drafts", "Studio › Projects".
    public var label: String { "\(spaceName) › \(folderName ?? "Drafts")" }

    /// The same place still offered by `spaces` (names refreshed), or nil when it's gone or can't be written to.
    public func resolved(in spaces: [NoteSpace]) -> NoteDestination? {
        guard let s = spaces.first(where: { $0.id == space }), s.canEdit else { return nil }
        guard let folderId else { return NoteDestination(space: s.id, spaceName: s.name) }
        guard let f = s.folders.first(where: { $0.id == folderId }) else { return nil }
        return NoteDestination(space: s.id, spaceName: s.name, folderId: f.id, folderName: f.name)
    }
}

public struct NoteFolder: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var depth: Int
    public init(id: String, name: String, depth: Int) { self.id = id; self.name = name; self.depth = depth }
}

public struct NoteSpace: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var kind: String
    public var canEdit: Bool
    public var folders: [NoteFolder]
    public init(id: String, name: String, kind: String, canEdit: Bool, folders: [NoteFolder]) {
        self.id = id; self.name = name; self.kind = kind; self.canEdit = canEdit; self.folders = folders
    }
}

public struct MenuBarNoteError: Error, LocalizedError, Sendable {
    public var message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// The Mac app's side: the note's page (a web view on Folevi's own editor), its place and its menus.
@MainActor
public protocol MenuBarNoteHost: AnyObject {
    /// The place the note belongs to (the one the main windows show).
    var placeID: String { get }
    /// The global shortcut as the panel shows it ("⌥Space"), nil when there's none.
    var shortcutLabel: String? { get }
    /// The web view showing the note (made once, kept).
    var noteView: NSView { get }
    /// Sends the note's view to an app path (`MenuBarNoteModel.notePath`, `composerPath`).
    func load(path: String)
    /// The path the view shows now, nil before it loaded one.
    var currentPath: String? { get }
    /// The spaces of the place and their folders, from the note's page.
    func destinations() async throws -> [NoteSpace]
    /// Puts an image into the note at the caret (uploaded with it, as a paste would).
    func insertImage(_ data: Data, mime: String, name: String) async throws
    /// Gives the note the keyboard.
    func focusNote()
    /// Tells the page to save now (the panel hides, the app quits).
    func flush()
    /// Opens the note in Folevi's main window.
    func openInFolevi(path: String)
    /// Today's menu bar items (Quick Add Task, New Note, Search, recent notes, places, Open Folevi, Settings,
    /// Quit), added to the panel's menu.
    func appMenuItems() -> [NSMenuItem]
}
