import SwiftUI

/// The tab strip across the top (the web's TabStrip): a glass bar holding, while the sidebar is hidden, the
/// sidebar menu and sync status; then Up; then a Home tab, the current list view (a folder, Drafts, Trash…)
/// while it's open, and one tab per open page; and "New note" at the end. Closing the open tab moves to its
/// neighbour.
struct TabStrip<Trailing: View>: View {
    @Bindable var nav: NavigationModel
    /// Opens a note (sync details).
    var openDocument: (String) -> Void
    /// Room for the traffic lights when the sidebar (which normally holds them) is hidden.
    var leadingInset: CGFloat = 0
    @ViewBuilder var trailing: Trailing
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: 6) {
            if leadingInset > 0 { Color.clear.frame(width: leadingInset, height: 1) }
            // While the sidebar is hidden, its menu waits here; otherwise it sits in the sidebar.
            if !nav.sidebarVisible {
                SidebarMenu(nav: nav)
                SyncStatusButton(documentId: nav.openDocumentId, openDocument: openDocument)
                divider
            }
            // Up a level (parent page, folder, …), then a divider before the tabs.
            UpButton(nav: nav)
            divider
            HStack(spacing: 6) {
                TabChip(title: String(localized: "Home"), systemImage: "house", isActive: onHome, kind: .fixed) {
                    nav.show(.all)
                }
                .accessibilityIdentifier("tab.home")
                if let viewTitle {
                    TabChip(title: viewTitle, systemImage: viewIcon, isActive: true, kind: .view) {}
                }
                ForEach(nav.tabs, id: \.self) { id in
                    TabChip(title: title(id), systemImage: "doc.text", isActive: nav.openDocumentId == id, kind: .page) {
                        nav.open(id)
                    } close: {
                        nav.closeTab(id)
                    }
                }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 4)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Open pages"))
            // Only the empty space moves the window: a drag area behind the row took the tabs' clicks.
            Color.clear
                .frame(minWidth: 8, maxWidth: .infinity, maxHeight: .infinity)
                .titlebarDragArea()
            trailing
        }
        .padding(.horizontal, 6)
        .frame(height: 44)
        .background {
            // The web's light glass (white 36%). Over the content panel it reads white, as on the web; the
            // system material's grey tint is only used over a note's artwork, where the web blurs it too.
            Color.clear.foleviSurface(.color(FoleviGlass.sidebar), shape: .rounded(12),
                                      shadow: FoleviGlassDepth.edge + FoleviGlassDepth.shadow)
                .background {
                    if nav.openDocumentId != nil {
                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.ultraThinMaterial)
                    }
                }
        }
        .onChange(of: app.documentsRevision, initial: true) { _, _ in
            guard !app.documents.isEmpty else { return }
            let live = Set(app.documents.filter { $0.deletedAt == nil }.map(\.id))
            nav.pruneTabs(existing: live.union(nav.openDocumentId.map { [$0] } ?? []))
        }
    }

    private var divider: some View {
        Rectangle().fill(.black.opacity(0.1)).frame(width: 1, height: 20).accessibilityHidden(true)
    }

    /// The first tab is always Home (the dashboard).
    private var onHome: Bool { nav.openDocumentId == nil && nav.selection == .all }

    /// Any other list view shows as the current tab while it's open.
    private var viewTitle: String? {
        guard nav.openDocumentId == nil, nav.selection != .all else { return nil }
        if case .folder(let id) = nav.selection { return app.sidebar.folders.first { $0.id == id }?.name ?? nav.selection.titleString }
        if case .tag(let id) = nav.selection { return app.sidebar.tags.first { $0.id == id }?.name ?? nav.selection.titleString }
        if nav.selection == .tasks { return String(localized: "Tasks · \(app.tasksViewLabel)") }
        return nav.selection.titleString
    }

    private var viewIcon: String {
        switch nav.selection {
        case .folder, .folders: return "folder"
        case .tag, .tags: return "number"
        default: return "list.bullet.rectangle"
        }
    }

    /// A tab is named after its note: the top page of the open page (nested pages open inside their note's tab).
    private func title(_ id: String) -> String {
        var doc = app.document(id)
        var hops = 0
        while let parent = doc?.parentDocumentId, let p = app.document(parent), hops < 12 {
            doc = p
            hops += 1
        }
        let t = doc?.title ?? ""
        return t.isEmpty ? String(localized: "Untitled") : t
    }
}

extension TabStrip where Trailing == EmptyView {
    init(nav: NavigationModel, openDocument: @escaping (String) -> Void, leadingInset: CGFloat = 0) {
        self.init(nav: nav, openDocument: openDocument, leadingInset: leadingInset) { EmptyView() }
    }
}

/// "Up", like a file browser's (the web's UpButton): a nested page goes to its parent page, a note to its
/// folder (or Drafts, or Templates), a folder to Folders, a tag to Tags, any other view to Home. Disabled on Home.
struct UpButton: View {
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app

    var body: some View {
        let target = nav.upTarget(app: app)
        let label = target.map { String(localized: "Up to \($0.label)") } ?? String(localized: "Up")
        Button { target?.go() } label: {
            Image(systemName: "arrow.up").font(.system(size: 13, weight: .medium)).frame(width: 32, height: 32)
        }
        .buttonStyle(IconButtonStyle())
        .disabled(target == nil)
        .help(Text(label))
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier("toolbar.up")
    }
}

/// One tab: an outlined rounded rectangle. Closed tabs sit back (a light grey fill, quiet text); the open one
/// comes forward (white, a soft dark outline and shadow, bold text).
private struct TabChip: View {
    enum Kind { case fixed, view, page }
    var title: String
    var systemImage: String
    var isActive: Bool
    var kind: Kind
    var open: () -> Void
    var close: () -> Void = {}
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            // A real button: in the title bar a tap gesture loses the click to window dragging.
            Button(action: open) {
                HStack(spacing: 8) {
                    Image(systemName: systemImage)
                        .font(.system(size: 12, weight: .medium))
                        .opacity(kind == .page ? 0.7 : 1)
                        .accessibilityHidden(true)
                    Text(title)
                        .font(.ui(13, isActive ? .semibold : .regular))
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: kind == .page ? .infinity : nil, alignment: .leading)
                }
                .foregroundStyle(isActive || hovering ? FoleviColor.heading : FoleviColor.inkMuted)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.chrome)
            .disabled(kind == .view)
            .help(Text(title))
            .accessibilityLabel(Text(title))
            .accessibilityAddTraits(isActive ? .isSelected : [])
            if kind == .page {
                CloseTabButton(title: title, visible: isActive || hovering, action: close)
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, kind == .page ? 4 : 10)
        .frame(height: 32)
        .frame(minWidth: kind == .page ? 172 : nil, idealWidth: kind == .page ? 284 : nil, maxWidth: kind == .page ? 284 : kind == .view ? 240 : nil)
        .background {
            if isActive {
                Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(6), shadow: FoleviGlassDepth.activeOutline)
            } else {
                RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering ? FoleviGlass.active.opacity(0.7) : FoleviGlass.hover)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .fixedSize(horizontal: kind != .page, vertical: false)
        .layoutPriority(kind == .page ? 0 : 1)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .contain)
    }
}

private struct CloseTabButton: View {
    var title: String
    var visible: Bool
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark").font(.system(size: 9.5, weight: .bold))
                .foregroundStyle(hover ? FoleviColor.heading : FoleviColor.inkFaint)
                .frame(width: 20, height: 20)
                .background(hover ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.chrome)
        .onHover { hover = $0 }
        .opacity(visible ? 1 : 0)
        .accessibilityLabel(Text("Close \(title)"))
    }
}
