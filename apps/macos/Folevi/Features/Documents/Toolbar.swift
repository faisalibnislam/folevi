import SwiftUI

/// One breadcrumb: folder / parent pages / current page.
struct Crumb: Identifiable {
    enum Icon { case emoji(String), symbol(String) }
    var id: String
    var title: String
    var icon: Icon?
    var action: (() -> Void)?
}

enum Crumbs {
    /// Workspace/folder › ancestors › current, computed from local data (works offline).
    @MainActor
    static func forDocument(_ documentId: String, app: AppModel, nav: NavigationModel?, openDocument: @escaping (String) -> Void) -> [Crumb] {
        guard let doc = app.document(documentId) else { return [] }
        var ancestors: [DocumentSummary] = []
        var cursor = doc.parentDocumentId
        var guardCount = 0
        while let id = cursor, let parent = app.document(id), guardCount < 12 {
            ancestors.insert(parent, at: 0)
            cursor = parent.parentDocumentId
            guardCount += 1
        }
        var out: [Crumb] = []
        let folderId = doc.folderId ?? ancestors.first?.folderId
        if let folderId, let folder = app.sidebar.folders.first(where: { $0.id == folderId }) {
            out.append(Crumb(id: "folder.\(folder.id)", title: folder.name,
                             icon: folder.icon.flatMap { $0.isEmpty ? nil : .emoji($0) } ?? .symbol("folder"),
                             action: nav.map { n in { n.selection = .folder(folder.id) } }))
        } else {
            let root: SidebarItem = doc.kind == .template ? .templates : .all
            out.append(Crumb(id: "root", title: rootTitle(root), icon: .symbol(root.systemImage),
                             action: nav.map { n in { if n.selection == root { n.closeDocument() } else { n.selection = root } } }))
        }
        for a in ancestors {
            out.append(Crumb(id: a.id, title: a.displayTitle, icon: a.icon.flatMap { $0.isEmpty ? nil : .emoji($0) }, action: { openDocument(a.id) }))
        }
        out.append(Crumb(id: doc.id, title: doc.displayTitle, icon: .emoji(doc.icon?.isEmpty == false ? doc.icon! : "📄"), action: nil))
        return out
    }

    static func rootTitle(_ item: SidebarItem) -> String {
        switch item {
        case .templates: return String(localized: "Templates")
        default: return String(localized: "Home")
        }
    }
}

/// Breadcrumb: each crumb is a hover pill; the current crumb is heading semibold. Long trails collapse
/// their middle into a "…" menu and titles truncate.
struct BreadcrumbBar: View {
    var crumbs: [Crumb]

    var body: some View {
        HStack(spacing: 1) {
            let shown = collapsed
            ForEach(Array(shown.enumerated()), id: \.offset) { idx, entry in
                if idx > 0 {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9.5, weight: .semibold))
                        .foregroundStyle(FoleviColor.inkFaint)
                        .accessibilityHidden(true)
                        .padding(.horizontal, 1)
                }
                switch entry {
                case .crumb(let c):
                    CrumbPill(crumb: c, isCurrent: idx == shown.count - 1)
                        .layoutPriority(idx == shown.count - 1 ? 2 : 0)
                case .overflow(let hidden):
                    Menu {
                        ForEach(hidden) { c in
                            Button(c.title) { c.action?() }
                        }
                    } label: {
                        Text("…").font(.ui(13.5, .semibold)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 6)
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .accessibilityLabel(Text("More locations"))
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Breadcrumb"))
    }

    enum Entry { case crumb(Crumb), overflow([Crumb]) }

    private var collapsed: [Entry] {
        guard crumbs.count > 4 else { return crumbs.map { .crumb($0) } }
        let hidden = Array(crumbs[1..<(crumbs.count - 2)])
        return [.crumb(crumbs[0]), .overflow(hidden), .crumb(crumbs[crumbs.count - 2]), .crumb(crumbs[crumbs.count - 1])]
    }
}

private struct CrumbPill: View {
    var crumb: Crumb
    var isCurrent: Bool
    @State private var hovering = false

    var body: some View {
        let label = HStack(spacing: 6) {
            switch crumb.icon {
            case .emoji(let e): Text(e).font(.system(size: 13)).accessibilityHidden(true)
            case .symbol(let s): Image(systemName: s).font(.system(size: 12, weight: .medium)).accessibilityHidden(true)
            case nil: EmptyView()
            }
            Text(crumb.title.isEmpty ? String(localized: "Untitled") : crumb.title)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: isCurrent ? 340 : 180, alignment: .leading)
                .fixedSize(horizontal: true, vertical: false)
        }
        .font(.ui(13.5, isCurrent ? .semibold : .regular))
        .foregroundStyle(isCurrent || hovering ? FoleviColor.heading : FoleviColor.inkMuted)
        .padding(.horizontal, 8)
        .frame(height: 28)
        .background(Capsule().fill(hovering && crumb.action != nil ? FoleviColor.accentSoft : .clear))
        .contentShape(Capsule())

        if let action = crumb.action {
            Button(action: action) { label }
                .buttonStyle(.plain)
                .onHover { hovering = $0 }
                .help(Text(crumb.title))
        } else {
            label
                .accessibilityAddTraits(.isHeader)
                .accessibilityValue(Text("Current page"))
        }
    }
}

/// Back/forward: two 28pt circles in one raised pill.
struct BackForwardPill: View {
    @Bindable var nav: NavigationModel

    var body: some View {
        HStack(spacing: 0) {
            IconButton(systemImage: "chevron.left", label: "Back", shortcutHint: "⌃⌘[", size: 28) { nav.goBack() }
                .disabled(!nav.canGoBack)
                .accessibilityIdentifier("toolbar.back")
            FoleviColor.line.frame(width: 1, height: 16).accessibilityHidden(true)
            IconButton(systemImage: "chevron.right", label: "Forward", shortcutHint: "⌃⌘]", size: 28) { nav.goForward() }
                .disabled(!nav.canGoForward)
        }
        .padding(2)
        .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .capsule, shadow: FoleviShadow.control)
    }
}

/// The 52pt toolbar row over the canvas.
struct MainToolbar: View {
    @Bindable var nav: NavigationModel
    var editor: EditorModel?
    var crumbs: [Crumb]
    var showsHistory = true
    /// Document windows have no sidebar: always leave room for the traffic lights.
    var hasSidebar = true
    /// The view's primary action (e.g. "New" in lists, "Add task" in Tasks), shown as a cocoa pill.
    var primary: (title: LocalizedStringKey, systemImage: String, action: () -> Void)?
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: 10) {
            if !hasSidebar {
                Color.clear.frame(width: 62, height: 1)
            } else if !nav.sidebarVisible {
                // Room for the traffic lights, then the sidebar toggle.
                Color.clear.frame(width: 66, height: 1)
                IconButton(systemImage: "sidebar.left", label: "Show Sidebar", shortcutHint: "⌃⌘S", size: 28) { withSidebarAnimation { nav.toggleSidebar() } }
            }
            if showsHistory { BackForwardPill(nav: nav) }
            BreadcrumbBar(crumbs: crumbs)
                .padding(.leading, 2)
            Spacer(minLength: 8)
            trailing
        }
        .padding(.horizontal, 14)
        .frame(height: FoleviLayout.toolbarHeight)
        .background { Color.clear.titlebarDragArea() }
    }

    @ViewBuilder private var trailing: some View {
        HStack(spacing: 6) {
            SyncStatusPill(snapshot: app.sync)
                .frame(width: 118)
                .padding(.trailing, 4)
            if editor == nil, let primary {
                Button(action: primary.action) {
                    Label(primary.title, systemImage: primary.systemImage)
                }
                .buttonStyle(.folevi(.primary, .medium))
                .padding(.trailing, 2)
            }
            if let editor {
                IconButton(systemImage: "text.bubble", label: "Comments", size: 30,
                           isActive: nav.showInspector && nav.inspectorTab == .comments) {
                    if nav.showInspector && nav.inspectorTab == .comments { nav.showInspector = false } else {
                        nav.inspectorTab = .comments
                        nav.showInspector = true
                    }
                }
                ShareLink(item: MarkdownShareItem(title: editor.document?.displayTitle ?? "Untitled",
                                                  markdown: MarkdownCodec.blocksToMarkdown(editor.exportBlocks(), .init(title: editor.document?.displayTitle))),
                          preview: SharePreview(editor.document?.displayTitle ?? "Untitled")) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.folevi(.primary, .medium))
                .help(Text("Share as Markdown"))
                .padding(.horizontal, 2)
                DocumentMoreMenu(editor: editor, nav: nav)
            }
            IconButton(systemImage: "sidebar.right", label: "Inspector", shortcutHint: "⌥⌘I", size: 30, isActive: nav.showInspector) {
                withSidebarAnimation { nav.showInspector.toggle() }
            }
            .accessibilityIdentifier("toolbar.inspector")
        }
    }
}

/// "…" menu for the open document — real actions only.
struct DocumentMoreMenu: View {
    var editor: EditorModel
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Menu {
            Button("Find in Document") { nav.showFind = true }
            Button("Version History…") { nav.showHistory = true }
            Button("Open in New Window") { openWindow(id: "document", value: editor.documentId) }
            Divider()
            Menu("Export") {
                ForEach(ExportService.Format.allCases) { format in
                    Button {
                        ExportService.export(format, title: editor.document?.displayTitle ?? String(localized: "Untitled"), blocks: editor.exportBlocks(), app: app)
                    } label: {
                        Text("Export as \(Text(format.title))…")
                    }
                }
            }
            Divider()
            Button("Page Style…") {
                nav.inspectorTab = .style
                nav.showInspector = true
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 14, weight: .semibold))
                .frame(width: 30, height: 30)
                .contentShape(Circle())
        }
        .menuStyle(.button)
        .buttonStyle(IconButtonStyle())
        .menuIndicator(.hidden)
        .fixedSize()
        .help(Text("More"))
        .accessibilityLabel(Text("More"))
    }
}

/// Floating inspector card: surface (+ material unless Reduce Transparency), card shadow, radius 16.
struct InspectorCard<Content: View>: View {
    @ViewBuilder var content: Content
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        content
            .frame(width: FoleviLayout.inspectorDefault)
            .frame(maxHeight: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous))
            .foleviSurface(.color(reduceTransparency ? FoleviColor.surface : FoleviColor.surface.opacity(0.86)),
                           shape: .rounded(FoleviRadius.card), shadow: FoleviShadow.card, clipShadowInside: !reduceTransparency)
            .background {
                if !reduceTransparency {
                    RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous).fill(.regularMaterial)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Inspector"))
    }
}
