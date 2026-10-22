// Folevi's App Intents: Siri, Shortcuts, Spotlight's actions, the widgets' check-off buttons and the
// Control Center control. Compiled into the app and the widget extension (an interactive widget runs its
// intent there). The ones that work in the background call the REST API with this device's token; the ones
// that open the app hand it a folevi:// link (PendingLink), the same way a link from another app arrives.
// In local mode there's no REST API: notes are picked from the page's list (LocalCatalog) and what can't be
// done without the page waits for it in the local-actions queue (Shared/LocalExtras.swift).
import AppIntents
import Foundation
import WidgetKit

enum FoleviIntentError: Error, CustomLocalizedStringResourceConvertible {
    case signedOut
    case offline
    case refused(String)

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .signedOut: return "Open Folevi and sign in first."
        case .offline: return "Folevi can't connect right now. Try again when you're online."
        case .refused(let message): return "\(message)"
        }
    }

    static func from(_ error: Error) -> FoleviIntentError {
        switch error as? FoleviAPI.Failure {
        case .signedOut?: return .signedOut
        case .offline?, .rateLimited?: return .offline
        case .refused(_, _, let message)?: return .refused(message)
        default: return .refused("Folevi couldn't do that.")
        }
    }
}

// MARK: Notes as entities (Open note, Add a task to a note)

struct NoteEntity: AppEntity, Identifiable {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Note"
    static let defaultQuery = NoteQuery()

    let id: String
    let title: String
    let place: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(place)")
    }

    init(id: String, title: String, place: String) {
        self.id = id
        self.title = title
        self.place = place
    }

    init(_ note: NoteSummary) {
        self.init(id: note.id, title: note.title, place: note.place.name)
    }
}

/// Notes found by searching Folevi (GET /notes?q=), with the recent ones as suggestions. In local mode: the
/// library's notes as the page last listed them.
struct NoteQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [NoteEntity] {
        let cached = WidgetStore.shared.load().notes + (LocalMode.on ? LocalCatalog.load() : [])
        var out: [NoteEntity] = []
        for id in identifiers {
            if let note = cached.first(where: { $0.id == id }) {
                out.append(NoteEntity(note))
            } else if let api = SharedAccount.api(), let note = try? await api.note(id) {
                out.append(NoteEntity(id: note.id, title: note.title, place: note.place.name))
            }
        }
        return out
    }

    func entities(matching string: String) async throws -> [NoteEntity] {
        if LocalMode.on { return LocalCatalog.search(string).map(NoteEntity.init) }
        guard let api = SharedAccount.api() else { throw FoleviIntentError.signedOut }
        do {
            return try await api.searchNotes(string, limit: 10).map(NoteEntity.init)
        } catch {
            throw FoleviIntentError.from(error)
        }
    }

    func suggestedEntities() async throws -> [NoteEntity] {
        if LocalMode.on { return Array(LocalCatalog.load().prefix(10)).map(NoteEntity.init) }
        if let api = SharedAccount.api(), let recent = try? await api.recentNotes(limit: 10) { return recent.map(NoteEntity.init) }
        return WidgetStore.shared.load().notes.map(NoteEntity.init)
    }
}

// MARK: Places as entities (Save to: the library and each account, several places only)

struct SavePlaceEntity: AppEntity, Identifiable {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Place"
    static let defaultQuery = SavePlaceQuery()

    let id: String
    let name: String
    let detail: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(detail)")
    }

    init(_ target: SaveTarget) {
        id = target.id
        name = target.name
        detail = target.detail
    }
}

/// This device's places as the app last listed them (SaveTargets), the one chosen last first.
struct SavePlaceQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [SavePlaceEntity] {
        let all = SaveTargets.load()
        return identifiers.compactMap { id in all.first { $0.id == id }.map(SavePlaceEntity.init) }
    }

    func suggestedEntities() async throws -> [SavePlaceEntity] {
        let all = SaveTargets.load()
        let first = SaveTargets.preferred()?.id
        return (all.filter { $0.id == first } + all.filter { $0.id != first }).map(SavePlaceEntity.init)
    }

    func defaultResult() async -> SavePlaceEntity? {
        SaveTargets.several() ? SaveTargets.preferred().map(SavePlaceEntity.init) : nil
    }
}

/// Where an intent saves: the place asked for, else (several places) the one chosen last; nil with one place.
func saveTarget(_ asked: SavePlaceEntity?) -> SaveTarget? {
    if let asked, let target = SaveTargets.target(asked.id) { return target }
    return SaveTargets.several() ? SaveTargets.preferred() : nil
}

// MARK: Background: add a task, check one off

struct AddTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Add a task"
    static let description = IntentDescription("Adds a task to your Inbox in Folevi, or to the end of a note.")

    @Parameter(title: "Task", requestValueDialog: "What do you need to do?")
    var text: String

    @Parameter(title: "Due date")
    var dueDate: Date?

    @Parameter(title: "Note")
    var note: NoteEntity?

    /// With several places on this device: the library or one of the accounts (the last one chosen by default).
    @Parameter(title: "Save to")
    var place: SavePlaceEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$text) in Folevi") {
            \.$dueDate
            \.$note
            \.$place
        }
    }

    init() {}

    init(text: String, dueDate: Date? = nil, note: NoteEntity? = nil, place: SavePlaceEntity? = nil) {
        self.text = text
        self.dueDate = dueDate
        self.note = note
        self.place = place
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw FoleviIntentError.refused("Say what the task is.") }
        if let target = saveTarget(place) {
            SaveTargets.remember(target.id)
            return .result(dialog: IntentDialog(stringLiteral: try await add(text, to: target)))
        }
        if LocalMode.on {
            // The library is the page's: the task waits for it, and goes in when Folevi next opens.
            do {
                try LocalActions.shared.add(.addTask, text: String(text.prefix(500)), dueDate: dueDate.map { DayFormat.string($0) }, noteId: note?.id)
            } catch {
                throw FoleviIntentError.refused("Folevi couldn't keep that task. Try again.")
            }
            if let note { return .result(dialog: "Added. It goes into \(note.title) when you next open Folevi.") }
            return .result(dialog: "Added. It goes into your Inbox when you next open Folevi.")
        }
        guard let api = SharedAccount.api() else { throw FoleviIntentError.signedOut }
        do {
            _ = try await api.createTask(text: text, dueDate: dueDate.map { DayFormat.string($0) }, noteId: note?.id)
        } catch {
            throw FoleviIntentError.from(error)
        }
        await WidgetStore.shared.refresh(api: api)
        WidgetCenter.shared.reloadAllTimelines()
        if let note { return .result(dialog: "Added to \(note.title).") }
        return .result(dialog: "Added to your Inbox.")
    }

    /// Several places: to the one chosen. An account takes it now with its own token; the library (and an account
    /// that's offline, or has no token here yet) keeps it, tagged, for that place's page.
    private func add(_ text: String, to target: SaveTarget) async throws -> String {
        let open = SaveTargets.isOpen(target.id)
        // A note picked from the open place's notes only means something there.
        let note = open ? self.note : nil
        let due = dueDate.map { DayFormat.string($0) }
        if !target.isLibrary, let api = SaveTargets.api(for: target) ?? (open ? SharedAccount.api() : nil) {
            do {
                _ = try await api.createTask(text: text, dueDate: due, noteId: note?.id)
                if open {
                    await WidgetStore.shared.refresh(api: api)
                    WidgetCenter.shared.reloadAllTimelines()
                }
                if let note { return "Added to \(note.title)." }
                return "Added to your Inbox in \(target.name)."
            } catch FoleviAPI.Failure.offline, FoleviAPI.Failure.rateLimited {
                // Kept below, for that account's page.
            } catch {
                throw FoleviIntentError.from(error)
            }
        }
        do {
            try LocalActions.shared.add(.addTask, text: String(text.prefix(500)), dueDate: due, noteId: note?.id, place: target.id)
        } catch {
            throw FoleviIntentError.refused("Folevi couldn't keep that task. Try again.")
        }
        if target.isLibrary { return open ? "Added. It goes into your Inbox when you next open Folevi." : "Added. It goes into the library's Inbox when you next open it." }
        return "Added. It goes into the Inbox in \(target.name) when you next open it."
    }
}

/// A widget's check-off button (not offered in Shortcuts).
struct ToggleTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Check off a task"
    static let isDiscoverable = false

    @Parameter(title: "Task")
    var taskId: String

    @Parameter(title: "Done")
    var completed: Bool

    init() {}

    init(taskId: String, completed: Bool = true) {
        self.taskId = taskId
        self.completed = completed
    }

    func perform() async throws -> some IntentResult {
        await WidgetStore.shared.setTask(taskId, completed: completed)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

// MARK: Opening the app

/// Opens a folevi:// link in the app: right away when it's running here, else when the app becomes active.
@MainActor
private func openInApp(_ url: URL) {
    PendingLink.open(url)
}

struct NewNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "New note"
    static let description = IntentDescription("Opens Folevi on a new note. With text, makes the note from it and opens it.")
    static let openAppWhenRun = true

    @Parameter(title: "Text")
    var text: String?

    /// With several places on this device: the library or one of the accounts (the last one chosen by default).
    @Parameter(title: "Save to")
    var place: SavePlaceEntity?

    init() {}

    init(text: String?, place: SavePlaceEntity? = nil) {
        self.text = text
        self.place = place
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        let target = saveTarget(place)
        if let target { SaveTargets.remember(target.id) }
        guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            openInApp(DeepLink.inPlace(DeepLink.newNoteURL, target?.id))
            return .result()
        }
        let content = ShareContent.tidy(title: nil, text: text, url: nil)
        // The first line is the title (as in the editor), the rest the note.
        let lines = text.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
        let body = lines[0].trimmingCharacters(in: .whitespaces) == content.title ? (lines.count > 1 ? String(lines[1]).trimmingCharacters(in: .whitespacesAndNewlines) : "") : text
        if let target {
            // Several places: made in the one chosen, which then opens on it.
            let title = content.title.isEmpty ? "Untitled" : content.title
            if !target.isLibrary, let api = SaveTargets.api(for: target) ?? (SaveTargets.isOpen(target.id) ? SharedAccount.api() : nil),
               let note = try? await api.createNote(title: title, markdown: ShareContent.paragraphs(body), place: nil, inInbox: false) {
                openInApp(DeepLink.inPlace(DeepLink.forNote(note.id) ?? URL(string: "folevi://documents")!, target.id))
                return .result()
            }
            // The library, or an account offline: kept for that place's page, which makes it as it opens.
            if (try? LocalActions.shared.add(.newNote, title: title, markdown: ShareContent.paragraphs(body), place: target.id)) != nil {
                openInApp(DeepLink.inPlace(URL(string: "folevi://documents")!, target.id))
                return .result()
            }
        }
        if LocalMode.on {
            // Made by the page as the app opens (it takes the local-actions queue), which then shows it.
            if (try? LocalActions.shared.add(.newNote, title: content.title.isEmpty ? "Untitled" : content.title, markdown: ShareContent.paragraphs(body))) != nil {
                return .result()
            }
        }
        if let api = SharedAccount.api(), let note = try? await api.createNote(title: content.title.isEmpty ? "Untitled" : content.title, markdown: ShareContent.paragraphs(body), place: nil, inInbox: false) {
            openInApp(DeepLink.forNote(note.id) ?? URL(string: "folevi://documents")!)
        } else {
            // Offline (or signed out): kept like a share, and saved to the Inbox when the page opens (which
            // says so); the app opens on Home meanwhile.
            _ = try? ShareQueue.shared.add(title: content.title, text: content.text, url: content.url ?? "", place: nil, accountId: SharedAccount.accountId, files: [])
            openInApp(URL(string: "folevi://documents")!)
        }
        return .result()
    }
}

struct OpenNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "Open note"
    static let description = IntentDescription("Opens a note in Folevi.")
    static let openAppWhenRun = true

    @Parameter(title: "Note")
    var note: NoteEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$note)")
    }

    init() {}

    init(note: NoteEntity) {
        self.note = note
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        openInApp(DeepLink.forNote(note.id) ?? URL(string: "folevi://documents")!)
        return .result()
    }
}

struct ShowTodayIntent: AppIntent {
    static let title: LocalizedStringResource = "Show today's tasks"
    static let description = IntentDescription("Opens Tasks > Today in Folevi.")
    static let openAppWhenRun = true

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        openInApp(DeepLink.todayURL)
        return .result()
    }
}

/// Quick add task (the Control Center control and the Action button).
struct OpenQuickAddIntent: AppIntent {
    static let title: LocalizedStringResource = "Quick add task"
    static let description = IntentDescription("Opens Folevi's Quick add task.")
    static let openAppWhenRun = true

    init() {}

    /// With several places: Quick add opens in the one chosen last.
    @MainActor
    func perform() async throws -> some IntentResult {
        openInApp(DeepLink.inPlace(DeepLink.quickAddURL, SaveTargets.several() ? SaveTargets.preferred()?.id : nil))
        return .result()
    }
}

/// The Quick add widget's setting: which place it adds to (the last one chosen, unless one is picked).
struct QuickAddPlaceIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Quick add"
    static let description = IntentDescription("Choose where Quick add puts tasks when this device holds several places.")

    @Parameter(title: "Save to")
    var place: SavePlaceEntity?

    init() {}
}
