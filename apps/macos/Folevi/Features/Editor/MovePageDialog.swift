import SwiftUI

/// Moves a page under another page (or back to the top level), from the page menu or Info (the web's
/// MovePageDialog). The parent pages' cards follow the move.
struct MovePageDialog: View {
    var editor: EditorModel
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [PageTarget]?
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var documentId: String { editor.documentId }
    private var title: String { editor.document?.title ?? "" }
    private var currentParentId: String? { editor.detail?.breadcrumbs.last?.id }
    /// The page's own scope when you're a member there (pages only move within their scope).
    private var scope: Scope { (editor.detail?.isMember ?? true) ? (editor.document?.homeScope ?? app.scope) : app.scope }
    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }
    private var list: [PageTarget] {
        (results ?? []).filter { $0.id != documentId && $0.id != currentParentId && $0.kind != "template" }
    }

    var body: some View {
        PageDialog(title: String(localized: "Move page"),
                   description: String(localized: "Choose a page to nest “\(title.isEmpty ? String(localized: "Untitled") : title)” under.")) {
            VStack(alignment: .leading, spacing: 0) {
                TextField("Search pages", text: $query)
                    .textFieldStyle(.plain)
                    .font(.ui(14))
                    .focused($focused)
                    .padding(.horizontal, 16)
                    .frame(height: 40)
                    .pageInput(focused: focused)
                    .accessibilityLabel(Text("Search pages"))
                if let error {
                    Text(error).font(.ui(14)).foregroundStyle(FoleviColor.destructive).padding(.top, 8)
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        if currentParentId != nil {
                            MoveRow(disabled: busy) {
                                Image(systemName: "arrow.turn.left.up").font(.system(size: 13)).foregroundStyle(FoleviColor.inkMuted).frame(width: 20)
                                Text("Top level (no parent page)").frame(maxWidth: .infinity, alignment: .leading)
                            } action: { move(to: nil, parentTitle: nil) }
                        }
                        ForEach(list) { d in
                            MoveRow(disabled: busy) {
                                Image(systemName: "doc.text").font(.system(size: 13)).foregroundStyle(FoleviColor.inkMuted).frame(width: 20)
                                Text(d.title.isEmpty ? String(localized: "Untitled") : d.title).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                                FolderBadgeView(folder: d.homeFolder)
                            } action: { move(to: d.id, parentTitle: d.title) }
                        }
                        if results == nil {
                            Text("Loading…").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 8).padding(.vertical, 12)
                        } else if list.isEmpty {
                            Text(trimmed.isEmpty ? String(localized: "Search for the page to move this one into.") : String(localized: "No pages match “\(trimmed)”."))
                                .font(.ui(14)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 8).padding(.vertical, 12)
                        }
                    }
                    .padding(.top, 12)
                }
                .frame(height: 320)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text(trimmed.isEmpty ? "Recent pages" : "Matching pages"))
            }
        }
        .claimsFocus($focused)
        .task(id: trimmed) { await search() }
    }

    private func search() async {
        guard let session = app.session else { return }
        results = nil
        if !trimmed.isEmpty { try? await Task.sleep(for: .milliseconds(150)) }
        guard !Task.isCancelled else { return }
        do {
            results = trimmed.isEmpty
                ? try await session.documents.recentPages(scope: scope, limit: 12)
                : try await session.documents.searchPages(scope: scope, query: trimmed, limit: 12)
        } catch {
            if !Task.isCancelled { results = [] }
        }
    }

    private func move(to parentId: String?, parentTitle: String?) {
        guard let session = app.session else { return }
        let id = documentId, title = title, from = currentParentId
        busy = true
        error = nil
        Task {
            do {
                try await session.documents.move(id, parentDocumentId: parentId)
                do {
                    try await PageCards.sync(session: session, documentId: id, title: title, from: from, to: parentId)
                } catch {
                    app.showToast(String(localized: "Moved, but the page card in the parent page couldn’t be updated."))
                }
                await session.engine.syncNow()
                editor.detail = try? await session.documents.get(id)
                busy = false
                dismiss()
                let message = parentId != nil
                    ? String(localized: "Moved into “\((parentTitle ?? "").isEmpty ? String(localized: "Untitled") : parentTitle!)”")
                    : String(localized: "Moved to the top level")
                app.showToast(message, action: .undo {
                    Task {
                        do {
                            try await session.documents.move(id, parentDocumentId: from)
                            try? await PageCards.sync(session: session, documentId: id, title: title, from: parentId, to: from)
                            await session.engine.syncNow()
                            editor.detail = try? await session.documents.get(id)
                        } catch {
                            app.showToast(ConvexService.mapError(error).localizedDescription)
                        }
                    }
                })
            } catch {
                busy = false
                self.error = ConvexService.mapError(error).localizedDescription
            }
        }
    }
}

private struct MoveRow<Label: View>: View {
    var disabled: Bool
    @ViewBuilder var label: () -> Label
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9.6) { label() }
                .font(.ui(13.5))
                .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.ink)
                .padding(.horizontal, 9.6)
                .frame(minHeight: 32)
                .background(hovering ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .onHover { hovering = $0 && !disabled }
    }
}

/// Where a page lives: its folder (filed, with a check) or "Draft" (the web's FolderBadge).
struct FolderBadgeView: View {
    var folder: HomeFolderRef?

    var body: some View {
        if let folder {
            HStack(spacing: 4) {
                Image(systemName: "checkmark").font(.system(size: 8.5, weight: .bold))
                FolderGlyph(color: folder.color, size: 13)
                Text(folder.name).lineLimit(1)
            }
            .font(.ui(11, .medium))
            .foregroundStyle(FoleviColor.mossInk)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(FoleviColor.mossSoft, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .help(Text("In folder “\(folder.name)”"))
            .accessibilityLabel(Text("In folder \(folder.name)"))
        } else {
            HStack(spacing: 4) {
                Image(systemName: "pencil.line").font(.system(size: 9.5, weight: .semibold))
                Text("Draft")
            }
            .font(.ui(11, .medium))
            .foregroundStyle(FoleviColor.inkMuted)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(FoleviColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .help(Text("Not in a folder yet"))
        }
    }
}

/// Keeps nested-page cards in step with a move (syncPageCards on the web): the new parent gets a card for
/// the page at its end, the old parent loses its card. Only where you can edit.
extension PageCards {
    static func sync(session: SessionContext, documentId: String, title: String, from: String?, to: String?) async throws {
        if let to, let parent = try await session.documents.get(to), parent.canWrite {
            let list: BlocksListResponse = try await session.convex.query("blocks:list", ["documentId": .string(to)])
            if let card = card(for: documentId, title: title, in: list.blocks) {
                await session.engine.ingestRemote(documentId: to, blocks: list.blocks)
                await session.engine.applyLocal(documentId: to, upserts: [(card, [.content, .position])])
            }
        }
        if let from, let parent = try await session.documents.get(from), parent.canWrite {
            let list: BlocksListResponse = try await session.convex.query("blocks:list", ["documentId": .string(from)])
            let cards = list.blocks.filter { isCard($0, for: documentId) }
            if !cards.isEmpty {
                await session.engine.ingestRemote(documentId: from, blocks: list.blocks)
                await session.engine.applyLocal(documentId: from, deletes: cards.map(\.id))
            }
        }
    }
}
