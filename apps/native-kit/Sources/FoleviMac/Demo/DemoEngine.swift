// A scripted engine for the Mac frame (docs/NATIVE_APP_PLAN.md section 3, ScriptedTransport): an in-memory place
// with notes, nested folders and tags that answers the frame's views and commands the way the web engine does
// (live updates after each command). It backs the frame's tests, SwiftUI previews and the Debug app's demo mode
// (FOLEVI_FRAME_DEMO=1), so the frame can be built, tested and screenshotted without a web export or an account.
// Never used for real data.
import Foundation
import FoleviEngine

@MainActor
public final class DemoEngine {
    /// (It holds the engine: whoever holds the client's transport keeps the demo place alive.)
    public private(set) lazy var transport = ScriptedTransport { m in try await self.respond(m) }
    public let place = "acct:demo"

    public var notes: [NoteRow] = []
    public var notificationRows: [NotificationRow] = []
    public var taskRows: [TaskRow] = []
    public var folders: [FolderNode] = []
    public var tags: [TagRow] = []
    public var space = "personal"
    /// The profile's picture and the workspace's logo (signed https links in a real place).
    public var avatarUrl: String?
    public var logoUrl: String?
    public var syncState: SyncState = .saved
    public var pending = 0
    public var online = true
    public var ready = true
    public var shownNote: String?
    /// Every editor command the frame sent (tests read it).
    public private(set) var editorLog: [String] = []
    /// Every command name the frame sent.
    public private(set) var commandLog: [String] = []

    private var watches: [String: (name: String, args: JSONValue, window: ListWindow?)] = [:]
    private var revs: [String: Int] = [:]
    private var nextId = 100

    public init(seed: Bool = true, now: Date = Date()) {
        if seed { seedData(now: now) }
    }

    public func client() -> EngineClient {
        EngineClient(transport: transport, place: place, app: AppInfo(platform: .macos, version: "1.1.00", build: "demo", protocol: EngineContract.protocolVersion, schemaHash: EngineContract.schemaHash))
    }

    // MARK: the protocol

    func respond(_ m: JSONValue) async throws -> JSONValue {
        let kind = m["kind"]?.string ?? ""
        let name = m["name"]?.string ?? ""
        switch kind {
        case "hello":
            return .object([
                "protocol": .number(Double(EngineContract.protocolVersion)), "revision": .number(Double(EngineContract.revision)), "build": .string("demo"),
                "schemaHash": .string(EngineContract.schemaHash), "ready": .bool(ready), "place": .string(place),
                "features": .array(EngineContract.features.map(JSONValue.string)), "views": .array([]), "listViews": .array([]), "commands": .array([]), "editorCommands": .array([]), "events": .array([]),
                "gate": Self.gate(ready ? nil : "loading"),
            ])
        case "watch":
            let sub = m["sub"]?.string ?? ""
            let window = try? m["window"].map { try $0.decode(ListWindow.self) }
            watches[sub] = (name, m["args"] ?? .object([:]), window ?? nil)
            revs[sub] = 0
            let value = try view(name, args: m["args"] ?? .object([:]), window: window ?? nil)
            Task { @MainActor in self.send(sub, value) }
            return .object(["sub": .string(sub)])
        case "unwatch":
            let sub = m["sub"]?.string ?? ""
            watches[sub] = nil
            revs[sub] = nil
            return .object(["ok": .bool(true)])
        case "window":
            let sub = m["sub"]?.string ?? ""
            if let w = try? m["window"]?.decode(ListWindow.self), var entry = watches[sub] {
                entry.window = w
                watches[sub] = entry
                refresh(sub)
            }
            return .object(["ok": .bool(true)])
        case "query":
            let window = try? m["window"].map { try $0.decode(ListWindow.self) }
            return try view(name, args: m["args"] ?? .object([:]), window: window ?? nil)
        case "command":
            commandLog.append(name)
            let result = try command(name, args: m["args"] ?? .object([:]))
            Task { @MainActor in self.refreshAll() }
            return result
        case "editor":
            editorLog.append(name)
            return try editor(name, args: m["args"] ?? .object([:]))
        default:
            throw EngineFailure.engine(EngineError(code: "invalid_message", message: "Unknown message."))
        }
    }

    private func send(_ sub: String, _ value: JSONValue) {
        guard watches[sub] != nil else { return }
        let rev = (revs[sub] ?? 0) + 1
        revs[sub] = rev
        let isList = watches[sub]?.name == "notes.list"
        var o: [String: JSONValue] = ["kind": .string("update"), "sub": .string(sub), "rev": .number(Double(rev))]
        o[isList ? "diff" : "value"] = value
        transport.push(.array([.object(o)]))
    }

    private func refresh(_ sub: String) {
        guard let w = watches[sub], let value = try? view(w.name, args: w.args, window: w.window) else { return }
        send(sub, value)
    }

    /// Every live view again (after a command), as the engine's updates would.
    public func refreshAll() {
        for sub in watches.keys { refresh(sub) }
    }

    /// An event from the engine.
    public func emit(_ name: String, _ data: JSONValue) {
        transport.push(.array([.object(["kind": .string("event"), "name": .string(name), "data": data])]))
    }

    /// A `gate.changed` value (the screen native shows instead of the app; nil: none).
    public static func gate(_ gate: String?) -> JSONValue {
        (try? .from(GateChangedEvent(gate: gate, title: gate == nil ? "" : "Opening your folio…", message: "", busy: gate == "loading", actions: [], fields: []))) ?? .object(["gate": .null])
    }

    // MARK: views

    func view(_ name: String, args: JSONValue, window: ListWindow?) throws -> JSONValue {
        switch name {
        case "session": return try .from(session)
        case "places.list": return try .from(placesValue)
        case "home": return try .from(homeValue)
        case "folders.tree": return try .from(FoldersTreeValue(space: space, folders: folders, tags: tags))
        case "sync.status": return try .from(syncValue)
        case "note.meta":
            let id = args["id"]?.string ?? ""
            return try .from(meta(id))
        case "tasks.list":
            let v = TaskViewName(rawValue: args["view"]?.string ?? "today") ?? .today
            let rows = tasks(for: v)
            let groups = Dictionary(grouping: rows, by: \.noteId).map { id, ts in
                TaskGroup(id: id, kind: .note, title: ts[0].noteTitle, icon: ts[0].noteIcon, tasks: ts)
            }.sorted { $0.title < $1.title }
            return try .from(TasksValue(view: v, groups: groups, total: rows.count))
        case "tasks.counts":
            return try .from(TaskCounts(inbox: tasks(for: .inbox).count, today: tasks(for: .today).count, upcoming: tasks(for: .upcoming).count, all: tasks(for: .all).count, mine: 0))
        case "tasks.range":
            let from = args["from"]?.string ?? "", to = args["to"]?.string ?? "~"
            return try .from(TasksRangeValue(tasks: taskRows.filter { ($0.dueDate ?? "") >= from && ($0.dueDate ?? "") <= to }))
        case "calendars.events":
            return try .from(CalendarEventsValue(events: []))
        case "calendars.list":
            return try .from(CalendarsValue(calendars: []))
        case "notes.meta":
            let ids = (try? args["ids"]?.decode([String].self)) ?? []
            return try .from(NotesMetaValue(notes: ids.map { id in
                let n = notes.first { $0.id == id }
                return NoteBrief(id: id, found: n != nil, title: n?.title ?? "", icon: n?.icon, inTrash: n?.inTrash ?? false)
            }))
        case "places.move.preview":
            let dests = [
                PlaceMoveDestination(value: "acct:work|personal", label: "Faisal at Airly", place: "acct:work", space: "personal", switches: false),
                PlaceMoveDestination(value: "library|personal", label: "On this Mac", place: "library", space: "personal", switches: true),
            ]
            let to = args["to"]?.string.flatMap { v in dests.first { $0.value == v } }
            return try .from(PlaceMovePreview(from: place, destinations: dests, to: to, folders: folders.count, notes: notes.count, everything: true, fits: to == nil ? nil : true))
        case "notifications.list":
            return try .from(NotificationsValue(unread: notificationRows.filter { !$0.read }.count, rows: notificationRows))
        case "search":
            let text = args["text"]?.string ?? ""
            let hits = notes.filter { !$0.inTrash && (text.isEmpty || $0.title.localizedCaseInsensitiveContains(text) || $0.excerpt.localizedCaseInsensitiveContains(text)) }
                .map { SearchHit(id: $0.id, title: $0.title, icon: $0.icon, snippet: $0.excerpt, folder: $0.folder, updatedAt: $0.updatedAt, archived: $0.archived, kind: $0.kind, matchIn: "text") }
            return try .from(SearchValue(text: text, hits: hits, meaningAvailable: false))
        case "notes.list":
            let a = try args.decode(NotesListArgs.self)
            let rows = list(a)
            let w = window ?? ListWindow(start: 0, count: 200)
            let slice = Array(rows.dropFirst(w.start).prefix(w.count))
            var upsert: [String: JSONValue] = [:]
            for r in slice { upsert[r.id] = try .from(r) }
            return .object([
                "reset": .bool(true), "total": .number(Double(rows.count)), "complete": .bool(true), "start": .number(Double(w.start)),
                "order": .array(slice.map { .string($0.id) }), "upsert": .object(upsert),
            ])
        default:
            throw EngineFailure.engine(EngineError(code: "unknown_view", message: "No view named \(name)."))
        }
    }

    public var session: SessionValue {
        SessionValue(
            place: place, mode: .account,
            profile: ProfileInfo(id: "u_demo", name: "Faisal Islam", email: "demo@folevi.test", avatarUrl: avatarUrl),
            spaces: [
                SpaceInfo(id: "personal", kind: .personal, name: "Personal", role: "owner", canEdit: true, canManage: false, encrypted: false, locked: false),
                SpaceInfo(id: "ws_airly", kind: .workspace, name: "Airly Studio", role: "admin", canEdit: true, canManage: true, encrypted: false, locked: false),
            ],
            space: space, online: online, today: "2026-10-24", timeZone: "Asia/Dhaka", appearance: .system,
            capabilities: Capabilities(graph: true, sharing: true, changes: true, workspaces: true, ai: true, purchases: false)
        )
    }

    public var placesValue: PlacesValue {
        PlacesValue(current: place, places: [
            PlaceRow(id: place, kind: .account, name: "Faisal Islam", email: "demo@folevi.test", avatarUrl: avatarUrl, syncs: nil, workspaces: [PlaceWorkspaceInfo(id: "ws_airly", name: "Airly Studio", logoUrl: logoUrl)], unread: 3, reminders: 0, waiting: 0),
            PlaceRow(id: "acct:work", kind: .account, name: "Faisal at Airly", email: "faisal@airly.test", avatarUrl: nil, syncs: nil, workspaces: [], unread: 1, reminders: 0, waiting: 0),
            PlaceRow(id: "library", kind: .library, name: "On this device", email: nil, avatarUrl: nil, syncs: "Syncs with iCloud Drive", workspaces: [], unread: 0, reminders: 0, waiting: 0),
        ])
    }

    public var syncValue: SyncStatusValue {
        let label: String
        switch syncState {
        case .saved: label = "Saved"
        case .saving: label = "Saving…"
        case .syncing: label = "Syncing…"
        case .offline: label = "Offline"
        case .conflict: label = "Conflict"
        case .error: label = "Not saved"
        }
        return SyncStatusValue(state: syncState, label: label, pending: pending, conflicts: syncState == .conflict ? 1 : 0, online: online, authRequired: false, spaces: [SpaceSyncInfo(space: space, state: .ready, have: notes.count, total: notes.count)])
    }

    public var homeValue: HomeValue {
        let live = notes.filter { !$0.archived && !$0.inTrash && $0.kind != "template" }
        let recents = Array(live.sorted { $0.updatedAt > $1.updatedAt }.prefix(10))
        let starred = live.filter(\.starred)
        let top = folders.filter { $0.parentId == nil }.map { f -> FolderCard in
            let inside = live.filter { $0.folder?.id == f.id }.sorted { $0.updatedAt > $1.updatedAt }
            return FolderCard(id: f.id, name: f.name, color: f.color, parentId: nil, noteCount: inside.count, childCount: f.childCount, updatedAt: inside.first?.updatedAt ?? 0,
                              previews: inside.prefix(3).map { FolderPreview(title: $0.title, excerpt: $0.excerpt, cover: $0.cover) }, encrypted: false, sync: .saved)
        }
        return HomeValue(
            space: space, spaceName: space == "personal" ? "Personal" : "Airly Studio", recents: recents, recentsLoaded: true,
            catchUp: CatchUpCard(available: true, state: .idle, brief: nil, error: nil),
            rows: [
                HomeRow(id: .notes, title: "All notes", count: live.count, route: "/notes"),
                HomeRow(id: .drafts, title: "Drafts", count: live.filter { $0.folder == nil }.count, route: "/drafts"),
                HomeRow(id: .shared, title: "Shared with me", count: 2, route: "/shared"),
                HomeRow(id: .changes, title: "Changes", count: 4, route: "/changes"),
            ],
            starred: StarredSection(rows: Array(starred.prefix(6)), more: starred.count > 6),
            folders: top, tags: tags
        )
    }

    func list(_ a: NotesListArgs) -> [NoteRow] {
        var rows: [NoteRow]
        switch a.view {
        case .all: rows = notes.filter { !$0.archived && !$0.inTrash && $0.kind != "template" }
        case .unsorted: rows = notes.filter { !$0.archived && !$0.inTrash && $0.folder == nil && $0.kind != "template" }
        case .starred: rows = notes.filter { $0.starred && !$0.inTrash }
        case .archive: rows = notes.filter { $0.archived && !$0.inTrash }
        case .trash: rows = notes.filter(\.inTrash)
        case .templates: rows = notes.filter { $0.kind == "template" && !$0.inTrash }
        case .folder: rows = notes.filter { $0.folder?.id == a.folderId && !$0.archived && !$0.inTrash }
        case .tag: rows = notes.filter { $0.tags.contains { $0.id == a.tagId } && !$0.inTrash }
        }
        switch a.sort ?? .updated {
        case .title: rows.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        case .created: rows.sort { $0.createdAt > $1.createdAt }
        default: rows.sort { $0.updatedAt > $1.updatedAt }
        }
        return rows
    }

    func meta(_ id: String) -> NoteMeta {
        guard let n = notes.first(where: { $0.id == id }) else {
            return NoteMeta(id: id, found: false, title: "", icon: nil, kind: "document", space: nil, folder: nil, breadcrumbs: [], starred: false, access: "full", canEdit: true, encrypted: false, archived: false, inTrash: false, cover: CardCover(kind: "none"), style: Self.style, sync: .saved)
        }
        return NoteMeta(id: n.id, found: true, title: n.title, icon: n.icon, kind: n.kind, space: space, folder: n.folder, breadcrumbs: [], starred: n.starred, access: "full", canEdit: true, encrypted: false, archived: n.archived, inTrash: n.inTrash, cover: n.cover, style: n.style, sync: n.sync)
    }

    static let today = "2026-10-24"

    func tasks(for v: TaskViewName) -> [TaskRow] {
        let open = taskRows.filter { $0.status == "open" }
        switch v {
        case .inbox: return open.filter { $0.noteId == "inbox" }
        case .today: return open.filter { ($0.dueDate ?? "~") <= Self.today && $0.dueDate != nil }
        case .upcoming: return open.filter { ($0.dueDate ?? "") > Self.today }
        case .all, .mine: return open
        case .completed: return taskRows.filter { $0.status == "done" }
        }
    }

    // MARK: commands

    func command(_ name: String, args: JSONValue) throws -> JSONValue {
        let ids = (args["ids"].flatMap { try? $0.decode([String].self) }) ?? []
        func bulk() -> JSONValue { .object(["done": .array(ids.map(JSONValue.string)), "skipped": .number(0), "queued": .bool(!online)]) }
        func edit(_ f: (inout NoteRow) -> Void) {
            for i in notes.indices where ids.contains(notes[i].id) {
                f(&notes[i])
                notes[i].h = UUID().uuidString
            }
        }
        switch name {
        case "note.create":
            nextId += 1
            let id = "doc_new\(nextId)"
            let folder = args["folderId"]?.string.flatMap { fid in folders.first { $0.id == fid } }.map { FolderChip(id: $0.id, name: $0.name, color: $0.color) }
            let text = args["text"]?.string ?? ""
            let lines = text.split(separator: "\n", maxSplits: 1).map(String.init)
            notes.append(Self.row(id: id, title: args["title"]?.string ?? lines.first ?? "", excerpt: lines.count > 1 ? lines[1] : "", folder: folder, updated: Date()))
            return .object(["id": .string(id)])
        case "note.star":
            let on = args["starred"]?.bool ?? true
            edit { $0.starred = on }
            return bulk()
        case "note.archive":
            let on = args["archived"]?.bool ?? true
            edit { $0.archived = on }
            return bulk()
        case "note.trash":
            edit { $0.inTrash = true }
            return bulk()
        case "note.restore":
            edit { $0.inTrash = false }
            return bulk()
        case "note.move":
            guard args["folderId"] != nil else { throw EngineFailure.engine(EngineError(code: "invalid_args", message: "folderId must be a folder id or null.")) }
            let target = args["folderId"]?.string.flatMap { fid in folders.first { $0.id == fid } }
            edit { $0.folder = target.map { FolderChip(id: $0.id, name: $0.name, color: $0.color) } }
            recount()
            return bulk()
        case "folder.create":
            nextId += 1
            let id = "fld_new\(nextId)"
            let parent = args["parentId"]?.string
            folders.append(FolderNode(id: id, name: args["name"]?.string ?? "New folder", color: nil, parentId: parent, depth: 0, rank: "z\(nextId)", childCount: 0, noteCount: 0, encrypted: false, sync: .saved))
            reorderTree()
            return .object(["id": .string(id)])
        case "folder.move":
            let id = args["id"]?.string ?? ""
            let parent = args["parentId"]?.string
            let after = args["afterId"]?.string
            guard let i = folders.firstIndex(where: { $0.id == id }) else { throw EngineFailure.engine(EngineError(code: "not_found", message: "That folder is gone.")) }
            var f = folders.remove(at: i)
            f.parentId = parent
            // Place it right after `after` among its new siblings (first when nil).
            let siblings = folders.filter { $0.parentId == parent }
            let rankAfter = after.flatMap { a in siblings.first { $0.id == a }?.rank }
            let next = siblings.first { rankAfter == nil ? true : $0.rank > rankAfter! }
            f.rank = rankAfter.map { r in next.map { Self.between(r, $0.rank) } ?? r + "m" } ?? next.map { Self.between("", $0.rank) } ?? "m"
            folders.append(f)
            reorderTree()
            return .object(["ok": .bool(true)])
        case "space.switch":
            space = args["space"]?.string ?? "personal"
            emit("place.changed", .object(["place": .string(place), "space": .string(space)]))
            return .object(["space": .string(space)])
        case "notification.markRead":
            let read = args["read"]?.bool ?? true
            for i in notificationRows.indices where ids.contains(notificationRows[i].id) { notificationRows[i].read = read }
            return .object(["ok": .bool(true)])
        case "notification.markAllRead":
            for i in notificationRows.indices { notificationRows[i].read = true }
            return .object(["ok": .bool(true)])
        case "task.create":
            nextId += 1
            return .object(["id": .string("task_\(nextId)"), "noteId": .string("inbox"), "where": .string("Inbox")])
        case "places.move":
            return .object(["status": .string("done"), "notes": .number(Double(notes.count)), "problems": .number(0)])
        case "engine.refresh", "catchUp.run", "catchUp.clear", "toast.action", "notification.act", "settings.update":
            return .object(["ok": .bool(true)])
        case _ where name.hasPrefix("task."):
            // Check off, reschedule, edit: applied as the engine would, for the demo's lists.
            if let id = args["id"]?.string, let i = taskRows.firstIndex(where: { $0.id == id }) {
                if let done = args["done"]?.bool { taskRows[i].status = done ? "done" : "open" }
                if let due = args["dueDate"]?.string { taskRows[i].dueDate = due }
            }
            return .object(["ok": .bool(true)])
        default:
            throw EngineFailure.engine(EngineError(code: "unknown_command", message: "No command named \(name)."))
        }
    }

    func editor(_ name: String, args: JSONValue) throws -> JSONValue {
        switch name {
        case "note.show", "note.prepare":
            let id = args["id"]?.string ?? ""
            shownNote = id
            let m = meta(id)
            Task { @MainActor in
                self.emit("note.ready", .object(["id": .string(id), "title": .string(m.title)]))
                if let v = try? JSONValue.from(m) { self.emit("note.meta", v) }
            }
            return .object(["id": .string(id), "ready": .bool(true)])
        case "note.close":
            shownNote = nil
            return .object(["ok": .bool(true)])
        case "panel.open", "ai":
            Task { @MainActor in self.emit("editor.panel", .object(["panel": .string(args["panel"]?.string ?? "ai")])) }
            return .object(["ok": .bool(true)])
        case "panel.close":
            Task { @MainActor in self.emit("editor.panel", .object(["panel": .null])) }
            return .object(["ok": .bool(true)])
        default:
            return .object(["ok": .bool(true)])
        }
    }

    // MARK: data

    private func recount() {
        for i in folders.indices {
            let id = folders[i].id
            folders[i].noteCount = notes.filter { $0.folder?.id == id && !$0.inTrash && !$0.archived }.count
        }
    }

    /// Depth-first order by rank, depths and child counts again (the engine's `folders.tree` shape).
    private func reorderTree() {
        var out: [FolderNode] = []
        func walk(_ parent: String?, _ depth: Int) {
            for var f in folders.filter({ $0.parentId == parent }).sorted(by: { $0.rank < $1.rank }) {
                f.depth = depth
                f.childCount = folders.filter { $0.parentId == f.id }.count
                out.append(f)
                walk(f.id, depth + 1)
            }
        }
        walk(nil, 0)
        folders = out
        recount()
    }

    static func between(_ a: String, _ b: String) -> String {
        // Good enough for a demo: a rank after `a` that sorts before `b`.
        let candidate = a + "m"
        return candidate < b ? candidate : a + "0"
    }

    static let style = CardStyle(font: "system", width: "normal", background: "paper", accent: "ember", card: "plain")

    static func row(id: String, title: String, icon: String? = nil, excerpt: String, preview: [PreviewLine]? = nil, cover: String? = nil, folder: FolderChip?, tags: [TagChip] = [], starred: Bool = false, updated: Date, kind: String = "document", font: String = "system") -> NoteRow {
        let ms = updated.timeIntervalSince1970 * 1000
        return NoteRow(id: id, title: title, icon: icon, kind: kind, excerpt: excerpt, preview: preview, cover: CardCover(kind: cover == nil ? "none" : "theme", value: cover),
                       style: CardStyle(font: font, width: "normal", background: "paper", accent: "ember", card: "plain"), starred: starred, createdAt: ms - 86_400_000 * 20, updatedAt: ms,
                       folder: folder, tags: tags, encrypted: false, archived: false, inTrash: false, sync: .saved, h: id + "-\(Int(ms))")
    }

    private func seedData(now: Date) {
        func ago(_ h: Double) -> Date { now.addingTimeInterval(-h * 3600) }
        folders = [
            FolderNode(id: "fld_work", name: "Work", color: "orange", parentId: nil, depth: 0, rank: "a", childCount: 1, noteCount: 0, encrypted: false, sync: .saved),
            FolderNode(id: "fld_projects", name: "Projects", color: nil, parentId: "fld_work", depth: 1, rank: "a", childCount: 1, noteCount: 0, encrypted: false, sync: .saved),
            FolderNode(id: "fld_launch", name: "Launch 1.1", color: "violet", parentId: "fld_projects", depth: 2, rank: "a", childCount: 0, noteCount: 0, encrypted: false, sync: .saved),
            FolderNode(id: "fld_trips", name: "Trips", color: "green", parentId: nil, depth: 0, rank: "b", childCount: 0, noteCount: 0, encrypted: false, sync: .saved),
            FolderNode(id: "fld_reading", name: "Reading", color: "amber", parentId: nil, depth: 0, rank: "c", childCount: 0, noteCount: 0, encrypted: false, sync: .waiting),
            FolderNode(id: "fld_recipes", name: "Recipes", color: "coral", parentId: nil, depth: 0, rank: "d", childCount: 0, noteCount: 0, encrypted: false, sync: .saved),
        ]
        tags = [TagRow(id: "tag_ideas", name: "ideas", color: "amber"), TagRow(id: "tag_people", name: "people", color: "violet")]
        let work = FolderChip(id: "fld_work", name: "Work", color: "orange")
        let launch = FolderChip(id: "fld_launch", name: "Launch 1.1", color: "violet")
        let trips = FolderChip(id: "fld_trips", name: "Trips", color: "green")
        let reading = FolderChip(id: "fld_reading", name: "Reading", color: "amber")
        let recipes = FolderChip(id: "fld_recipes", name: "Recipes", color: "coral")
        let ideas = TagChip(id: "tag_ideas", name: "ideas", color: "marigold")
        notes = [
            Self.row(id: "doc_kyoto", title: "Kyoto in November", icon: "🗺️", excerpt: "Book the ryokan, rail pass, the moss garden.", preview: [PreviewLine(t: "heading", x: "Kyoto in November", l: 1), PreviewLine(t: "todo", x: "Book the ryokan", c: true), PreviewLine(t: "todo", x: "Rail pass", c: false)], cover: "art-03", folder: trips, tags: [ideas], starred: true, updated: ago(1)),
            Self.row(id: "doc_launch", title: "Launch plan", icon: "🚀", excerpt: "Native frame, contract, TestFlight, notarized build.", preview: [PreviewLine(t: "heading", x: "Milestones", l: 2), PreviewLine(t: "bulleted", x: "M1: vertical slice"), PreviewLine(t: "bulleted", x: "M2: every screen native")], folder: launch, starred: true, updated: ago(2)),
            Self.row(id: "doc_standup", title: "Standup notes", excerpt: "Mac frame tabs and sidebar; Home screens; engine views.", folder: work, updated: ago(5)),
            Self.row(id: "doc_books", title: "Books to read", icon: "📚", excerpt: "The Dispossessed, Piranesi, A Psalm for the Wild-Built.", preview: [PreviewLine(t: "numbered", x: "The Dispossessed"), PreviewLine(t: "numbered", x: "Piranesi")], cover: "art-12", folder: reading, updated: ago(26)),
            Self.row(id: "doc_bread", title: "Sourdough", icon: "🍞", excerpt: "Levain at 9, mix at 1, bake at 7.", cover: "art-21", folder: recipes, updated: ago(50), font: "serif"),
            Self.row(id: "doc_ideas", title: "Ideas", excerpt: "A folder card that peeks; a calmer sync status.", folder: nil, tags: [ideas], updated: ago(8)),
            Self.row(id: "doc_meeting", title: "Meeting with Lina", excerpt: "Pricing, the 30% margin rule, per-seat plans.", folder: work, updated: ago(30)),
            Self.row(id: "doc_untitled", title: "", excerpt: "", folder: nil, updated: ago(72)),
            Self.row(id: "doc_lisbon", title: "Lisbon weekend", icon: "🇵🇹", excerpt: "Trams, tiles, pastéis.", cover: "art-07", folder: trips, updated: ago(200)),
            Self.row(id: "tpl_weekly", title: "Weekly review", excerpt: "What went well, what to change.", folder: nil, updated: ago(400), kind: "template"),
        ]
        var archived = Self.row(id: "doc_old", title: "Old roadmap", excerpt: "Superseded by the native plan.", folder: work, updated: ago(900))
        archived.archived = true
        var trashed = Self.row(id: "doc_trash", title: "Scratch", excerpt: "", folder: nil, updated: ago(100))
        trashed.inTrash = true
        notes += [archived, trashed]
        let ms = { (h: Double) in ago(h).timeIntervalSince1970 * 1000 }
        func task(_ id: String, _ title: String, note: String, _ noteTitle: String, icon: String? = nil, due: String?, time: String? = nil, done: Bool = false, overdue: Bool = false) -> TaskRow {
            TaskRow(id: id, noteId: note, noteTitle: noteTitle, noteIcon: icon, title: title, status: done ? "done" : "open", dueDate: due, dueTime: time, updatedAt: ms(2), overdue: overdue)
        }
        taskRows = [
            task("t1", "Book the ryokan", note: "doc_kyoto", "Kyoto in November", icon: "🗺️", due: "2026-10-24", time: "10:00"),
            task("t2", "Rail pass", note: "doc_kyoto", "Kyoto in November", icon: "🗺️", due: "2026-10-28"),
            task("t3", "Send the Mac frame screenshots", note: "doc_launch", "Launch plan", icon: "🚀", due: "2026-10-23", overdue: true),
            task("t4", "TestFlight build for the owner", note: "doc_launch", "Launch plan", icon: "🚀", due: "2026-10-30"),
            task("t5", "Call Lina about pricing", note: "inbox", "Inbox", due: nil),
            task("t6", "Feed the levain", note: "doc_bread", "Sourdough", icon: "🍞", due: "2026-10-24", time: "21:00"),
            task("t7", "Order flour", note: "doc_bread", "Sourdough", icon: "🍞", due: "2026-10-20", done: true),
        ]
        notificationRows = [
            NotificationRow(id: "n1", kind: "mention", title: "Lina mentioned you in Launch plan", body: "Can you check the Mac frame screenshots?", at: ms(0.5), read: false, route: "/d/doc_launch", actorName: "Lina", noteId: "doc_launch", noteTitle: "Launch plan", count: 1),
            NotificationRow(id: "n2", kind: "comment", title: "2 new comments on Kyoto in November", body: "", at: ms(3), read: false, route: "/d/doc_kyoto", actorName: "Sam", noteId: "doc_kyoto", noteTitle: "Kyoto in November", count: 2),
            NotificationRow(id: "n3", kind: "share", title: "Sam shared Reading list with you", body: "", at: ms(30), read: false, route: "/shared", actorName: "Sam", count: 1),
            NotificationRow(id: "n4", kind: "reminder", title: "Book the ryokan", body: "Due today", at: ms(50), read: true, route: "/d/doc_kyoto", noteId: "doc_kyoto", noteTitle: "Kyoto in November", count: 1),
        ]
        recount()
    }
}
