// The Vault: Folevi's end-to-end encrypted place for passwords, codes and files. Set up with a passcode, locked
// after a while, unlocked with the passcode (or Touch ID); items by kind with their fields, one-time codes that
// count down, a password generator, files, trash, and the people it's shared with.
import FoleviDesign
import FoleviEngine
import SwiftUI

struct VaultScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var summary = Live<Views.VaultSummary>()
    @State private var passcode = ""
    @State private var section: VaultItemsArgs.Section = .passwords
    @State private var pane: VaultPane = .items

    enum VaultPane: String, CaseIterable { case items = "Items", health = "Health", activity = "Activity", people = "People" }
    @State private var items = Live<Views.VaultItems>()
    @State private var selected: String?
    @State private var editing: VaultEditTarget?
    @State private var error: String?

    var body: some View {
        Group {
            if let s = summary.value {
                switch s.state {
                case .none: setUp
                case .setUp: setUp
                case .open: open(s)
                case .locked, .needsPasscode: unlock(s)
                case .encryptionLocked, .waitingForKey:
                    EmptyScreen(symbol: "lock.shield", title: "Unlock Your Encrypted Notes First", message: "The Vault opens once this Mac has your encryption keys.")
                }
            } else {
                LoadingScreen()
            }
        }
        .task(id: app.client.map(ObjectIdentifier.init)) { summary.bind(app.client, Views.VaultSummary(SpaceArgs())) }
        .sheet(item: $editing) { t in VaultItemEditor(target: t) }
    }

    private var setUp: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.shield").font(.system(size: 48)).foregroundStyle(.secondary)
            Text("Set Up Your Vault").font(CoreType.screenTitle(26))
            Text("Keep passwords, one-time codes and private files end to end encrypted. Choose a passcode you'll remember: Folevi can't see it or reset it for you.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary).frame(maxWidth: 420)
            SecureField("Passcode", text: $passcode).textFieldStyle(.roundedBorder).frame(width: 240).onSubmit(doSetUp)
            if let error { Text(error).foregroundStyle(.red) }
            Button("Set Up Vault", action: doSetUp).buttonStyle(.borderedProminent).controlSize(.large).disabled(passcode.count < 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func doSetUp() {
        let p = passcode
        guard p.count >= 4 else { return }
        Task { @MainActor in
            do {
                let r = try await app.client?.command(Commands.VaultSetUp(VaultSetUpArgs(passcode: p, space: nil)))
                passcode = ""
                if let key = r?.recoveryKey { VaultRecovery.show(key, vaultId: summary.value?.vaultId ?? "") }
            } catch let f as EngineFailure { error = f.message } catch {}
        }
    }

    private func unlock(_ s: VaultSummaryValue) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.fill").font(.system(size: 44)).foregroundStyle(.secondary)
            Text("The Vault Is Locked").font(CoreType.screenTitle(26))
            SecureField("Passcode", text: $passcode).textFieldStyle(.roundedBorder).frame(width: 240).onSubmit { doUnlock(s) }
            if let error { Text(error).foregroundStyle(.red) }
            Button("Unlock") { doUnlock(s) }.buttonStyle(.borderedProminent).controlSize(.large).keyboardShortcut(.defaultAction)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func doUnlock(_ s: VaultSummaryValue) {
        guard let vault = s.vaultId else { return }
        let p = passcode
        Task { @MainActor in
            do {
                let r = try await app.client?.command(Commands.VaultUnlock(VaultPasscodeArgs(vaultId: vault, passcode: p)))
                passcode = ""
                error = r?.status == "ok" || r?.status == "open" ? nil : r?.message
            } catch let f as EngineFailure { error = f.message } catch {}
        }
    }

    @ViewBuilder private func open(_ s: VaultSummaryValue) -> some View {
        VStack(spacing: 0) {
            Picker("Vault", selection: $pane) {
                ForEach(VaultPane.allCases, id: \.self) { p in
                    if p != .people || !s.personal { Text(p.rawValue).tag(p) }
                }
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize().padding(.vertical, 8)
            switch pane {
            case .items: items(s)
            case .health: VaultHealthView(vaultId: s.vaultId ?? "")
            case .activity: VaultActivityView(vaultId: s.vaultId ?? "")
            case .people: VaultPeopleView(vaultId: s.vaultId ?? "")
            }
        }
    }

    private func items(_ s: VaultSummaryValue) -> some View {
        HSplitView {
            VStack(spacing: 0) {
                Picker("Section", selection: $section) {
                    Text("Passwords").tag(VaultItemsArgs.Section.passwords)
                    Text("Files").tag(VaultItemsArgs.Section.files)
                    Text("Trash").tag(VaultItemsArgs.Section.trash)
                }
                .pickerStyle(.segmented).labelsHidden().padding(10)
                List(selection: $selected) {
                    ForEach(items.value?.items ?? [], id: \.id) { item in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title.nonEmpty ?? item.kindLabel)
                            Text(item.detail.nonEmpty ?? item.kindLabel).font(.caption).foregroundStyle(.secondary)
                        }
                        .tag(item.id)
                        .contextMenu {
                            if section == .trash {
                                Button("Restore") { app.perform { _ = try await $0.command(Commands.VaultItemRestore(VaultItemIdArgs(vaultId: s.vaultId ?? "", itemId: item.id))) } }
                            } else {
                                Button("Duplicate") { app.perform { _ = try await $0.command(Commands.VaultItemDuplicate(VaultItemIdArgs(vaultId: s.vaultId ?? "", itemId: item.id))) } }
                                Button("Move to Trash", role: .destructive) { app.perform { _ = try await $0.command(Commands.VaultItemRemove(VaultItemIdArgs(vaultId: s.vaultId ?? "", itemId: item.id))) } }
                            }
                        }
                    }
                }
                .listStyle(.inset)
            }
            .frame(minWidth: 240, idealWidth: 280, maxWidth: 360)
            Group {
                if let id = selected, let vault = s.vaultId {
                    VaultItemDetail(vaultId: vault, itemId: id, kinds: items.value?.kinds ?? [], edit: { editing = $0 })
                } else {
                    EmptyScreen(symbol: "key", title: "No Item Selected", message: "Choose an item, or add one with +.")
                }
            }
            .frame(minWidth: 360)
        }
        .task(id: section) { if let v = s.vaultId { items.bind(app.client, Views.VaultItems(VaultItemsArgs(vaultId: v, section: section, folderId: nil))) } }
        .toolbar {
            ToolbarItemGroup(placement: .secondaryAction) {
                Menu {
                    ForEach(items.value?.kinds ?? [], id: \.kind) { k in
                        Button(k.label) { editing = VaultEditTarget(vaultId: s.vaultId ?? "", itemId: nil, kind: k) }
                    }
                } label: { Label("Add Item", systemImage: "plus") }
                Button { app.perform { _ = try await $0.command(Commands.VaultLock(VaultIdArgs(vaultId: s.vaultId ?? ""))) } } label: { Label("Lock Vault", systemImage: "lock") }
                    .help("Lock Vault")
            }
        }
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

/// One item's fields: secrets hidden until shown, copy buttons, one-time codes counting down.
struct VaultItemDetail: View {
    let vaultId: String
    let itemId: String
    var kinds: [VaultKindDef] = []
    let edit: (VaultEditTarget) -> Void
    private var app: AppModel { .shared }
    @State private var item: VaultItemValue?
    @State private var shown: Set<String> = []
    @State private var history = false

    var body: some View {
        Form {
            if let item {
                Section {
                    Text(item.title.nonEmpty ?? item.kindLabel).font(CoreType.screenTitle(22))
                    Text(item.kindLabel).foregroundStyle(.secondary)
                }
                Section {
                    ForEach(item.fields, id: \.key) { f in
                        LabeledContent(f.label) {
                            HStack {
                                if f.type == "totp" {
                                    TotpCode(secret: f.value, copied: { copy($0) })
                                } else if f.type == "password" || f.type == "secret" {
                                    Text(shown.contains(f.key) ? f.value : String(repeating: "•", count: min(12, max(6, f.value.count)))).font(.body.monospaced()).textSelection(.enabled)
                                    Button { if shown.contains(f.key) { shown.remove(f.key) } else { shown.insert(f.key) } } label: { Image(systemName: shown.contains(f.key) ? "eye.slash" : "eye") }.buttonStyle(.borderless)
                                } else {
                                    Text(f.value).textSelection(.enabled)
                                }
                                if f.type != "totp" { Button { copy(f.value) } label: { Image(systemName: "doc.on.doc") }.buttonStyle(.borderless).help("Copy") }
                            }
                        }
                    }
                }
                if !item.notes.isEmpty { Section("Notes") { Text(item.notes).textSelection(.enabled) } }
                Section { Text("Edited \(CoreDates.relative(item.updatedAt)) by \(item.updatedBy)").font(.caption).foregroundStyle(.secondary) }
            } else {
                ProgressView()
            }
        }
        .formStyle(.grouped)
        .toolbar {
            if item != nil {
                ToolbarItem {
                    Button("History") { history = true }
                }
            }
            if let item, item.canChange {
                ToolbarItem {
                    Button("Edit") {
                        let def = kinds.first { $0.kind == item.kind } ?? VaultKindDef(kind: item.kind, label: item.kindLabel, fields: item.fields.map { VaultFieldDef(key: $0.key, label: $0.label, type: $0.type) })
                        edit(VaultEditTarget(vaultId: vaultId, itemId: item.id, kind: def, values: Dictionary(uniqueKeysWithValues: item.fields.map { ($0.key, $0.value) }), title: item.title, notes: item.notes))
                    }
                }
            }
        }
        .sheet(isPresented: $history) { VaultHistorySheet(vaultId: vaultId, itemId: itemId) }
        .task(id: itemId) {
            shown = []
            item = try? await app.client?.command(Commands.VaultItemOpen(VaultItemIdArgs(vaultId: vaultId, itemId: itemId)))
        }
    }

    private func copy(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
        app.toast("Copied. Clears from the clipboard in 90 seconds.")
        let count = NSPasteboard.general.changeCount
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { if NSPasteboard.general.changeCount == count { NSPasteboard.general.clearContents() } }
    }
}

/// A one-time code from its secret, with the seconds it has left.
struct TotpCode: View {
    let secret: String
    var copied: ((String) -> Void)?
    private var app: AppModel { .shared }
    @State private var code: VaultTotpResult?

    var body: some View {
        HStack {
            Text(code?.code ?? "––– –––").font(.title3.monospaced().weight(.semibold))
            if let left = code?.secondsLeft { Text("\(left)s").font(.caption).foregroundStyle(.secondary).monospacedDigit() }
            if let c = code?.code, let copied { Button { copied(c) } label: { Image(systemName: "doc.on.doc") }.buttonStyle(.borderless).help("Copy Code") }
        }
        .task(id: secret) {
            while !Task.isCancelled {
                code = try? await app.client?.command(Commands.VaultTotp(VaultTotpArgs(secret: secret)))
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }
}

/// Adding or changing an item: its title, each field of its kind (with a generator for passwords), notes.
struct VaultItemEditor: View {
    @State private var target: VaultEditTarget
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss

    init(target: VaultEditTarget) { _target = State(initialValue: target) }

    var body: some View {
        Form {
            TextField("Title", text: $target.title)
            ForEach(target.kind.fields, id: \.key) { f in
                HStack {
                    TextField(f.label, text: Binding(get: { target.values[f.key] ?? "" }, set: { target.values[f.key] = $0 }))
                    if f.type == "password" {
                        Button("Generate") {
                            Task { @MainActor in
                                if let r = try? await app.client?.command(Commands.VaultGenerate(VaultGenerateArgs(kind: .password))) { target.values[f.key] = r.value }
                            }
                        }
                    }
                }
            }
            TextField("Notes", text: $target.notes, axis: .vertical).lineLimit(3...8)
        }
        .formStyle(.grouped)
        .frame(width: 440)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    let t = target
                    app.perform { _ = try await $0.command(Commands.VaultItemSave(VaultItemSaveArgs(vaultId: t.vaultId, itemId: t.itemId, kind: t.kind.kind, title: t.title, values: t.values, notes: t.notes))) }
                    dismiss()
                }
            }
        }
    }
}

@MainActor
enum VaultRecovery {
    /// The recovery key, once, to save somewhere safe.
    static func show(_ key: String, vaultId: String) {
        let alert = NSAlert()
        alert.messageText = "Save Your Recovery Key"
        alert.informativeText = "If you forget your passcode, this key is the only way back into your Vault. Keep it somewhere safe, such as your password manager.\n\n\(key)"
        alert.addButton(withTitle: "I've Saved It")
        alert.addButton(withTitle: "Copy Key")
        if alert.runModal() == .alertSecondButtonReturn {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(key, forType: .string)
        }
        AppModel.shared.perform { _ = try await $0.command(Commands.VaultRecoverySaved(VaultIdArgs(vaultId: vaultId))) }
    }
}

/// The Vault's other sections: Health (weak, reused or old passwords), Activity (who opened or changed what) and
/// People (who shares the Vault and their roles).
struct VaultHealthView: View {
    let vaultId: String
    private var app: AppModel { .shared }
    @State private var health = Live<Views.VaultHealth>()

    var body: some View {
        List {
            if let h = health.value {
                if h.groups.isEmpty { Text("Everything looks good.").foregroundStyle(.secondary) }
                ForEach(h.groups, id: \.issue) { g in
                    Section {
                        Text(g.body).font(.callout).foregroundStyle(.secondary)
                        ForEach(g.items, id: \.id) { item in
                            Label(item.title.nonEmpty ?? item.kindLabel, systemImage: g.tone == "danger" ? "exclamationmark.triangle" : "info.circle")
                        }
                    } header: { Text(g.title) }
                }
            } else {
                ProgressView()
            }
        }
        .task { health.bind(app.client, Views.VaultHealth(VaultIdArgs(vaultId: vaultId))) }
    }
}

struct VaultActivityView: View {
    let vaultId: String
    private var app: AppModel { .shared }
    @State private var activity = Live<Views.VaultActivity>()
    @State private var failedOnly = false

    var body: some View {
        List {
            Toggle("Only failed attempts", isOn: $failedOnly).toggleStyle(.checkbox)
            ForEach(activity.value?.entries ?? [], id: \.seq) { e in
                HStack(alignment: .top) {
                    Image(systemName: e.failed ? "xmark.octagon" : "checkmark.circle").foregroundStyle(e.failed ? .red : .secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(e.actorName) \(e.label)")
                        if !e.detail.isEmpty { Text(e.detail).font(.caption).foregroundStyle(.secondary) }
                        if let r = e.reason { Text(r).font(.caption).foregroundStyle(.red) }
                    }
                    Spacer()
                    Text(CoreDates.short(e.at)).font(.caption).foregroundStyle(.tertiary)
                }
            }
        }
        .task(id: failedOnly) { activity.bind(app.client, Views.VaultActivity(VaultActivityArgs(vaultId: vaultId, event: nil, failedOnly: failedOnly ? true : nil, personId: nil))) }
    }
}

struct VaultPeopleView: View {
    let vaultId: String
    private var app: AppModel { .shared }
    @State private var people = Live<Views.VaultPeople>()

    var body: some View {
        List {
            if let p = people.value {
                Section("People") {
                    ForEach(p.people, id: \.profileId) { person in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(person.name + (person.isYou ? " (you)" : ""))
                                Text([person.email, person.role.capitalized, person.status == "active" ? nil : person.status.capitalized].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if p.canAdd && !person.isYou {
                                Button("Remove") { app.perform { _ = try await $0.command(Commands.VaultPeopleRemove(VaultPersonArgs(vaultId: vaultId, profileId: person.profileId))) } }
                                    .buttonStyle(.borderless)
                            }
                        }
                    }
                }
                if p.canAdd, !p.candidates.isEmpty {
                    Section("Add from the Workspace") {
                        ForEach(p.candidates, id: \.profileId) { c in
                            HStack {
                                Text(c.name)
                                Spacer()
                                Button("Add") { app.perform { _ = try await $0.command(Commands.VaultPeopleAdd(VaultPersonArgs(vaultId: vaultId, profileId: c.profileId))) } }
                            }
                        }
                    }
                }
            } else {
                ProgressView()
            }
        }
        .task { people.bind(app.client, Views.VaultPeople(VaultIdArgs(vaultId: vaultId))) }
    }
}
