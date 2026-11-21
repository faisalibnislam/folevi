// Quick Add's field, in the floating panel (⌥Space from any app) and in a window (⇧⌘A). A task reads its date,
// repeat, priority ("!high", "!!!") and page ("#Atlas", #"Two words") from the words and shows each as a chip
// with an editor and an x that keeps the words as typed; a note goes to Drafts. Return adds and closes, ⇧Return
// adds and stays for another, ⌘Return adds and opens where it went, Escape closes. Without an engine (Core still
// starting), what you add waits in a queue and goes in once it can.
import AppKit
import FoleviDesign
import FoleviEngine
import SwiftUI

struct QuickAddView: View {
    let close: () -> Void
    var inWindow = false
    private var app: AppModel { .shared }
    @State private var text = ""
    @State private var kind: Kind = .task
    @State private var parsed: TaskParseValue?
    @State private var keepDate = false
    @State private var dateOverride: Date?
    @State private var timeOverride: Date?
    @State private var priority: TaskCreateArgs.Priority?
    @State private var page: (id: String, title: String)?
    @State private var editing: Chip?
    @State private var added: String?
    @State private var problem: String?
    @AppStorage("core.quickAdd.hintSeen") private var hintSeen = false
    @FocusState private var focused: Bool

    enum Kind: String, CaseIterable { case task = "Task", note = "Note" }
    enum Chip: Identifiable { case date, priority, page; var id: Int { switch self { case .date: 0; case .priority: 1; case .page: 2 } } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Picker("Kind", selection: $kind) { ForEach(Kind.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                Spacer()
                if let places = AppModel.shared.places.value, places.places.count > 1 {
                    // Add to: another place (an account, the library on this Mac) switches to it first.
                    Menu {
                        ForEach(places.places, id: \.id) { p in
                            Button {
                                if p.id != places.current { Places.shared.switchTo(p.id) }
                            } label: {
                                if p.id == places.current { Label(p.kind == .library ? "On This Mac" : p.name, systemImage: "checkmark") } else { Text(p.kind == .library ? "On This Mac" : p.name) }
                            }
                        }
                    } label: {
                        Text("Add to \(destination)").font(.caption)
                    }
                    .menuStyle(.borderlessButton).fixedSize().help("Add to another place")
                } else {
                    Text(destination).font(.caption).foregroundStyle(.secondary)
                }
            }
            HStack(alignment: .top, spacing: 8) {
                if kind == .task { Image(systemName: "circle").foregroundStyle(.secondary).padding(.top, 4) }
                TextField(kind == .task ? "What needs doing?" : "A thought to keep", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .lineLimit(1...6)
                    .focused($focused)
                    .onChange(of: text) { problem = nil; added = nil; parse() }
                    .onKeyPress(.return, phases: .down) { press in
                        if press.modifiers.contains(.shift) { add(stay: true); return .handled }
                        if press.modifiers.contains(.command) { add(open: true); return .handled }
                        add()
                        return .handled
                    }
            }
            if kind == .task { chips }
            HStack {
                if let added {
                    Label(added, systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                } else if let problem {
                    Text(problem).foregroundStyle(.red)
                } else if !hintSeen {
                    Text("Return adds it, ⇧Return adds another, ⌘Return adds and opens it.").foregroundStyle(.tertiary)
                } else {
                    Text("Return to add · Esc to close").foregroundStyle(.tertiary)
                }
                Spacer()
            }
            .font(.caption)
        }
        .padding(18)
        .frame(width: 560)
        .modifier(QuickAddSurface(inWindow: inWindow))
        .onAppear { focused = true }
        .onExitCommand(perform: close)
        .popover(item: $editing) { chip in editor(chip).padding(14) }
    }

    private var destination: String {
        if kind == .note { return "Drafts" }
        return page?.title ?? "Inbox"
    }

    // MARK: chips

    @ViewBuilder private var chips: some View {
        let date = dateText
        if date != nil || parsed?.repeatLabel != nil || priority != nil || page != nil {
            HStack(spacing: 6) {
                if let date { chip(date, icon: "calendar", edit: .date) { keepDate = true; dateOverride = nil; timeOverride = nil } }
                if let r = parsed?.repeatLabel, !keepDate { chip(r, icon: "repeat", edit: nil) { keepDate = true } }
                if let p = priority { chip(p.rawValue.capitalized, icon: "flag", edit: .priority) { priority = nil } }
                if let page { chip(page.title, icon: "doc.text", edit: .page) { self.page = nil } }
            }
        }
        HStack(spacing: 12) {
            if dateText == nil { Button("Date") { editing = .date }.buttonStyle(.borderless) }
            if priority == nil { Button("Priority") { editing = .priority }.buttonStyle(.borderless) }
            if page == nil { Button("Page") { editing = .page }.buttonStyle(.borderless) }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    private var dateText: String? {
        if let d = dateOverride {
            var s = d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
            if let t = timeOverride { s += " " + t.formatted(date: .omitted, time: .shortened) }
            return s
        }
        return keepDate ? nil : parsed?.dateText
    }

    private func chip(_ label: String, icon: String, edit: Chip?, remove: @escaping () -> Void) -> some View {
        HStack(spacing: 4) {
            Button { if let edit { editing = edit } } label: { Label(label, systemImage: icon) }.buttonStyle(.plain)
            Button(action: remove) { Image(systemName: "xmark") }.buttonStyle(.plain).help("Keep the words as typed")
        }
        .font(.caption)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(.fill.tertiary, in: .capsule)
    }

    @ViewBuilder private func editor(_ chip: Chip) -> some View {
        switch chip {
        case .date:
            VStack(alignment: .leading) {
                DatePicker("Date", selection: Binding(get: { dateOverride ?? Date() }, set: { dateOverride = $0 }), displayedComponents: .date).datePickerStyle(.graphical)
                Toggle("Time", isOn: Binding(get: { timeOverride != nil }, set: { timeOverride = $0 ? (timeOverride ?? Date()) : nil }))
                if timeOverride != nil { DatePicker("At", selection: Binding(get: { timeOverride ?? Date() }, set: { timeOverride = $0 }), displayedComponents: .hourAndMinute) }
            }
            .frame(width: 260)
        case .priority:
            Picker("Priority", selection: Binding(get: { priority }, set: { priority = $0; editing = nil })) {
                Text("None").tag(TaskCreateArgs.Priority?.none)
                Text("Low").tag(Optional(TaskCreateArgs.Priority.low))
                Text("Medium").tag(Optional(TaskCreateArgs.Priority.medium))
                Text("High").tag(Optional(TaskCreateArgs.Priority.high))
            }
            .pickerStyle(.segmented)
        case .page:
            PagePickerList { id, title in page = (id, title); editing = nil }
                .frame(width: 300, height: 260)
        }
    }

    // MARK: words

    /// The words with the priority and page tokens taken out (they're chips), and what they said.
    private func tokens(_ s: String) -> (rest: String, priority: TaskCreateArgs.Priority?, page: String?) {
        var rest = s
        var pr: TaskCreateArgs.Priority?
        for (pattern, value) in [("(^|\\s)(!high|!!!)(?=\\s|$)", TaskCreateArgs.Priority.high), ("(^|\\s)(!med|!medium|!!)(?=\\s|$)", .medium), ("(^|\\s)(!low|!)(?=\\s|$)", .low)] {
            if let r = rest.range(of: pattern, options: .regularExpression) { pr = pr ?? value; rest.removeSubrange(r) }
        }
        var pageName: String?
        if let r = rest.range(of: #"#"([^"]+)""#, options: .regularExpression) {
            pageName = String(rest[r]).dropFirst(2).dropLast().description
            rest.removeSubrange(r)
        } else if let r = rest.range(of: #"(^|\s)#([A-Za-z0-9][\w-]*)"#, options: .regularExpression) {
            pageName = String(rest[r]).trimmingCharacters(in: .whitespaces).dropFirst().description
            rest.removeSubrange(r)
        }
        return (rest.trimmingCharacters(in: .whitespaces), pr, pageName)
    }

    @State private var parseTask: Task<Void, Never>?

    private func parse() {
        parseTask?.cancel()
        guard kind == .task else { parsed = nil; return }
        let t = tokens(text)
        if let p = t.priority { priority = p }
        let words = t.rest
        let pageName = t.page
        parseTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled, let client = app.client else { return }
            if words.count >= 3 { parsed = try? await client.query(Views.TaskParse(TaskParseArgs(text: words))) } else { parsed = nil }
            if let pageName, page?.title.caseInsensitiveCompare(pageName) != .orderedSame,
               let hit = try? await client.query(Views.Search(SearchArgs(text: pageName, limit: 1))).hits.first {
                page = (hit.id, hit.title.nonEmpty ?? pageName)
            }
        }
    }

    // MARK: adding

    private func add(stay: Bool = false, open: Bool = false) {
        let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else {
            problem = kind == .task ? "Write the task first." : "Write the note first."
            NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested, userInfo: [.announcement: problem ?? ""])
            return
        }
        hintSeen = true
        let item = QuickAddQueue.Item(
            kind: kind == .task ? "task" : "note",
            text: kind == .task ? tokens(raw).rest : raw,
            dueDate: dateOverride.map { $0.formatted(CoreDates.dayFormat) },
            dueTime: timeOverride.map { Self.time.string(from: $0) },
            priority: priority?.rawValue,
            noteId: page?.id,
            keepText: keepDate
        )
        let where_ = destination
        text = ""
        parsed = nil
        dateOverride = nil
        timeOverride = nil
        priority = nil
        keepDate = false
        Task { @MainActor in
            do {
                let opened = try await QuickAddQueue.shared.send(item)
                added = "Added to \(where_)"
                if open, let opened { app.open(.note(opened), newTab: true) }
                if !stay && !open {
                    try? await Task.sleep(for: .milliseconds(700))
                    close()
                    added = nil
                } else if open {
                    close()
                }
            } catch {
                QuickAddQueue.shared.keep(item)
                added = "Saved. It goes in once Folevi Core is ready."
                if !stay { try? await Task.sleep(for: .milliseconds(900)); close() }
            }
        }
        if stay { page = nil }
    }

    static let time: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
}

/// The panel's glass, or a plain sheet in a window.
struct QuickAddSurface: ViewModifier {
    let inWindow: Bool
    func body(content: Content) -> some View {
        if inWindow { content } else { content.glassEffect(.regular, in: .rect(cornerRadius: 22)) }
    }
}

/// Recent notes and search, to pick the page a task goes to.
struct PagePickerList: View {
    let picked: (String, String) -> Void
    private var app: AppModel { .shared }
    @State private var query = ""
    @State private var hits: [(String, String)] = []

    var body: some View {
        VStack(alignment: .leading) {
            TextField("Inbox, or search a page…", text: $query).textFieldStyle(.roundedBorder)
            List(hits, id: \.0) { h in
                Button(h.1.nonEmpty ?? "Untitled") { picked(h.0, h.1.nonEmpty ?? "Untitled") }.buttonStyle(.plain)
            }
        }
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard let client = app.client else { return }
            if q.isEmpty {
                hits = ((try? await client.query(Views.Recent(RecentArgs(scope: .place, limit: 15))))?.rows ?? []).map { ($0.row.id, $0.row.title) }
            } else {
                try? await Task.sleep(for: .milliseconds(150))
                hits = ((try? await client.query(Views.Search(SearchArgs(text: q, limit: 20))))?.hits ?? []).map { ($0.id, $0.title) }
            }
        }
    }
}

/// What Quick Add sends, and the items waiting for an engine (Application Support/QuickAddQueue.json; never
/// anything from encrypted notes: it holds only what was typed into Quick Add).
@MainActor
final class QuickAddQueue {
    static let shared = QuickAddQueue()

    struct Item: Codable {
        var kind: String
        var text: String
        var dueDate: String?
        var dueTime: String?
        var priority: String?
        var noteId: String?
        var keepText: Bool
    }

    private var file: URL { Paths.supportFolder.appendingPathComponent("QuickAddQueue.json") }

    /// Sends one item; returns the note it went to (to open).
    @discardableResult
    func send(_ item: Item) async throws -> String? {
        guard let client = AppModel.shared.client, AppModel.shared.ready else { throw QuickAddWait() }
        if item.kind == "task" {
            let r = try await client.command(Commands.TaskCreate(TaskCreateArgs(text: item.text, noteId: item.noteId, dueDate: item.dueDate, dueTime: item.dueTime, priority: item.priority.flatMap(TaskCreateArgs.Priority.init(rawValue:)), keepText: item.keepText ? true : nil)))
            return r.noteId
        }
        let r = try await client.command(Commands.NoteCreate(NoteCreateArgs(text: item.text)))
        return r.id
    }

    func keep(_ item: Item) {
        var all = load()
        all.append(item)
        if let data = try? JSONEncoder().encode(all) { try? data.write(to: file, options: [.atomic, .completeFileProtection]) }
    }

    /// Once the engine is ready: everything waiting goes in, in order.
    func flush() {
        let waiting = load()
        guard !waiting.isEmpty else { return }
        try? FileManager.default.removeItem(at: file)
        Task { @MainActor in
            var left: [Item] = []
            for item in waiting {
                do { try await send(item) } catch { left.append(item) }
            }
            if !left.isEmpty, let data = try? JSONEncoder().encode(left) { try? data.write(to: file, options: .atomic) }
            let done = waiting.count - left.count
            if done > 0 { AppModel.shared.toast(done == 1 ? "1 item from Quick Add added" : "\(done) items from Quick Add added", tone: .success) }
        }
    }

    private func load() -> [Item] {
        (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode([Item].self, from: $0) } ?? []
    }

    struct QuickAddWait: Error {}
}
