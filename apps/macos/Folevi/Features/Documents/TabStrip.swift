import SwiftUI

/// The tab strip across the top (the web's tabs): the current view (Home, a folder, Tasks…) first, then
/// every open note. The open one is a raised white tab; close a note's tab with its ×.
struct TabStrip: View {
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app

    var body: some View {
        // No horizontal ScrollView: in the title bar it swallowed clicks on the tabs. Tabs shrink to fit instead
        // (titles truncate), and at most 8 note tabs stay open.
        HStack(spacing: 6) {
            TabChip(title: viewTitle, systemImage: nav.selection.systemImage, isActive: nav.openDocumentId == nil, closable: false) {
                nav.closeDocument()
            } close: {}
            ForEach(nav.tabs, id: \.self) { id in
                TabChip(title: title(id), systemImage: "doc.text", isActive: nav.openDocumentId == id, closable: true) {
                    nav.open(id)
                } close: {
                    nav.closeTab(id)
                }
            }
        }
        .padding(.vertical, 2)
        .clipped()
        .onChange(of: app.documentsRevision, initial: true) { _, _ in
            guard !app.documents.isEmpty else { return }
            let live = Set(app.documents.filter { $0.deletedAt == nil }.map(\.id))
            nav.pruneTabs(existing: live.union(nav.openDocumentId.map { [$0] } ?? []))
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Tabs"))
    }

    private var viewTitle: String {
        if case .folder(let id) = nav.selection { return app.sidebar.folders.first { $0.id == id }?.name ?? nav.selection.titleString }
        if case .tag(let id) = nav.selection { return app.sidebar.tags.first { $0.id == id }.map { "#" + $0.name } ?? nav.selection.titleString }
        return nav.selection.titleString
    }

    private func title(_ id: String) -> String {
        app.documents.first { $0.id == id }?.displayTitle ?? String(localized: "Untitled")
    }
}

private struct TabChip: View {
    var title: String
    var systemImage: String
    var isActive: Bool
    var closable: Bool
    var open: () -> Void
    var close: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 2) {
            // A real button: in the title bar a tap gesture loses the click to window dragging.
            Button(action: open) {
                HStack(spacing: 7) {
                    Image(systemName: systemImage)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(isActive ? FoleviColor.heading : FoleviColor.inkMuted)
                        .accessibilityHidden(true)
                    Text(title)
                        .font(.ui(13, isActive ? .semibold : .regular))
                        .foregroundStyle(isActive ? FoleviColor.heading : FoleviColor.ink.opacity(0.85))
                        .lineLimit(1)
                        .frame(maxWidth: 160, alignment: .leading)
                }
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.chrome)
            .accessibilityLabel(Text(title))
            .accessibilityAddTraits(isActive ? .isSelected : [])
            if closable {
                Button(action: close) {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(FoleviColor.inkMuted)
                        .frame(width: 16, height: 16)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.chrome)
                .opacity(isActive || hovering ? 1 : 0)
                .accessibilityLabel(Text("Close \(title)"))
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, closable ? 6 : 12)
        .frame(height: 32)
        .background {
            let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
            if isActive {
                shape.fill(FoleviColor.surface)
                    .overlay(shape.strokeBorder(FoleviGlass.border))
                    .shadow(color: .black.opacity(0.06), radius: 1.5, y: 1)
            } else {
                shape.fill(hovering ? FoleviGlass.active : FoleviGlass.hover)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        // As wide as its title (up to 160pt), not stretched across the bar.
        .fixedSize(horizontal: true, vertical: false)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .contain)
    }
}
