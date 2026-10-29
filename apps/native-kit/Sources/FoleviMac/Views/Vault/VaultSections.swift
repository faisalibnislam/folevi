// The open Vault's sections (components/vault/Files.tsx, Passwords.tsx, Health.tsx, Trash.tsx, Sections.tsx), drawn
// from the live web's styles inside the inverted Vault: Files & Notes (Grid or Lines), Passwords & Credentials (the
// list and the open item beside it), Health, Trash, Settings, Activity and People.
#if os(macOS)
import AppKit
import SwiftUI
import UniformTypeIdentifiers
import FoleviDesign
import FoleviEngine

struct VaultSectionView: View {
    @Bindable var model: VaultModel

    var body: some View {
        if let id = model.vaultId {
            switch model.section {
            case .files: VaultFiles(model: model, vaultId: id)
            case .passwords: VaultPasswords(model: model, vaultId: id)
            case .health: VaultHealth(model: model, vaultId: id)
            case .trash: VaultTrash(model: model, vaultId: id)
            case .settings: VaultSettingsView(model: model, vaultId: id)
            case .activity: VaultActivityView(model: model, vaultId: id)
            case .people: VaultPeopleView(model: model, vaultId: id)
            }
        }
    }
}

// MARK: shared pieces

/// A list in a card (`divide-y divide-line ui-card rounded-control`).
struct VaultList<Content: View>: View {
    var card = true
    @ViewBuilder let content: Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let list = VS.style("vault.list", scheme)
        let rows = _VariadicView.Tree(VaultDividedLayout(line: VS.color("line", scheme))) { content }
        if card {
            rows
                .clipShape(RoundedRectangle(cornerRadius: list.radius, style: .circular))
                .webBox(VS.pair("vault.list"))
        } else {
            rows
        }
    }
}

private struct VaultDividedLayout: _VariadicView_MultiViewRoot {
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

/// A row of a list: title, detail, and something on the right (a time, a button).
struct VaultRow<Trailing: View>: View {
    let title: String
    let detail: String
    /// A person's picture or initial first (People, as the web's 32 pt Avatar).
    var person: (name: String, url: String?)? = nil
    var selected = false
    var action: (() -> Void)?
    @ViewBuilder var trailing: Trailing
    @Environment(\.colorScheme) private var scheme
    @State private var over = false

    var body: some View {
        let row = VS.style("vault.row", scheme)
        let t = VS.style("vault.row.title", scheme)
        let d = VS.style("vault.row.detail", scheme)
        let content = HStack(spacing: row.gap) {
            if let person { WebPersonAvatar(name: person.name, url: person.url, size: 32) }
            VStack(alignment: .leading, spacing: 0) {
                Text(title).webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
                Text(detail.isEmpty ? " " : detail).webText(d.text).lineLimit(1).foregroundStyle(d.color.color)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(row.padding.edgeInsets)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? VS.color("glass-active", scheme) : over && action != nil ? VS.color("surface", scheme) : .clear)
        .contentShape(Rectangle())
        .onHover { over = $0 }
        if let action {
            Button(action: action) { content }.buttonStyle(.plain)
        } else {
            content
        }
    }
}

struct VaultTimeText: View {
    let ms: Double
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let s = VS.style("vault.row.time", scheme)
        Text(VaultTime.relative(ms)).webText(s.text).lineLimit(1).fixedSize().foregroundStyle(s.color.color)
    }
}

/// The section's top line: a sentence in muted text and actions at the end (Trash, Health).
struct VaultLead: View {
    let text: String
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let s = VS.style("vault.health.lead", scheme)
        Text(text).webText(s.text).foregroundStyle(s.color.color).fixedSize(horizontal: false, vertical: true)
    }
}

/// A Select (ui/Select.tsx) over an input well: the chosen label, a chevron, a Folevi menu of options.
struct VaultSelect: View {
    let style: String
    let label: String
    let options: [(String, String)]
    let selected: String
    let onSelect: (String) -> Void
    @Environment(\.colorScheme) private var scheme
    private var capturedLabel: String { style == "vault.settings.select" ? "5 minutes" : "All kinds" }

    var body: some View {
        let s = VS.style(style, scheme)
        WebMenuButton(width: max(s.width, 180), entries: { options.map { o in WebMenuEntry(.item(o.1, checked: o.0 == selected)) { onSelect(o.0) } } }) {
            let row = HStack(spacing: s.gap) {
                Text(label).webText(s.text).lineLimit(1)
                Spacer(minLength: 0)
                WebIconView(.chevronDown, size: 14).opacity(0.6)
            }
            .padding(s.padding.edgeInsets)
            .frame(height: s.height)
            Group {
                // The web's trigger is as wide as its label, chevron and padding: the captured width for that label.
                row.frame(minWidth: label == capturedLabel ? s.width : 0).fixedSize(horizontal: true, vertical: false)
            }
            .foregroundStyle(s.color.color)
            .webBox(VS.pair(style))
            .contentShape(Rectangle())
        }
    }
}

// MARK: Files & Notes

struct VaultFiles: View {
    @Bindable var model: VaultModel
    let vaultId: String
    @Environment(\.colorScheme) private var scheme
    @State private var busy = false

    var body: some View {
        let folders = model.store("folders") { .vaultFolders(vaultId: vaultId) }
        let items = model.store("files:\(model.folderId ?? "")") { .vaultItems(vaultId: vaultId, section: .files, folderId: model.folderId) }
        let all = folders.value?.folders ?? []
        let here = all.filter { $0.parentId == model.folderId }
        let name = { (id: String?) in id.flatMap { i in all.first { $0.id == i }?.name } }
        let bar = VS.style("vault.files.bar", scheme)
        let title = VS.style("vault.files.title", scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: bar.gap) {
                if let current = model.folderId {
                    let parent = all.first { $0.id == current }?.parentId
                    WebButton(parent.flatMap { name($0) } ?? "Files & Notes", icon: .chevronLeft, variant: .quiet) { model.folderId = parent }
                }
                Text(name(model.folderId) ?? "Files & Notes").webText(title.text).lineLimit(1).foregroundStyle(title.color.color)
                Spacer(minLength: 0)
                layoutSwitch
                WebButton("Folder", icon: .folderPlus) { model.dialog = .newFolder }
                WebButton("Note", icon: .filePlusCorner) { model.dialog = .newNote }
                WebButton(busy ? "Encrypting…" : "Upload", icon: .upload, variant: .primary) { upload() }
                    .disabled(busy)
            }
            .frame(height: bar.height)
            .padding(.bottom, bar.margin.bottom)
            if !here.isEmpty { folderList(here) }
            if let entries = items.value?.items {
                if entries.isEmpty {
                    if here.isEmpty { VaultEmpty(icon: .fileText, title: "Nothing here yet", message: "Upload files of any kind, or write a note. They're encrypted on this device before they leave it.") }
                } else if model.filesLayout == "grid" {
                    LazyVGrid(columns: grid, alignment: .leading, spacing: VS.style("vault.files.cards", scheme).gap) {
                        ForEach(entries, id: \.id) { e in card(e, all: entries) }
                    }
                } else {
                    VaultList {
                        ForEach(entries, id: \.id) { e in
                            VaultFileLine(entry: e) { open(e, all: entries) }
                        }
                    }
                }
            }
        }
        .onDrop(of: [.fileURL], isTargeted: nil) { providers in
            for p in providers {
                _ = p.loadObject(ofClass: URL.self) { url, _ in
                    if let url { Task { @MainActor in send(url) } }
                }
            }
            return true
        }
    }

    private var grid: [GridItem] {
        [GridItem(.adaptive(minimum: 180), spacing: VS.style("vault.files.cards", scheme).gap, alignment: .top)]
    }

    private var layoutSwitch: some View {
        let seg = VS.style("vault.files.seg", scheme)
        return HStack(spacing: seg.gap) {
            segButton("grid", .layoutGrid, "Grid")
            segButton("list", .rows3, "Lines")
        }
        .padding(seg.padding.edgeInsets)
        .webBox(VS.pair("vault.files.seg"))
    }

    private func segButton(_ value: String, _ icon: WebIcon, _ label: String) -> some View {
        let on = model.filesLayout == value
        let s = VS.style(on ? "vault.files.seg.on" : "vault.files.seg.off", scheme)
        return Button { model.filesLayout = value } label: {
            WebIconView(icon, size: 15)
                .foregroundStyle(s.color.color)
                .frame(width: s.width, height: s.height)
                .webBox(VS.pair(on ? "vault.files.seg.on" : "vault.files.seg.off"))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foleviTooltip(label)
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    @ViewBuilder private func folderList(_ here: [VaultFolderRow]) -> some View {
        let wrap = VS.style("vault.files.folders", scheme)
        Group {
            if model.filesLayout == "grid" {
                LazyVGrid(columns: grid, alignment: .leading, spacing: wrap.gap) {
                    ForEach(here, id: \.id) { f in folderCard(f) }
                }
            } else {
                VaultList {
                    ForEach(here, id: \.id) { f in
                        let s = VS.style("vault.files.folder.name", scheme)
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
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(.bottom, wrap.margin.bottom)
    }

    private func folderCard(_ f: VaultFolderRow) -> some View {
        let s = VS.style("vault.files.folder", scheme)
        let n = VS.style("vault.files.folder.name", scheme)
        return Button { openFolder(f) } label: {
            HStack(spacing: s.gap) {
                FolderGlyph(colorId: nil, size: 17)
                Text(f.name).webText(n.text).lineLimit(1).foregroundStyle(n.color.color)
                Spacer(minLength: 0)
            }
            .padding(s.padding.edgeInsets)
            .frame(maxWidth: .infinity, minHeight: s.height, alignment: .leading)
            .webBox(VS.pair("vault.files.folder"))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func card(_ e: VaultItemRow, all: [VaultItemRow]) -> some View {
        let s = VS.style("vault.files.card", scheme)
        let icon = VS.style("vault.files.card.icon", scheme)
        let t = VS.style("vault.files.card.title", scheme)
        let d = VS.style("vault.files.card.detail", scheme)
        return Button { open(e, all: all) } label: {
            VStack(alignment: .leading, spacing: s.gap) {
                WebIconView(e.kind == "file" ? .upload : .fileText, size: 17).foregroundStyle(icon.color.color)
                VStack(alignment: .leading, spacing: 0) {
                    Text(e.title).webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
                    Text([e.detail, VaultTime.relative(e.updatedAt)].filter { !$0.isEmpty }.joined(separator: " · ")).webText(d.text).lineLimit(1).foregroundStyle(d.color.color)
                }
            }
            .padding(s.padding.edgeInsets)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .webBox(VS.pair("vault.files.card"))
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

    private func upload() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        send(url)
    }

    /// A file sent to the engine, which seals it before it goes anywhere (50 MB at most, as any attachment).
    private func send(_ url: URL) {
        guard let data = try? Data(contentsOf: url) else { return model.toast("That file couldn't be read.", tone: .error) }
        guard data.count <= 50 * 1024 * 1024 else { return model.toast("Files up to 50 MB go in the Vault.", tone: .error) }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let name = url.lastPathComponent
        let folder = model.folderId
        busy = true
        Task { @MainActor in
            do {
                _ = try await model.frame.client.command(.vaultFileUpload(vaultId: vaultId, folderId: folder, name: name, mime: mime, data: data.base64EncodedString()))
                model.toast("\(name) added to the Vault", tone: .success)
            } catch { model.toast(VaultModel.message(error), tone: .error) }
            busy = false
        }
    }
}

private struct VaultFileLine: View {
    let entry: VaultItemRow
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = VS.style("vault.row.title", scheme)
        let d = VS.style("vault.row.detail", scheme)
        Button(action: action) {
            HStack(spacing: 12) {
                WebIconView(entry.kind == "file" ? .upload : .fileText, size: 15).foregroundStyle(d.color.color)
                VStack(alignment: .leading, spacing: 0) {
                    Text(entry.title).webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
                    Text(entry.detail.isEmpty ? " " : entry.detail).webText(d.text).lineLimit(1).foregroundStyle(d.color.color)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VaultTimeText(ms: entry.updatedAt)
            }
            .padding(VS.style("vault.row", scheme).padding.edgeInsets)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: Passwords & Credentials

struct VaultPasswords: View {
    @Bindable var model: VaultModel
    let vaultId: String
    @State private var query = ""
    @State private var kind = "all"
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let items = model.store("passwords") { .vaultItems(vaultId: vaultId, section: .passwords) }
        let kinds = items.value?.kinds ?? []
        let bar = VS.style("vault.pw.bar", scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: bar.gap) {
                search
                VaultSelect(style: "vault.pw.kind", label: kind == "all" ? "All kinds" : kinds.first { $0.kind == kind }?.label ?? "All kinds", options: [("all", "All kinds")] + kinds.map { ($0.kind, $0.label) }, selected: kind) { kind = $0 }
                WebButton("Add", icon: .plus, variant: .primary) { model.dialog = .addItem }
            }
            .frame(height: bar.height)
            .padding(.bottom, bar.margin.bottom)
            if let all = items.value?.items {
                let shown = filtered(all)
                VaultColumns(gap: 24, twoFrom: VaultColumns.lgWidth(bar)) {
                    Group {
                        if shown.isEmpty {
                            VaultEmpty(icon: .search, title: all.isEmpty ? "No passwords yet" : "Nothing matches", message: all.isEmpty ? "Add logins, API keys, cards and other credentials. Only people in the Vault can open them." : nil)
                        } else {
                            VaultList {
                                ForEach(shown, id: \.id) { o in
                                    VaultRow(title: o.title, detail: o.detail, selected: model.selected == o.id, action: { model.selected = o.id }) { VaultTimeText(ms: o.updatedAt) }
                                        .webContextMenu {
                                            [
                                                WebMenuEntry(.item("Open", icon: .keyRound)) { model.selected = o.id },
                                                WebMenuEntry(.item("Duplicate", icon: .copyPlus)) { duplicate(o.id) },
                                            ]
                                        }
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    if let id = model.selected, all.contains(where: { $0.id == id }) {
                        VaultItemPanel(model: model, vaultId: vaultId, itemId: id, revision: all.first { $0.id == id }?.revision ?? 0)
                            .id(id)
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                }
            }
        }
    }

    private var search: some View {
        let s = VS.style("vault.pw.search", scheme)
        let icon = VS.style("vault.pw.search.icon", scheme)
        return ZStack(alignment: .leading) {
            TextField("", text: $query, prompt: Text("Search").foregroundStyle(icon.color.color))
                .textFieldStyle(.plain)
                .webText(s.text)
                .padding(s.padding.edgeInsets)
                .frame(height: s.height)
                .foregroundStyle(s.color.color)
                .webBox(VS.pair("vault.pw.search"))
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
            let r = try await model.frame.client.command(.vaultItemDuplicate(vaultId: vaultId, itemId: id))
            model.toast("Duplicated", tone: .success)
            model.selected = r.id
            let item = try await model.frame.client.command(.vaultItemOpen(vaultId: vaultId, itemId: r.id))
            model.dialog = .editItem(item)
        }
    }
}

/// The list and the open item as Passwords.tsx lays them out: `grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]`,
/// two columns (the item 1.2 times the list) from the web's lg width, one above the other below it; the list alone
/// takes the whole width. (An HStack with layout priorities gave the item all the room and left the list a sliver.)
struct VaultColumns: Layout {
    let gap: CGFloat
    /// The section's width at the web's `lg` (a 1024 pt window).
    let twoFrom: CGFloat

    /// The section's width in a 1024 pt window, from where the live web's 1280 pt window put it.
    static func lgWidth(_ bar: WebComputedStyle) -> CGFloat { 1024 - bar.x - (1280 - bar.x - bar.width) }

    private func columns(_ width: CGFloat, _ count: Int) -> (list: CGFloat, item: CGFloat)? {
        guard count == 2, width >= twoFrom else { return nil }
        let list = (width - gap) / 2.2
        return (list, width - gap - list)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 800
        if let c = columns(width, subviews.count) {
            let h = max(subviews[0].sizeThatFits(.init(width: c.list, height: nil)).height, subviews[1].sizeThatFits(.init(width: c.item, height: nil)).height)
            return CGSize(width: width, height: h)
        }
        let heights = subviews.map { $0.sizeThatFits(.init(width: width, height: nil)).height }
        return CGSize(width: width, height: heights.reduce(0, +) + gap * CGFloat(max(0, subviews.count - 1)))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        if let c = columns(bounds.width, subviews.count) {
            subviews[0].place(at: bounds.origin, proposal: .init(width: c.list, height: nil))
            subviews[1].place(at: CGPoint(x: bounds.minX + c.list + gap, y: bounds.minY), proposal: .init(width: c.item, height: nil))
            return
        }
        var y = bounds.minY
        for s in subviews {
            let h = s.sizeThatFits(.init(width: bounds.width, height: nil)).height
            s.place(at: CGPoint(x: bounds.minX, y: y), proposal: .init(width: bounds.width, height: h))
            y += h + gap
        }
    }
}

/// An open item beside the list (Passwords.tsx ItemPanel): fields, hidden ones shown on reveal, copy, a live 2FA
/// code, history, Edit, Share and Trash. Opening it is logged by the engine; revealing and copying are reported.
struct VaultItemPanel: View {
    @Bindable var model: VaultModel
    let vaultId: String
    let itemId: String
    let revision: Int
    @State private var item: VaultItemValue?
    @State private var revealed: Set<String> = []
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let t = VS.style("vault.gate.title", scheme)
        let d = VS.style("vault.row.detail", scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(item?.title ?? " ").webText(t.text).lineLimit(1).foregroundStyle(t.color.color)
                    Text(item.map { "\($0.kindLabel) · added by \($0.createdBy), changed by \($0.updatedBy)" } ?? " ").webText(d.text).foregroundStyle(d.color.color)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                WebIconButton(.rotateCcwClock, label: "Earlier versions") {
                    if let item { model.dialog = .history(itemId: item.id, canChange: item.canChange) }
                }
                if item?.canChange == true, let item {
                    WebButton("Edit", size: .sm) { model.dialog = .editItem(item) }
                    WebButton("Share", icon: .share2, size: .sm) { model.dialog = .share(itemId: item.id, title: item.title, note: false) }
                    WebIconButton(.trash, label: "Move to the Vault's Trash") {
                        model.run {
                            _ = try await model.frame.client.command(.vaultItemRemove(vaultId: vaultId, itemId: item.id))
                            model.toast("Moved to the Vault's Trash")
                            model.selected = nil
                        }
                    }
                }
            }
            .padding(.bottom, 12)
            if let item {
                VaultList(card: false) {
                    ForEach(item.fields.filter { !$0.value.isEmpty }, id: \.key) { f in field(f, item: item) }
                    if !item.notes.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Notes").webText(d.text).foregroundStyle(d.color.color)
                            Text(item.notes).webText(VS.style("vault.row.title", scheme).text).fontWeight(.regular).textSelection(.enabled)
                        }
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            } else {
                RoundedRectangle(cornerRadius: 6).fill(VS.color("surface", scheme)).frame(height: 80)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .webBox(VS.pair("vault.gate.card"))
        .frame(maxWidth: .infinity, alignment: .top)
        .task(id: revision) { await load() }
    }

    private func load() async {
        do { item = try await model.frame.client.command(.vaultItemOpen(vaultId: vaultId, itemId: itemId)) } catch { model.toast(VaultModel.message(error), tone: .error) }
    }

    @ViewBuilder private func field(_ f: VaultFieldValue, item: VaultItemValue) -> some View {
        let label = VS.style("vault.row.detail", scheme)
        let value = VS.style("vault.row.title", scheme)
        HStack(alignment: .center, spacing: 12) {
            Text(f.label).webText(label.text).foregroundStyle(label.color.color).frame(width: 128, alignment: .leading)
            if f.type == "totp" {
                VaultTotp(model: model, secret: f.value, itemId: item.id)
            } else {
                let hidden = f.type == "secret" && !revealed.contains(f.key)
                Group {
                    if f.type == "secret" || f.type == "multiline" {
                        Text(hidden ? "••••••••••••" : f.value).font(.system(size: value.fontSize, design: .monospaced))
                    } else {
                        Text(f.value).webText(WebTextStyle(size: value.fontSize, leading: value.lineHeight ?? 18, weight: 400))
                    }
                }
                .foregroundStyle(value.color.color)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                if f.type == "secret" {
                    WebIconButton(hidden ? .eye : .eyeOff, label: hidden ? "Show \(f.label)" : "Hide \(f.label)") {
                        if hidden {
                            revealed.insert(f.key)
                            model.record("item.reveal", itemId: item.id, field: f.key)
                        } else { revealed.remove(f.key) }
                    }
                }
                WebIconButton(.copy, label: "Copy \(f.label)") { model.copy(f.label, f.value, itemId: item.id) }
            }
        }
        .padding(.vertical, 10)
    }
}

/// A 2FA code worked out by the engine each second (lib/vault/totp.ts), shown as "123 456" with its seconds.
struct VaultTotp: View {
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
                Text("Not a 2FA secret Folevi can read.").webText(VS.style("vault.row.detail", scheme).text).foregroundStyle(VS.color("warning", scheme))
            } else {
                Text(code.map { "\($0.prefix(3)) \($0.dropFirst(3))" } ?? "··· ···")
                    .font(.system(size: 17, design: .monospaced))
                    .tracking(2)
                    .foregroundStyle(VS.style("vault.gate.title", scheme).color.color)
                Text(code == nil ? "" : "\(seconds)s").webText(VS.style("vault.row.detail", scheme).text).foregroundStyle(VS.style("vault.row.detail", scheme).color.color)
                WebIconButton(.copy, label: "Copy the code") { if let code { model.copy("2FA code", code, itemId: itemId, event: "totp.copy") } }
            }
            Spacer(minLength: 0)
        }
        .task {
            model.record("totp.show", itemId: itemId)
            while !Task.isCancelled {
                if let r = try? await model.frame.client.command(.vaultTotp(secret: secret)) {
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

struct VaultHealth: View {
    @Bindable var model: VaultModel
    let vaultId: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let health = model.store("health") { .vaultHealth(vaultId: vaultId) }
        if let h = health.value {
            let lead = VS.style("vault.health.lead", scheme)
            VStack(alignment: .leading, spacing: lead.margin.bottom) {
                VaultLead(text: "\(h.needsLook > 0 ? "\(h.needsLook) \(h.needsLook == 1 ? "item needs" : "items need") a look." : "Nothing needs a look.") Checked on this device: only the first 5 characters of a password's SHA-1 ever leave it.")
                    .frame(maxWidth: .infinity, alignment: h.groups.isEmpty ? .center : .leading)
                if h.groups.isEmpty {
                    VaultEmpty(icon: .heartPulse, title: "All healthy", message: "No weak, reused or breached passwords, and nothing about to expire.")
                }
                ForEach(h.groups, id: \.issue) { g in
                    let heading = VS.style(g.tone == "muted" ? "vault.health.heading.muted" : "vault.health.heading.warning", scheme)
                    let count = VS.style("vault.health.count", scheme)
                    let body = VS.style("vault.health.body", scheme)
                    VStack(alignment: .leading, spacing: 0) {
                        (Text(g.title + " ").foregroundStyle(g.tone == "danger" ? VS.color("danger", scheme) : heading.color.color)
                            + Text("(\(g.items.count))").font(.custom("Instrument Sans", size: count.fontSize).weight(.regular)).foregroundStyle(count.color.color))
                            .webText(heading.text)
                        Text(g.body).webText(body.text).foregroundStyle(body.color.color).padding(.bottom, body.margin.bottom)
                        VaultList {
                            ForEach(g.items, id: \.id) { o in
                                VaultRow(title: o.title, detail: o.detail, action: {
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

struct VaultTrash: View {
    @Bindable var model: VaultModel
    let vaultId: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let trash = model.store("trash") { .vaultItems(vaultId: vaultId, section: .trash) }
        let bar = VS.style("vault.trash.bar", scheme)
        VStack(alignment: .leading, spacing: bar.margin.bottom) {
            HStack(spacing: bar.gap) {
                VaultLead(text: "Deleted items stay here for 30 days, then go for good.")
                Spacer(minLength: 0)
                if model.value?.role != "member", !(trash.value?.items.isEmpty ?? true) {
                    WebButton("Empty Trash", icon: .trash) { model.dialog = .emptyTrash }
                        .foregroundStyle(VS.color("danger", scheme))
                }
            }
            .frame(minHeight: bar.height)
            if let items = trash.value?.items {
                if items.isEmpty {
                    VaultEmpty(icon: .trash, title: "The Trash is empty")
                } else {
                    VaultList {
                        ForEach(items, id: \.id) { row in
                            let left = max(0, Int(ceil(((row.deletedAt ?? 0) + 30 * 86_400_000 - Date().timeIntervalSince1970 * 1000) / 86_400_000)))
                            VaultRow(title: row.title, detail: [row.kindLabel, "deleted \(VaultTime.relative(row.deletedAt ?? row.updatedAt))", "\(left) \(left == 1 ? "day" : "days") left"].joined(separator: " · ")) {
                                WebButton("Restore", icon: .rotateCcw, size: .sm) {
                                    model.run {
                                        _ = try await model.frame.client.command(.vaultItemRestore(vaultId: vaultId, itemId: row.id))
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

// MARK: Settings

struct VaultSettingsView: View {
    @Bindable var model: VaultModel
    let vaultId: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let label = VS.style("vault.settings.label", scheme)
        let hint = VS.style("vault.settings.hint", scheme)
        let v = model.value
        VStack(alignment: .leading, spacing: 20) {
            if v?.role != "member" {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Lock after").webText(label.text).foregroundStyle(label.color.color)
                        Text("Idle minutes before the Vault locks itself on a device.").webText(hint.text).foregroundStyle(hint.color.color)
                    }
                    Spacer(minLength: 0)
                    let m = v?.autoLockMinutes ?? 5
                    VaultSelect(style: "vault.settings.select", label: "\(m) \(m == 1 ? "minute" : "minutes")", options: [1, 2, 5, 10, 15, 30].map { ("\($0)", "\($0) \($0 == 1 ? "minute" : "minutes")") }, selected: "\(m)") { value in
                        model.run {
                            _ = try await model.frame.client.command(.vaultSettingsUpdate(vaultId: vaultId, autoLockMinutes: Int(value)))
                            model.toast("Saved")
                        }
                    }
                }
            }
            if v?.role == "owner", v?.personal == false {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Custodians can name custodians").webText(label.text).foregroundStyle(label.color.color)
                        Text("Otherwise only you do. Custodians always add and remove members.").webText(hint.text).foregroundStyle(hint.color.color)
                    }
                    Spacer(minLength: 0)
                    Toggle("", isOn: Binding(get: { v?.custodiansNameCustodians ?? false }, set: { on in
                        model.run {
                            _ = try await model.frame.client.command(.vaultSettingsUpdate(vaultId: vaultId, custodiansNameCustodians: on))
                            model.toast("Saved")
                        }
                    }))
                    .toggleStyle(.switch)
                    .labelsHidden()
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Import and export").webText(label.text).foregroundStyle(label.color.color)
                Text("Import a CSV from 1Password, Bitwarden, LastPass, Chrome, Safari or Firefox, or a Folevi Vault backup. Items are encrypted on this device before they're sent.").webText(hint.text).foregroundStyle(hint.color.color)
                HStack(spacing: 8) {
                    WebButton("Import…", icon: .upload) { importExportLater() }
                    if v?.role != "member" {
                        WebButton("Encrypted backup…", icon: .download) { importExportLater() }
                        WebButton("Readable CSV…", icon: .download) { importExportLater() }
                    }
                }
            }
            HStack(spacing: 8) {
                WebButton("Change passcode") { model.dialog = .changePasscode }
                WebButton("Make a new recovery key") {
                    model.run { _ = try await model.frame.client.command(.vaultNewRecoveryKey(vaultId: vaultId)) }
                }
                WebButton("Lock now") { model.lock() }
            }
        }
    }

    private func importExportLater() {
        model.toast("Import and export are on the web for now: open the Vault at folevi.com.")
    }
}

// MARK: Activity (an account's Vault)

struct VaultActivityView: View {
    @Bindable var model: VaultModel
    let vaultId: String
    @State private var event = ""
    @State private var failedOnly = false
    @Environment(\.colorScheme) private var scheme

    private static let filters: [(String, String)] = [("", "Everything"), ("vault.", "Unlocking and locking"), ("item.", "Items"), ("file.", "Files"), ("note.", "Notes"), ("person.", "People"), ("link.", "Links"), ("share.", "Sharing")]

    var body: some View {
        let log = model.store("activity:\(event):\(failedOnly)") { .vaultActivity(vaultId: vaultId, event: event.isEmpty ? nil : event, failedOnly: failedOnly ? true : nil) }
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                VaultSelect(style: "vault.pw.kind", label: Self.filters.first { $0.0 == event }?.1 ?? "Everything", options: Self.filters, selected: event) { event = $0 }
                Toggle("Failures only", isOn: $failedOnly).toggleStyle(.switch).controlSize(.small)
                Spacer(minLength: 0)
            }
            if log.value?.everything == false {
                Text("You see your own activity. The owner and custodians see everyone's.").webText(VS.style("vault.health.body", scheme).text).foregroundStyle(VS.style("vault.health.body", scheme).color.color)
            }
            if let entries = log.value?.entries, !entries.isEmpty {
                VaultList {
                    ForEach(entries, id: \.seq) { e in
                        VStack(alignment: .leading, spacing: 0) {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(e.actorName).webText(VS.style("vault.row.title", scheme).text)
                                Text(e.label + (e.failed ? " (failed\(e.reason.map { ": \($0)" } ?? ""))" : "")).webText(VS.style("vault.health.lead", scheme).text).foregroundStyle(e.failed ? VS.color("danger", scheme) : VS.style("vault.row.title", scheme).color.color)
                                Spacer(minLength: 0)
                                Text(VaultTime.dateTime(e.at)).webText(VS.style("vault.row.time", scheme).text).foregroundStyle(VS.style("vault.row.time", scheme).color.color)
                            }
                            Text(e.detail).webText(VS.style("vault.row.detail", scheme).text).foregroundStyle(VS.style("vault.row.detail", scheme).color.color)
                        }
                        .padding(VS.style("vault.row", scheme).padding.edgeInsets)
                    }
                }
            }
        }
    }
}

// MARK: People (a team Vault)

struct VaultPeopleView: View {
    @Bindable var model: VaultModel
    let vaultId: String
    @State private var pick: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let people = model.store("people") { .vaultPeople(vaultId: vaultId) }
        if let p = people.value {
            VStack(alignment: .leading, spacing: 16) {
                if p.onlyOneCustodian {
                    HStack(alignment: .top, spacing: 8) {
                        WebIconView(.shieldAlert, size: 16)
                        Text("Only one person can manage this Vault. If they lose their recovery key, nobody can open it. Make someone else a custodian too.").webText(VS.style("vault.health.lead", scheme).text)
                    }
                    .foregroundStyle(VS.color("warning", scheme))
                    .padding(12)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(VS.color("warning", scheme).opacity(0.4)))
                }
                if p.canAdd {
                    HStack(spacing: 8) {
                        VaultSelect(style: "vault.pw.kind", label: p.candidates.first { $0.profileId == pick }?.name ?? "Choose a workspace member", options: p.candidates.map { ($0.profileId, $0.name) }, selected: pick ?? "") { pick = $0 }
                        WebButton("Add", icon: .userPlus, variant: .primary) {
                            guard let id = pick else { return }
                            pick = nil
                            model.run {
                                _ = try await model.frame.client.command(.vaultPeopleAdd(vaultId: vaultId, profileId: id))
                                model.toast("Added. Their key arrives when you next open the Vault.")
                            }
                        }
                        .disabled(pick == nil)
                        WebButton("Everyone here should have access") {
                            model.run {
                                _ = try await model.frame.client.command(.vaultPeopleReviewed(vaultId: vaultId))
                                model.toast("Access reviewed")
                            }
                        }
                    }
                }
                VaultList {
                    ForEach(p.people, id: \.profileId) { person in
                        VaultRow(title: person.name + (person.isYou ? " (you)" : ""), detail: [person.email, person.status].compactMap { $0 }.joined(separator: " · "), person: (person.name, person.avatarUrl)) {
                            if person.role == "owner" {
                                Text("Owner").webText(VS.style("vault.row.detail", scheme).text).foregroundStyle(VS.style("vault.row.detail", scheme).color.color)
                            } else if p.canNameCustodians {
                                VaultSelect(style: "vault.pw.kind", label: person.role == "custodian" ? "Custodian" : "Member", options: [("custodian", "Custodian"), ("member", "Member")], selected: person.role) { role in
                                    model.run {
                                        _ = try await model.frame.client.command(.vaultPeopleSetRole(vaultId: vaultId, profileId: person.profileId, role: role == "custodian" ? .custodian : .member))
                                        model.toast("Role changed")
                                    }
                                }
                            } else {
                                Text(person.role == "custodian" ? "Custodian" : "Member").webText(VS.style("vault.row.detail", scheme).text).foregroundStyle(VS.style("vault.row.detail", scheme).color.color)
                            }
                            if person.role != "owner" && (p.canAdd || person.isYou) {
                                WebButton(person.isYou ? "Leave" : "Remove", variant: .quiet, size: .sm) {
                                    model.run {
                                        _ = try await model.frame.client.command(.vaultPeopleRemove(vaultId: vaultId, profileId: person.profileId))
                                        model.toast(person.isYou ? "You left the Vault" : "Removed. The Vault's key changes when a custodian next opens it.")
                                    }
                                }
                                .foregroundStyle(VS.color("danger", scheme))
                            }
                        }
                    }
                }
            }
        }
    }
}
#endif
