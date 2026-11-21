// Recent, Search, Shared with Me, a shared folder, Changes, Templates, Folders, Tags, an invitation, the daily
// note and the screens that stay on the page (Reviews, the Foli DNA graph).
import FoleviDesign
import FoleviEngine
import SwiftUI

// MARK: Recent

struct RecentScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var recent = Live<Views.Recent>()
    @AppStorage("core.recent.everywhere") private var everywhere = false

    var body: some View {
        Group {
            if let rows = recent.value?.rows {
                if rows.isEmpty {
                    EmptyScreen(symbol: "clock", title: "Nothing Recent", message: "Notes you open show up here.")
                } else if window.listStyle == .cards {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 190, maximum: 250), spacing: 20)], spacing: 22) {
                            ForEach(rows, id: \.row.id) { r in NoteCardButton(row: r.row, window: window) }
                        }
                        .padding(24)
                    }
                } else {
                    List {
                        ForEach(rows, id: \.row.id) { r in
                            NoteListRow(row: r.row)
                                .contentShape(Rectangle())
                                .onTapGesture(count: 2) { window.go(.note(r.row.id)) }
                                .contextMenu {
                                    NoteMenu(row: r.row, window: window)
                                    Divider()
                                    Button("Hide from Recent") { app.perform { _ = try await $0.command(Commands.NoteHideFromRecent(NoteIdsArgs(ids: [r.row.id]))) } }
                                }
                                .draggable(NoteDrag(id: r.row.id, title: r.row.title))
                        }
                    }
                    .listStyle(.inset)
                }
            } else {
                LoadingScreen()
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .secondaryAction) {
                ListStylePicker(window: window)
                if (app.places.value?.places.count ?? 0) > 1 {
                    Toggle(isOn: $everywhere) { Label("Every Place", systemImage: "square.stack.3d.up") }
                        .help("Show recent notes from every place on this Mac")
                }
            }
        }
        .task(id: everywhere) { recent.bind(app.client, Views.Recent(RecentArgs(scope: everywhere ? .everywhere : .place, limit: 100))) }
    }
}

// MARK: Search

/// Search across the space: titles and text, with filters (folder, tag, edited since, archived) and, where the
/// account has it, search by meaning.
struct SearchScreen: View {
    let window: WindowModel
    let initial: String
    private var app: AppModel { .shared }
    @State private var text = ""
    @State private var result: SearchValue?
    @State private var searching = false
    @State private var folder: String?
    @State private var tag: String?
    @State private var archived = false
    @State private var meaning = false
    @State private var everywhere = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search notes", text: $text)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($focused)
                    .onSubmit { run() }
                if searching { ProgressView().controlSize(.small) }
            }
            .padding(12)
            .background(.fill.quinary, in: .rect(cornerRadius: 10))
            .padding(.horizontal, 24)
            .padding(.top, 16)

            HStack(spacing: 12) {
                Picker("Folder", selection: $folder) {
                    Text("Any Folder").tag(String?.none)
                    ForEach(app.tree.value?.folders ?? [], id: \.id) { Text($0.name).tag(Optional($0.id)) }
                }
                .frame(maxWidth: 200)
                Picker("Tag", selection: $tag) {
                    Text("Any Tag").tag(String?.none)
                    ForEach(app.tree.value?.tags ?? [], id: \.id) { Text("#" + $0.name).tag(Optional($0.id)) }
                }
                .frame(maxWidth: 180)
                Toggle("Archived", isOn: $archived).toggleStyle(.checkbox)
                if result?.meaningAvailable == true { Toggle("By Meaning", isOn: $meaning).toggleStyle(.checkbox).help("Find notes about the same thing, even in other words") }
                if (app.places.value?.places.count ?? 0) > 1 { Toggle("Every Place", isOn: $everywhere).toggleStyle(.checkbox) }
                Spacer()
            }
            .labelsHidden()
            .controlSize(.small)
            .padding(.horizontal, 24)
            .padding(.vertical, 10)

            Divider()
            if let r = result, !r.text.isEmpty {
                if r.hits.isEmpty {
                    EmptyScreen(symbol: "magnifyingglass", title: "No Results", message: "Nothing matches “\(r.text)”.")
                } else {
                    List(r.hits, id: \.id) { hit in
                        SearchHitRow(hit: hit, query: r.text)
                            .contentShape(Rectangle())
                            .onTapGesture { open(hit) }
                    }
                    .listStyle(.inset)
                }
            } else {
                EmptyScreen(symbol: "magnifyingglass", title: "Search Your Notes", message: "Type a word or phrase. Press ⌘K anywhere for the command palette.")
            }
        }
        .onAppear {
            text = initial
            focused = true
            if !initial.isEmpty { run() }
        }
        .onChange(of: text) { schedule() }
        .onChange(of: folder) { run() }
        .onChange(of: tag) { run() }
        .onChange(of: archived) { run() }
        .onChange(of: meaning) { run() }
        .onChange(of: everywhere) { run() }
    }

    @State private var pending: Task<Void, Never>?

    private func schedule() {
        pending?.cancel()
        pending = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled else { return }
            run()
        }
    }

    private func run() {
        let q = text.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, let client = app.client else { result = nil; return }
        searching = true
        let args = SearchArgs(text: q, scope: everywhere ? .everywhere : .place, space: nil, folderId: folder, tagId: tag, updatedAfter: nil, includeArchived: archived, creatorId: nil, meaning: meaning, limit: 100)
        Task { @MainActor in
            let r = try? await client.query(Views.Search(args))
            if q == text.trimmingCharacters(in: .whitespaces) { result = r }
            searching = false
        }
    }

    private func open(_ hit: SearchHit) {
        window.go(.note(hit.id))
        if let block = hit.blockId, let page = window.page {
            Task {
                try? await Task.sleep(for: .milliseconds(350))
                _ = try? await page.client.editor(EditorCommands.BlockJump(BlockJumpArgs(blockId: block)))
            }
        }
    }
}

struct SearchHitRow: View {
    let hit: SearchHit
    let query: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            NoteMark(icon: hit.icon, size: 15).frame(width: 18).padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(hit.title.nonEmpty ?? "Untitled").font(CoreType.noteTitle(15)).lineLimit(1)
                if !hit.snippet.isEmpty { Text(highlighted(hit.snippet)).font(CoreType.noteText(13)).foregroundStyle(.secondary).lineLimit(2) }
                HStack(spacing: 8) {
                    Text(CoreDates.short(hit.updatedAt))
                    if let f = hit.folder { Label { Text(f.name) } icon: { FolderMark(colorId: f.color, size: 10) } }
                    if let s = hit.spaceName { Text(s) }
                    if hit.archived { Text("Archived") }
                }
                .font(.caption).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 3)
    }

    private func highlighted(_ s: String) -> AttributedString {
        var a = AttributedString(s)
        for word in query.split(separator: " ") where word.count > 1 {
            var search = a.startIndex..<a.endIndex
            while let r = a[search].range(of: String(word), options: .caseInsensitive) {
                a[r].foregroundColor = .primary
                a[r].inlinePresentationIntent = .stronglyEmphasized
                search = r.upperBound..<a.endIndex
            }
        }
        return a
    }
}

// MARK: Shared with me

struct SharedScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var notes = Live<Views.SharedList>()
    @State private var folders = Live<Views.SharedFolders>()

    var body: some View {
        Group {
            if notes.value == nil && folders.value == nil {
                LoadingScreen()
            } else if (notes.value?.rows ?? []).isEmpty && (folders.value?.rows ?? []).isEmpty {
                EmptyScreen(symbol: "person.2", title: "Nothing Shared Yet", message: "Notes and folders people share with you show up here.")
            } else {
                List {
                    if let f = folders.value?.rows, !f.isEmpty {
                        Section("Folders") {
                            ForEach(f, id: \.id) { row in
                                HStack(spacing: 10) {
                                    FolderMark(colorId: row.color, size: 18)
                                    VStack(alignment: .leading) {
                                        Text(row.name).font(CoreType.noteTitle(15))
                                        Text("\(row.sharedBy) · \(row.role.capitalized)").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text("\(row.noteCount) notes").font(.caption).foregroundStyle(.secondary)
                                }
                                .contentShape(Rectangle())
                                .onTapGesture(count: 2) { window.go(.sharedFolder(row.id)) }
                            }
                        }
                    }
                    if let n = notes.value?.rows, !n.isEmpty {
                        Section("Notes") {
                            ForEach(n, id: \.id) { row in
                                HStack(alignment: .top, spacing: 10) {
                                    NoteMark(icon: row.icon, size: 15).frame(width: 18)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(row.title.nonEmpty ?? "Untitled").font(CoreType.noteTitle(15))
                                        if !row.excerpt.isEmpty { Text(row.excerpt).font(CoreType.noteText(13)).foregroundStyle(.secondary).lineLimit(2) }
                                        Text("Shared by \(row.sharedBy) · \(row.role.capitalized) · \(CoreDates.short(row.sharedAt))").font(.caption).foregroundStyle(.tertiary)
                                    }
                                }
                                .contentShape(Rectangle())
                                .onTapGesture(count: 2) { window.go(.note(row.id)) }
                                .contextMenu {
                                    Button("Open") { window.go(.note(row.id)) }
                                    Button("Open in New Tab") { app.open(.note(row.id), newTab: true) }
                                }
                            }
                        }
                    }
                }
                .listStyle(.inset)
            }
        }
        .task(id: app.client.map(ObjectIdentifier.init)) {
            notes.bind(app.client, Views.SharedList())
            folders.bind(app.client, Views.SharedFolders())
        }
    }
}

struct SharedFolderScreen: View {
    let window: WindowModel
    let id: String
    private var app: AppModel { .shared }
    @State private var folder = Live<Views.SharedFolderOpen>()

    var body: some View {
        Group {
            if let f = folder.value {
                if !f.found {
                    EmptyScreen(symbol: "folder.badge.questionmark", title: "Folder Not Available", message: "It may have been unshared or deleted.")
                } else {
                    List {
                        Section {
                            HStack(spacing: 12) {
                                FolderMark(colorId: f.color, size: 30)
                                VStack(alignment: .leading) {
                                    Text(f.name).font(CoreType.screenTitle(22))
                                    Text([f.sharedBy.map { "Shared by \($0)" }, f.roleLabel].compactMap { $0 }.joined(separator: " · ")).foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 6)
                        }
                        if !f.subfolders.isEmpty {
                            Section("Folders") {
                                ForEach(f.subfolders, id: \.id) { s in
                                    Label { Text(s.name) } icon: { FolderMark(colorId: s.color, size: 15) }
                                        .contentShape(Rectangle())
                                        .onTapGesture(count: 2) { window.go(.sharedFolder(s.id)) }
                                }
                            }
                        }
                        Section("Notes") {
                            ForEach(f.notes, id: \.id) { n in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(n.title.nonEmpty ?? "Untitled").font(CoreType.noteTitle(15))
                                    if !n.excerpt.isEmpty { Text(n.excerpt).font(CoreType.noteText(13)).foregroundStyle(.secondary).lineLimit(2) }
                                }
                                .contentShape(Rectangle())
                                .onTapGesture(count: 2) { window.go(.note(n.id)) }
                            }
                        }
                    }
                    .listStyle(.inset)
                }
            } else {
                LoadingScreen()
            }
        }
        .task(id: id) { folder.bind(app.client, Views.SharedFolderOpen(NoteIdArgs(id: id))) }
    }
}

// MARK: Changes

/// What others changed in your notes since you last looked, and suggestions waiting for your answer.
struct ChangesScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }

    var body: some View {
        Group {
            if let c = app.changes.value {
                if c.notes.isEmpty && c.proposals.isEmpty {
                    EmptyScreen(symbol: "checkmark.circle", title: "You're Up to Date", message: "When people change notes you share, the changes show up here.")
                } else {
                    List {
                        if !c.proposals.isEmpty {
                            Section("Suggestions") {
                                ForEach(c.proposals, id: \.id) { p in
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(p.title.nonEmpty ?? "Untitled").font(CoreType.noteTitle(15))
                                        Text("\(p.sourceName) · \(p.summary)").font(.callout).foregroundStyle(.secondary)
                                        if let problem = p.problem { Label(problem, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange) }
                                        HStack {
                                            Button("Accept") { app.perform { _ = try await $0.command(Commands.ProposalAccept(ProposalIdArgs(id: p.id))) } }
                                            Button("Decline") { app.perform { _ = try await $0.command(Commands.ProposalReject(ProposalIdArgs(id: p.id))) } }
                                            if let note = p.noteId { Button("Open Note") { window.go(.note(note)) }.buttonStyle(.link) }
                                        }
                                        .controlSize(.small)
                                    }
                                    .padding(.vertical, 4)
                                }
                            }
                        }
                        if !c.notes.isEmpty {
                            Section("Changed Notes") {
                                ForEach(c.notes, id: \.id) { n in
                                    HStack(alignment: .top) {
                                        NoteMark(icon: n.icon, size: 15).frame(width: 18)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(n.title.nonEmpty ?? "Untitled").font(CoreType.noteTitle(15))
                                            Text("\(n.who) · \(n.counts)").font(.callout).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Text(CoreDates.short(n.changedAt)).font(.caption).foregroundStyle(.tertiary)
                                    }
                                    .contentShape(Rectangle())
                                    .onTapGesture(count: 2) {
                                        window.go(.note(n.id))
                                        app.perform { _ = try await $0.command(Commands.ChangesMarkSeen(NoteIdsArgs(ids: [n.id]))) }
                                    }
                                    .contextMenu {
                                        Button("Open") { window.go(.note(n.id)) }
                                        Button("Mark as Seen") { app.perform { _ = try await $0.command(Commands.ChangesMarkSeen(NoteIdsArgs(ids: [n.id]))) } }
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(.inset)
                    .toolbar {
                        ToolbarItem(placement: .secondaryAction) {
                            Button("Mark All as Seen") {
                                let ids = c.notes.map(\.id)
                                app.perform { _ = try await $0.command(Commands.ChangesMarkSeen(NoteIdsArgs(ids: ids))) }
                            }
                            .disabled(c.notes.isEmpty)
                        }
                    }
                }
            } else {
                LoadingScreen()
            }
        }
    }
}

// MARK: Templates

struct TemplatesScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var builtIn = Live<Views.TemplatesBuiltIn>()

    var body: some View {
        VStack(spacing: 0) {
            if let t = builtIn.value?.templates, !t.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 12) {
                        ForEach(t, id: \.key) { tmpl in
                            Button {
                                NoteActions.newNote(app: app, window: window, template: tmpl.key)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(tmpl.icon).font(.title2)
                                    Text(tmpl.name).font(CoreType.noteTitle(14))
                                    Text(tmpl.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                                .frame(width: 170, alignment: .leading)
                                .padding(12)
                                .background(.fill.quinary, in: .rect(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                            .hoverEffectCompat()
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 14)
                }
                .scrollIndicators(.never)
                Divider()
            }
            NoteListScreen(window: window, kind: .templates)
        }
        .toolbar {
            ToolbarItem(placement: .secondaryAction) {
                Button {
                    app.perform { client in
                        let r = try await client.command(Commands.TemplateCreate(TemplateCreateArgs(space: nil, title: nil, open: false)))
                        window.go(.note(r.id))
                    }
                } label: { Label("New Template", systemImage: "plus.square.on.square") }
            }
        }
        .task(id: app.client.map(ObjectIdentifier.init)) { builtIn.bind(app.client, Views.TemplatesBuiltIn()) }
    }
}

// MARK: Folders and tags

struct FoldersScreen: View {
    let window: WindowModel
    let parent: String?
    private var app: AppModel { .shared }
    @State private var cards = Live<Views.FoldersCards>()
    @State private var newFolder = false

    var body: some View {
        Group {
            if let f = cards.value?.folders {
                if f.isEmpty {
                    EmptyScreen(symbol: "folder", title: "No Folders", message: "Folders keep related notes together.", actionTitle: "New Folder") { newFolder = true }
                } else {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 180, maximum: 240), spacing: 22)], spacing: 22) {
                            ForEach(f, id: \.id) { folder in
                                Button { window.go(.folder(folder.id)) } label: { WebFolderCard(Cards.folder(folder)) }
                                    .buttonStyle(CardPressStyle())
                                    .dropDestination(for: NoteDrag.self) { items, _ in
                                        let ids = items.map(\.id)
                                        app.perform { _ = try await $0.command(Commands.NoteMove(NoteMoveArgs(ids: ids, folderId: folder.id))) }
                                        return true
                                    }
                            }
                        }
                        .padding(24)
                    }
                }
            } else {
                LoadingScreen()
            }
        }
        .toolbar {
            ToolbarItem(placement: .secondaryAction) {
                Button { newFolder = true } label: { Label("New Folder", systemImage: "folder.badge.plus") }
            }
        }
        .sheet(isPresented: $newFolder) {
            NameSheet(title: "New Folder", initial: "", action: "Create") { name in
                app.perform { _ = try await $0.command(Commands.FolderCreate(FolderCreateArgs(space: nil, name: name, parentId: parent, color: nil))) }
            }
        }
        .task(id: parent) { cards.bind(app.client, Views.FoldersCards(FolderCardsArgs(space: nil, parentId: parent, all: parent == nil ? true : nil))) }
    }
}

struct TagsScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var tags = Live<Views.TagsIndex>()
    @State private var renaming: TagIndexRow?

    var body: some View {
        Group {
            if let rows = tags.value?.tags {
                if rows.isEmpty {
                    EmptyScreen(symbol: "number", title: "No Tags", message: "Type # in a note to tag it.")
                } else {
                    Table(rows) {
                        TableColumn("Tag") { t in
                            Label { Text(t.name) } icon: { Image(systemName: "number").foregroundStyle(Color.folevi(t.color)) }
                        }
                        TableColumn("Notes") { t in Text(t.documentCount.formatted()).monospacedDigit() }.width(80)
                        TableColumn("Created") { t in Text(CoreDates.short(t.createdAt)) }.width(120)
                    }
                    .contextMenu(forSelectionType: TagIndexRow.ID.self) { ids in
                        if let id = ids.first, let t = rows.first(where: { $0.id == id }) {
                            Button("Open") { window.go(.tag(t.id)) }
                            Button("Rename…") { renaming = t }
                            Menu("Colour") {
                                ForEach(FolderColors.all, id: \.self) { c in
                                    Button(c.capitalized) { app.perform { _ = try await $0.command(Commands.TagUpdate(TagUpdateArgs(id: t.id, name: nil, color: c))) } }
                                }
                            }
                            Divider()
                            Button("Delete Tag", role: .destructive) { app.perform { _ = try await $0.command(Commands.TagDelete(TagIdArgs(id: t.id))) } }
                        }
                    } primaryAction: { ids in
                        if let id = ids.first { window.go(.tag(id)) }
                    }
                }
            } else {
                LoadingScreen()
            }
        }
        .sheet(item: $renaming) { t in
            NameSheet(title: "Rename Tag", initial: t.name, action: "Rename") { name in
                app.perform { _ = try await $0.command(Commands.TagUpdate(TagUpdateArgs(id: t.id, name: name, color: nil))) }
            }
        }
        .task(id: app.client.map(ObjectIdentifier.init)) { tags.bind(app.client, Views.TagsIndex(TagsIndexArgs(space: nil))) }
    }
}

extension TagIndexRow: Identifiable {}
extension FolderNode: Identifiable {}

// MARK: Pages that stay on the page

/// Reviews (flashcards) and the Foli DNA graph are drawn by the page (canvas content), in Core's window with
/// native bars, as a note is.
struct WebScreen: View {
    let window: WindowModel
    let page: WebPage
    private var app: AppModel { .shared }
    @State private var host: Page?

    var body: some View {
        PageHostView(page: host)
            .task(id: page) {
                guard let p = app.pool.editor(for: window.id) else { return }
                host = p
                await p.show(web: page)
            }
            .onDisappear {
                host = nil
                app.pool.giveBack(from: window.id)
            }
    }
}

// MARK: The daily note

struct DailyNoteScreen: View {
    let window: WindowModel
    let date: String?
    private var app: AppModel { .shared }

    var body: some View {
        LoadingScreen()
            .task(id: date) {
                // The page knows the daily note of a date (or makes it): it navigates to it.
                guard let p = app.pool.engine else { return }
                Events.command(["type": "navigate", "path": Destination.daily(date).path], to: p.view)
            }
    }
}

// MARK: Invitations

struct InviteScreen: View {
    let window: WindowModel
    let kind: Destination.InviteKind
    let token: String
    private var app: AppModel { .shared }
    @State private var preview: InvitePreview?
    @State private var loaded = false

    var body: some View {
        VStack(spacing: 18) {
            if !loaded {
                ProgressView()
            } else if let p = preview, p.valid {
                Image(systemName: kind == .folder ? "folder.badge.person.crop" : kind == .page ? "doc.badge.ellipsis" : "person.3")
                    .font(.system(size: 44)).foregroundStyle(.secondary)
                Text(p.inviterName.map { "\($0) invited you" } ?? "You're invited").font(CoreType.screenTitle(26))
                if let name = p.name { Text(name).font(.title3) }
                if let role = p.roleLabel { Text(role).foregroundStyle(.secondary) }
                if !p.emailMatches { Label("This invitation was sent to a different email address.", systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
                HStack {
                    Button("Decline") { app.perform { _ = try await $0.command(Commands.InviteDecline(InviteDeclineArgs(kind: .init(rawValue: kind.rawValue) ?? .workspace, inviteId: nil, token: token))); window.go(.home) } }
                    Button("Accept") { accept() }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                }
                .controlSize(.large)
            } else {
                EmptyScreen(symbol: "envelope.badge.shield.half.filled", title: "Invitation Not Valid", message: "It may have expired or been used already.")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: token) {
            preview = try? await app.client?.query(Views.InvitePreview(InviteTokenArgs(kind: .init(rawValue: kind.rawValue) ?? .workspace, token: token)))
            loaded = true
        }
    }

    private func accept() {
        app.perform { client in
            switch kind {
            case .workspace: _ = try await client.command(Commands.InviteAcceptLink(InviteTokenArgs(kind: .workspace, token: token)))
            case .page: _ = try await client.command(Commands.InviteAcceptLink(InviteTokenArgs(kind: .page, token: token)))
            case .folder: _ = try await client.command(Commands.InviteAcceptLink(InviteTokenArgs(kind: .folder, token: token)))
            }
            window.go(.home)
        }
    }
}
