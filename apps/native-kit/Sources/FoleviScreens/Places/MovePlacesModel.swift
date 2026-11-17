// "Move or copy notes" (the web's components/places/MovePlaces.tsx) for the phone: from the account sheet
// (everything here) or "Move to another place…" in a folder's menu (that folder picked). Where to (another place,
// and for an account its Personal or one of its workspaces), what (everything here, or what was picked), copy or
// move, version history; the engine's `places.move.preview` says where it can go and `places.move` runs it (its
// progress shows as the placeMove gate; from the library to an account it answers `switched` and goes on there).
import Foundation
import Observation
import FoleviEngine

/// What a "Move or copy notes" sheet starts with: the folders and notes picked (none: everything here).
public struct MovePlacesRequest: Identifiable, Hashable, Sendable {
    public let id = UUID()
    public var folders: [String]
    public var notes: [String]
    public init(folders: [String] = [], notes: [String] = []) {
        self.folders = folders
        self.notes = notes
    }
}

@MainActor
@Observable
public final class MovePlacesModel {
    public let client: EngineClient
    public let folders: [String]
    public let notes: [String]
    @ObservationIgnored let feedback: ScreenFeedback
    /// Everything in the open space (the web's "What": "Everything in …"), or the folders and notes picked.
    public private(set) var everything: Bool
    /// The destination's `value` ("<place>|personal", "<place>|ws:<id>").
    public private(set) var destination: String?
    /// Copy (they stay here too, the web's default) or move (they go to Trash here).
    public var copy = true
    /// Bring version history (default on).
    public var versions = true
    public private(set) var preview: PlaceMovePreview?
    public private(set) var running = false
    public private(set) var error: String?
    /// Which load is the latest (a slower earlier answer never replaces a newer one).
    @ObservationIgnored private var generation = 0

    public init(client: EngineClient, request: MovePlacesRequest = MovePlacesRequest(), feedback: ScreenFeedback = ScreenFeedback()) {
        self.client = client
        self.folders = request.folders
        self.notes = request.notes
        self.feedback = feedback
        self.everything = request.folders.isEmpty && request.notes.isEmpty
    }

    /// Something was picked from a menu (else "What" is only everything here).
    public var hasPick: Bool { !folders.isEmpty || !notes.isEmpty }
    public var loaded: Bool { preview != nil }
    public var destinations: [PlaceMoveDestination] { preview?.destinations ?? [] }
    public var chosen: PlaceMoveDestination? { destinations.first { $0.value == destination } }
    /// Where they come from ("Personal", a workspace's name, "On this iPhone").
    public var here: String { preview?.from ?? "" }

    // MARK: The web's words

    public var description: String { "From \(here) to another place. Nothing crosses between places unless you move it." }
    public static let noOtherPlace = "There's no other place yet. Sign in to another account from the account menu first."
    public var whatLabel: String { everything ? "Everything in \(here)" : "Folders and notes I pick" }
    public static func howLabel(copy: Bool) -> String { copy ? "Copy: they stay here too" : "Move: they go to Trash here" }
    public var actionTitle: String { copy ? "Copy notes" : "Move notes" }

    /// What goes, in words (the picked folders and notes counted).
    public var summary: String {
        guard let p = preview else { return "" }
        let what: String
        if everything {
            what = "Everything in \(here)"
        } else {
            var parts: [String] = []
            if p.folders > 0 { parts.append("\(p.folders) \(p.folders == 1 ? "folder" : "folders")") }
            if p.notes > 0 { parts.append("\(p.notes) \(p.notes == 1 ? "note" : "notes")") }
            let list = parts.isEmpty ? "Nothing" : parts.joined(separator: " and ")
            what = p.folders > 0 ? "\(list), with everything inside," : list
        }
        return copy ? "\(what) will be copied. The originals stay here." : "\(what) will move. They go to Trash here once they've arrived."
    }

    /// From the library to an account the move runs there: the web's note about it.
    public var switchNote: String? {
        guard let d = chosen, d.switches else { return nil }
        let name = d.label.components(separatedBy: ": ").first ?? d.label
        return "Folevi opens \(name) to do this, then shows how it went."
    }

    public var canRun: Bool {
        destination != nil && !running && (everything || hasPick) && preview?.fits != false
    }

    // MARK: Loading and running

    /// The destinations and what goes, for the destination chosen (the first one at first).
    public func load() async {
        generation += 1
        let mine = generation
        do {
            var p = try await client.query(.placesMovePreview(to: destination, folders: everything ? nil : folders, notes: everything ? nil : notes))
            if destination == nil, let first = p.destinations.first?.value {
                destination = first
                if p.to?.value != first {
                    p = try await client.query(.placesMovePreview(to: first, folders: everything ? nil : folders, notes: everything ? nil : notes))
                }
            }
            guard mine == generation else { return }
            preview = p
            error = nil
        } catch {
            guard mine == generation else { return }
            self.error = ScreenErrors.message(error)
        }
    }

    public func choose(destination value: String) async {
        guard value != destination else { return }
        destination = value
        await load()
    }

    /// Everything here, or what was picked (only when something was).
    public func setEverything(_ all: Bool) async {
        guard all != everything, all || hasPick else { return }
        everything = all
        await load()
    }

    /// Runs it; true when it's done (or goes on in the other place) and the sheet can close.
    @discardableResult
    public func run() async -> Bool {
        guard canRun, let to = destination else { return false }
        running = true
        defer { running = false }
        do {
            let r = try await client.command(.placesMove(to: to, folders: everything ? nil : folders, notes: everything ? nil : notes, copy: copy, versions: versions))
            switch r.status {
            case "switched":
                feedback.toast(ScreenToast("The move continues in the other place."))
            default:
                let n = "\(r.notes) \(r.notes == 1 ? "note" : "notes")"
                if r.problems > 0 {
                    feedback.toast(ScreenToast("\(copy ? "Copied" : "Moved") \(n). \(r.problems) couldn't be.", tone: .error))
                } else {
                    feedback.toast(ScreenToast("\(copy ? "Copied" : "Moved") \(n).", tone: .success))
                }
            }
            error = nil
            return true
        } catch {
            self.error = ScreenErrors.message(error)
            return false
        }
    }
}
