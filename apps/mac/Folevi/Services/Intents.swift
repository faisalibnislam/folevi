// Shortcuts and Siri on the Mac (App Intents): New Note, Add a Task and Open Note, as on iPhone and iPad
// (apps/ios AppAndWidgets/Intents.swift), also offered in Spotlight and the Shortcuts app without setting anything
// up (FoleviMacShortcuts). The Mac app is always at hand, so each goes through the open place's page, the way
// the menus do: "new-note-with-text" and "add-task" commands, answered with commandDone. Open Note picks from the
// notes the page last handed Spotlight (its recent and starred ones), by title.
import AppIntents
import AppKit
import Foundation

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
    private func all() -> [NoteEntity] {
        let place = WindowManager.shared.currentPlace() ?? "default"
        let notes = Spotlight.shared.notes[place] ?? Spotlight.shared.notes.values.first ?? []
        return notes.map { NoteEntity(id: $0.id, title: $0.title.isEmpty ? "Untitled" : $0.title, location: $0.location) }
    }

    func entities(for identifiers: [String]) async throws -> [NoteEntity] {
        let known = await all()
        return identifiers.compactMap { id in known.first { $0.id == id } }
    }

    func entities(matching string: String) async throws -> [NoteEntity] {
        let needle = string.trimmingCharacters(in: .whitespaces).lowercased()
        return await all().filter { needle.isEmpty || $0.title.lowercased().contains(needle) }
    }

    func suggestedEntities() async throws -> [NoteEntity] {
        await all()
    }
}

struct NewNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "New Note"
    static let description = IntentDescription("Starts a note in Folevi, with text in it if you give some.")
    static let openAppWhenRun = true

    @Parameter(title: "Text")
    var text: String?

    @MainActor
    func perform() async throws -> some IntentResult {
        _ = await Intents.newNote(text: text)
        return .result()
    }
}

struct AddTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Add a Task"
    static let description = IntentDescription("Adds a task to Folevi's Inbox.")

    @Parameter(title: "Task", requestValueDialog: "What do you need to do?")
    var text: String

    @Parameter(title: "Due date")
    var due: Date?

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let answer = await Intents.addTask(text: text, due: due)
        return .result(dialog: IntentDialog(stringLiteral: answer.message))
    }
}

struct OpenNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Note"
    static let description = IntentDescription("Opens one of your recent or starred notes in Folevi.")
    static let openAppWhenRun = true

    @Parameter(title: "Note")
    var note: NoteEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        Intents.open(noteId: note.id)
        return .result()
    }
}

struct FoleviMacShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddTaskIntent(), phrases: ["Add a task in \(.applicationName)", "Add a \(.applicationName) task", "New task in \(.applicationName)"], shortTitle: "Add a Task", systemImageName: "checkmark.circle")
        AppShortcut(intent: NewNoteIntent(), phrases: ["New note in \(.applicationName)", "Make a \(.applicationName) note", "Start a note in \(.applicationName)"], shortTitle: "New Note", systemImageName: "square.and.pencil")
        AppShortcut(intent: OpenNoteIntent(), phrases: ["Open a note in \(.applicationName)", "Find a note in \(.applicationName)"], shortTitle: "Open Note", systemImageName: "doc.text")
    }
}

/// What the intents do, also for scripts (MacEval "intent").
@MainActor
enum Intents {
    struct Answer {
        let ok: Bool
        let message: String
    }

    /// A new note: with text, the page makes it from the text (its first line the title); without, an empty one.
    static func newNote(text: String?) async -> Answer {
        let t = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        NSApp.activate()
        if t.isEmpty {
            guard let view = await Capabilities.mainPage() else { return Answer(ok: false, message: "Folevi couldn't open a window.") }
            Events.command(["type": "new-note"], to: view)
            return Answer(ok: true, message: "")
        }
        let answer = await Capabilities.ask(["type": "new-note-with-text", "text": String(t.prefix(ServicesProvider.maxText))], timeout: 60)
        return Answer(ok: answer?["ok"] as? Bool ?? false, message: answer?["message"] as? String ?? "")
    }

    /// A task in the open place's Inbox (due on `due`'s day when given).
    static func addTask(text: String, due: Date?) async -> Answer {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return Answer(ok: false, message: "Write the task first.") }
        var command: [String: Any] = ["type": "add-task", "text": String(t.prefix(500))]
        if let due { command["dueDate"] = day(due) }
        guard let answer = await Capabilities.ask(command, timeout: 60) else { return Answer(ok: false, message: "Folevi couldn't add the task. Open Folevi and try again.") }
        let ok = answer["ok"] as? Bool ?? false
        return Answer(ok: ok, message: answer["message"] as? String ?? (ok ? "Added." : "Folevi couldn't add the task."))
    }

    static func open(noteId: String) {
        let place = WindowManager.shared.currentPlace() ?? "default"
        Spotlight.shared.open(identifier: Spotlight.identifier(place: place, id: noteId))
    }

    /// YYYY-MM-DD in this Mac's time zone.
    static func day(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    #if DEBUG
    /// MacEval "intent": { name: "newNote" | "addTask" | "openNote", text?, due? (YYYY-MM-DD), id? }.
    static func run(_ name: String, _ req: [String: Any]) async -> [String: Any] {
        switch name {
        case "newNote":
            let a = await newNote(text: req["text"] as? String)
            return ["ok": a.ok, "message": a.message]
        case "addTask":
            let due = (req["due"] as? String).flatMap { s -> Date? in
                let f = DateFormatter()
                f.dateFormat = "yyyy-MM-dd"
                return f.date(from: s)
            }
            let a = await addTask(text: req["text"] as? String ?? "", due: due)
            return ["ok": a.ok, "message": a.message]
        case "openNote":
            open(noteId: req["id"] as? String ?? "")
            return ["ok": true]
        default:
            return ["error": "unknown intent \(name)"]
        }
    }
    #endif
}
