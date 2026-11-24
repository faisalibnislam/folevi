// The open Vault's sections: Files & Notes (folders, notes, uploads, previews), Passwords & Credentials (search,
// kinds, fields, one-time codes, a generator and a strength meter), sharing with a person or a one-time link,
// Trash and Settings.
import AppKit
import FoleviDesign
import FoleviEngine
import SwiftUI
import UniformTypeIdentifiers

// MARK: Files & Notes

struct VaultFilesView: View {
    let vaultId: String
    private var app: AppModel { .shared }
    @State private var folder: String?
    @State private var folders = Live<Views.VaultFolders>()
    @State private var items = Live<Views.VaultItems>()
    @AppStorage("core.vault.grid") private var grid = false
    @State private var naming: NameKind?
    @State private var openNote: String?
    @State private var busy = false
    @State private var dropping = false

    enum NameKind: Identifiable { case folder, note; var id: Int { self == .folder ? 0 : 1 } }

    private var childFolders: [VaultFolderRow] { (folders.value?.folders ?? []).filter { $0.parentId == folder } }
    private var files: [VaultItemRow] { (items.value?.items ?? []).filter { $0.folderId == folder } }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                if let f = folder {
                    Button { folder = (folders.value?.folders ?? []).first { $0.id == f }?.parentId } label: { Label("Back", appSymbol: "chevron.left") }
                    Text((folders.value?.folders ?? []).first { $0.id == f }?.name ?? "").font(.headline)
                } else {
                    Text("Files & Notes").font(.headline)
                }
                Spacer()
                if busy { ProgressView().controlSize(.small); Text("Encrypting…").font(.caption).foregroundStyle(.secondary) }
                Picker("Layout", selection: $grid) {
                    Image(systemName: "list.bullet").tag(false)
                    Image(systemName: "square.grid.2x2").tag(true)
                }
                .pickerStyle(.segmented).fixedSize().labelsHidden()
                Menu {
                    Button("New Folder…") { naming = .folder }
                    Button("New Note…") { naming = .note }
                    Button("Upload Files…", action: upload)
                } label: { Label("Add", appSymbol: "plus") }
                .fixedSize()
            }
            .padding(10)
            Divider()
            if childFolders.isEmpty && files.isEmpty {
                EmptyScreen(symbol: "doc.badge.plus", title: "Nothing Here Yet", message: "Upload files of any kind, or write a note. They're encrypted on this Mac before they leave it.")
            } else if grid {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 14)], spacing: 14) {
                        ForEach(childFolders, id: \.id) { f in tile(name: f.name, icon: .folder) { folder = f.id } }
                        ForEach(files, id: \.id) { i in tile(name: i.title.nonEmpty ?? i.kindLabel, icon: i.kind == "note" ? .notebookText : .file) { openItem(i) } }
                    }
                    .padding(16)
                }
            } else {
                List {
                    ForEach(childFolders, id: \.id) { f in
                        Label { Text(f.name) } icon: { WebIcon.folder.image(size: 15) }
                            .contentShape(Rectangle()).onTapGesture(count: 2) { folder = f.id }
                    }
                    ForEach(files, id: \.id) { i in
                        HStack {
                            Label { Text(i.title.nonEmpty ?? i.kindLabel) } icon: { (i.kind == "note" ? WebIcon.notebookText : WebIcon.file).image(size: 15) }
                            Spacer()
                            if let size = i.size { Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)).font(.caption).foregroundStyle(.secondary) }
                            Text(AppDates.short(i.updatedAt)).font(.caption).foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2) { openItem(i) }
                        .contextMenu {
                            Button("Open") { openItem(i) }
                            if i.kind != "note" { Button("Download…") { download(i) } }
                            Button("Move to the Vault's Trash", role: .destructive) { app.perform { _ = try await $0.command(Commands.VaultItemRemove(VaultItemIdArgs(vaultId: vaultId, itemId: i.id))) } }
                        }
                    }
                }
                .listStyle(.inset)
            }
        }
        .onDrop(of: [.fileURL], isTargeted: $dropping) { providers in
            for p in providers { _ = p.loadObject(ofClass: URL.self) { url, _ in if let url { Task { @MainActor in uploadFile(url) } } } }
            return true
        }
        .overlay { if dropping { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.foleviInk, style: StrokeStyle(lineWidth: 2, dash: [6])).padding(6) } }
        .task { folders.bind(app.client, Views.VaultFolders(VaultIdArgs(vaultId: vaultId))) }
        .task(id: folder) { items.bind(app.client, Views.VaultItems(VaultItemsArgs(vaultId: vaultId, section: .files, folderId: folder))) }
        .sheet(item: $naming) { kind in
            NameSheet(title: kind == .folder ? "New Folder" : "New Note", initial: "", action: "Create") { name in
                let f = folder
                app.perform { client in
                    if kind == .folder {
                        _ = try await client.command(Commands.VaultFolderCreate(VaultFolderCreateArgs(vaultId: vaultId, parentId: f, name: name)))
                    } else {
                        let r = try await client.command(Commands.VaultNoteCreate(VaultNoteCreateArgs(vaultId: vaultId, folderId: f, title: name)))
                        openNote = r.id
                    }
                }
            }
        }
        .sheet(isPresented: Binding(get: { openNote != nil }, set: { if !$0 { openNote = nil } })) {
            if let id = openNote { VaultNoteSheet(vaultId: vaultId, itemId: id) }
        }
    }

    private func tile(name: String, icon: WebIcon, open: @escaping () -> Void) -> some View {
        Button(action: open) {
            VStack(spacing: 8) {
                icon.image(size: 30).foregroundStyle(.secondary).frame(height: 44)
                Text(name).font(.caption).lineLimit(2).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity).padding(12)
            .background(.fill.quinary, in: .rect(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .hoverEffectCompat()
    }

    private func openItem(_ i: VaultItemRow) {
        if i.kind == "note" { openNote = i.id; return }
        Task { @MainActor in
            guard let f = try? await app.client?.command(Commands.VaultFileOpen(VaultFileOpenArgs(vaultId: vaultId, itemId: i.id, purpose: .preview))), let data = Data(base64Encoded: f.data) else { return }
            try? AppQuickLook.shared.show([(f.name, data)])
        }
    }

    private func download(_ i: VaultItemRow) {
        Task { @MainActor in
            guard let f = try? await app.client?.command(Commands.VaultFileOpen(VaultFileOpenArgs(vaultId: vaultId, itemId: i.id, purpose: .download))), let data = Data(base64Encoded: f.data) else { return }
            _ = await ShellFiles.shared.save(name: f.name, bytes: data, from: NSApp.keyWindow)
        }
    }

    private func upload() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK else { return }
        panel.urls.forEach(uploadFile)
    }

    private func uploadFile(_ url: URL) {
        guard let data = try? Data(contentsOf: url), data.count <= 100 * 1024 * 1024 else { app.toast("That file is too big for the Vault (100 MB at most).", tone: .error); return }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let f = folder
        busy = true
        app.perform { client in
            defer { busy = false }
            _ = try await client.command(Commands.VaultFileUpload(VaultUploadArgs(vaultId: vaultId, folderId: f, name: url.lastPathComponent, mime: mime, data: data.base64EncodedString())))
        }
    }
}

/// A Vault note: its text, saved only when it changed.
struct VaultNoteSheet: View {
    let vaultId: String
    let itemId: String
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var note: VaultNoteValue?
    @State private var text = ""
    @State private var sharing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(note?.title.nonEmpty ?? "Note").font(AppType.screenTitle(20))
                Spacer()
                Button("Share…") { sharing = true }
            }
            TextEditor(text: $text)
                .font(AppType.noteText(15))
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(.fill.quinary, in: .rect(cornerRadius: 8))
                .disabled(note?.canChange == false)
            HStack {
                Spacer()
                Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
                if let n = note, text != n.text {
                    Button("Save") {
                        let t = text
                        app.perform { _ = try await $0.command(Commands.VaultNoteSave(VaultNoteSaveArgs(vaultId: vaultId, itemId: itemId, revision: n.revision, text: t))) }
                        dismiss()
                    }
                    .buttonStyle(InkPillStyle()).keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(18)
        .frame(width: 560, height: 480)
        .task {
            note = try? await app.client?.command(Commands.VaultNoteOpen(VaultItemIdArgs(vaultId: vaultId, itemId: itemId)))
            text = note?.text ?? ""
        }
        .sheet(isPresented: $sharing) { VaultShareSheet(vaultId: vaultId, itemId: itemId) }
    }
}

// MARK: Passwords

struct VaultPasswordsView: View {
    let vaultId: String
    private var app: AppModel { .shared }
    @State private var items = Live<Views.VaultItems>()
    @State private var selected: String?
    @State private var editing: VaultEditTarget?
    @State private var search = ""
    @State private var kind = ""

    private var rows: [VaultItemRow] {
        (items.value?.items ?? []).filter { r in
            (kind.isEmpty || r.kind == kind) && (search.isEmpty || r.title.localizedCaseInsensitiveContains(search) || r.detail.localizedCaseInsensitiveContains(search))
        }
    }

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                HStack {
                    TextField("Search", text: $search).textFieldStyle(.roundedBorder)
                    Picker("Kind", selection: $kind) {
                        Text("All kinds").tag("")
                        ForEach(Array(Set((items.value?.items ?? []).map(\.kind))).sorted(), id: \.self) { k in
                            Text(items.value?.kinds.first { $0.kind == k }?.label ?? k).tag(k)
                        }
                    }
                    .labelsHidden().fixedSize()
                    Menu {
                        ForEach(items.value?.kinds ?? [], id: \.kind) { k in Button(k.label) { editing = VaultEditTarget(vaultId: vaultId, itemId: nil, kind: k) } }
                    } label: { Image(systemName: "plus") }
                    .fixedSize().help("Add")
                }
                .padding(10)
                if rows.isEmpty {
                    EmptyScreen(symbol: "key", title: search.isEmpty && kind.isEmpty ? "No Passwords Yet" : "Nothing Matches", message: search.isEmpty && kind.isEmpty ? "Add logins, API keys, cards and other credentials. Only people in the Vault can open them." : "Try other words or another kind.")
                } else {
                    List(rows, id: \.id, selection: $selected) { item in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title.nonEmpty ?? item.kindLabel)
                            Text("\(item.detail.nonEmpty ?? item.kindLabel) · \(AppDates.relative(item.updatedAt))").font(.caption).foregroundStyle(.secondary)
                        }
                        .tag(item.id)
                        .contextMenu {
                            Button("Duplicate") { app.perform { _ = try await $0.command(Commands.VaultItemDuplicate(VaultItemIdArgs(vaultId: vaultId, itemId: item.id))) } }
                            Button("Move to the Vault's Trash", role: .destructive) { app.perform { _ = try await $0.command(Commands.VaultItemRemove(VaultItemIdArgs(vaultId: vaultId, itemId: item.id))) } }
                        }
                    }
                    .listStyle(.inset)
                }
            }
            .frame(minWidth: 260, idealWidth: 300, maxWidth: 380)
            Group {
                if let id = selected {
                    VaultItemDetail(vaultId: vaultId, itemId: id, kinds: items.value?.kinds ?? [], edit: { editing = $0 })
                } else {
                    EmptyScreen(symbol: "key", title: "No Item Selected", message: "Choose an item, or add one with +.")
                }
            }
            .frame(minWidth: 360)
        }
        .task { items.bind(app.client, Views.VaultItems(VaultItemsArgs(vaultId: vaultId, section: .passwords))) }
        .sheet(item: $editing) { t in VaultItemEditor(target: t) }
    }
}

struct VaultEditTarget: Identifiable {
    let vaultId: String
    let itemId: String?
    let kind: VaultKindDef
    var values: [String: String] = [:]
    var title = ""
    var notes = ""
    var id: String { itemId ?? "new-" + kind.kind }
}

/// One item: who added and changed it, its fields (secrets hidden until shown, copy, one-time codes), notes,
/// earlier versions, sharing, editing and the Trash.
struct VaultItemDetail: View {
    let vaultId: String
    let itemId: String
    var kinds: [VaultKindDef] = []
    let edit: (VaultEditTarget) -> Void
    private var app: AppModel { .shared }
    @State private var item: VaultItemValue?
    @State private var shown: Set<String> = []
    @State private var history = false
    @State private var sharing = false

    var body: some View {
        Form {
            if let item {
                Section {
                    Text(item.title.nonEmpty ?? item.kindLabel).font(AppType.screenTitle(22))
                    Text("\(item.kindLabel) · added by \(item.createdBy), changed by \(item.updatedBy) \(AppDates.relative(item.updatedAt))").font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    ForEach(item.fields, id: \.key) { f in
                        LabeledContent(f.label) {
                            HStack {
                                if f.type == "totp" {
                                    TotpCode(secret: f.value, copied: { copy($0, field: f.key, event: "totp.copy") })
                                } else if f.type == "password" || f.type == "secret" {
                                    Text(shown.contains(f.key) ? f.value : String(repeating: "•", count: min(12, max(6, f.value.count)))).font(.body.monospaced()).textSelection(.enabled)
                                    Button { toggle(f.key) } label: { Image(systemName: shown.contains(f.key) ? "eye.slash" : "eye") }.buttonStyle(.borderless).help(shown.contains(f.key) ? "Hide" : "Show")
                                } else {
                                    Text(f.value).textSelection(.enabled)
                                }
                                if f.type != "totp" { Button { copy(f.value, field: f.key, event: "field.copy") } label: { Image(systemName: "doc.on.doc") }.buttonStyle(.borderless).help("Copy") }
                            }
                        }
                    }
                }
                if !item.notes.isEmpty { Section("Notes") { Text(item.notes).textSelection(.enabled) } }
                Section {
                    Button("Move to the Vault's Trash", role: .destructive) { app.perform { _ = try await $0.command(Commands.VaultItemRemove(VaultItemIdArgs(vaultId: vaultId, itemId: itemId))) } }
                }
            } else {
                ProgressView()
            }
        }
        .formStyle(.grouped)
        .screenActions {
            if let item {
                Group {
                    Button("Earlier Versions") { history = true }
                    Button("Share…") { sharing = true }
                    if item.canChange {
                        Button("Edit") {
                            let def = kinds.first { $0.kind == item.kind } ?? VaultKindDef(kind: item.kind, label: item.kindLabel, fields: item.fields.map { VaultFieldDef(key: $0.key, label: $0.label, type: $0.type) })
                            edit(VaultEditTarget(vaultId: vaultId, itemId: item.id, kind: def, values: Dictionary(uniqueKeysWithValues: item.fields.map { ($0.key, $0.value) }), title: item.title, notes: item.notes))
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $history) { VaultHistorySheet(vaultId: vaultId, itemId: itemId) }
        .sheet(isPresented: $sharing) { VaultShareSheet(vaultId: vaultId, itemId: itemId) }
        .task(id: itemId) {
            shown = []
            item = try? await app.client?.command(Commands.VaultItemOpen(VaultItemIdArgs(vaultId: vaultId, itemId: itemId)))
        }
    }

    private func toggle(_ key: String) {
        if shown.contains(key) { shown.remove(key); return }
        shown.insert(key)
        app.perform { _ = try await $0.command(Commands.VaultRecord(VaultRecordArgs(vaultId: vaultId, event: "field.reveal", itemId: itemId, field: key))) }
    }

    private func copy(_ s: String, field: String, event: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
        app.toast("Copied. Clears from the clipboard in 90 seconds.")
        app.perform { _ = try await $0.command(Commands.VaultRecord(VaultRecordArgs(vaultId: vaultId, event: event, itemId: itemId, field: field))) }
        let count = NSPasteboard.general.changeCount
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { if NSPasteboard.general.changeCount == count { NSPasteboard.general.clearContents() } }
    }
}

/// A one-time code from its secret, with the seconds it has left and Copy for the code.
struct TotpCode: View {
    let secret: String
    var copied: ((String) -> Void)?
    private var app: AppModel { .shared }
    @State private var code: VaultTotpResult?

    var body: some View {
        HStack {
            if let c = code, c.code == nil {
                Text("Not a 2FA secret Folevi can read.").foregroundStyle(.secondary)
            } else {
                Text(grouped(code?.code) ?? "––– –––").font(.title3.monospaced().weight(.semibold))
                if let left = code?.secondsLeft { Text("\(left)s").font(.caption).foregroundStyle(.secondary).monospacedDigit() }
                if let c = code?.code, let copied { Button { copied(c) } label: { Image(systemName: "doc.on.doc") }.buttonStyle(.borderless).help("Copy Code") }
            }
        }
        .task(id: secret) {
            while !Task.isCancelled {
                code = try? await app.client?.command(Commands.VaultTotp(VaultTotpArgs(secret: secret)))
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func grouped(_ c: String?) -> String? {
        guard let c, c.count == 6 else { return c }
        return c.prefix(3) + " " + c.suffix(3)
    }
}

/// Adding or changing an item: its title, each field of its kind (a generator and a strength meter on
/// passwords), notes.
struct VaultItemEditor: View {
    @State private var target: VaultEditTarget
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var strength: [String: VaultStrengthResult] = [:]

    init(target: VaultEditTarget) { _target = State(initialValue: target) }

    var body: some View {
        Form {
            Section(target.kind.label) {
                TextField("Title", text: $target.title, prompt: Text("A name to find it by"))
                ForEach(target.kind.fields, id: \.key) { f in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            if f.type == "password" || f.type == "secret" {
                                SecureField(f.label, text: binding(f.key))
                            } else {
                                TextField(f.label, text: binding(f.key), axis: f.type == "multiline" ? .vertical : .horizontal)
                            }
                            if f.type == "password" {
                                Menu("Generate") {
                                    Button("Random Password") { generate(f.key, .password) }
                                    Button("Memorable Passphrase") { generate(f.key, .passphrase) }
                                }
                                .fixedSize()
                            }
                        }
                        if f.type == "password", let s = strength[f.key] {
                            HStack(spacing: 6) {
                                ProgressView(value: Double(s.score + 1), total: 5).frame(width: 120).tint(s.score >= 3 ? .green : s.score >= 2 ? .orange : .red)
                                Text(s.label).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            Section("Notes") { TextField("Notes", text: $target.notes, axis: .vertical).lineLimit(3...8) }
        }
        .formStyle(.grouped)
        .frame(width: 460, height: 520)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    let t = target
                    app.perform { _ = try await $0.command(Commands.VaultItemSave(VaultItemSaveArgs(vaultId: t.vaultId, itemId: t.itemId, kind: t.kind.kind, title: t.title, values: t.values, notes: t.notes))) }
                    dismiss()
                }
                .disabled(target.title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func binding(_ key: String) -> Binding<String> {
        Binding(get: { target.values[key] ?? "" }, set: { v in
            target.values[key] = v
            if target.kind.fields.first(where: { $0.key == key })?.type == "password" { rate(key, v) }
        })
    }

    private func generate(_ key: String, _ kind: VaultGenerateArgs.Kind) {
        Task { @MainActor in
            if let r = try? await app.client?.command(Commands.VaultGenerate(VaultGenerateArgs(kind: kind))) {
                target.values[key] = r.value
                rate(key, r.value)
            }
        }
    }

    private func rate(_ key: String, _ password: String) {
        guard !password.isEmpty else { strength[key] = nil; return }
        Task { @MainActor in strength[key] = try? await app.client?.command(Commands.VaultStrength(VaultStrengthArgs(password: password))) }
    }
}

/// Sharing an item or a note: with a person (for a while, view or edit), or as a one-time link.
struct VaultShareSheet: View {
    let vaultId: String
    let itemId: String
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var shares = Live<Views.VaultShares>()
    @State private var email = ""
    @State private var days = 7
    @State private var canEdit = false
    @State private var linkPassword = ""
    @State private var maxViews = 1
    @State private var lasts = 86_400_000
    @State private var newLink: String?
    @State private var message: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Share").font(.title2.weight(.semibold)).padding([.horizontal, .top], 20)
            Form {
                if app.session.value?.mode == .local {
                    Section { Text("Sign in to a Folevi account to share from the Vault.").foregroundStyle(.secondary) }
                } else {
                    Section("With a Person") {
                        TextField("Email", text: $email)
                        Picker("For", selection: $days) {
                            Text("1 day").tag(1); Text("7 days").tag(7); Text("30 days").tag(30); Text("90 days").tag(90); Text("1 year").tag(365)
                        }
                        Picker("They", selection: $canEdit) { Text("Can view").tag(false); Text("Can edit").tag(true) }
                        Button("Share") {
                            let e = email, d = days, c = canEdit
                            Task { @MainActor in
                                let r = try? await app.client?.command(Commands.VaultSharePerson(VaultShareArgs(vaultId: vaultId, itemId: itemId, email: e, days: d, canEdit: c)))
                                message = r?.message
                                if r?.status == "shared" { email = "" }
                            }
                        }
                        .disabled(!email.contains("@"))
                        if let message { Text(message).font(.caption).foregroundStyle(.secondary) }
                        ForEach(shares.value?.people ?? [], id: \.id) { p in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(p.name)
                                    Text("\(p.canEdit ? "Can edit" : "Can view")\(p.expiresAt.map { " · until " + AppDates.short($0) } ?? "")\(p.expired ? " · Expired" : "")").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("Stop") { app.perform { _ = try await $0.command(Commands.VaultShareStop(VaultShareStopArgs(vaultId: vaultId, itemId: itemId, shareId: p.id))) } }.buttonStyle(.borderless)
                            }
                        }
                    }
                    Section("One-Time Link") {
                        SecureField("Password (optional, 5 or more characters)", text: $linkPassword)
                        Picker("Works", selection: $maxViews) { ForEach([1, 2, 3, 5, 10], id: \.self) { Text($0 == 1 ? "Once" : "\($0) times").tag($0) } }
                        Picker("For", selection: $lasts) {
                            Text("1 hour").tag(3_600_000); Text("1 day").tag(86_400_000); Text("7 days").tag(604_800_000); Text("30 days").tag(2_592_000_000)
                        }
                        Button("Make Link") {
                            let p = linkPassword, m = maxViews, l = lasts
                            app.perform { client in
                                let r = try await client.command(Commands.VaultLinkCreate(VaultLinkArgs(vaultId: vaultId, itemId: itemId, maxViews: m, lastsMs: l, password: p.count >= 5 ? p : nil)))
                                newLink = r.url
                            }
                        }
                        .disabled(!linkPassword.isEmpty && linkPassword.count < 5)
                        if let newLink {
                            HStack {
                                Text(newLink).font(.caption.monospaced()).textSelection(.enabled).lineLimit(1)
                                Button("Copy") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(newLink, forType: .string) }
                            }
                        }
                        ForEach(shares.value?.links ?? [], id: \.id) { l in
                            HStack {
                                Text("\(l.views) of \(l.maxViews) views · until \(AppDates.short(l.expiresAt))\(l.hasPassword ? " · password" : "")").font(.caption)
                                Spacer()
                                Button("Revoke") { app.perform { _ = try await $0.command(Commands.VaultLinkRevoke(VaultLinkRevokeArgs(vaultId: vaultId, linkId: l.id))) } }.buttonStyle(.borderless)
                            }
                        }
                    }
                }
            }
            .formStyle(.grouped)
            HStack { Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.defaultAction) }.padding(16)
        }
        .frame(width: 480, height: 600)
        .task { shares.bind(app.client, Views.VaultShares(VaultItemIdArgs(vaultId: vaultId, itemId: itemId))) }
    }
}

// MARK: Trash and Settings

struct VaultTrashView: View {
    let vaultId: String
    private var app: AppModel { .shared }
    @State private var items = Live<Views.VaultItems>()

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("The Vault's Trash").font(.headline)
                Spacer()
                Button("Empty Trash…", action: empty).disabled((items.value?.items ?? []).isEmpty)
            }
            .padding(10)
            List(items.value?.items ?? [], id: \.id) { item in
                HStack {
                    VStack(alignment: .leading) {
                        Text(item.title.nonEmpty ?? item.kindLabel)
                        Text("Deleted \(AppDates.relative(item.deletedAt ?? item.updatedAt))").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Restore") { app.perform { _ = try await $0.command(Commands.VaultItemRestore(VaultItemIdArgs(vaultId: vaultId, itemId: item.id))) } }
                }
            }
            .listStyle(.inset)
        }
        .task { items.bind(app.client, Views.VaultItems(VaultItemsArgs(vaultId: vaultId, section: .trash))) }
    }

    private func empty() {
        let alert = NSAlert()
        alert.messageText = "Empty the Vault's Trash?"
        alert.informativeText = "Everything in the Trash goes for good, for everyone in the Vault. You can't undo this."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Delete for Good")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        AppAlerts.cancelIsDefault(alert)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        app.perform { client in
            let r = try await client.command(Commands.VaultTrashEmpty(VaultIdArgs(vaultId: vaultId)))
            app.toast(r.removed == 1 ? "1 item deleted" : "\(r.removed) items deleted")
        }
    }
}

struct VaultSettingsView: View {
    let summary: VaultSummaryValue
    private var app: AppModel { .shared }
    @State private var changing = false
    @State private var current = ""
    @State private var askCurrent = false

    private var vaultId: String { summary.vaultId ?? "" }

    var body: some View {
        if changing {
            VaultChoosePin(summary: summary, mode: .change(current: current)) { changing = false; current = "" }
        } else {
            Form {
                Section {
                    Picker("Lock after", selection: Binding(get: { summary.autoLockMinutes }, set: { m in
                        app.perform { _ = try await $0.command(Commands.VaultSettingsUpdate(VaultSettingsArgs(vaultId: vaultId, autoLockMinutes: m))) }
                    })) {
                        ForEach([1, 2, 5, 10, 15, 30], id: \.self) { Text("\($0) minute\($0 == 1 ? "" : "s")").tag($0) }
                    }
                    if !summary.personal && summary.role == "owner" {
                        Toggle("Custodians can name custodians", isOn: Binding(get: { summary.custodiansNameCustodians }, set: { v in
                            app.perform { _ = try await $0.command(Commands.VaultSettingsUpdate(VaultSettingsArgs(vaultId: vaultId, custodiansNameCustodians: v))) }
                        }))
                    }
                }
                Section {
                    Button("Change PIN…") { askCurrent = true }
                    Button(summary.recoveryOutdated ? "Make a New Recovery Key (the old one is out of date)…" : "Make a New Recovery Key…") {
                        app.perform { client in
                            _ = try await client.command(Commands.VaultNewRecoveryKey(VaultIdArgs(vaultId: vaultId)))
                            app.toast("A new recovery key is ready to save at the top of the Vault.")
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .sheet(isPresented: $askCurrent) {
                VStack(spacing: 14) {
                    Text("Your Current PIN").font(.headline)
                    PinField(text: $current, length: summary.passcodeLengths.max() ?? 6) { askCurrent = false; changing = true }
                    HStack {
                        Button("Cancel") { askCurrent = false; current = "" }.keyboardShortcut(.cancelAction)
                        Button("Next") { askCurrent = false; changing = true }.buttonStyle(InkPillStyle()).disabled(current.isEmpty)
                    }
                }
                .padding(24)
            }
        }
    }
}
