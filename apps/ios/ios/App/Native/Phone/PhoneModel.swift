// The frame's state for one window (plan 2.1: one Page View, one EngineClient per window): the engine client, the
// gate (which full screen to show instead of the app), the open note's bars (note.meta, editor.state,
// editor.panel), which notes the page has drawn (note.ready), the toasts, and the actions every screen shares
// (open a note, a new note, run a command and show a refusal as a toast).
import Foundation
import Observation
import UIKit
import FoleviEngine
import FoleviScreens

struct PhoneToast: Identifiable, Equatable {
    enum Tone { case info, success, error }
    enum Action { case engine(String), undo(ToastUndo), run(@MainActor () -> Void), retrySync }
    let id = UUID()
    var message: String
    var tone: Tone
    var actionTitle: String?
    var action: Action?
    static func == (a: PhoneToast, b: PhoneToast) -> Bool { a.id == b.id }
}

/// What the model asks of the frame (navigation lives in UIKit).
@MainActor
protocol PhoneRouting: AnyObject {
    func open(_ route: ScreenRoute, source: CardSource?)
    func openNote(_ id: String, source: CardSource?, focus: Bool)
    func openExternal(_ url: URL)
}

@MainActor
@Observable
final class PhoneModel {
    let client: EngineClient
    let place: String
    let session: ValueStore<SessionValue>
    let sync: ValueStore<SyncStatusValue>
    let places: ValueStore<PlacesValue>

    /// The screen to show instead of the app (nil: the app; "loading" never covers a returning person's app).
    private(set) var gate: GateChangedEvent?
    /// Whether the engine has said which screen to show yet (hello or gate.changed).
    private(set) var gateKnown = false
    private(set) var editorState: EditorStateEvent?
    private(set) var editorPanel: EditorPanel?
    private(set) var noteMeta: [String: NoteMeta] = [:]
    /// Notes the page has drawn since they were last asked for (note.ready).
    private(set) var readyNotes: Set<String> = []
    /// The note the page shows (or is preparing).
    private(set) var shownNote: String?
    private(set) var toasts: [PhoneToast] = []
    /// Keyboard on screen (KeyboardHost's notifications, read by the bars).
    var keyboardVisible = false
    /// How much of the window's bottom the keyboard covers (points).
    var keyboardOverlap: CGFloat = 0

    @ObservationIgnored weak var router: PhoneRouting?
    @ObservationIgnored private var eventsTask: Task<Void, Never>?
    @ObservationIgnored private var helloObserver: Observer?

    init(client: EngineClient) {
        self.client = client
        self.place = client.place
        session = client.watch(.session, snapshotKey: "session.\(client.place)")
        sync = client.watch(.syncStatus)
        places = client.watch(.placesList)
    }

    func start() {
        client.start()
        eventsTask = Task { [weak self] in
            guard let stream = self?.client.events() else { return }
            for await event in stream {
                guard let self else { return }
                self.handle(event)
            }
        }
        // hello carries the gate too (revision 3), for a page that was up before native listened.
        helloObserver = Observer { [weak self] in
            guard let self, let hello = self.client.hello else { return }
            if !self.gateKnown || hello.ready {
                self.gate = hello.ready ? nil : hello.gate
                self.gateKnown = true
            }
        }
    }

    func stop() {
        eventsTask?.cancel()
        helloObserver?.cancel()
    }

    // MARK: Events

    private func handle(_ event: EngineEvent) {
        switch event {
        case .engineReady:
            gate = nil
            gateKnown = true
            // A reloaded page shows no note: the note on screen asks again.
            readyNotes.removeAll()
            if let id = shownNote {
                shownNote = nil
                show(id)
            }
        case .gateChanged(let e):
            gate = e.gate == nil ? nil : e
            gateKnown = true
        case .noteMeta(let meta):
            noteMeta[meta.id] = meta
        case .noteReady(let e):
            readyNotes.insert(e.id)
        case .editorState(let e):
            editorState = e
        case .editorPanel(let e):
            editorPanel = e.panel
        case .navigateRequest(let e):
            if e.external, let url = URL(string: e.route) {
                router?.openExternal(url)
            } else if let id = e.noteId {
                router?.openNote(id, source: nil, focus: false)
            } else {
                router?.open(ScreenRoute(webRoute: e.route), source: nil)
            }
        case .toast(let e):
            var action: PhoneToast.Action?
            var title: String?
            if let a = e.action {
                action = .engine(a.id)
                title = a.label
            } else if let u = e.undo {
                action = .undo(u)
                title = "Undo"
            }
            push(PhoneToast(message: e.message, tone: e.tone == .error ? .error : e.tone == .success ? .success : .info, actionTitle: title, action: action))
        case .placeChanged, .syncStatus, .memoryRelieved, .unknown:
            break
        }
    }

    // MARK: The note page

    /// Touch-down on a card or row: the page draws the note while the finger is still down.
    func prepare(_ id: String) {
        guard shownNote != id else { return }
        shownNote = id
        readyNotes.remove(id)
        Task { _ = try? await client.editor(.notePrepare(id: id)) }
    }

    /// Shows a note in the Page View (it may be prepared already).
    func show(_ id: String, focus: Bool = false) {
        if shownNote != id { readyNotes.remove(id) }
        shownNote = id
        Task {
            if let r = try? await client.editor(.noteShow(id: id, focus: focus ? true : nil)), r.ready { readyNotes.insert(r.id) }
        }
    }

    /// A page that stays web (Reviews, Graph) in the Page View.
    func showWebPage(_ page: FoleviEngine.WebPage) {
        shownNote = nil
        editorState = nil
        editorPanel = nil
        perform { _ = try await self.client.editor(.webShow(page: page)) }
    }

    /// No note on screen: the page goes back to its idle route (frees the editor).
    func closeNote() {
        shownNote = nil
        editorState = nil
        editorPanel = nil
        Task { _ = try? await client.editor(.noteClose) }
    }

    func isReady(_ id: String) -> Bool { readyNotes.contains(id) }

    /// An editor command; a refusal (no note, read only) is quiet except for real failures.
    func editor<E: EngineEditorSpec>(_ command: E) {
        Task {
            do { _ = try await client.editor(command) } catch let f as EngineFailure {
                if f.bridgeCode == .noNote || f.bridgeCode == .unknownEditorCommand { return }
                toast(f.message, tone: .error)
            } catch {}
        }
    }

    var editing: Bool {
        guard let s = editorState, let id = shownNote else { return false }
        return s.noteId == id && s.focused && s.canEdit && keyboardVisible
    }

    // MARK: Actions

    /// A new note (in a folder when given), opened ready to type in.
    func newNote(folderId: String? = nil, templateId: String? = nil) {
        perform { [weak self] in
            guard let self else { return }
            let made = try await self.client.command(.noteCreate(folderId: folderId, templateId: templateId, open: false))
            self.router?.openNote(made.id, source: nil, focus: true)
        }
    }

    func star(_ id: String, _ on: Bool) { perform { try await self.client.command(.noteStar(ids: [id], starred: on)) } }
    func archive(_ id: String, _ on: Bool) { perform { try await self.client.command(.noteArchive(ids: [id], archived: on)) } }

    func retrySync() {
        perform { try await self.client.command(.engineRefresh) }
    }

    /// Runs an engine call; a refusal shows its message as a toast.
    func perform(_ work: @escaping @MainActor () async throws -> Void) {
        Task { @MainActor in
            do { try await work() } catch let f as EngineFailure {
                let unknown = [BridgeErrorCode.unknownCommand.rawValue, BridgeErrorCode.unknownView.rawValue].contains(f.code)
                self.toast(unknown ? "That isn't available in this version yet." : f.message, tone: .error)
            } catch {
                self.toast("Something went wrong. Try again.", tone: .error)
            }
        }
    }

    // MARK: Toasts

    func toast(_ message: String, tone: PhoneToast.Tone = .info, actionTitle: String? = nil, action: (@MainActor () -> Void)? = nil) {
        push(PhoneToast(message: message, tone: tone, actionTitle: action == nil ? nil : actionTitle, action: action.map { .run($0) }))
    }

    private func push(_ t: PhoneToast) {
        toasts.append(t)
        if toasts.count > 2 { toasts.removeFirst(toasts.count - 2) }
        let id = t.id
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(t.actionTitle == nil ? 3.5 : 6))
            self?.dismissToast(id)
        }
    }

    func dismissToast(_ id: UUID) { toasts.removeAll { $0.id == id } }

    func runToastAction(_ t: PhoneToast) {
        dismissToast(t.id)
        switch t.action {
        case .engine(let id): perform { try await self.client.command(.toastAction(id: id)) }
        case .undo(let u): undo(u)
        case .run(let f): f()
        case .retrySync: retrySync()
        case nil: break
        }
    }

    private func undo(_ u: ToastUndo) {
        let args = JSONValue.object(u.args)
        func decode<A: Decodable>(_: A.Type) -> A? { (try? JSONEncoder().encode(args)).flatMap { try? JSONDecoder().decode(A.self, from: $0) } }
        switch u.command {
        case .noteStar: if let a = decode(NoteStarArgs.self) { perform { try await self.client.command(Commands.NoteStar(a)) } }
        case .noteArchive: if let a = decode(NoteArchiveArgs.self) { perform { try await self.client.command(Commands.NoteArchive(a)) } }
        case .noteMove: if let a = decode(NoteMoveArgs.self) { perform { try await self.client.command(Commands.NoteMove(a)) } }
        case .noteTrash: if let a = decode(NoteIdsArgs.self) { perform { try await self.client.command(Commands.NoteTrash(a)) } }
        case .noteRestore: if let a = decode(NoteIdsArgs.self) { perform { try await self.client.command(Commands.NoteRestore(a)) } }
        default: toast("That can't be undone from here.", tone: .error)
        }
    }

    // MARK: Session facts the bars use

    var profileName: String { session.value?.profile.name ?? "" }
    var aiOn: Bool { session.value?.capabilities.ai ?? false }
    var syncIndicatorSymbol: String {
        switch sync.value?.state {
        case .offline: "icloud.slash"
        case .conflict, .error: "exclamationmark.icloud"
        case .saving, .syncing: "arrow.triangle.2.circlepath.icloud"
        default: "checkmark.icloud"
        }
    }
}
