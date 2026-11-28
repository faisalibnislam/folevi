// Where "Save to note" puts a dot (owner decision, 2026-11-28): Personal or a team workspace, and a folder in it, or
// no folder for that workspace's Drafts. Always shown in the panel and remembered per place. The Mac app (the host)
// lists the choices and makes the note through the place's page (apps/web lib/desktop/quickNotes.ts).
import AppKit
import Foundation

public struct QuickNoteDestination: Codable, Equatable, Sendable {
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

    public static let personalDrafts = QuickNoteDestination(space: "personal", spaceName: "Personal")

    /// "Personal › Drafts", "Studio › Projects".
    public var label: String { "\(spaceName) › \(folderName ?? "Drafts")" }

    /// The same place still offered by `spaces` (names refreshed), or nil when it's gone or can't be written to.
    public func resolved(in spaces: [QuickNoteSpace]) -> QuickNoteDestination? {
        guard let s = spaces.first(where: { $0.id == space }), s.canEdit else { return nil }
        guard let folderId else { return QuickNoteDestination(space: s.id, spaceName: s.name) }
        guard let f = s.folders.first(where: { $0.id == folderId }) else { return nil }
        return QuickNoteDestination(space: s.id, spaceName: s.name, folderId: f.id, folderName: f.name)
    }
}

public struct QuickNoteFolder: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var depth: Int
    public init(id: String, name: String, depth: Int) { self.id = id; self.name = name; self.depth = depth }
}

public struct QuickNoteSpace: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var kind: String
    public var canEdit: Bool
    public var folders: [QuickNoteFolder]
    public init(id: String, name: String, kind: String, canEdit: Bool, folders: [QuickNoteFolder]) {
        self.id = id; self.name = name; self.kind = kind; self.canEdit = canEdit; self.folders = folders
    }
}

/// An image of the dot, sent with the note: the Markdown names it `![alt](ref)`.
public struct QuickNoteImage: Sendable, Equatable {
    public var ref: String
    public var mime: String
    public var name: String
    public var data: Data
}

/// What a save hands the host: a new note in `destination`.
public struct QuickNotePayload: Sendable, Equatable {
    public var destination: QuickNoteDestination
    public var title: String
    public var markdown: String
    public var images: [QuickNoteImage]
}

public struct QuickNotesHostError: Error, LocalizedError, Sendable {
    public var message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// The Mac app's side: its place, its pages and its menus. Everything the panel needs from Folevi goes through it.
@MainActor
public protocol QuickNotesHost: AnyObject {
    /// The place saves go to (the one the main windows show), and its name when there are several.
    var placeID: String { get }
    var placeName: String? { get }
    /// The spaces of the place and their folders.
    func destinations() async throws -> [QuickNoteSpace]
    /// Makes the note; returns its id.
    func save(_ payload: QuickNotePayload) async throws -> String
    /// Undo of a save: the note goes to the Trash.
    func undoSave(noteID: String) async throws
    /// Opens a note in Folevi's window.
    func openNote(_ id: String)
    /// Today's menu bar items (New Note, Quick Add, Search, recent notes, places, Open Folevi, Settings, Quit),
    /// added to the panel's menu.
    func appMenuItems() -> [NSMenuItem]
    /// The global shortcut as the panel shows it ("⌥Space"), nil when there's none.
    var shortcutLabel: String? { get }
}
