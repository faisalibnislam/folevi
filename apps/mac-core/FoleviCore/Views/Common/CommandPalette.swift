// The command palette (⌘K): one field for notes, places and commands. Notes come from search as you type; places
// and commands from the app's own list. Up and Down to move, Return to run, Escape to close. A floating glass
// panel over the window (a functional layer, so Liquid Glass belongs here).
import FoleviDesign
import FoleviEngine
import SwiftUI

struct PaletteItem: Identifiable, Hashable {
    enum Kind: Hashable { case note(String), place(Destination), command(String) }
    let id: String
    let kind: Kind
    let title: String
    let subtitle: String?
    let symbol: String
    let shortcut: String?
}

struct CommandPalette: View {
    let window: WindowModel
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @State private var hits: [SearchHit] = []
    @State private var index = 0
    @FocusState private var focused: Bool

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
                        .onSubmit(run)
                        .onKeyPress(.downArrow) { move(1); return .handled }
                        .onKeyPress(.upArrow) { move(-1); return .handled }
                        .onKeyPress(.escape) { close(); return .handled }
                }
                .padding(14)
                Divider()
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 2) {
                            ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                                row(item, selected: i == index)
                                    .id(item.id)
                                    .onTapGesture { index = i; run() }
                            }
                            if items.isEmpty { Text("No matches").foregroundStyle(.secondary).padding(14) }
                        }
                        .padding(6)
                    }
                    .frame(maxHeight: 380)
                    .onChange(of: index) { if items.indices.contains(index) { proxy.scrollTo(items[index].id) } }
                }
            }
            .frame(width: 600)
            .glassEffect(.regular, in: .rect(cornerRadius: 18))
            .shadow(color: .black.opacity(0.18), radius: 30, y: 12)
            .padding(.top, 80)
        }
        .onAppear { focused = true }
        .onChange(of: query) { index = 0; search() }
    }

    private func row(_ item: PaletteItem, selected: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: item.symbol).frame(width: 20).foregroundStyle(selected ? .white : .secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).font(item.kind.isNote ? CoreType.noteTitle(14) : .body).lineLimit(1)
                if let s = item.subtitle { Text(s).font(.caption).foregroundStyle(selected ? .white.opacity(0.8) : .secondary).lineLimit(1) }
            }
            Spacer()
            if let k = item.shortcut { Text(k).font(.caption).foregroundStyle(selected ? .white.opacity(0.8) : .secondary) }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .foregroundStyle(selected ? .white : .primary)
        .background(selected ? Color.accentColor : .clear, in: .rect(cornerRadius: 8))
        .contentShape(Rectangle())
    }

    private var items: [PaletteItem] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let notes = hits.prefix(8).map { PaletteItem(id: "n" + $0.id, kind: .note($0.id), title: $0.title.nonEmpty ?? "Untitled", subtitle: $0.folder?.name ?? $0.snippet, symbol: "doc.text", shortcut: nil) }
        let fixed = Self.commands.filter { q.isEmpty || $0.title.lowercased().contains(q) }
        let folders = (app.tree.value?.folders ?? []).filter { !q.isEmpty && $0.name.lowercased().contains(q) }.prefix(5)
            .map { PaletteItem(id: "f" + $0.id, kind: .place(.folder($0.id)), title: $0.name, subtitle: "Folder", symbol: "folder", shortcut: nil) }
        return Array(notes) + Array(folders) + fixed
    }

    static let commands: [PaletteItem] = [
        .init(id: "c-new", kind: .command("newNote"), title: "New Note", subtitle: nil, symbol: "square.and.pencil", shortcut: "⌘N"),
        .init(id: "c-tab", kind: .command("newTab"), title: "New Tab", subtitle: nil, symbol: "plus.square.on.square", shortcut: "⌘T"),
        .init(id: "c-quick", kind: .command("quickAdd"), title: "Quick Add", subtitle: nil, symbol: "bolt", shortcut: nil),
        .init(id: "c-ai", kind: .place(.foliAI(nil)), title: "Ask Foli AI", subtitle: nil, symbol: "sparkles", shortcut: "⇧⌘J"),
        .init(id: "c-home", kind: .place(.home), title: "Home", subtitle: "Go", symbol: "house", shortcut: "⇧⌘H"),
        .init(id: "c-all", kind: .place(.allNotes), title: "All Notes", subtitle: "Go", symbol: "doc.text", shortcut: nil),
        .init(id: "c-recent", kind: .place(.recent), title: "Recent", subtitle: "Go", symbol: "clock", shortcut: nil),
        .init(id: "c-tasks", kind: .place(.tasks(.today)), title: "Tasks", subtitle: "Go", symbol: "checklist", shortcut: "⇧⌘T"),
        .init(id: "c-cal", kind: .place(.calendar(nil)), title: "Calendar", subtitle: "Go", symbol: "calendar", shortcut: nil),
        .init(id: "c-starred", kind: .place(.starred), title: "Starred", subtitle: "Go", symbol: "star", shortcut: nil),
        .init(id: "c-drafts", kind: .place(.drafts), title: "Drafts", subtitle: "Go", symbol: "tray", shortcut: nil),
        .init(id: "c-notif", kind: .place(.notifications), title: "Notifications", subtitle: "Go", symbol: "bell", shortcut: nil),
        .init(id: "c-graph", kind: .place(.graph), title: "Foli DNA", subtitle: "Go", symbol: "point.3.connected.trianglepath.dotted", shortcut: nil),
        .init(id: "c-review", kind: .place(.reviews), title: "Reviews", subtitle: "Go", symbol: "rectangle.stack", shortcut: nil),
        .init(id: "c-vault", kind: .place(.vault), title: "Vault", subtitle: "Go", symbol: "lock.shield", shortcut: nil),
        .init(id: "c-trash", kind: .place(.trash), title: "Trash", subtitle: "Go", symbol: "trash", shortcut: nil),
        .init(id: "c-settings", kind: .command("settings"), title: "Settings", subtitle: nil, symbol: "gearshape", shortcut: "⌘,"),
        .init(id: "c-sync", kind: .command("sync"), title: "Sync Now", subtitle: nil, symbol: "arrow.triangle.2.circlepath", shortcut: nil),
    ]

    private func search() {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2, let client = app.client else { hits = []; return }
        Task { @MainActor in
            let r = try? await client.query(Views.Search(SearchArgs(text: q, scope: .place, space: nil, folderId: nil, tagId: nil, updatedAfter: nil, includeArchived: false, creatorId: nil, meaning: nil, limit: 12)))
            if q == query.trimmingCharacters(in: .whitespaces) { hits = r?.hits ?? [] }
        }
    }

    private func move(_ d: Int) {
        guard !items.isEmpty else { return }
        index = (index + d + items.count) % items.count
    }

    private func run() {
        guard items.indices.contains(index) else { return }
        let item = items[index]
        close()
        switch item.kind {
        case .note(let id): window.go(.note(id))
        case .place(let d): window.go(d)
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
