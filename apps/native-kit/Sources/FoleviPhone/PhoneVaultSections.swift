// The open Vault's sections on the iPhone (components/vault/Files.tsx, Passwords.tsx, Health.tsx, Trash.tsx,
// Sections.tsx) as the web lays them out at the phone's width, from the measured phone styles: Files & Notes (Grid
// or Lines), Passwords & Credentials (the list, the open item under it), Health, Trash, Settings, Activity, People.
#if os(iOS)
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import FoleviDesign
import FoleviEngine
import FoleviScreens

struct PhoneVaultSectionView: View {
    @Bindable var model: VaultModel
    let menus: PhoneMenus

    var body: some View {
        if let id = model.vaultId {
            switch model.section {
            case .files: PhoneVaultFiles(model: model, menus: menus, vaultId: id)
            case .passwords: PhoneVaultPasswords(model: model, menus: menus, vaultId: id)
            case .health: PhoneVaultHealth(model: model, vaultId: id)
            case .trash: PhoneVaultTrash(model: model, vaultId: id)
            case .settings: PhoneVaultSettings(model: model, menus: menus, vaultId: id)
            case .activity: PhoneVaultActivity(model: model, menus: menus, vaultId: id)
            case .people: PhoneVaultPeople(model: model, menus: menus, vaultId: id)
            }
        }
    }
}

// MARK: shared pieces

/// A list in a card (`divide-y divide-line ui-card rounded-control`).
struct PhoneVaultList<Content: View>: View {
    var card = true
    @ViewBuilder let content: Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let list = PV.style("list", scheme)
        let rows = _VariadicView.Tree(PhoneVaultDivided(line: FoleviTokens.Chrome.line.resolve(scheme).color)) { content }
        if card {
            rows
                .clipShape(RoundedRectangle(cornerRadius: list.radius, style: .continuous))
                .webBox(PV.pair("list"))
        } else {
            rows
        }
    }
}

private struct PhoneVaultDivided: _VariadicView_MultiViewRoot {
    let line: Color
    func body(children: _VariadicView.Children) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(children.enumerated()), id: \.offset) { i, child in
                if i > 0 { Rectangle().fill(line).frame(height: 1) }
                child
            }
        }
    }
}

/// A row of a list: title, detail, and something at the end (a time, a button).
struct PhoneVaultRow<Trailing: View>: View {
    let title: String
    let detail: String
    var person: (name: String, url: String?)? = nil
    var selected = false
    var action: (() -> Void)?
    @ViewBuilder var trailing: Trailing
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let row = PV.style("row", scheme)
        let t = PV.style("row.title", scheme)
        let d = PV.style("row.detail", scheme)
        let content = HStack(spacing: row.gap) {
            if let person { PhoneVaultAvatar(name: person.name) }
            VStack(alignment: .leading, spacing: 0) {
                Text(title).webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
                Text(detail.isEmpty ? " " : detail).webText(d.text).lineLimit(1).foregroundStyle(d.color.color)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(row.padding.edgeInsets)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? PV.color("glass-active", scheme) : .clear)
        .contentShape(Rectangle())
        if let action {
            Button(action: action) { content }.buttonStyle(PhoneRowPressStyle())
        } else {
            content
        }
    }
}

/// People's 32 pt initial (Avatar.tsx without a picture).
private struct PhoneVaultAvatar: View {
    let name: String
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        Text(String(name.prefix(1)).uppercased())
            .webText(WebTextStyle(size: 13, leading: 16, weight: 600))
            .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
            .frame(width: 32, height: 32)
            .background(Circle().fill(FoleviTokens.Chrome.surfaceSunken.resolve(scheme).color))
    }
}

struct PhoneVaultTime: View {
    let ms: Double
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let s = PV.style("row.time", scheme)
        Text(VaultTime.relative(ms, now: ScreenClock.now())).webText(s.text).lineLimit(1).fixedSize().foregroundStyle(s.color.color)
    }
}

/// A section's top sentence in muted text (Health, Trash).
struct PhoneVaultLead: View {
    let text: String
    var centred = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.phoneVaultWidth) private var width
    var body: some View {
        let s = PV.style("health.lead", scheme)
        PhoneVaultText(text: text, style: s.text, width: width, alignment: centred ? .center : .leading).foregroundStyle(s.color.color)
            .frame(maxWidth: .infinity, alignment: centred ? .center : .leading)
    }
}

/// A Select (ui/Select.tsx) on the iPhone: the chosen label and a chevron in an input well, its options in
/// Folevi's iOS menu.
struct PhoneVaultSelect: View {
    let style: String
    let label: String
    let options: [(String, String)]
    let selected: String
    let menus: PhoneMenus
    let onSelect: (String) -> Void
    @State private var frame: CGRect = .zero
    @Environment(\.colorScheme) private var scheme

    /// The measured width where it's known: Lock after (the web's flex row shortens its label), and the kind
    /// select while it reads "All kinds" (its label when measured; as the Mac's VaultSelect does).
    private var fixedWidth: Bool { style == "settings.select" || (style == "pw.kind" && label == "All kinds") }

    var body: some View {
        let s = PV.style(style, scheme)
        Button {
            menus.show(options.map { o in PhoneMenuEntry(.item(o.1, checked: o.0 == selected)) { onSelect(o.0) } }, from: frame, side: .bottom, align: .end, minWidth: max(s.width, 200))
        } label: {
            HStack(spacing: s.gap) {
                Text(label).webText(s.text).lineLimit(1).truncationMode(.tail)
                Spacer(minLength: 0)
                WebIconView(.chevronDown, size: 14).opacity(0.6)
            }
            .padding(s.padding.edgeInsets)
            // Settings' Lock after is as wide as the web's flex row leaves it (its label shortened); the others
            // are as wide as their label.
            .frame(width: fixedWidth ? s.width : nil, height: s.height)
            .fixedSize(horizontal: !fixedWidth, vertical: false)
            .foregroundStyle(s.color.color)
            .webBox(PV.pair(style))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
        .accessibilityValue(label)
    }
}

// MARK: Files & Notes

struct PhoneVaultFiles: View {
    @Bindable var model: VaultModel
    let menus: PhoneMenus
    let vaultId: String
    @Environment(\.colorScheme) private var scheme
    @State private var busy = false
    @State private var uploadFrame: CGRect = .zero
    @State private var importing = false
    @State private var photo: PhotosPickerItem?
    @State private var pickingPhoto = false

    var body: some View {
        let folders = model.store("folders") { .vaultFolders(vaultId: vaultId) }
        let items = model.store("files:\(model.folderId ?? "")") { .vaultItems(vaultId: vaultId, section: .files, folderId: model.folderId) }
        let all = folders.value?.folders ?? []
        let here = all.filter { $0.parentId == model.folderId }
        let name = { (id: String?) in id.flatMap { i in all.first { $0.id == i }?.name } }
        let bar = PV.style("files.bar", scheme)
        let title = PV.style("files.title", scheme)
        VStack(alignment: .leading, spacing: 0) {
            PhoneVaultFlow(gap: bar.gap, rowGap: bar.gap, pushAfterFirst: model.folderId == nil) {
                if let current = model.folderId {
                    let parent = all.first { $0.id == current }?.parentId
                    WebButton(parent.flatMap { name($0) } ?? "Files & Notes", icon: .chevronLeft, iconSize: 14, styleName: "phone.vault.files.button", variant: .quiet) { model.folderId = parent }
                }
                Text(name(model.folderId) ?? "Files & Notes").webText(title.text).lineLimit(1).foregroundStyle(title.color.color)
                    .accessibilityAddTraits(.isHeader)
                layoutSwitch
                WebButton("Folder", icon: .folderPlus, iconSize: 14, styleName: "phone.vault.files.button") { model.dialog = .newFolder }
                WebButton("Note", icon: .filePlusCorner, iconSize: 14, styleName: "phone.vault.files.button") { model.dialog = .newNote }
                WebButton(busy ? "Encrypting…" : "Upload", icon: .upload, iconSize: 14, styleName: "phone.vault.files.upload", variant: .primary) { chooseUpload() }
                    .disabled(busy)
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { uploadFrame = $0 }
            }
            .padding(.bottom, bar.margin.bottom)
            if !here.isEmpty { folderList(here) }
            if let entries = items.value?.items {
                if entries.isEmpty {
                    if here.isEmpty { PhoneVaultEmpty(icon: .fileText, title: "Nothing here yet", message: "Upload files of any kind, or write a note. They're encrypted on this device before they leave it.") }
                } else if model.filesLayout == "grid" {
                    LazyVGrid(columns: grid, alignment: .leading, spacing: PV.style("files.cards", scheme).gap) {
                        ForEach(entries, id: \.id) { e in card(e, all: entries) }
                    }
                } else {
                    PhoneVaultList {
                        ForEach(entries, id: \.id) { e in
                            PhoneVaultFileLine(entry: e) { open(e, all: entries) }
                        }
                    }
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item]) { result in
            if case .success(let url) = result { send(url) }
        }
        .photosPicker(isPresented: $pickingPhoto, selection: $photo, matching: .any(of: [.images, .videos]), preferredItemEncoding: .current)
        .onChange(of: photo) { _, item in
            guard let item else { return }
            photo = nil
            Task { @MainActor in
                guard let data = try? await item.loadTransferable(type: Data.self) else { return model.toast("That couldn't be read.", tone: .error) }
                let type = item.supportedContentTypes.first ?? .jpeg
                let ext = type.preferredFilenameExtension ?? "jpg"
                let stamp = Date().formatted(.iso8601.year().month().day().dateSeparator(.dash))
                send(data: data, name: "Photo \(stamp).\(ext)", mime: type.preferredMIMEType ?? "image/jpeg")
            }
        }
    }

    /// `grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2`.
    private var grid: [GridItem] {
        [GridItem(.adaptive(minimum: 180), spacing: PV.style("files.cards", scheme).gap, alignment: .top)]
    }

    private var layoutSwitch: some View {
        let seg = PV.style("files.seg", scheme)
        return HStack(spacing: seg.gap) {
            segButton("grid", .layoutGrid, "Grid")
            segButton("list", .rows3, "Lines")
        }
        .padding(seg.padding.edgeInsets)
        .webBox(PV.pair("files.seg"))
    }

    private func segButton(_ value: String, _ icon: WebIcon, _ label: String) -> some View {
        let on = model.filesLayout == value
        let s = PV.style(on ? "files.seg.on" : "files.seg.off", scheme)
        return Button { model.filesLayout = value } label: {
            WebIconView(icon, size: 15)
                .foregroundStyle(s.color.color)
                .frame(width: s.width, height: s.height)
                .webBox(PV.pair(on ? "files.seg.on" : "files.seg.off"))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    @ViewBuilder private func folderList(_ here: [VaultFolderRow]) -> some View {
        let wrap = PV.style("files.folders", scheme)
        Group {
            if model.filesLayout == "grid" {
                LazyVGrid(columns: grid, alignment: .leading, spacing: wrap.gap) {
                    ForEach(here, id: \.id) { f in folderCard(f) }
                }
            } else {
                PhoneVaultList {
                    ForEach(here, id: \.id) { f in
                        let s = PV.style("files.folder.name", scheme)
                        Button { openFolder(f) } label: {
                            HStack(spacing: 12) {
                                FolderGlyph(colorId: nil, size: 15)
                                Text(f.name).webText(s.text).lineLimit(1).foregroundStyle(s.color.color)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PhoneRowPressStyle())
                    }
                }
            }
        }
        .padding(.bottom, wrap.margin.bottom)
    }

    private func folderCard(_ f: VaultFolderRow) -> some View {
        let s = PV.style("files.folder", scheme)
        let n = PV.style("files.folder.name", scheme)
        return Button { openFolder(f) } label: {
            HStack(spacing: s.gap) {
                FolderGlyph(colorId: nil, size: 17)
                Text(f.name).webText(n.text).lineLimit(1).foregroundStyle(n.color.color)
                Spacer(minLength: 0)
            }
            .padding(s.padding.edgeInsets)
            .frame(maxWidth: .infinity, minHeight: s.height, alignment: .leading)
            .webBox(PV.pair("files.folder"))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func card(_ e: VaultItemRow, all: [VaultItemRow]) -> some View {
        let s = PV.style("files.card", scheme)
        let icon = PV.style("files.card.icon", scheme)
        let t = PV.style("files.card.title", scheme)
        let d = PV.style("files.card.detail", scheme)
        return Button { open(e, all: all) } label: {
            VStack(alignment: .leading, spacing: s.gap) {
                WebIconView(e.kind == "file" ? .upload : .fileText, size: 17).foregroundStyle(icon.color.color)
                VStack(alignment: .leading, spacing: 0) {
                    Text(e.title).webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
                    Text([e.detail, VaultTime.relative(e.updatedAt, now: ScreenClock.now())].filter { !$0.isEmpty }.joined(separator: " · ")).webText(d.text).lineLimit(1).foregroundStyle(d.color.color)
                }
            }
            .padding(s.padding.edgeInsets)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .webBox(PV.pair("files.card"))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func openFolder(_ f: VaultFolderRow) {
        model.folderId = f.id
        model.record("folder.open")
    }

    private func open(_ e: VaultItemRow, all: [VaultItemRow]) {
        if e.kind == "file" {
            let files = all.filter { $0.kind == "file" }
            model.dialog = .preview(files: files, index: files.firstIndex { $0.id == e.id } ?? 0)
        } else {
            model.dialog = .note(e)
        }
    }

    /// Upload: the photo library or Files (the web's file input offers both on the iPhone).
    private func chooseUpload() {
        menus.show([
            PhoneMenuEntry(.item("Photo Library", icon: .image)) { pickingPhoto = true },
            PhoneMenuEntry(.item("Choose File", icon: .folder)) { importing = true },
        ], from: uploadFrame, side: .bottom, align: .end, minWidth: 220)
    }

    private func send(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return model.toast("That file couldn't be read.", tone: .error) }
        send(data: data, name: url.lastPathComponent, mime: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream")
    }

    /// A file sent to the engine, which seals it before it goes anywhere (50 MB at most, as any attachment).
    private func send(data: Data, name: String, mime: String) {
        guard data.count <= 50 * 1024 * 1024 else { return model.toast("Files up to 50 MB go in the Vault.", tone: .error) }
        let folder = model.folderId
        busy = true
        Task { @MainActor in
            do {
                _ = try await model.client.command(.vaultFileUpload(vaultId: vaultId, folderId: folder, name: name, mime: mime, data: data.base64EncodedString()))
                model.toast("\(name) added to the Vault", tone: .success)
            } catch { model.toast(VaultModel.message(error), tone: .error) }
            busy = false
        }
    }
}

private struct PhoneVaultFileLine: View {
    let entry: VaultItemRow
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = PV.style("row.title", scheme)
        let d = PV.style("row.detail", scheme)
        Button(action: action) {
            HStack(spacing: 12) {
                WebIconView(entry.kind == "file" ? .upload : .fileText, size: 15).foregroundStyle(d.color.color)
                VStack(alignment: .leading, spacing: 0) {
                    Text(entry.title).webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
                    Text(entry.detail.isEmpty ? " " : entry.detail).webText(d.text).lineLimit(1).foregroundStyle(d.color.color)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                PhoneVaultTime(ms: entry.updatedAt)
            }
            .padding(PV.style("row", scheme).padding.edgeInsets)
            .contentShape(Rectangle())
        }
        .buttonStyle(PhoneRowPressStyle())
    }
}

// MARK: Passwords & Credentials

struct PhoneVaultPasswords: View {
    @Bindable var model: VaultModel
    let menus: PhoneMenus
    let vaultId: String
    @State private var query = ""
    @State private var kind = "all"
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let items = model.store("passwords") { .vaultItems(vaultId: vaultId, section: .passwords) }
        let kinds = items.value?.kinds ?? []
        let bar = PV.style("pw.bar", scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: bar.gap) {
                search
                PhoneVaultSelect(style: "pw.kind", label: kind == "all" ? "All kinds" : kinds.first { $0.kind == kind }?.label ?? "All kinds", options: [("all", "All kinds")] + kinds.map { ($0.kind, $0.label) }, selected: kind, menus: menus) { kind = $0 }
                WebButton("Add", icon: .plus, iconSize: 14, styleName: "phone.vault.pw.add", variant: .primary) { model.dialog = .addItem }
            }
            .padding(.bottom, bar.margin.bottom)
            if let all = items.value?.items {
                let shown = filtered(all)
                VStack(alignment: .leading, spacing: 24) {
                    if shown.isEmpty {
                        PhoneVaultEmpty(icon: .search, title: all.isEmpty ? "No passwords yet" : "Nothing matches", message: all.isEmpty ? "Add logins, API keys, cards and other credentials. Only people in the Vault can open them." : nil)
                    } else {
                        PhoneVaultList {
                            ForEach(shown, id: \.id) { o in
                                PhoneVaultRow(title: o.title, detail: o.detail, selected: model.selected == o.id, action: { model.selected = model.selected == o.id ? nil : o.id }) { PhoneVaultTime(ms: o.updatedAt) }
                                    .contextMenu {
                                        Button("Open", systemImage: "key") { model.selected = o.id }
                                        Button("Duplicate", systemImage: "plus.square.on.square") { duplicate(o.id) }
                                    }
                            }
                        }
                    }
                    if let id = model.selected, let row = all.first(where: { $0.id == id }) {
                        PhoneVaultItemPanel(model: model, vaultId: vaultId, itemId: id, revision: row.revision)
                            .id(id)
                    }
                }
            }
        }
        #if DEBUG
        // screen-match.mjs: an item opened by its title (FOLEVI_VAULT_ITEM).
        .task(id: items.value?.items.count) {
            if let title = ProcessInfo.processInfo.environment["FOLEVI_VAULT_ITEM"], model.selected == nil {
                model.selected = items.value?.items.first { $0.title == title }?.id
            }
        }
        #endif
    }

    private var search: some View {
        let s = PV.style("pw.search", scheme)
        let icon = PV.style("pw.search.icon", scheme)
        return ZStack(alignment: .leading) {
            TextField("", text: $query, prompt: Text("Search").foregroundStyle(icon.color.color))
                .webText(s.text)
                .autocorrectionDisabled()
                .padding(s.padding.edgeInsets)
                .frame(height: s.height)
                .foregroundStyle(s.color.color)
                .webBox(PV.pair("pw.search"))
            WebIconView(.search, size: 14).foregroundStyle(icon.color.color).padding(.leading, icon.x - s.x).allowsHitTesting(false)
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel("Search the Vault")
    }

    private func filtered(_ all: [VaultItemRow]) -> [VaultItemRow] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return all.filter { (kind == "all" || $0.kind == kind) && (needle.isEmpty || $0.title.lowercased().contains(needle) || $0.detail.lowercased().contains(needle)) }
    }

    private func duplicate(_ id: String) {
        model.run {
            let r = try await model.client.command(.vaultItemDuplicate(vaultId: vaultId, itemId: id))
            model.toast("Duplicated", tone: .success)
            model.selected = r.id
            let item = try await model.client.command(.vaultItemOpen(vaultId: vaultId, itemId: r.id))
            model.dialog = .editItem(item)
        }
    }
}

/// An open item (Passwords.tsx ItemPanel), under the list at the phone's width: fields, hidden ones shown on
/// reveal, copy, a live 2FA code, history, Edit, Share and Trash. Opening it is logged by the engine; revealing and
/// copying are reported.
struct PhoneVaultItemPanel: View {
    @Bindable var model: VaultModel
    let vaultId: String
    let itemId: String
    let revision: Int
    @State private var item: VaultItemValue?
    @State private var revealed: Set<String> = []
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let card = PV.style("item.card", scheme)
        let head = PV.style("item.head", scheme)
        let t = PV.style("item.title", scheme)
        let d = PV.style("item.sub", scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: head.gap) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(item?.title ?? " ").webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
                    Text(item.map { "\($0.kindLabel) · added by \($0.createdBy), changed by \($0.updatedBy)" } ?? " ").webText(d.text).foregroundStyle(d.color.color).fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                iconButton(.rotateCcwClock, "Earlier versions") {
                    if let item { model.dialog = .history(itemId: item.id, canChange: item.canChange) }
                }
                if item?.canChange == true, let item {
                    WebButton("Edit", styleName: "phone.vault.item.button", size: .sm) { model.dialog = .editItem(item) }
                    WebButton("Share", icon: .share2, iconSize: 13, styleName: "phone.vault.item.button", size: .sm) { model.dialog = .share(itemId: item.id, title: item.title, note: false) }
                    iconButton(.trash, "Move to the Vault's Trash") {
                        model.run {
                            _ = try await model.client.command(.vaultItemRemove(vaultId: vaultId, itemId: item.id))
                            model.toast("Moved to the Vault's Trash")
                            model.selected = nil
                        }
                    }
                }
            }
            .padding(.bottom, head.margin.bottom)
            if let item {
                PhoneVaultList(card: false) {
                    ForEach(item.fields.filter { !$0.value.isEmpty }, id: \.key) { f in field(f, item: item) }
                    if !item.notes.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Notes").webText(PV.style("item.label", scheme).text).foregroundStyle(PV.style("item.label", scheme).color.color)
                            Text(item.notes).webText(PV.style("item.value", scheme).text).foregroundStyle(PV.style("item.value", scheme).color.color).textSelection(.enabled)
                        }
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            } else {
                RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(FoleviTokens.Chrome.surface.resolve(scheme).color).frame(height: 80)
            }
        }
        .padding(card.padding.edgeInsets)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .webBox(PV.pair("item.card"))
        .task(id: revision) { await load() }
    }

    private func iconButton(_ icon: WebIcon, _ label: String, action: @escaping () -> Void) -> some View {
        let s = PV.style("item.icon", scheme)
        return Button(action: action) {
            WebIconView(icon, size: 14)
                .foregroundStyle(s.color.color)
                .frame(width: s.width, height: s.height)
                .webBox(PV.pair("item.icon"))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func load() async {
        do { item = try await model.client.command(.vaultItemOpen(vaultId: vaultId, itemId: itemId)) } catch { model.toast(VaultModel.message(error), tone: .error) }
    }

    @ViewBuilder private func field(_ f: VaultFieldValue, item: VaultItemValue) -> some View {
        let row = PV.style("item.field", scheme)
        let label = PV.style("item.label", scheme)
        let value = PV.style(f.type == "secret" ? "item.secret" : "item.value", scheme)
        let dt = Text(f.label).webText(label.text).foregroundStyle(label.color.color).frame(width: label.width, alignment: .leading)
        // `flex flex-wrap gap-x-3`: the value beside its label, filling the rest (a long one breaks anywhere).
        HStack(spacing: row.gap) {
            dt
            fieldValue(f, item: item, value: value)
        }
        .padding(row.padding.edgeInsets)
    }

    @ViewBuilder private func fieldValue(_ f: VaultFieldValue, item: VaultItemValue, value: WebComputedStyle) -> some View {
            HStack(spacing: 6) {
                if f.type == "totp" {
                    PhoneVaultTotp(model: model, secret: f.value, itemId: item.id)
                } else {
                    let hidden = f.type == "secret" && !revealed.contains(f.key)
                    // `break-all`: a long value (a URL, a key) breaks at any letter.
                    // (No text selection: it would carry the breaks; Copy copies the value itself.)
                    Text(hidden ? "••••••••••••" : f.value.map(String.init).joined(separator: "\u{200B}"))
                        .webText(value.text)
                        .foregroundStyle(value.color.color)
                        .accessibilityLabel(hidden ? "Hidden" : f.value)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if f.type == "secret" {
                        iconButton(hidden ? .eye : .eyeOff, hidden ? "Show \(f.label)" : "Hide \(f.label)") {
                            if hidden {
                                revealed.insert(f.key)
                                model.record("item.reveal", itemId: item.id, field: f.key)
                            } else { revealed.remove(f.key) }
                        }
                    }
                    iconButton(.copy, "Copy \(f.label)") { model.copy(f.label, f.value, itemId: item.id) }
                }
            }
    }
}

/// A 2FA code worked out by the engine each second (lib/vault/totp.ts), shown as "123 456" with its seconds.
struct PhoneVaultTotp: View {
    @Bindable var model: VaultModel
    let secret: String
    let itemId: String
    @State private var code: String?
    @State private var seconds = 0
    @State private var unreadable = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 8) {
            if unreadable {
                Text("Not a 2FA secret Folevi can read.").webText(PV.style("item.sub", scheme).text).foregroundStyle(PV.color("warning", scheme))
            } else {
                Text(code.map { "\($0.prefix(3)) \($0.dropFirst(3))" } ?? "··· ···")
                    .font(.system(size: 20, design: .monospaced))
                    .tracking(2.4)
                    .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                Text(code == nil ? "" : "\(seconds)s").webText(PV.style("item.sub", scheme).text).foregroundStyle(PV.style("item.sub", scheme).color.color)
                WebIconButton(.copy, label: "Copy the code") { if let code { model.copy("2FA code", code, itemId: itemId, event: "totp.copy") } }
            }
            Spacer(minLength: 0)
        }
        .task {
            model.record("totp.show", itemId: itemId)
            while !Task.isCancelled {
                if let r = try? await model.client.command(.vaultTotp(secret: secret)) {
                    unreadable = r.code == nil
                    code = r.code
                    seconds = r.secondsLeft
                }
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }
}

// MARK: Health

struct PhoneVaultHealth: View {
    @Bindable var model: VaultModel
    let vaultId: String
    @Environment(\.colorScheme) private var scheme
    @Environment(\.phoneVaultWidth) private var width

    var body: some View {
        let health = model.store("health") { .vaultHealth(vaultId: vaultId) }
        if let h = health.value {
            let section = PV.style("health.section", scheme)
            VStack(alignment: .leading, spacing: section.gap > 0 ? section.gap : 20) {
                PhoneVaultLead(text: "\(h.needsLook > 0 ? "\(h.needsLook) \(h.needsLook == 1 ? "item needs" : "items need") a look." : "Nothing needs a look.") Checked on this device: only the first 5 characters of a password's SHA-1 ever leave it.", centred: h.groups.isEmpty)
                if h.groups.isEmpty {
                    PhoneVaultEmpty(icon: .heartPulse, title: "All healthy", message: "No weak, reused or breached passwords, and nothing about to expire.")
                }
                ForEach(h.groups, id: \.issue) { g in
                    let heading = PV.style("health.heading", scheme)
                    let count = PV.style("health.count", scheme)
                    let body = PV.style("health.body", scheme)
                    let tone: RGBA = g.tone == "muted" ? FoleviTokens.Chrome.inkMuted.resolve(scheme) : WebStyles.vars["color-\(g.tone == "danger" ? "danger" : "warning")"]?.resolve(scheme) ?? heading.color
                    VStack(alignment: .leading, spacing: 0) {
                        WebParagraph([WebRun(g.title + " ", color: tone), WebRun("(\(g.items.count))", weight: count.fontWeight, color: count.color)], style: heading.text, width: width, wrap: .greedy)
                        PhoneVaultText(text: g.body, style: body.text, width: width).foregroundStyle(body.color.color).padding(.bottom, body.margin.bottom)
                        PhoneVaultList {
                            ForEach(g.items, id: \.id) { o in
                                PhoneVaultRow(title: o.title, detail: o.detail, action: {
                                    model.selected = o.id
                                    model.open(.passwords)
                                }) { EmptyView() }
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: Trash

struct PhoneVaultTrash: View {
    @Bindable var model: VaultModel
    let vaultId: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let trash = model.store("trash") { .vaultItems(vaultId: vaultId, section: .trash) }
        let bar = PV.style("trash.bar", scheme)
        VStack(alignment: .leading, spacing: bar.margin.bottom > 0 ? bar.margin.bottom : 12) {
            PhoneVaultFlow(gap: bar.gap, rowGap: bar.gap, pushAfterFirst: true) {
                Text("Deleted items stay here for 30 days, then go for good.").webText(PV.style("trash.lead", scheme).text).foregroundStyle(PV.style("trash.lead", scheme).color.color)
                if model.value?.role != "member", !(trash.value?.items.isEmpty ?? true) {
                    WebButton("Empty Trash", icon: .trash, iconSize: 14, styleName: "phone.vault.trash.empty") { model.dialog = .emptyTrash }
                }
            }
            if let items = trash.value?.items {
                if items.isEmpty {
                    PhoneVaultEmpty(icon: .trash, title: "The Trash is empty")
                } else {
                    PhoneVaultList {
                        ForEach(items, id: \.id) { row in
                            PhoneVaultRow(title: row.title, detail: Self.detail(row)) {
                                WebButton("Restore", icon: .rotateCcw, iconSize: 13, styleName: "phone.vault.trash.restore", size: .sm) {
                                    model.run {
                                        _ = try await model.client.command(.vaultItemRestore(vaultId: vaultId, itemId: row.id))
                                        model.toast("Restored")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

extension PhoneVaultTrash {
    /// "Login · deleted 2 days ago · 28 days left".
    static func detail(_ row: VaultItemRow) -> String {
        let now = ScreenClock.now()
        let deleted: Double = row.deletedAt ?? 0
        let endsMs: Double = deleted + 30 * 86_400_000
        let leftDays: Double = (endsMs - now.timeIntervalSince1970 * 1000) / 86_400_000
        let left = max(0, Int(leftDays.rounded(.up)))
        let when = VaultTime.relative(row.deletedAt ?? row.updatedAt, now: now)
        return [row.kindLabel, "deleted \(when)", "\(left) \(left == 1 ? "day" : "days") left"].joined(separator: " · ")
    }
}

// MARK: Settings

struct PhoneVaultSettings: View {
    @Bindable var model: VaultModel
    let menus: PhoneMenus
    let vaultId: String
    @State private var biometricsOn = false
    @State private var askingPasscode = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.phoneVaultWidth) private var width

    var body: some View {
        let label = PV.style("settings.label", scheme)
        let hint = PV.style("settings.hint", scheme)
        let v = model.value
        VStack(alignment: .leading, spacing: 20) {
            if v?.role != "member" {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Lock after").webText(label.text).foregroundStyle(label.color.color)
                        // (A span, not a <p>: broken greedily, beside the select's measured width.)
                        PhoneVaultText(text: "Idle minutes before the Vault locks itself on a device.", style: hint.text, width: width - 12 - PV.style("settings.select", scheme).width, paragraph: false).foregroundStyle(hint.color.color)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    let m = v?.autoLockMinutes ?? 5
                    PhoneVaultSelect(style: "settings.select", label: "\(m) \(m == 1 ? "minute" : "minutes")", options: [1, 2, 5, 10, 15, 30].map { ("\($0)", "\($0) \($0 == 1 ? "minute" : "minutes")") }, selected: "\(m)", menus: menus) { value in
                        model.run {
                            _ = try await model.client.command(.vaultSettingsUpdate(vaultId: vaultId, autoLockMinutes: Int(value)))
                            model.toast("Saved")
                        }
                    }
                }
            }
            if v?.role == "owner", v?.personal == false {
                toggleRow("Custodians can name custodians", hint: "Otherwise only you do. Custodians always add and remove members.", isOn: Binding(get: { v?.custodiansNameCustodians ?? false }, set: { on in
                    model.run {
                        _ = try await model.client.command(.vaultSettingsUpdate(vaultId: vaultId, custodiansNameCustodians: on))
                        model.toast("Saved")
                    }
                }))
            }
            // This device's own: Face ID instead of the passcode (only where the device has it).
            if VaultBiometrics.available {
                toggleRow("Unlock with \(VaultBiometrics.name)", hint: "On this \(VaultBiometrics.device) only. The Vault still locks itself after its idle minutes.", isOn: Binding(get: { biometricsOn }, set: { on in
                    if on { askingPasscode = true } else {
                        VaultBiometrics.turnOff(vaultId: vaultId)
                        biometricsOn = false
                    }
                }))
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Import and export").webText(label.text).foregroundStyle(label.color.color)
                PhoneVaultText(text: "Import a CSV from 1Password, Bitwarden, LastPass, Chrome, Safari or Firefox, or a Folevi Vault backup. Items are encrypted on this device before they're sent.", style: hint.text, width: width, paragraph: false).foregroundStyle(hint.color.color)
                PhoneVaultFlow(gap: 8, rowGap: 8, pushAfterFirst: false) {
                    WebButton("Import…", icon: .upload, iconSize: 14, styleName: "phone.vault.settings.button") { importExportLater() }
                    if v?.role != "member" {
                        WebButton("Encrypted backup…", icon: .download, iconSize: 14, styleName: "phone.vault.settings.button") { importExportLater() }
                        WebButton("Readable CSV…", icon: .download, iconSize: 14, styleName: "phone.vault.settings.button") { importExportLater() }
                    }
                }
            }
            PhoneVaultFlow(gap: 8, rowGap: 8, pushAfterFirst: false) {
                WebButton("Change passcode", styleName: "phone.vault.settings.button") { model.dialog = .changePasscode }
                WebButton("Make a new recovery key", styleName: "phone.vault.settings.button") {
                    model.run { _ = try await model.client.command(.vaultNewRecoveryKey(vaultId: vaultId)) }
                }
                WebButton("Lock now", styleName: "phone.vault.settings.button") { model.lock() }
            }
        }
        .onAppear { biometricsOn = VaultBiometrics.isOn(vaultId: vaultId) }
        .sheet(isPresented: $askingPasscode) {
            PhoneVaultBiometricsSheet(model: model, vaultId: vaultId) { on in
                biometricsOn = on
                askingPasscode = false
            }
            .presentationDetents([.medium])
        }
    }

    private func toggleRow(_ title: String, hint: String, isOn: Binding<Bool>) -> some View {
        let label = PV.style("settings.label", scheme)
        let h = PV.style("settings.hint", scheme)
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Text(title).webText(label.text).foregroundStyle(label.color.color)
                Text(hint).webText(h.text).foregroundStyle(h.color.color).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Toggle(title, isOn: isOn).labelsHidden().tint(FoleviTokens.Chrome.heading.resolve(scheme).color)
        }
    }

    private func importExportLater() {
        model.toast("Import and export are on the web for now: open the Vault at folevi.com.")
    }
}

/// Turning Face ID on from Settings: the passcode once more (checked by the engine), then kept behind Face ID.
private struct PhoneVaultBiometricsSheet: View {
    @Bindable var model: VaultModel
    let vaultId: String
    let done: (Bool) -> Void
    @State private var passcode = ""
    @State private var error: String?
    @State private var busy = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        PhoneSheetPanel(title: "Unlock with \(VaultBiometrics.name)", close: { done(false) }) {
            VStack(alignment: .leading, spacing: 16) {
                Text("Type your Vault passcode. This \(VaultBiometrics.device) then asks for \(VaultBiometrics.name) instead.")
                    .webText(PV.style("gate.body", scheme).text)
                    .foregroundStyle(PV.style("gate.body", scheme).color.color)
                    .fixedSize(horizontal: false, vertical: true)
                PhonePasscodeInput(label: "Passcode", value: $passcode, autoFocus: true) { save() }
                if let error { Text(error).webText(PV.style("health.body", scheme).text).foregroundStyle(PV.color("danger", scheme)) }
                WebButton(busy ? "Checking…" : "Turn on", variant: .primary) { save() }.disabled(busy || passcode.isEmpty)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
    }

    private func save() {
        guard !passcode.isEmpty, !busy else { return }
        busy = true
        error = nil
        let p = passcode
        Task { @MainActor in
            do {
                // The passcode opens the Vault (already open: it only proves the passcode).
                let r = try await model.client.command(.vaultUnlock(vaultId: vaultId, passcode: p))
                if r.status == "ok", await VaultBiometrics.turnOn(vaultId: vaultId, passcode: p) {
                    done(true)
                } else {
                    error = r.status == "ok" ? "This \(VaultBiometrics.device) couldn't keep it. Try again." : r.message
                }
            } catch { self.error = VaultModel.message(error) }
            busy = false
        }
    }
}

// MARK: Activity (an account's Vault)

struct PhoneVaultActivity: View {
    @Bindable var model: VaultModel
    let menus: PhoneMenus
    let vaultId: String
    @State private var event = ""
    @State private var failedOnly = false
    @Environment(\.colorScheme) private var scheme

    private static let filters: [(String, String)] = [("", "Everything"), ("vault.", "Unlocking and locking"), ("item.", "Items"), ("file.", "Files"), ("note.", "Notes"), ("person.", "People"), ("link.", "Links"), ("share.", "Sharing")]

    var body: some View {
        let log = model.store("activity:\(event):\(failedOnly)") { .vaultActivity(vaultId: vaultId, event: event.isEmpty ? nil : event, failedOnly: failedOnly ? true : nil) }
        let title = PV.style("row.title", scheme)
        let detail = PV.style("row.detail", scheme)
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                PhoneVaultSelect(style: "pw.kind", label: Self.filters.first { $0.0 == event }?.1 ?? "Everything", options: Self.filters, selected: event, menus: menus) { event = $0 }
                Spacer(minLength: 0)
                Text("Failures only").webText(detail.text).foregroundStyle(detail.color.color)
                Toggle("Failures only", isOn: $failedOnly).labelsHidden().tint(FoleviTokens.Chrome.heading.resolve(scheme).color)
            }
            if log.value?.everything == false {
                Text("You see your own activity. The owner and custodians see everyone's.").webText(PV.style("health.body", scheme).text).foregroundStyle(PV.style("health.body", scheme).color.color)
            }
            if let entries = log.value?.entries, !entries.isEmpty {
                PhoneVaultList {
                    ForEach(entries, id: \.seq) { e in
                        VStack(alignment: .leading, spacing: 0) {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(e.actorName).webText(title.text).foregroundStyle(title.color.color).lineLimit(1)
                                Spacer(minLength: 0)
                                Text(VaultTime.dateTime(e.at)).webText(PV.style("row.time", scheme).text).foregroundStyle(PV.style("row.time", scheme).color.color)
                            }
                            Text(e.label + (e.failed ? " (failed\(e.reason.map { ": \($0)" } ?? ""))" : "")).webText(PV.style("health.lead", scheme).text).foregroundStyle(e.failed ? PV.color("danger", scheme) : title.color.color)
                            Text(e.detail).webText(detail.text).foregroundStyle(detail.color.color)
                        }
                        .padding(PV.style("row", scheme).padding.edgeInsets)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            } else if log.value != nil {
                PhoneVaultEmpty(icon: .activity, title: "Nothing yet")
            }
        }
    }
}

// MARK: People (a team Vault)

struct PhoneVaultPeople: View {
    @Bindable var model: VaultModel
    let menus: PhoneMenus
    let vaultId: String
    @State private var pick: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let people = model.store("people") { .vaultPeople(vaultId: vaultId) }
        if let p = people.value {
            let detail = PV.style("row.detail", scheme)
            VStack(alignment: .leading, spacing: 16) {
                if p.onlyOneCustodian {
                    HStack(alignment: .top, spacing: 8) {
                        WebIconView(.shieldAlert, size: 16)
                        Text("Only one person can manage this Vault. If they lose their recovery key, nobody can open it. Make someone else a custodian too.").webText(PV.style("health.lead", scheme).text).fixedSize(horizontal: false, vertical: true)
                    }
                    .foregroundStyle(PV.color("warning", scheme))
                    .padding(12)
                    .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).stroke(PV.color("warning", scheme).opacity(0.4)))
                }
                if p.canAdd {
                    PhoneVaultFlow(gap: 8, rowGap: 8, pushAfterFirst: false) {
                        PhoneVaultSelect(style: "pw.kind", label: p.candidates.first { $0.profileId == pick }?.name ?? "Choose a workspace member", options: p.candidates.map { ($0.profileId, $0.name) }, selected: pick ?? "", menus: menus) { pick = $0 }
                        WebButton("Add", icon: .userPlus, iconSize: 14, variant: .primary) {
                            guard let id = pick else { return }
                            pick = nil
                            model.run {
                                _ = try await model.client.command(.vaultPeopleAdd(vaultId: vaultId, profileId: id))
                                model.toast("Added. Their key arrives when you next open the Vault.")
                            }
                        }
                        .disabled(pick == nil)
                        WebButton("Everyone here should have access") {
                            model.run {
                                _ = try await model.client.command(.vaultPeopleReviewed(vaultId: vaultId))
                                model.toast("Access reviewed")
                            }
                        }
                    }
                }
                PhoneVaultList {
                    ForEach(p.people, id: \.profileId) { person in
                        PhoneVaultRow(title: person.name + (person.isYou ? " (you)" : ""), detail: [person.email, person.status].compactMap { $0 }.joined(separator: " · "), person: (person.name, person.avatarUrl)) {
                            if person.role == "owner" {
                                Text("Owner").webText(detail.text).foregroundStyle(detail.color.color)
                            } else if p.canNameCustodians {
                                PhoneVaultSelect(style: "pw.kind", label: person.role == "custodian" ? "Custodian" : "Member", options: [("custodian", "Custodian"), ("member", "Member")], selected: person.role, menus: menus) { role in
                                    model.run {
                                        _ = try await model.client.command(.vaultPeopleSetRole(vaultId: vaultId, profileId: person.profileId, role: role == "custodian" ? .custodian : .member))
                                        model.toast("Role changed")
                                    }
                                }
                            } else {
                                Text(person.role == "custodian" ? "Custodian" : "Member").webText(detail.text).foregroundStyle(detail.color.color)
                            }
                        }
                        .contextMenu {
                            if person.role != "owner" && (p.canAdd || person.isYou) {
                                Button(person.isYou ? "Leave" : "Remove", systemImage: "person.badge.minus", role: .destructive) {
                                    model.run {
                                        _ = try await model.client.command(.vaultPeopleRemove(vaultId: vaultId, profileId: person.profileId))
                                        model.toast(person.isYou ? "You left the Vault" : "Removed. The Vault's key changes when a custodian next opens it.")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
#endif
