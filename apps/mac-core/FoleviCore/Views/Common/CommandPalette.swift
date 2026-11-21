// The command palette (⌘K): one field for notes, folders and commands. Before typing: the notes opened last and
// the first actions. Typing searches notes (with Folder, Tag and Updated filters, the space or everywhere, archived
// and by meaning) and matches folders and commands. Up and Down move, Return opens here, ⌘Return opens a note in a
// new tab, Escape closes. A floating glass panel over the window (a functional layer, so Liquid Glass belongs here).
import FoleviDesign
import FoleviEngine
import SwiftUI

struct PaletteItem: Identifiable, Hashable {
    enum Kind: Hashable { case note(String, block: String?), place(Destination), command(String), ask }
    let id: String
    let kind: Kind
    let title: String
    let subtitle: String?
    let symbol: String
    let shortcut: String?
    var section: String = "Actions"
}

struct CommandPalette: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var query = ""
    @State private var hits: [SearchHit] = []
    @State private var searching = false
    @State private var index = 0
    @State private var folder: String?
    @State private var tag: String?
    @State private var updated: SearchScreen.Updated = .any
    @State private var everywhere = false
    @State private var archived = false
    @State private var meaning = false
    @State private var meaningAvailable = false
    @State private var recent = Live<Views.RecentViewed>()
    @FocusState private var focused: Bool

    private var q: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.opacity(0.08).ignoresSafeArea().onTapGesture { close() }
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").font(.title3).foregroundStyle(.secondary)
                    TextField("Search notes or type a command", text: $query)
                        .textFieldStyle(.plain)
                        .font(.title3)
                        .focused($focused)
                        .onSubmit { run(newTab: false) }
                        .onKeyPress(.downArrow) { move(1); return .handled }
                        .onKeyPress(.upArrow) { move(-1); return .handled }
                        .onKeyPress(.escape) { close(); return .handled }
                        .onKeyPress(.return, phases: .down) { press in
                            guard press.modifiers.contains(.command) else { return .ignored }
                            run(newTab: true)
                            return .handled
                        }
                    if searching { ProgressView().controlSize(.small) }
                }
                .padding(14)
                filters
                Divider()
                results
            }
            .frame(width: 640)
            .glassEffect(.regular, in: .rect(cornerRadius: 18))
            .shadow(color: .black.opacity(0.18), radius: 30, y: 12)
            .padding(.top, 80)
        }
        .onAppear { focused = true }
        .task { recent.bind(app.client, Views.RecentViewed(RecentViewedArgs(space: nil, limit: 6))) }
        .onChange(of: query) { index = 0; search() }
        .onChange(of: folder) { search() }
        .onChange(of: tag) { search() }
        .onChange(of: updated) { search() }
        .onChange(of: everywhere) { search() }
        .onChange(of: archived) { search() }
        .onChange(of: meaning) { search() }
    }

    private var filters: some View {
        HStack(spacing: 8) {
            Picker("Folder", selection: $folder) {
                Text("Any Folder").tag(String?.none)
                ForEach(FolderOrder.nested(app.tree.value?.folders ?? []), id: \.id) { f in
                    Text(String(repeating: "    ", count: f.depth) + f.name).tag(Optional(f.id))
                }
            }
            .labelsHidden().fixedSize()
            Picker("Tag", selection: $tag) {
                Text("Any Tag").tag(String?.none)
                ForEach(app.tree.value?.tags ?? [], id: \.id) { Text("#" + $0.name).tag(Optional($0.id)) }
            }
            .labelsHidden().fixedSize()
            Picker("Updated", selection: $updated) {
                ForEach(SearchScreen.Updated.allCases) { Text($0.title).tag($0) }
            }
            .labelsHidden().fixedSize()
            Menu {
                Picker("Where", selection: $everywhere) {
                    Text("In \(app.spaceName)").tag(false)
                    Text("Everywhere").tag(true)
                }
                .pickerStyle(.inline)
                Toggle("Include Archived Notes", isOn: $archived)
                if meaningAvailable { Toggle("Search by Meaning", isOn: $meaning) }
            } label: {
                Text(everywhere ? "Everywhere" : app.spaceName)
            }
            .fixedSize()
            Spacer()
        }
        .controlSize(.small)
        .padding(.horizontal, 14)
        .padding(.bottom, 10)
    }

    private var results: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    let all = items
                    ForEach(Array(all.enumerated()), id: \.element.id) { i, item in
                        if i == 0 || all[i - 1].section != item.section {
                            Text(item.section).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                .padding(.horizontal, 10).padding(.top, i == 0 ? 4 : 10).padding(.bottom, 2)
                        }
                        row(item, selected: i == index)
                            .id(item.id)
                            .onTapGesture { index = i; run(newTab: false) }
                    }
                    if !q.isEmpty, q.count >= 2, hits.isEmpty {
                        Text(searching ? "Searching…" : "No notes match “\(q)”.").foregroundStyle(.secondary).padding(.horizontal, 10).padding(.vertical, 8)
                    }
                }
                .padding(6)
            }
            .frame(maxHeight: 420)
            .onChange(of: index) { let all = items; if all.indices.contains(index) { proxy.scrollTo(all[index].id) } }
        }
    }

    private func row(_ item: PaletteItem, selected: Bool) -> some View {
        HStack(spacing: 10) {
            Group {
                if item.kind == .ask { AiMarkGlyph(size: 16, mono: selected) } else { Image(systemName: item.symbol) }
            }
            .frame(width: 20).foregroundStyle(selected ? Color.foleviOnInk : .secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).font(item.kind.isNote ? CoreType.noteTitle(14) : .body).lineLimit(1)
                if let s = item.subtitle, !s.isEmpty { Text(s).font(.caption).foregroundStyle(selected ? Color.foleviOnInk.opacity(0.8) : .secondary).lineLimit(1) }
            }
            Spacer()
            if let k = item.shortcut { Text(k).font(.caption).foregroundStyle(selected ? Color.foleviOnInk.opacity(0.8) : .secondary) }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .foregroundStyle(selected ? Color.foleviOnInk : .primary)
        .background(selected ? Color.foleviInk : .clear, in: .rect(cornerRadius: 8))
        .contentShape(Rectangle())
    }

    private var items: [PaletteItem] {
        let lower = q.lowercased()
        let caps = app.session.value?.capabilities
        let local = app.session.value?.mode == .local
        let actions = Self.commands.filter { c in
            switch c.kind {
            case .place(.graph): caps?.graph != false
            case .place(.changes): caps?.changes != false && !local
            default: true
            }
        }
        if lower.isEmpty {
            let recentRows = (recent.value?.rows ?? []).prefix(6).map {
                PaletteItem(id: "r" + $0.id, kind: .note($0.id, block: nil), title: $0.title.nonEmpty ?? "Untitled", subtitle: CoreDates.short($0.updatedAt), symbol: "doc.text", shortcut: nil, section: "Recent")
            }
            return Array(recentRows) + actions.prefix(4)
        }
        let edited = { (h: SearchHit) in "Edited " + CoreDates.short(h.updatedAt) + (h.folder.map { " · " + $0.name } ?? "") }
        let notes = hits.filter { $0.matchIn != "meaning" }.prefix(8).map {
            PaletteItem(id: "n" + $0.id + ($0.blockId ?? ""), kind: .note($0.id, block: $0.blockId), title: $0.title.nonEmpty ?? "Untitled", subtitle: $0.snippet.isEmpty ? edited($0) : $0.snippet, symbol: "doc.text", shortcut: nil, section: "Notes")
        }
        let meaningRows = hits.filter { $0.matchIn == "meaning" }.prefix(5).map {
            PaletteItem(id: "m" + $0.id, kind: .note($0.id, block: $0.blockId), title: $0.title.nonEmpty ?? "Untitled", subtitle: edited($0), symbol: "sparkle.magnifyingglass", shortcut: nil, section: "By Meaning")
        }
        let folders = (app.tree.value?.folders ?? []).filter { $0.name.lowercased().contains(lower) }.prefix(5)
            .map { PaletteItem(id: "f" + $0.id, kind: .place(.folder($0.id)), title: $0.name, subtitle: nil, symbol: "folder", shortcut: nil, section: "Folders") }
        let ask = caps?.ai == false ? [] : [PaletteItem(id: "ask", kind: .ask, title: "Ask Foli AI: \(q)", subtitle: nil, symbol: "sparkles", shortcut: "⌘J", section: "Foli AI")]
        let fixed = actions.filter { $0.title.lowercased().contains(lower) }
        return Array(notes) + Array(meaningRows) + Array(folders) + fixed + ask
    }

    static let commands: [PaletteItem] = [
        .init(id: "c-new", kind: .command("newNote"), title: "New Note", subtitle: nil, symbol: "square.and.pencil", shortcut: "⌘N"),
        .init(id: "c-tasks", kind: .place(.tasks(.today)), title: "Go to Tasks · Today", subtitle: nil, symbol: "checklist", shortcut: "⌃⌘T"),
        .init(id: "c-cal", kind: .place(.calendar(nil)), title: "Go to Calendar", subtitle: nil, symbol: "calendar", shortcut: nil),
        .init(id: "c-quick", kind: .command("quickAdd"), title: "Quick Add Task", subtitle: nil, symbol: "bolt", shortcut: "⇧⌘A"),
        .init(id: "c-tab", kind: .command("newTab"), title: "New Tab", subtitle: nil, symbol: "plus.square.on.square", shortcut: "⌘T"),
        .init(id: "c-ai", kind: .place(.foliAI(nil)), title: "Go to Foli AI", subtitle: nil, symbol: "sparkles", shortcut: "⇧⌘J"),
        .init(id: "c-home", kind: .place(.home), title: "Go to Home", subtitle: nil, symbol: "house", shortcut: "⇧⌘H"),
        .init(id: "c-all", kind: .place(.allNotes), title: "Go to All Notes", subtitle: nil, symbol: "doc.text", shortcut: nil),
        .init(id: "c-recent", kind: .place(.recent), title: "Go to Recent", subtitle: nil, symbol: "clock", shortcut: nil),
        .init(id: "c-starred", kind: .place(.starred), title: "Go to Starred", subtitle: nil, symbol: "star", shortcut: nil),
        .init(id: "c-drafts", kind: .place(.drafts), title: "Go to Drafts", subtitle: nil, symbol: "tray", shortcut: nil),
        .init(id: "c-notif", kind: .place(.notifications), title: "Go to Notifications", subtitle: nil, symbol: "bell", shortcut: nil),
        .init(id: "c-changes", kind: .place(.changes), title: "Go to Changes", subtitle: nil, symbol: "clock.arrow.circlepath", shortcut: nil),
        .init(id: "c-review", kind: .place(.reviews), title: "Go to Reviews", subtitle: nil, symbol: "rectangle.stack", shortcut: nil),
        .init(id: "c-graph", kind: .place(.graph), title: "Go to Foli DNA", subtitle: nil, symbol: "point.3.connected.trianglepath.dotted", shortcut: nil),
        .init(id: "c-vault", kind: .place(.vault), title: "Go to Vault", subtitle: nil, symbol: "lock.shield", shortcut: nil),
        .init(id: "c-search", kind: .place(.search("")), title: "Search All Notes", subtitle: nil, symbol: "magnifyingglass", shortcut: "⇧⌘F"),
        .init(id: "c-trash", kind: .place(.trash), title: "Open Trash", subtitle: nil, symbol: "trash", shortcut: nil),
        .init(id: "c-settings", kind: .command("settings"), title: "Settings", subtitle: nil, symbol: "gearshape", shortcut: "⌘,"),
        .init(id: "c-sync", kind: .command("sync"), title: "Sync Now", subtitle: nil, symbol: "arrow.triangle.2.circlepath", shortcut: nil),
    ]

    private func search() {
        let text = q
        guard text.count >= 2, let client = app.client else { hits = []; searching = false; return }
        searching = true
        let args = SearchArgs(text: text, scope: everywhere ? .everywhere : .place, space: nil, folderId: folder, tagId: tag, updatedAfter: updated.after, includeArchived: archived, creatorId: nil, meaning: meaning, limit: 16)
        Task { @MainActor in
            let r = try? await client.query(Views.Search(args))
            guard text == q else { return }
            hits = r?.hits ?? []
            meaningAvailable = r?.meaningAvailable ?? false
            searching = false
        }
    }

    private func move(_ d: Int) {
        let count = items.count
        guard count > 0 else { return }
        index = (index + d + count) % count
    }

    private func run(newTab: Bool) {
        let all = items
        guard all.indices.contains(index) else { return }
        let item = all[index]
        close()
        switch item.kind {
        case .note(let id, let block):
            if newTab { app.open(.note(id), newTab: true) } else { window.go(.note(id)) }
            if let block, !newTab {
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(400))
                    window.editor(EditorCommands.BlockJump(BlockJumpArgs(blockId: block)))
                }
            }
        case .place(let d):
            if newTab { app.open(d, newTab: true) } else { window.go(d) }
        case .ask:
            withAnimation(.snappy) { window.askShown = true }
        case .command(let c):
            switch c {
            case "newNote": NoteActions.newNote(app: app, window: window)
            case "newTab": app.open(.home, newTab: true)
            case "quickAdd": QuickAdd.shared.show()
            case "settings": SettingsRouter.shared.open(nil)
            case "sync": app.perform { _ = try await $0.command(Commands.EngineRefresh()) }
            default: break
            }
        }
    }

    private func close() { window.paletteShown = false }
}

extension PaletteItem.Kind {
    var isNote: Bool { if case .note = self { true } else { false } }
}
