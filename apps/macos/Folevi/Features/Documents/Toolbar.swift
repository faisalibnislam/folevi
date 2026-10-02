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
                             icon: .symbol("folder"),
                             action: nav.map { n in { n.selection = .folder(folder.id) } }))
        } else {
            let root: SidebarItem = doc.kind == .template ? .templates : .all
            out.append(Crumb(id: "root", title: rootTitle(root), icon: .symbol(root.systemImage),
                             action: nav.map { n in { if n.selection == root { n.closeDocument() } else { n.selection = root } } }))
        }
        for a in ancestors {
            out.append(Crumb(id: a.id, title: a.displayTitle, icon: .symbol("doc.text"), action: { openDocument(a.id) }))
        }
        out.append(Crumb(id: doc.id, title: doc.displayTitle, icon: .symbol("doc.text"), action: nil))
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
                    FoleviViewMenu(label: String(localized: "More locations"), align: .start) {
                        ForEach(hidden) { c in
                            Button(c.title) { c.action?() }
                        }
                    } trigger: {
                        Text("…").font(.ui(13.5, .semibold)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 6)
                    }
                    .fixedSize()
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
                .buttonStyle(.chrome)
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

/// The top of the window. In the main window, the web's tab strip: a 44pt glass bar 8pt in from the edges
/// (Up, Home and the open pages, New note). A document window has no tabs: its breadcrumb instead.
struct MainToolbar: View {
    @Bindable var nav: NavigationModel
    var editor: EditorModel?
    var crumbs: [Crumb]
    var showsHistory = true
    /// Document windows have no sidebar: always leave room for the traffic lights.
    var hasSidebar = true
    /// Opens a note (sync details in the strip while the sidebar is hidden).
    var openDocument: (String) -> Void = { _ in }
    @Environment(AppModel.self) private var app

    var body: some View {
        if hasSidebar {
            // Room for the traffic lights while the sidebar (which normally holds them) is hidden.
            TabStrip(nav: nav, openDocument: openDocument, leadingInset: nav.sidebarVisible ? 0 : 58) {
                trailing
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .frame(height: FoleviLayout.toolbarHeight, alignment: .bottom)
        } else {
            HStack(spacing: 10) {
                Color.clear.frame(width: 62, height: 1)
                if showsHistory { BackForwardPill(nav: nav) }
                BreadcrumbBar(crumbs: crumbs)
                    .padding(.leading, 2)
                // Only the empty space moves the window. A drag area behind the whole row took clicks meant
                // for the tabs and buttons on top of it.
                Color.clear
                    .frame(minWidth: 8, maxWidth: .infinity, maxHeight: .infinity)
                    .titlebarDragArea()
                // No sidebar here: save state sits in this row (as the web shows it in the header without one).
                SyncStatusButton(documentId: editor?.documentId)
            }
            .padding(.horizontal, 14)
            .frame(height: FoleviLayout.toolbarHeight)
        }
    }

    /// Always here: a new note opens in its own tab (in the open folder, else in Drafts).
    @ViewBuilder private var trailing: some View {
        HStack(spacing: 6) {
            let inFolder = nav.currentFolderId != nil
            Button {
                let folderId = nav.currentFolderId
                Task { if let id = await app.createDocument(folderId: folderId) { nav.open(id, newTab: true) } }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 12, weight: .semibold))
                    Text("New note")
                }
            }
            .buttonStyle(.folevi(.primary, .small))
            .help(Text(inFolder ? "New note in this folder (⌘⌥N)" : "New note (⌘⌥N)"))
            .accessibilityIdentifier("toolbar.newNote")
            // Comments, Share, the page's "…" menu and its tools live in the note's dock (NoteDock), as on the web.
        }
    }
}
