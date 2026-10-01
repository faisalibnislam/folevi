import AppKit
import SwiftUI

/// The row above the page (the web's ViewChrome on a note): with the sidebar hidden, where the page lives
/// (folder or Home, parent pages, the page) as a breadcrumb; a "View only" or "In Trash" chip when you
/// can't edit. Nothing otherwise.
struct PageChromeBar: View {
    @Bindable var model: EditorModel
    var nav: NavigationModel?
    @Environment(AppModel.self) private var app

    private var inTrash: Bool { model.detail?.inTrash ?? (model.document?.deletedAt != nil) }
    private var showsCrumbs: Bool { nav.map { !$0.sidebarVisible } ?? false }

    var body: some View {
        if showsCrumbs || model.isReadOnly {
            HStack(spacing: 2) {
                if showsCrumbs, let nav { crumbs(nav) }
                if model.isReadOnly {
                    Text(inTrash ? "In Trash" : "View only")
                        .font(.ui(11, .semibold))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .padding(.horizontal, 10)
                        .frame(height: 24)
                        .background(FoleviColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .padding(.leading, showsCrumbs ? 4 : 0)
                        .fixedSize()
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 36)
            .frame(minHeight: 44)
        }
    }

    private struct Folder { var id: String; var name: String }

    @ViewBuilder private func crumbs(_ nav: NavigationModel) -> some View {
        let folder: Folder? = model.detail?.folder.map { Folder(id: $0.id, name: $0.name) }
            ?? model.document?.folderId.flatMap { id in app.sidebar.folders.first { $0.id == id }.map { Folder(id: $0.id, name: $0.name) } }
        let parentFolder = folder.flatMap { f in app.sidebar.folders.first { $0.id == f.id }?.parentFolderId }
            .flatMap { pid in app.sidebar.folders.first { $0.id == pid } }
        HStack(spacing: 2) {
            if let parentFolder {
                CrumbLink(systemImage: "folder", title: parentFolder.name, maxWidth: 160) { nav.selection = .folder(parentFolder.id) }
                chevron
            }
            if let folder {
                CrumbLink(systemImage: "folder", title: folder.name, maxWidth: 192) { nav.selection = .folder(folder.id) }
            } else {
                CrumbLink(systemImage: "house", title: String(localized: "Home"), maxWidth: 192) {
                    if nav.selection == .all { nav.closeDocument() } else { nav.selection = .all }
                }
            }
            chevron
            ForEach(ancestors, id: \.id) { a in
                CrumbLink(systemImage: nil, title: a.title.isEmpty ? String(localized: "Untitled") : a.title, maxWidth: 192) { nav.open(a.id) }
                chevron
            }
            Text(model.document?.title.isEmpty == false ? model.document!.title : String(localized: "Untitled"))
                .font(.ui(13.5, .semibold))
                .foregroundStyle(FoleviColor.heading)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .accessibilityAddTraits(.isHeader)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Breadcrumb"))
    }

    /// Parent pages, outermost first (the server's list, or this Mac's while offline).
    private var ancestors: [(id: String, title: String)] {
        if let crumbs = model.detail?.breadcrumbs { return crumbs.map { ($0.id, $0.title) } }
        var out: [(String, String)] = []
        var cursor = model.document?.parentDocumentId
        var guardCount = 0
        while let id = cursor, let parent = app.document(id), guardCount < 12 {
            out.insert((parent.id, parent.title), at: 0)
            cursor = parent.parentDocumentId
            guardCount += 1
        }
        return out
    }

    private var chevron: some View {
        Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(FoleviColor.inkFaint).accessibilityHidden(true)
    }
}

private struct CrumbLink: View {
    var systemImage: String?
    var title: String
    var maxWidth: CGFloat
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 12.5)) }
                Text(title).lineLimit(1).truncationMode(.tail)
            }
            .font(.ui(13.5))
            .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.inkMuted)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .frame(maxWidth: maxWidth, alignment: .leading)
            .fixedSize(horizontal: true, vertical: false)
            .background(hovering ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(Text(title))
    }
}

/// "Linked from" under the page: pages that link here, and pages that mention its title (the web's
/// Backlinks). Hidden when there are none.
struct BacklinksSection: View {
    @Bindable var model: EditorModel
    var nav: NavigationModel?
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var data: Backlinks?

    var body: some View {
        Group {
            if let data, !(data.linked.isEmpty && data.unlinked.isEmpty) {
                VStack(alignment: .leading, spacing: 0) {
                    heading("Linked from")
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(data.linked) { l in BacklinkRow(link: l, excerpt: true) { open(l.id) } }
                        if data.linked.isEmpty {
                            Text("No pages link here yet.").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 8)
                        }
                    }
                    .padding(.top, 8)
                    if !data.unlinked.isEmpty {
                        heading("Unlinked mentions").padding(.top, 16)
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(data.unlinked) { l in BacklinkRow(link: l, excerpt: false) { open(l.id) } }
                        }
                        .padding(.top, 8)
                    }
                }
                .padding(.horizontal, EditorView.sheetPadding)
                .padding(.top, 32)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task(id: BacklinksKey(id: model.documentId, revision: app.documentsRevision, online: app.sync.isOnline)) { await load() }
    }

    private struct BacklinksKey: Equatable {
        var id: String
        var revision: Int
        var online: Bool
    }

    private func heading(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.ui(12, .semibold))
            .tracking(0.06 * 12)
            .textCase(.uppercase)
            .foregroundStyle(FoleviColor.inkFaint)
            .accessibilityAddTraits(.isHeader)
    }

    private func open(_ id: String) {
        openDocument(id, NSEvent.modifierFlags.contains(.option))
    }

    private func load() async {
        guard let session = app.session, app.sync.isOnline else { return }
        if let b = try? await session.documents.backlinks(model.documentId) { data = b }
    }
}

private struct BacklinkRow: View {
    var link: LinkRef
    var excerpt: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "doc.text").font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted)
                Text(link.title.isEmpty ? String(localized: "Untitled") : link.title).font(.ui(16, .medium)).foregroundStyle(FoleviColor.ink)
                if excerpt, !link.excerpt.isEmpty {
                    Text(link.excerpt).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(hovering ? FoleviColor.surface : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

/// A note style made from the person's own image: the image itself, loaded from this Mac's attachment cache
/// (or downloaded once).
@MainActor
@Observable
final class CoverImages {
    static let shared = CoverImages()
    private(set) var images: [String: NSImage] = [:]
    @ObservationIgnored private var loading: Set<String> = []

    func image(_ fileId: String, app: AppModel) -> NSImage? {
        if let image = images[fileId] { return image }
        guard !loading.contains(fileId), let session = app.session else { return nil }
        loading.insert(fileId)
        Task {
            if let url = try? await session.files.localFile(fileId: fileId), let image = NSImage(contentsOf: url) {
                images[fileId] = image
            } else {
                loading.remove(fileId)
            }
        }
        return nil
    }
}
