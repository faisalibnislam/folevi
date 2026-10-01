import SwiftUI

/// Every folder and tag with counts (organization:index), live; offline, worked out from this Mac's copy.
@MainActor
@Observable
final class OrganizationIndexModel {
    var data: OrganizationIndex?

    func watch(app: AppModel) async {
        data = local(app)
        guard let session = app.session else { return }
        while !Task.isCancelled {
            do {
                for try await d in session.organization.indexUpdates(scope: session.scope) { data = d }
            } catch {}
            if data == nil { data = local(app) }
            try? await Task.sleep(for: .seconds(10))
        }
    }

    /// Counts from the pages on this Mac (used until the server answers, and offline).
    private func local(_ app: AppModel) -> OrganizationIndex {
        let pages = app.documents.filter { $0.deletedAt == nil && $0.archivedAt == nil && $0.parentDocumentId == nil && $0.kind != .template }
        let folders = app.sidebar.folders.map { f -> OrganizationIndex.Folder in
            let inside = pages.filter { $0.folderId == f.id }
            return .init(id: f.id, name: f.name, color: f.color, parentFolderId: f.parentFolderId, createdAt: 0,
                         updatedAt: inside.map(\.updatedAt).max() ?? 0, documentCount: inside.count)
        }
        let tags = app.sidebar.tags.map { t in
            OrganizationIndex.Tag(id: t.id, name: t.name, color: t.color, createdAt: 0,
                                  documentCount: pages.filter { ($0.tags ?? []).contains { $0.id == t.id } }.count)
        }
        return OrganizationIndex(folders: folders, tags: tags)
    }
}

private func pagesText(_ n: Int) -> String {
    n == 1 ? String(localized: "1 page") : String(localized: "\(n.formatted()) pages")
}

/// A search box (the web's SearchField): a 36pt input, a search glyph inside, and a clear button.
private struct IndexSearchField: View {
    @Binding var text: String
    var label: String
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .medium)).foregroundStyle(FoleviColor.inkFaint)
                .accessibilityHidden(true)
            TextField(label, text: $text)
                .textFieldStyle(.plain)
                .font(.ui(14))
                .focused($focused)
                .accessibilityLabel(Text(label))
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(FoleviColor.inkFaint)
                        .frame(width: 24, height: 24).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Clear search"))
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, 6)
        .frame(height: 36)
        .frame(maxWidth: 384)
        .foleviInputSurface(focused: focused)
    }
}

/// "Sort [Name ▾]".
private struct SortPicker<V: Hashable>: View {
    @Binding var value: V
    var options: [(V, String)]

    var body: some View {
        HStack(spacing: 8) {
            Text("Sort").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
            FoleviSelect(selection: $value, options: options.map { .init(value: $0.0, title: $0.1) },
                         accessibilityLabel: String(localized: "Sort"), height: 36, fontSize: 14)
        }
    }
}

/// The view's facts and actions row (the web's ViewChrome bar): right-aligned actions, 44pt.
private struct IndexHeader<Actions: View>: View {
    var title: String
    @ViewBuilder var actions: Actions

    var body: some View {
        HStack {
            // The page's name is in its tab; screen readers get it here.
            Text(title).accessibilityAddTraits(.isHeader).frame(width: 1, height: 1).opacity(0).accessibilityHidden(false)
            Spacer()
            actions
        }
        .frame(minHeight: 44)
        .padding(.horizontal, 16)
        .padding(.horizontal, 12)
    }
}

/// Every folder in the open scope (the web's FoldersIndex): search, the count, sorting, cards or a list,
/// and New folder. The sidebar lists only the first few.
struct FoldersIndex: View {
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @State private var model = OrganizationIndexModel()
    @State private var query = ""
    @State private var creating = false
    @AppStorage("folders.sort") private var sort = "name"
    @AppStorage("folders.layout") private var layout = "grid"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                IndexHeader(title: String(localized: "Folders")) {
                    if app.canEditHere {
                        Button { creating = true } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "folder.badge.plus").font(.system(size: 12, weight: .medium))
                                Text("New folder")
                            }
                        }
                        .buttonStyle(.folevi(.primary, .small))
                    }
                }
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 12) {
                        IndexSearchField(text: $query, label: String(localized: "Search folders"))
                        Text(status).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                            .accessibilityAddTraits(.updatesFrequently)
                        Spacer(minLength: 0)
                        SortPicker(value: $sort, options: [("name", String(localized: "Name")), ("updated", String(localized: "Last updated")),
                                                           ("count", String(localized: "Most pages")), ("created", String(localized: "Newest"))])
                        FoleviSegmented(selection: $layout, items: [
                            .init(value: "grid", title: "Grid", systemImage: "square.grid.2x2"),
                            .init(value: "list", title: "List", systemImage: "list.bullet"),
                        ], showTitles: false, accessibilityLabel: "Layout")
                    }
                    content.padding(.top, 24)
                }
                .padding(.horizontal, 32)
                .padding(.top, 12)
                .padding(.bottom, 96)
                .frame(maxWidth: 1152)
                .frame(maxWidth: .infinity)
            }
        }
        .scrollContentBackground(.hidden)
        .task(id: app.scope.key) { await model.watch(app: app) }
        .sheet(isPresented: $creating) {
            FoleviPromptDialog(title: String(localized: "New folder"), label: String(localized: "Folder name"),
                               confirmTitle: String(localized: "Create folder")) { name in
                guard let session = app.session else { return }
                let scope = session.scope
                Task {
                    do {
                        let id = try await session.organization.createFolder(scope: scope, name: name)
                        await app.refreshSidebar()
                        nav.show(.folder(id))
                    } catch {
                        app.showToast(ConvexService.mapError(error).localizedDescription, tone: .error)
                    }
                }
            }
        }
    }

    private var all: [OrganizationIndex.Folder] { model.data?.folders ?? [] }

    private var list: [OrganizationIndex.Folder] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let rows = all.filter { needle.isEmpty || $0.name.lowercased().contains(needle) }
        return rows.sorted { a, b in
            switch sort {
            case "updated": return a.updatedAt > b.updatedAt
            case "count": return a.documentCount != b.documentCount ? a.documentCount > b.documentCount : a.name.localizedCompare(b.name) == .orderedAscending
            case "created": return a.createdAt > b.createdAt
            default: return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
        }
    }

    private var status: String {
        guard model.data != nil else { return String(localized: "Loading…") }
        let q = query.trimmingCharacters(in: .whitespaces)
        if !q.isEmpty { return String(localized: "\(list.count) of \(all.count) folders") }
        return all.count == 1 ? String(localized: "1 folder") : String(localized: "\(all.count) folders")
    }

    private func parentName(_ f: OrganizationIndex.Folder) -> String? {
        f.parentFolderId.flatMap { id in all.first { $0.id == id }?.name }
    }

    @ViewBuilder private var content: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        if model.data != nil && list.isEmpty {
            Text(q.isEmpty ? String(localized: "No folders yet. Create one to group related pages.") : String(localized: "No folders match “\(q)”."))
                .font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                .frame(maxWidth: .infinity)
                .padding(.top, 40)
        } else if layout == "grid" {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 32)], spacing: 40) {
                ForEach(list) { f in FolderCardCell(folder: f, parentName: parentName(f), nav: nav) }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Folders"))
        } else {
            VStack(spacing: 0) {
                ForEach(Array(list.enumerated()), id: \.element.id) { idx, f in
                    FolderListRow(folder: f, parentName: parentName(f), nav: nav)
                    if idx < list.count - 1 { FoleviColor.line.frame(height: 1) }
                }
            }
            .foleviCard(radius: 6)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Folders"))
        }
    }
}

/// A folder card (drawn as a real folder) with its menu over the cover on hover.
private struct FolderCardCell: View {
    var folder: OrganizationIndex.Folder
    var parentName: String?
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @State private var hover = false

    var body: some View {
        let docs = app.documents.filter { $0.folderId == folder.id && $0.deletedAt == nil && $0.archivedAt == nil && $0.parentDocumentId == nil }
        let info = FolderInfo(id: folder.id, name: folder.name, parentFolderId: folder.parentFolderId, rank: "", color: folder.color)
        FolderCard(folder: info, documentCount: folder.documentCount, updatedAt: folder.updatedAt > 0 ? folder.updatedAt : nil,
                   parentName: parentName, previews: Array(docs.sorted { $0.updatedAt > $1.updatedAt }.prefix(3)))
            .contentShape(Rectangle())
            .onTapGesture { nav.show(.folder(folder.id)) }
            .overlay(alignment: .topTrailing) {
                FolderMenu(folder: MenuFolder(folder), openDocument: { nav.open($0) }) { open in
                    FoleviMenuTrigger(systemImage: "ellipsis", size: 32, open: open)
                }
                .padding(.top, 28)
                .padding(.trailing, 16)
                .opacity(hover ? 1 : 0)
            }
            .onHover { hover = $0 }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(accessibilityText))
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { nav.show(.folder(folder.id)) }
            .help(Text(parentName.map { "\(folder.name) (in \($0))" } ?? folder.name))
    }

    private var accessibilityText: String {
        let place = parentName.map { String(localized: ", in \($0)") } ?? ""
        return "\(folder.name)\(place), \(pagesText(folder.documentCount)), \(String(localized: "updated")) \(CollabTime.relative(folder.updatedAt))"
    }
}

/// A folder as a list row: its glyph, name (and parent), page count and last update; the menu on hover.
private struct FolderListRow: View {
    var folder: OrganizationIndex.Folder
    var parentName: String?
    @Bindable var nav: NavigationModel
    @State private var hover = false

    var body: some View {
        HStack(spacing: 12) {
            Button { nav.show(.folder(folder.id)) } label: {
                HStack(spacing: 12) {
                    FolderGlyph(color: folder.color, size: 24)
                    HStack(spacing: 8) {
                        Text(folder.name).font(.ui(14, .medium)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                        if parentFolderLabel != nil {
                            Text(parentFolderLabel ?? "").font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text(pagesText(folder.documentCount)).font(.ui(12).monospacedDigit()).foregroundStyle(FoleviColor.inkMuted)
                        .frame(width: 80, alignment: .trailing)
                    Text(folder.updatedAt > 0 ? CollabTime.relative(folder.updatedAt) : "").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                        .frame(width: 128, alignment: .trailing)
                }
                .padding(.vertical, 10)
                .padding(.leading, 16)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            FolderMenu(folder: MenuFolder(folder), openDocument: { nav.open($0) })
                .opacity(hover ? 1 : 0)
                .padding(.trailing, 12)
        }
        .background(hover ? FoleviColor.accentSoft.opacity(0.5) : .clear)
        .onHover { hover = $0 }
    }

    private var parentFolderLabel: String? {
        guard folder.parentFolderId != nil else { return nil }
        return String(localized: "in \(parentName ?? String(localized: "a folder"))")
    }
}

/// Every tag in the open scope (the web's TagsIndex): search, the count, sorting, and chips with page counts.
struct TagsIndex: View {
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @State private var model = OrganizationIndexModel()
    @State private var query = ""
    @AppStorage("tags.sort") private var sort = "name"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                IndexHeader(title: String(localized: "Tags")) { EmptyView() }
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 12) {
                        IndexSearchField(text: $query, label: String(localized: "Search tags"))
                        Text(status).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                        Spacer(minLength: 0)
                        SortPicker(value: $sort, options: [("name", String(localized: "Name")), ("count", String(localized: "Most used")),
                                                           ("created", String(localized: "Newest"))])
                    }
                    content.padding(.top, 24)
                }
                .padding(.horizontal, 32)
                .padding(.top, 12)
                .padding(.bottom, 96)
                .frame(maxWidth: 1152)
                .frame(maxWidth: .infinity)
            }
        }
        .scrollContentBackground(.hidden)
        .task(id: app.scope.key) { await model.watch(app: app) }
    }

    private var all: [OrganizationIndex.Tag] { model.data?.tags ?? [] }

    private var needle: String {
        var q = query.trimmingCharacters(in: .whitespaces)
        if q.hasPrefix("#") { q.removeFirst() }
        return q.lowercased()
    }

    private var list: [OrganizationIndex.Tag] {
        all.filter { needle.isEmpty || $0.name.lowercased().contains(needle) }.sorted { a, b in
            switch sort {
            case "count": return a.documentCount != b.documentCount ? a.documentCount > b.documentCount : a.name.localizedCompare(b.name) == .orderedAscending
            case "created": return a.createdAt > b.createdAt
            default: return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
        }
    }

    private var status: String {
        guard model.data != nil else { return String(localized: "Loading…") }
        if !query.trimmingCharacters(in: .whitespaces).isEmpty { return String(localized: "\(list.count) of \(all.count) tags") }
        return all.count == 1 ? String(localized: "1 tag") : String(localized: "\(all.count) tags")
    }

    @ViewBuilder private var content: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        if model.data != nil && list.isEmpty {
            Text(q.isEmpty ? String(localized: "No tags yet. Add tags to a page from its Info panel.") : String(localized: "No tags match “\(q)”."))
                .font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                .frame(maxWidth: .infinity)
                .padding(.top, 40)
        } else {
            TagChipFlow(spacing: 8) {
                ForEach(list) { t in TagIndexChip(tag: t) { nav.show(.tag(t.id)) } }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Tags"))
        }
    }
}

private struct TagIndexChip: View {
    var tag: OrganizationIndex.Tag
    var open: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                Image(systemName: "number").font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.folevi(tag: tag.color))
                    .accessibilityHidden(true)
                Text(tag.name).font(.ui(13.5, .medium)).foregroundStyle(FoleviColor.ink)
                Text(pagesText(tag.documentCount))
                    .font(.ui(11).monospacedDigit())
                    .foregroundStyle(FoleviColor.inkMuted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(FoleviColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            .padding(.leading, 12)
            .padding(.trailing, 8)
            .frame(height: 36)
            .background {
                if hover {
                    RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.accentSoft)
                } else {
                    Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(6), shadow: FoleviShadow.control)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityLabel(Text("\(tag.name), \(pagesText(tag.documentCount))"))
    }
}

/// Wrapping row of chips.
private struct TagChipFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(widest, maxWidth), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
