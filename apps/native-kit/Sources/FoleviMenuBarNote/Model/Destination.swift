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
    /// Its mark: your picture for Personal, the workspace's logo (nil: the initial of `markName`).
    public var imageUrl: String?
    public var markName: String?
    public var folders: [NoteFolder]
    public init(id: String, name: String, kind: String, canEdit: Bool, imageUrl: String? = nil, markName: String? = nil, folders: [NoteFolder]) {
        self.id = id; self.name = name; self.kind = kind; self.canEdit = canEdit; self.imageUrl = imageUrl; self.markName = markName; self.folders = folders
    }
}

public struct MenuBarNoteError: Error, LocalizedError, Sendable {
    public var message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// A screenshot taken into the panel, sent with the note.
public struct MenuNoteImage: Sendable, Equatable, Identifiable {
    public let id = UUID()
    public var mime: String
    public var name: String
    public var data: Data
    public init(mime: String, name: String, data: Data) { self.mime = mime; self.name = name; self.data = data }
}

/// What Save hands the host: a new note of `text` (its first line the title, as Home's quick note) with the images.
public struct MenuNotePayload: Sendable, Equatable {
    public var destination: NoteDestination
    public var text: String
    public var images: [MenuNoteImage]
}

/// The Mac app's side: a quiet page of its place that saves, lists folders and adds tasks, and its menus.
@MainActor
public protocol MenuBarNoteHost: AnyObject {
    /// The place notes go to (the one the main windows show).
    var placeID: String { get }
    /// The global shortcut as the panel shows it ("⌥Space"), nil when there's none.
    var shortcutLabel: String? { get }
    /// The spaces of the place and their folders.
    func destinations() async throws -> [NoteSpace]
    /// Makes the note; returns its id.
    func save(_ payload: MenuNotePayload) async throws -> String
    /// The text's first line as a task in `space` (Home's Add as a task).
    func addTask(_ text: String, space: String) async throws
    /// Undo of a save: the note to the Trash.
    func undoSave(noteID: String) async throws
    /// Opens a note, or Tasks, in Folevi's main window.
    func openInFolevi(path: String)
    /// Today's menu bar items, added to the panel's menu.
    func appMenuItems() -> [NSMenuItem]
}
