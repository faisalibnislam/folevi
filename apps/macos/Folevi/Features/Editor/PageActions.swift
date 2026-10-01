import AppKit
import SwiftUI

/// The open page's own UI state: the dialogs and menus its dock, menu and Info panel open, and who else is
/// on the page (DocumentView.tsx on the web).
@MainActor
@Observable
final class DocumentPageState {
    var shareOpen = false
    var moreOpen = false
    var movePageOpen = false
    /// Move to folder… or Delete permanently…
    var dialog: NoteDialog?
    /// Other people on the page now (presence:list).
    var presence: [PresencePerson] = []
    /// Bumped each time ⌘F / ⌘⌥F (or the menu) asks for the find bar again, so it takes the keyboard back.
    var findFocusToken = UUID()
    /// Bumped to scroll the page back to its top (the sidebar's title in Table of contents).
    var scrollTopToken = UUID()
    /// This window's presence session on the page.
    let presenceSession = String(UUID().uuidString.prefix(12)).lowercased()
}

/// One row of the page's "…" menu (and Info → Actions).
struct PageMenuItem: Identifiable {
    var label: String
    var systemImage: String
    var shortcut: String? = nil
    var danger = false
    var disabled = false
    var run: @MainActor () -> Void
    var id: String { label }
}

enum PageMenuEntry: Identifiable {
    case item(PageMenuItem)
    case separator(Int)

    var id: String {
        switch self {
        case .item(let i): return i.id
        case .separator(let n): return "separator.\(n)"
        }
    }
}

/// The page's actions, in the web's order (useDocumentActions in DocumentView.tsx), plus following or
/// muting the note's comment notifications.
@MainActor
enum PageActions {
    typealias Context = PageMenu.Context

    static func labels(_ c: Context) -> [String] { PageMenu.labels(c) }

    static func context(editor: EditorModel, app: AppModel) -> Context {
        let doc = editor.document
        let detail = editor.detail
        let readOnly = editor.isReadOnly
        let canManage = detail.map { $0.access == "manage" || $0.access == "write" } ?? !readOnly
        let inCurrentScope = (doc.map { $0.homeScope == app.scope } ?? false) && (detail?.isMember ?? true)
        return Context(
            inTrash: detail?.inTrash ?? (doc?.deletedAt != nil),
            starred: doc.map { NoteActions.shared.isStarred($0) } ?? false,
            archived: doc?.archivedAt != nil,
            isTemplate: doc?.kind == .template,
            canManage: canManage,
            readOnly: readOnly,
            canMoveToFolder: !readOnly && inCurrentScope && doc?.parentDocumentId == nil && doc?.kind != .template && canManage
        )
    }

    static func entries(editor: EditorModel, nav: NavigationModel, app: AppModel) -> [PageMenuEntry] {
        let c = context(editor: editor, app: app)
        let id = editor.documentId
        let title = editor.document?.title ?? ""
        let page = editor.page
        var out: [PageMenuEntry] = []
        var seps = 0
        func sep() {
            seps += 1
            out.append(.separator(seps))
        }
        func add(_ label: String, _ icon: String, shortcut: String? = nil, danger: Bool = false, disabled: Bool = false, _ run: @escaping @MainActor () -> Void) {
            out.append(.item(PageMenuItem(label: label, systemImage: icon, shortcut: shortcut, danger: danger, disabled: disabled, run: run)))
        }
        if c.inTrash {
            add(String(localized: "Restore from Trash"), "arrow.uturn.backward") {
                act(app, String(localized: "Restored")) { try await $0.documents.restoreFromTrash(id) }
            }
            add(String(localized: "Delete permanently…"), "trash", danger: true) { page.dialog = .deletePermanently(id: id, title: title) }
        } else {
            if c.starred {
                add(String(localized: "Unstar"), "star.slash") {
                    NoteActions.shared.noteStarChanged(id, false)
                    act(app, String(localized: "Removed from Starred")) { try await $0.documents.setStarred(id, false) }
                }
            } else {
                add(String(localized: "Star"), "star") {
                    NoteActions.shared.noteStarChanged(id, true)
                    act(app, String(localized: "Starred")) { try await $0.documents.setStarred(id, true) }
                }
            }
            add(String(localized: "Share…"), "square.and.arrow.up") { page.shareOpen = true }
            add(String(localized: "Version history…"), "clock.arrow.circlepath") { nav.showHistory = true }
            add(c.canManage ? String(localized: "Find and replace…") : String(localized: "Find in note…"), "magnifyingglass",
                shortcut: c.canManage ? "⌘⌥F" : "⌘F") {
                editor.findShowsReplace = !c.readOnly
                nav.showFind = true
                page.findFocusToken = UUID()
            }
            if c.canMoveToFolder {
                add(String(localized: "Move to folder…"), "folder") {
                    page.dialog = .move(ids: [id], title: title, current: .some(editor.document?.folderId))
                }
            }
            add(String(localized: "Move to page…"), "arrow.turn.down.right", disabled: !c.canManage) { page.movePageOpen = true }
            sep()
            add(String(localized: "Export as Markdown"), "doc.text") { ExportService.exportPage(.markdown, editor: editor) }
            add(String(localized: "Export as HTML"), "chevron.left.forwardslash.chevron.right") { ExportService.exportPage(.html, editor: editor) }
            add(String(localized: "Export as PDF (print)"), "printer") { ExportService.exportPage(.pdf, editor: editor) }
            sep()
            add(String(localized: "Duplicate"), "doc.on.doc") {
                app.perform("duplicate") { session in
                    let copy = try await session.documents.duplicate(id, asTemplate: false)
                    await session.engine.storeDocuments([copy])
                    await MainActor.run { nav.open(copy.id) }
                }
            }
            if !c.isTemplate {
                add(String(localized: "Save as template"), "rectangle.on.rectangle") {
                    act(app, String(localized: "Saved to Templates")) { session in
                        let copy = try await session.documents.duplicate(id, asTemplate: true)
                        await session.engine.storeDocuments([copy])
                    }
                }
            }
            if c.archived {
                add(String(localized: "Unarchive"), "archivebox.circle") {
                    act(app, String(localized: "Moved out of Archive")) { try await $0.documents.setArchived(id, false) }
                }
            } else {
                add(String(localized: "Archive"), "archivebox", disabled: !c.canManage) {
                    act(app, String(localized: "Archived"), undo: { try await $0.documents.setArchived(id, false) }) { try await $0.documents.setArchived(id, true) }
                }
            }
            add(String(localized: "Move to Trash"), "trash", danger: true, disabled: !c.canManage) {
                act(app, String(localized: "Moved to Trash"), undo: { try await $0.documents.restoreFromTrash(id) }) { try await $0.documents.moveToTrash(id) }
            }
        }
        // Following or muting this note's comment notifications.
        let notify = notifyItems(editor.comments)
        if !notify.isEmpty {
            sep()
            out += notify.map { .item($0) }
        }
        return out
    }

    /// The comment-notification items (useNoteNotifyItems on the web).
    static func notifyItems(_ comments: NoteComments) -> [PageMenuItem] {
        guard let sub = comments.subscription else { return [] }
        var out: [PageMenuItem] = []
        if !sub.isAuthor {
            if sub.mode == "follow" {
                out.append(PageMenuItem(label: String(localized: "Unfollow comments"), systemImage: "bell.badge.slash") {
                    comments.setNotifyMode("default", message: String(localized: "You'll hear about replies and @mentions only"))
                })
            } else {
                out.append(PageMenuItem(label: String(localized: "Follow comments"), systemImage: "bell.badge") {
                    comments.setNotifyMode("follow", message: String(localized: "You'll hear about every comment on this note"))
                })
            }
        }
        if sub.mode == "mute" {
            out.append(PageMenuItem(label: String(localized: "Unmute comment notifications"), systemImage: "bell") {
                comments.setNotifyMode("default", message: String(localized: "Comment notifications are on again"))
            })
        } else {
            out.append(PageMenuItem(label: String(localized: "Mute comment notifications"), systemImage: "bell.slash") {
                comments.setNotifyMode("mute", message: String(localized: "Muted. You'll still hear when someone @mentions you."))
            })
        }
        return out
    }

    /// Runs a page action online, then shows its message (with Undo when it has one), or the error.
    private static func act(_ app: AppModel, _ message: String, undo: (@Sendable (SessionContext) async throws -> Void)? = nil,
                            _ action: @escaping @Sendable (SessionContext) async throws -> Void) {
        guard let session = app.session else { return }
        Task {
            do {
                try await action(session)
                await session.engine.syncNow()
                let undoAction: ToastAction? = undo.map { u in
                    .undo {
                        Task {
                            do {
                                try await u(session)
                                await session.engine.syncNow()
                            } catch {
                                app.showToast(ConvexService.mapError(error).localizedDescription)
                            }
                        }
                    }
                }
                app.showToast(message, action: undoAction)
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}

// MARK: - Menu list

/// A menu drawn like the web's (ui-pop, ui-menu-item rows: icon, label, shortcut; danger rows in red).
struct PageMenuList: View {
    var entries: [PageMenuEntry]
    var onPick: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(entries) { entry in
                switch entry {
                case .separator:
                    FoleviColor.line.frame(height: 1).padding(.horizontal, 8).padding(.vertical, 6)
                case .item(let item):
                    PageMenuRow(item: item) {
                        onPick()
                        item.run()
                    }
                }
            }
        }
        .padding(6)
        .frame(minWidth: 224)
        .fixedSize()
    }
}

private struct PageMenuRow: View {
    var item: PageMenuItem
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9.6) {
                Image(systemName: item.systemImage)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(item.danger ? FoleviColor.destructive : FoleviColor.inkMuted)
                    .frame(width: 16)
                Text(item.label)
                    .font(.ui(13.5))
                    .foregroundStyle(item.danger ? FoleviColor.destructive : hovering ? FoleviColor.heading : FoleviColor.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let shortcut = item.shortcut {
                    Text(shortcut).font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                }
            }
            .padding(.horizontal, 9.6)
            .frame(minHeight: 32)
            .background(hovering && !item.disabled ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.disabled)
        .opacity(item.disabled ? 0.4 : 1)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text(item.label))
    }
}

// MARK: - Glass pop surface

extension View {
    /// `.ui-pop`: strong glass (glass-pop over a blur) with the glass edge and the pop shadow; solid under
    /// Reduce Transparency.
    func foleviGlassPop(radius: CGFloat) -> some View { modifier(GlassPop(radius: radius)) }
}

private struct GlassPop: ViewModifier {
    var radius: CGFloat
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if reduceTransparency {
            content.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(radius), shadow: FoleviShadow.pop)
        } else {
            content
                .background(FoleviGlass.pop, in: shape)
                .background(.regularMaterial, in: shape)
                .overlay(shape.strokeBorder(FoleviGlass.border))
                .foleviShadow(FoleviShadow.pop, radius: radius)
        }
    }
}
