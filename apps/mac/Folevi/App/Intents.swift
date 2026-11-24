// Shortcuts and Siri (App Intents): New Note (with text), Add a Task (with a due date), Open a Note and Search
// Notes. Notes come from the open place's engine (search), so Shortcuts finds every note the app can see.
import AppIntents
import AppKit
import FoleviEngine

struct NoteEntity: AppEntity, Identifiable {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Note"
    static let defaultQuery = NoteQuery()

    let id: String
    let title: String
    let location: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(location)")
    }
}

struct NoteQuery: EntityStringQuery {
    @MainActor
    private func search(_ text: String) async -> [NoteEntity] {
        guard let client = AppModel.shared.client else { return [] }
        if text.isEmpty {
            let recent = try? await client.query(Views.Recent(RecentArgs(scope: .place, limit: 30)))
            return (recent?.rows ?? []).map { NoteEntity(id: $0.row.id, title: $0.row.title.nonEmpty ?? "Untitled", location: $0.row.folder?.name ?? "Drafts") }
        }
        let r = try? await client.query(Views.Search(SearchArgs(text: text, scope: .place, space: nil, folderId: nil, tagId: nil, updatedAfter: nil, includeArchived: false, creatorId: nil, meaning: nil, limit: 30)))
        return (r?.hits ?? []).map { NoteEntity(id: $0.id, title: $0.title.nonEmpty ?? "Untitled", location: $0.folder?.name ?? "Drafts") }
    }

    func entities(for identifiers: [String]) async throws -> [NoteEntity] {
        await MainActor.run {
            identifiers.map { NoteEntity(id: $0, title: "Note", location: "") }
        }
    }

    func entities(matching string: String) async throws -> [NoteEntity] {
        await search(string.trimmingCharacters(in: .whitespaces))
    }

    func suggestedEntities() async throws -> [NoteEntity] {
        await search("")
    }
}

struct NewNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "New Note"
    static let description = IntentDescription("Makes a note in Folevi, with the text you give it.")
    static let openAppWhenRun = true

    @Parameter(title: "Text")
    var text: String?

    @MainActor
    func perform() async throws -> some IntentResult {
        await AppDelegate.whenLaunched()
        guard let client = AppModel.shared.client else { return .result() }
        let r = try await client.command(Commands.NoteCreate(NoteCreateArgs(text: text?.nonEmpty)))
        AppModel.shared.open(.note(r.id), newTab: AppModel.shared.front == nil)
        return .result()
    }
}

struct AddTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Add a Task"
    static let description = IntentDescription("Adds a task to your Folevi Inbox, with a due date when you give one.")

    @Parameter(title: "Task", requestValueDialog: "What do you need to do?")
    var text: String

    @Parameter(title: "Due date")
    var due: Date?

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        await AppDelegate.whenLaunched()
        guard let client = AppModel.shared.client else { return .result(dialog: "Open Folevi first.") }
        let r = try await client.command(Commands.TaskCreate(TaskCreateArgs(text: text, dueDate: due.map { $0.formatted(AppDates.dayFormat) })))
        return .result(dialog: "Added to \(r.where).")
    }
}

struct OpenNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Note"
    static let description = IntentDescription("Opens one of your notes in Folevi.")
    static let openAppWhenRun = true

    @Parameter(title: "Note")
    var note: NoteEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.shared.open(.note(note.id))
        return .result()
    }
}

struct SearchNotesIntent: AppIntent {
    static let title: LocalizedStringResource = "Search Notes"
    static let description = IntentDescription("Searches your notes in Folevi.")
    static let openAppWhenRun = true

    @Parameter(title: "Search for")
    var text: String

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.shared.open(.search(text))
        return .result()
    }
}

struct FoleviShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddTaskIntent(), phrases: ["Add a task in \(.applicationName)", "New task in \(.applicationName)"], shortTitle: "Add a Task", systemImageName: "checkmark.circle")
        AppShortcut(intent: NewNoteIntent(), phrases: ["New note in \(.applicationName)", "Start a note in \(.applicationName)"], shortTitle: "New Note", systemImageName: "square.and.pencil")
        AppShortcut(intent: OpenNoteIntent(), phrases: ["Open a note in \(.applicationName)"], shortTitle: "Open Note", systemImageName: "doc.text")
        AppShortcut(intent: SearchNotesIntent(), phrases: ["Search \(.applicationName)"], shortTitle: "Search Notes", systemImageName: "magnifyingglass")
    }
}
