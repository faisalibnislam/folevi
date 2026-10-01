import SwiftUI

/// The page tools' panel, floating above the dock (the web's Inspector opened from the dock): the tool's
/// name and ×, then Insert, Format, Style, Info or Comments. Escape closes it.
struct InspectorView: View {
    @Bindable var model: EditorModel
    @Bindable var nav: NavigationModel
    var openDocument: (String, Bool) -> Void
    @State private var lastTab: InspectorTab = .format

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, 12)
                .padding(.top, 10)
            ScrollView {
                Group {
                    switch nav.inspectorTab {
                    case .insert: InsertInspector(model: model)
                    case .format: FormatInspector(model: model)
                    case .style: StyleInspector(model: model)
                    case .info: InfoInspector(model: model, nav: nav)
                    case .comments: CommentsPanel(model: model)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.automatic)
        }
        .onChange(of: nav.inspectorTab, initial: true) { _, tab in if tab != .comments { lastTab = tab } }
        .onExitCommand { close() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(nav.inspectorTab.title))
    }

    @ViewBuilder private var header: some View {
        if nav.inspectorTab == .comments {
            HStack(spacing: 4) {
                BackToTab(title: lastTab.title) { nav.inspectorTab = lastTab }
                Text("Comments")
                    .font(.ui(13.5, .semibold))
                    .foregroundStyle(FoleviColor.heading)
                    .frame(maxWidth: .infinity)
                    .accessibilityAddTraits(.isHeader)
                closeButton
            }
            .frame(height: 36)
        } else {
            HStack(spacing: 4) {
                Text(nav.inspectorTab.title)
                    .font(FoleviType.display(18))
                    .tracking(FoleviType.displayTracking(18))
                    .foregroundStyle(FoleviColor.heading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                closeButton
            }
            .padding(.horizontal, 4)
            .frame(height: 36)
        }
    }

    private var closeButton: some View {
        PageIconButton(systemImage: "xmark", label: String(localized: "Close inspector"), shortcut: "Esc", size: 28, iconSize: 13) { close() }
    }

    private func close() {
        nav.showInspector = false
    }
}

/// "‹ Format": back from Comments to the tool that was open.
private struct BackToTab: View {
    var title: LocalizedStringKey
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: "chevron.left").font(.system(size: 11, weight: .semibold))
                Text(title).font(.ui(13))
            }
            .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.inkMuted)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(hovering ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

/// The floating panel's frame: 400pt wide (less in a narrow window), up to 640pt tall, glass.
struct FloatingInspector<Content: View>: View {
    var availableHeight: CGFloat
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(width: 400)
            .frame(maxHeight: max(200, min(640, availableHeight - 112)))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .foleviGlassPop(radius: 14)
    }
}

// MARK: - Insert tiles (the slash menu's icon tints)

/// Badge colours per block family (the slash menu's icon tints).
enum InsertTile {
    static func tone(for id: String) -> (fill: Color, ink: Color) {
        switch id {
        case "paragraph": return (FoleviColor.surfaceSunken, FoleviColor.heading)
        case "heading1", "heading2", "heading3": return (FoleviColor.emberSoft, FoleviColor.emberInk)
        case "todo", "bulleted", "numbered", "toggle": return (FoleviColor.mossSoft, FoleviColor.mossInk)
        case "quote", "callout": return (FoleviColor.plumSoft, FoleviColor.plumInk)
        case "code", "table", "flowchart": return (FoleviColor.marigoldSoft, FoleviColor.marigoldInk)
        case "image", "file", "record", "bookmark", "date": return (FoleviColor.accentSoft, FoleviColor.accentSoftInk)
        default: return (FoleviColor.coralSoft, FoleviColor.coralInk)
        }
    }

    /// Icon tint (slash menu).
    static func tint(for id: String) -> Color { tone(for: id).ink }
}

// MARK: - Info

/// Info: the page's details (Page info) or its actions (Actions), as the web's InfoPanel.
struct InfoInspector: View {
    @Bindable var model: EditorModel
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @State private var view = "page"

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PageSegmented(selection: $view, items: [
                .init(value: "page", title: String(localized: "Page info")),
                .init(value: "actions", title: String(localized: "Actions")),
            ], label: String(localized: "Info view"))
            if view == "page" {
                PageInfoView(model: model, nav: nav)
            } else {
                ActionList(entries: PageActions.entries(editor: model, nav: nav, app: app))
            }
        }
    }
}

/// Info → Actions: the page's "…" menu as a list of buttons.
private struct ActionList: View {
    var entries: [PageMenuEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(entries) { entry in
                switch entry {
                case .separator:
                    FoleviColor.line.opacity(0.7).frame(height: 1).padding(.vertical, 6)
                case .item(let item):
                    ActionRow(item: item)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Page actions"))
    }
}

private struct ActionRow: View {
    var item: PageMenuItem
    @State private var hovering = false

    var body: some View {
        Button { item.run() } label: {
            HStack(spacing: 10) {
                Image(systemName: item.systemImage)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(item.danger ? FoleviColor.coralInk : FoleviColor.inkMuted)
                    .frame(width: 16)
                Text(item.label)
                    .font(.ui(13, .medium))
                    .foregroundStyle(item.danger ? FoleviColor.coralInk : hovering ? FoleviColor.heading : FoleviColor.ink)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(background, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.disabled)
        .opacity(item.disabled ? 0.4 : 1)
        .onHover { hovering = $0 && !item.disabled }
    }

    private var background: Color {
        if item.danger { return hovering ? FoleviColor.coralSoft : FoleviColor.coralSoft.opacity(0.6) }
        return hovering ? FoleviColor.accentSoft : FoleviColor.surfaceSunken.opacity(0.7)
    }
}

/// Info → Page info: properties, stats, where it lives (folder and parent page), tags and activity.
private struct PageInfoView: View {
    @Bindable var model: EditorModel
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @State private var info: DocumentInfo?
    @State private var scopeSidebar: SidebarData?
    @State private var newTag = ""
    @FocusState private var tagFocused: Bool

    private var disabled: Bool { model.isReadOnly }
    private var detail: DocumentDetail? { model.detail }
    private var isMember: Bool { detail?.isMember ?? true }
    private var home: Scope { (detail?.document ?? model.document)?.homeScope ?? app.scope }
    /// Folders and tags of the page's own Personal or workspace.
    private var org: SidebarData? { isMember ? (home == app.scope ? app.sidebar : scopeSidebar) : nil }

    var body: some View {
        if let detail {
            VStack(alignment: .leading, spacing: 20) {
                properties
                stats
                location(detail)
                parent(detail)
                tags(detail)
                activity
            }
            .font(.ui(14))
            .task(id: TaskKey(id: model.documentId, revision: app.documentsRevision)) { await load() }
        } else {
            Text("Details appear once the document has synced.").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
        }
    }

    private struct TaskKey: Equatable {
        var id: String
        var revision: Int
    }

    private func caps(_ text: LocalizedStringKey) -> some View {
        Text(text).pageCaps().padding(.horizontal, 4).accessibilityAddTraits(.isHeader)
    }

    // MARK: Properties

    private var properties: some View {
        VStack(alignment: .leading, spacing: 8) {
            caps("Properties")
            VStack(alignment: .leading, spacing: 6) {
                property("calendar", "Created:", info.map { PageFormat.relative($0.createdAt) } ?? "-",
                         help: info.map { PageFormat.dateTime($0.createdAt) })
                property("pencil", "Updated:", info.map { String(localized: "\(PageFormat.relative($0.updatedAt)) by \($0.lastEditedBy)") } ?? "-")
                property("person", "Author:", info?.createdBy ?? "-")
            }
            .padding(.horizontal, 4)
        }
    }

    private func property(_ icon: String, _ label: LocalizedStringKey, _ value: String, help: String? = nil) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 12, weight: .medium)).foregroundStyle(FoleviColor.inkFaint).frame(width: 14)
                .accessibilityHidden(true)
            Text(label).foregroundStyle(FoleviColor.inkMuted)
            Text(value).foregroundStyle(FoleviColor.ink).lineLimit(1).truncationMode(.tail)
                .help(help.map { Text($0) } ?? Text(value))
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Stats

    private var stats: some View {
        VStack(alignment: .leading, spacing: 8) {
            caps("Stats · full document")
            HStack(spacing: 8) {
                stat("Words", info.map { Int($0.wordCount).formatted() }, help: String(localized: "Words in the page body (the title isn’t counted)"))
                stat("Characters", info.map { Int($0.charCount).formatted() })
                stat("Blocks", info.map { Int($0.blockCount).formatted() })
            }
        }
    }

    private func stat(_ label: LocalizedStringKey, _ value: String?, help: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.ui(11)).foregroundStyle(FoleviColor.inkMuted)
            Text(value ?? "-").font(.ui(15, .semibold)).monospacedDigit().foregroundStyle(FoleviColor.heading).lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FoleviColor.surfaceSunken.opacity(0.7), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .help(help.map { Text($0) } ?? Text(""))
        .accessibilityElement(children: .combine)
    }

    // MARK: Location

    private func location(_ detail: DocumentDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            caps("Location")
            let folders = org?.folders ?? []
            FoleviSelect(selection: Binding(get: { detail.folder?.id ?? "" }, set: { moveToFolder($0.isEmpty ? nil : $0) }),
                         options: [.init(value: "", title: String(localized: "Drafts"))]
                            + folders.map { .init(value: $0.id, title: ($0.parentFolderId != nil ? "- " : "") + $0.name) },
                         accessibilityLabel: String(localized: "Folder"))
                .frame(maxWidth: .infinity, alignment: .leading)
                .disabled(disabled)
        }
    }

    private func moveToFolder(_ folderId: String?) {
        guard let session = app.session, folderId != detail?.folder?.id else { return }
        let id = model.documentId
        Task {
            do {
                try await session.documents.move(id, folderId: folderId)
                await session.engine.syncNow()
                model.detail = try? await session.documents.get(id)
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    // MARK: Parent page

    private func parent(_ detail: DocumentDetail) -> some View {
        HStack(spacing: 8) {
            Group {
                if let p = detail.breadcrumbs.last {
                    Label {
                        Text(p.title.isEmpty ? String(localized: "Untitled") : p.title)
                    } icon: {
                        Image(systemName: "doc.text").font(.system(size: 11.5)).foregroundStyle(FoleviColor.inkMuted)
                    }
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(FoleviColor.ink)
                } else {
                    Text("None (top level)").foregroundStyle(FoleviColor.inkMuted)
                }
            }
            .lineLimit(1)
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            if !disabled {
                Button("Move…") { model.page.movePageOpen = true }.buttonStyle(.page(.secondary, .sm))
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Parent page"))
    }

    // MARK: Tags

    private func tags(_ detail: DocumentDetail) -> some View {
        let current = detail.document.tags ?? []
        let suggestions = (org?.tags ?? []).filter { t in
            !newTag.isEmpty && t.name.localizedCaseInsensitiveContains(newTag.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: ""))
                && !current.contains { $0.id == t.id }
        }
        return VStack(alignment: .leading, spacing: 8) {
            caps("Tags")
            if !current.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(current, id: \.id) { t in
                        HStack(spacing: 5) {
                            Text("#\(t.name)")
                            if !disabled {
                                Button {
                                    setTags(current.filter { $0.id != t.id }.map(\.id))
                                } label: {
                                    Image(systemName: "xmark").font(.system(size: 8.5, weight: .bold)).foregroundStyle(FoleviColor.inkFaint)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(Text("Remove tag \(t.name)"))
                            }
                        }
                        .font(.ui(12.5, .semibold))
                        .foregroundStyle(FoleviColor.accentSoftInk)
                        .padding(.horizontal, 10)
                        .frame(height: 25.6)
                        .background(FoleviColor.accentSoft, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                }
            }
            if !disabled {
                HStack(spacing: 6) {
                    TextField("Add a tag", text: $newTag)
                        .textFieldStyle(.plain)
                        .font(.ui(14))
                        .focused($tagFocused)
                        .onSubmit { addTag(current) }
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .pageInput(focused: tagFocused)
                        .accessibilityLabel(Text("Add a tag"))
                    Button("Add") { addTag(current) }.buttonStyle(.page(.secondary, .sm))
                }
                if tagFocused, !suggestions.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(suggestions.prefix(6)) { t in
                            Button {
                                newTag = t.name
                                addTag(current)
                            } label: {
                                Text(t.name).font(.ui(13)).foregroundStyle(FoleviColor.ink)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 10).frame(height: 28).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(4)
                    .foleviPop(radius: 8)
                }
            }
        }
    }

    private func setTags(_ ids: [String]) {
        guard let session = app.session else { return }
        let id = model.documentId
        Task {
            do {
                try await session.documents.setTags(id, tagIds: ids)
                model.detail = try? await session.documents.get(id)
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    private func addTag(_ current: [DocumentSummary.TagRef]) {
        let name = newTag.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "^#", with: "", options: .regularExpression)
        guard !name.isEmpty, let session = app.session else { return }
        let id = model.documentId
        let scope = home
        let existing = org?.tags.first { $0.name.lowercased() == name.lowercased() }
        Task {
            do {
                let tagId: String
                if let existing { tagId = existing.id } else { tagId = try await session.documents.createTag(scope: scope, name: name) }
                var ids = current.map(\.id)
                if !ids.contains(tagId) { ids.append(tagId) }
                try await session.documents.setTags(id, tagIds: ids)
                newTag = ""
                model.detail = try? await session.documents.get(id)
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    // MARK: Activity

    private var activity: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Activity").pageCaps()
                Spacer()
                VersionHistoryLink { nav.showHistory = true }
            }
            .padding(.horizontal, 4)
            VStack(alignment: .leading, spacing: 6) {
                if info?.activity.isEmpty == true {
                    Text("Versions are saved after a pause in editing.").foregroundStyle(FoleviColor.inkMuted)
                }
                ForEach(Array((info?.activity ?? []).enumerated()), id: \.offset) { _, a in
                    (Text(a.by).foregroundStyle(FoleviColor.ink)
                        + Text(" · \(Self.reason(a.reason)) · \(PageFormat.relative(a.at))").foregroundStyle(FoleviColor.inkMuted))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    static func reason(_ r: String) -> String {
        switch r {
        case "before_restore": return String(localized: "restored an earlier version")
        case "close": return String(localized: "saved on close")
        default: return String(localized: "saved a version")
        }
    }

    private func load() async {
        guard let session = app.session, app.sync.isOnline else { return }
        info = try? await session.documents.info(model.documentId)
        if isMember, home != app.scope { scopeSidebar = try? await session.documents.sidebar(scope: home) }
    }
}

private struct VersionHistoryLink: View {
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: "clock.arrow.circlepath").font(.system(size: 10.5, weight: .medium))
                Text("Version history").font(.ui(11, .semibold))
            }
            .foregroundStyle(FoleviColor.heading)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(hovering ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
