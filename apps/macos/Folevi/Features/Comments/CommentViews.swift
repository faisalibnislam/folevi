import AppKit
import SwiftUI

// The web's Comments.tsx on the Mac: one thread (header, comments, composer), the thread card floating
// under a block (opened from its "2 comments" line, the block menu or ⌘⌥M), and the Comments panel in the
// inspector with every thread in the note.

/// One comment thread: header (Comments, "…", resolve, close), the comments, and a composer. With no
/// `thread` yet it's a new thread on `blockId` (the composer creates it). Enter sends, Shift+Enter adds a
/// line, Escape closes.
struct CommentThreadCard: View {
    var comments: NoteComments
    var thread: CommentsData.Thread?
    var blockId: String?
    /// Other threads on the same block (for the "1 of 2" switcher).
    var siblings: [CommentsData.Thread] = []
    /// Shown inside the Comments panel rather than floating over the note.
    var embedded = false
    var autoFocus = true
    var onClose: () -> Void

    @State private var draft = ""
    @State private var picked: [MentionPerson] = []
    @State private var editing: String?
    @State private var editDraft = ""
    @State private var editPicked: [MentionPerson] = []
    @State private var confirmDelete = false
    @State private var showResolved = false
    @State private var focusToken = 0

    private var canComment: Bool { comments.data?.canComment ?? false }
    private var resolved: Bool { thread?.isResolved ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(FoleviColor.line.opacity(0.7))
            if confirmDelete, let thread { deleteConfirmation(thread) }
            if let thread {
                if resolved && !showResolved {
                    resolvedSummary(thread)
                } else {
                    commentList(thread)
                }
            }
            if canComment && !resolved {
                composer
            } else if !canComment && thread == nil {
                Text("You can read comments on this note but not add them.")
                    .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                    .padding(.horizontal, 16).padding(.vertical, 12)
            }
        }
        .onAppear {
            if let thread { comments.markReadIfNeeded(thread) }
            if autoFocus && canComment && !resolved { focusToken += 1 }
            Task { await comments.loadPeople() }
        }
        .onChange(of: thread?.id) { _, _ in
            showResolved = false
            confirmDelete = false
            if let thread { comments.markReadIfNeeded(thread) }
        }
        .onChange(of: thread?.lastActivityAt) { _, _ in if let thread { comments.markReadIfNeeded(thread) } }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(embedded ? "Thread" : "Comments"))
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 2) {
            VStack(alignment: .leading, spacing: 1) {
                Text(embedded ? "Thread" : "Comments").font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading)
                    .accessibilityAddTraits(.isHeader)
                if thread?.blockExists == false {
                    HStack(spacing: 4) {
                        Image(systemName: "link").font(.system(size: 10)).accessibilityHidden(true)
                        Text("On a deleted block")
                    }
                    .font(.ui(11.5))
                    .foregroundStyle(FoleviColor.inkMuted)
                }
            }
            Spacer(minLength: 4)
            if let thread, siblings.count > 1, let at = siblings.firstIndex(where: { $0.id == thread.id }) {
                HStack(spacing: 0) {
                    IconButton(systemImage: "chevron.left", label: "Previous thread", size: 22) { comments.selectThread(siblings[at - 1].id) }
                        .disabled(at == 0)
                    Text("\(at + 1) of \(siblings.count)").font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).monospacedDigit()
                    IconButton(systemImage: "chevron.right", label: "Next thread", size: 22) { comments.selectThread(siblings[at + 1].id) }
                        .disabled(at == siblings.count - 1)
                }
                .padding(.trailing, 4)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Threads on this block"))
            }
            if let thread, !thread.isPending {
                CollabMenuButton(label: "Thread options", size: 28) { threadMenu(thread) }
                if thread.canResolve {
                    IconButton(systemImage: resolved ? "arrow.uturn.backward" : "checkmark", label: resolved ? "Reopen thread" : "Resolve thread", size: 28,
                               isActive: resolved) {
                        Task { await comments.setResolved(thread.id, !resolved) }
                    }
                }
            }
            if !embedded {
                IconButton(systemImage: "xmark", label: "Close comments", size: 28, action: onClose)
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
    }

    private func threadMenu(_ thread: CommentsData.Thread) -> [CollabMenuItem] {
        var items = [
            CollabMenuItem(title: String(localized: "Copy link to comment"), systemImage: "link") { comments.copyLink(thread.id) },
            CollabMenuItem(title: String(localized: "Mark as unread"), systemImage: "eye.slash") {
                Task { await comments.markUnread(thread) }
                onClose()
            },
        ]
        if thread.canDelete {
            items.append(CollabMenuItem(title: String(localized: "Delete thread"), systemImage: "trash", destructive: true) { confirmDelete = true })
        }
        return items
    }

    private func deleteConfirmation(_ thread: CommentsData.Thread) -> some View {
        HStack(spacing: 8) {
            Text(thread.comments.count == 1 ? "Delete this thread and its comment?" : "Delete this thread and its \(thread.comments.count) comments?")
                .font(.ui(12.5)).foregroundStyle(FoleviColor.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("Cancel") { confirmDelete = false }.buttonStyle(.folevi(.quiet, .small))
            Button("Delete") {
                confirmDelete = false
                Task { await comments.deleteThread(thread.id) }
                onClose()
            }
            .buttonStyle(.folevi(.danger, .small))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(FoleviColor.destructiveSoft.opacity(0.4))
        .accessibilityElement(children: .contain)
    }

    private func resolvedSummary(_ thread: CommentsData.Thread) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(FoleviColor.heading)
            Text(resolvedText(thread)).font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                showResolved = true
            } label: {
                Label(thread.comments.count == 1 ? "Show comment" : "Show \(thread.comments.count) comments", systemImage: "eye")
                    .font(.ui(12.5, .medium))
            }
            .buttonStyle(.folevi(.quiet, .small))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func resolvedText(_ thread: CommentsData.Thread) -> String {
        var s = String(localized: "Resolved")
        if let by = thread.resolvedBy { s += " " + String(localized: "by \(by)") }
        if let at = thread.resolvedAt { s += " · " + CollabTime.relative(at) }
        return s
    }

    // MARK: Comments

    private func commentList(_ thread: CommentsData.Thread) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(thread.comments) { c in
                        CommentRowView(comment: c, comments: comments, editing: editing == c.id, editDraft: $editDraft, editPicked: $editPicked,
                                       onEdit: {
                                           editDraft = CommentText.editableText(c.body)
                                           editPicked = []
                                           editing = c.id
                                       },
                                       onCancel: { editing = nil },
                                       onSave: { saveEdit(c.id) })
                            .id(c.id)
                    }
                }
                .padding(.vertical, 4)
            }
            .frame(maxHeight: embedded ? .infinity : 340)
            .fixedSize(horizontal: false, vertical: true)
            .onAppear { proxy.scrollTo(thread.comments.last?.id, anchor: .bottom) }
            .onChange(of: thread.comments.count) { _, _ in proxy.scrollTo(thread.comments.last?.id, anchor: .bottom) }
            .accessibilityLabel(Text("Comments in this thread"))
        }
    }

    private func saveEdit(_ id: String) {
        let text = editDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let picked = editPicked
        editing = nil
        Task { await comments.edit(id, text: text, picked: picked) }
    }

    // MARK: Composer

    private var composer: some View {
        VStack(spacing: 0) {
            Divider().overlay(FoleviColor.line.opacity(0.7))
            HStack(alignment: .bottom, spacing: 6) {
                MentionField(text: $draft, picked: $picked, people: comments.people,
                             placeholder: thread == nil ? String(localized: "Type your comment") : String(localized: "Reply"),
                             accessibilityLabel: thread == nil ? (blockId == nil ? String(localized: "Comment on this document") : String(localized: "Comment on this block")) : String(localized: "Reply"),
                             focusToken: focusToken, onSubmit: send, onEscape: embedded ? nil : onClose)
                    .padding(.vertical, 4)
                Button(action: send) {
                    Image(systemName: "arrow.up").font(.system(size: 13, weight: .bold))
                        .foregroundStyle(FoleviColor.accentInk)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(FoleviColor.accent))
                }
                .buttonStyle(.plain)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1)
                .help(Text("Send"))
                .accessibilityLabel(Text("Send"))
            }
            .padding(.leading, 16)
            .padding(.trailing, 8)
            .padding(.vertical, 6)
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let picked = self.picked
        draft = ""
        self.picked = []
        let threadId = thread?.id
        Task {
            let ok = await comments.send(text, picked: picked, threadId: threadId, blockId: blockId)
            if !ok { draft = text }
        }
    }
}

/// One comment: avatar, name · time · edited, the text (or its editor), and Edit / Delete on hover.
struct CommentRowView: View {
    var comment: CommentsData.Comment
    var comments: NoteComments
    var editing: Bool
    @Binding var editDraft: String
    @Binding var editPicked: [MentionPerson]
    var onEdit: () -> Void
    var onCancel: () -> Void
    var onSave: () -> Void
    @State private var hover = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            CollabAvatar(name: comment.authorName, url: comment.authorAvatarUrl, size: 24).padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(comment.authorName).font(.ui(12.5, .semibold)).foregroundStyle(FoleviColor.heading).lineLimit(1)
                    Text(meta).font(.ui(12.5)).foregroundStyle(FoleviColor.inkFaint).lineLimit(1).layoutPriority(1)
                }
                .padding(.trailing, 26)
                if editing {
                    VStack(alignment: .trailing, spacing: 6) {
                        MentionField(text: $editDraft, picked: $editPicked, people: comments.people, placeholder: "",
                                     accessibilityLabel: String(localized: "Edit comment"), focusToken: 0, focusOnAppear: true,
                                     onSubmit: onSave, onEscape: onCancel)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .foleviSurface(.color(FoleviColor.surface), shape: .rounded(6),
                                           shadow: [FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.line, inset: false)])
                        HStack(spacing: 6) {
                            Button("Cancel", action: onCancel).buttonStyle(.folevi(.quiet, .small))
                            Button("Save", action: onSave).buttonStyle(.folevi(.primary, .small))
                                .disabled(editDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                    .padding(.top, 2)
                } else if comment.deleted {
                    Text("Comment deleted").font(.ui(13.5)).italic().foregroundStyle(FoleviColor.inkFaint)
                } else {
                    commentBodyText(comment.body)
                        .font(.ui(13.5))
                        .foregroundStyle(FoleviColor.ink)
                        .lineSpacing(2)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .opacity(comment.isPending ? 0.6 : 1)
        .overlay(alignment: .topTrailing) {
            if !items.isEmpty && !editing && !comment.isPending {
                CollabMenuButton(label: "Options for \(comment.authorName)'s comment", size: 24) { items }
                    .opacity(hover ? 1 : 0)
                    .padding(.trailing, 8)
                    .padding(.top, 5)
            }
        }
        .contentShape(Rectangle())
        .onHover { hover = $0 }
        .accessibilityElement(children: .contain)
    }

    private var meta: String {
        var s = "· " + (comment.isPending ? String(localized: "Sending…") : CollabTime.relative(comment.createdAt))
        if comment.editedAt != nil && !comment.deleted { s += " · " + String(localized: "edited") }
        return s
    }

    private var items: [CollabMenuItem] {
        var out: [CollabMenuItem] = []
        if comment.canEdit { out.append(CollabMenuItem(title: String(localized: "Edit"), action: onEdit)) }
        if comment.canDelete {
            let id = comment.id
            out.append(CollabMenuItem(title: String(localized: "Delete"), destructive: true) { Task { await comments.remove(id) } })
        }
        return out
    }
}

// MARK: - Under a block

/// The thread card floating under a block: the chosen thread, else the block's latest open one, else a new thread.
struct BlockThreadPopover: View {
    var comments: NoteComments
    var blockId: String
    /// Closing puts the keyboard back in the block's text.
    var onClose: (() -> Void)?

    var body: some View {
        let data = comments.data ?? .empty
        let thread = data.threadToShow(onBlock: blockId, chosen: comments.openThreadId)
        CommentThreadCard(comments: comments, thread: thread, blockId: blockId,
                          siblings: data.siblings(onBlock: blockId, showing: thread), onClose: {
                              comments.closeThread()
                              onClose?()
                          })
            .id(thread?.id ?? "new")
            .frame(width: 360)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .foleviPop(radius: 14)
            .onAppear {
                // Stay on the thread being shown (so resolving it shows it resolved rather than switching away).
                if comments.openThreadId == nil, let thread, !thread.isPending { comments.selectThread(thread.id) }
            }
    }
}

/// The "2 comments · 8:18 AM" line under a commented block, and its thread card floating just under the
/// block (and its comment line), scrolling with the text, as on the web. Clicking elsewhere in the note
/// closes it.
struct BlockCommentsModifier: ViewModifier {
    var model: EditorModel
    var row: EditorRow
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let comments = model.comments
        let summary = comments.data?.summary(for: row.id)
        let open = comments.openBlockId == row.id
        let blockLeft = BlockMetrics.gutter + CGFloat(row.depth) * BlockMetrics.indent(CGFloat(app.editorScale))
        VStack(alignment: .leading, spacing: 0) {
            content
            if let summary {
                BlockCommentLine(summary: summary, isOpen: open, accent: Color.folevi(accent: model.style.accent),
                                 accentSoft: Color.folevi(accentSoft: model.style.accent)) {
                    if open || comments.justDismissed(row.id) { comments.closeThread() } else { comments.openBlock(row.id) }
                }
                .padding(.leading, blockLeft + listPad)
                .padding(.bottom, 4)
            }
        }
        .overlay(alignment: .bottomLeading) {
            if open {
                BlockThreadPopover(comments: comments, blockId: row.id) {
                    if model.blocks[row.id]?.content.carriesText == true {
                        model.focus = FocusRequest(blockId: row.id, caret: .end)
                    }
                }
                .background(OutsideClickWatcher(reveals: true) { comments.dismissFromOutside() })
                .padding(.leading, max(12, blockLeft - 4))
                .alignmentGuide(.bottom) { d in d[.top] - 6 }
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 4)))
            }
        }
    }

    private var listPad: CGFloat {
        switch row.block.content {
        case .bulleted, .numbered, .todo: return BlockMetrics.indent(CGFloat(app.editorScale))
        default: return 0
        }
    }
}

/// Opens the inspector's Comments panel when the note asks for it (a thread on the whole note or a deleted
/// block, a link, ⌘⌥M off a block).
private struct CommentsPanelOpener: ViewModifier {
    var editor: EditorModel?
    var nav: NavigationModel

    private struct Request: Equatable {
        var documentId: String
        var count: Int
    }

    func body(content: Content) -> some View {
        content.onChange(of: editor.map { Request(documentId: $0.documentId, count: $0.comments.panelRequest) }) { old, new in
            guard let old, let new, old.documentId == new.documentId, new.count > old.count else { return }
            nav.inspectorTab = .comments
            nav.showInspector = true
        }
    }
}

extension View {
    func opensCommentsPanel(editor: EditorModel?, nav: NavigationModel) -> some View {
        modifier(CommentsPanelOpener(editor: editor, nav: nav))
    }

    /// Adds a block's comment line and thread card (Features/Comments).
    func blockComments(model: EditorModel, row: EditorRow) -> some View {
        modifier(BlockCommentsModifier(model: model, row: row))
    }
}

struct BlockCommentLine: View {
    var summary: CommentsData.BlockSummary
    var isOpen: Bool
    var accent: Color
    var accentSoft: Color
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        let label = CollabTime.commentLineLabel(count: summary.comments, lastActivityAt: summary.lastActivityAt)
        Button(action: action) {
            HStack(spacing: 6) {
                HStack(spacing: -4) {
                    ForEach(Array(summary.authors.prefix(3).enumerated()), id: \.offset) { _, a in
                        CollabAvatar(name: a.name, url: a.avatarUrl, size: 16)
                            .overlay(Circle().strokeBorder(FoleviColor.surface, lineWidth: 1.5))
                    }
                }
                Text(label).font(.ui(12, .medium))
                if summary.unread { Circle().fill(accent).frame(width: 6, height: 6) }
            }
            .foregroundStyle(hover || isOpen ? FoleviColor.heading : FoleviColor.inkMuted)
            .padding(.leading, 3)
            .padding(.trailing, 8)
            .frame(height: 22)
            .background(Capsule().fill(hover || isOpen ? accentSoft : .clear))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityLabel(Text("\(label)\(summary.unread ? String(localized: ", unread") : ""). Open comments"))
        .accessibilityAddTraits(isOpen ? .isSelected : [])
    }
}

// MARK: - The Comments panel (inspector)

/// Every thread in the note (open or resolved), plus a comment on the whole note. Choosing a thread on a
/// block jumps there and opens it; threads on the whole note or a deleted block open right here.
struct CommentsPanel: View {
    @Bindable var model: EditorModel
    @Environment(AppModel.self) private var app
    @State private var filter = "open"
    @State private var expanded: String?
    @State private var draft = ""
    @State private var picked: [MentionPerson] = []

    private var comments: NoteComments { model.comments }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !app.sync.isOnline && comments.data == nil {
                Text("Comments are available when you're online.").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
            } else if let data = comments.data {
                content(data)
            } else {
                Text("Loading comments…").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
            }
        }
        .onAppear {
            comments.start()
            focusRequested()
        }
        .onChange(of: comments.panelRequest) { _, _ in focusRequested() }
        .onChange(of: comments.data == nil) { _, _ in focusRequested() }
    }

    /// A thread asked for from outside (a link, a thread whose block is gone): open it once it's loaded.
    private func focusRequested() {
        guard let id = comments.panelThreadId, let t = comments.data?.thread(id) else { return }
        expanded = t.id
        filter = t.isResolved ? "resolved" : "open"
    }

    @ViewBuilder private func content(_ data: CommentsData) -> some View {
        if data.canComment {
            VStack(alignment: .leading, spacing: 6) {
                MentionField(text: $draft, picked: $picked, people: comments.people, placeholder: String(localized: "Comment on the whole note"),
                             accessibilityLabel: String(localized: "Comment on this document"), focusToken: 0, onSubmit: submit)
                HStack {
                    Text("@ to mention · Enter to send").font(.ui(11.5)).foregroundStyle(FoleviColor.inkFaint)
                    Spacer()
                    Button("Comment", action: submit).buttonStyle(.folevi(.primary, .small))
                        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            // The web's `ui-input`: the surface with a fine line around it.
            .foleviSurface(.color(FoleviColor.surface), shape: .rounded(10),
                           shadow: [FoleviShadowLayer(x: 0, y: 0, blur: 0, spread: 1, color: FoleviColor.line, inset: false)])
            .task { await comments.loadPeople() }
        } else {
            Text("You can read comments on this note but not add them.").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
        }
        let open = data.openThreads, resolved = data.resolvedThreads
        FoleviSegmented(selection: $filter, items: [
            .init(value: "open", title: LocalizedStringKey(open.isEmpty ? String(localized: "Open") : String(localized: "Open · \(open.count)"))),
            .init(value: "resolved", title: LocalizedStringKey(resolved.isEmpty ? String(localized: "Resolved") : String(localized: "Resolved · \(resolved.count)"))),
        ], accessibilityLabel: "Show threads")
        let shown = filter == "open" ? open : resolved
        if shown.isEmpty {
            Text(filter == "open" ? "No open comments." : "No resolved comments.")
                .font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                .frame(maxWidth: .infinity).padding(.vertical, 16)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(shown) { t in threadRow(t) }
            }
        }
        NoteNotifyRow(comments: comments)
    }

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let picked = self.picked
        draft = ""
        self.picked = []
        Task {
            if !(await comments.send(text, picked: picked, threadId: nil, blockId: nil)) { draft = text }
        }
    }

    @ViewBuilder private func threadRow(_ t: CommentsData.Thread) -> some View {
        // Threads that can't float under their block open here (also one whose block is folded away).
        let inline = t.blockId == nil || t.blockExists == false || comments.panelThreadId == t.id
            || !(model.rows.contains { $0.id == t.blockId })
        VStack(alignment: .leading, spacing: 4) {
            ThreadSummaryButton(thread: t, expanded: inline && expanded == t.id) {
                if inline {
                    expanded = expanded == t.id ? nil : t.id
                } else if let blockId = t.blockId {
                    comments.openBlock(blockId, threadId: t.id)
                }
            }
            .disabled(t.isPending)
            if inline && expanded == t.id {
                CommentThreadCard(comments: comments, thread: t, blockId: t.blockId, embedded: true, autoFocus: false) { expanded = nil }
                    .foleviCard(radius: 10)
                    .padding(.horizontal, 2)
                    .padding(.bottom, 4)
            }
        }
    }
}

private struct ThreadSummaryButton: View {
    var thread: CommentsData.Thread
    var expanded: Bool
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        let first = thread.comments.first { !$0.deleted } ?? thread.comments.first
        let replies = thread.comments.count - 1
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                anchor.font(.ui(11.5)).foregroundStyle(FoleviColor.inkFaint).lineLimit(1)
                if let first {
                    HStack(spacing: 8) {
                        CollabAvatar(name: first.authorName, url: first.authorAvatarUrl, size: 20)
                        (Text(first.authorName).font(.ui(12.5, .semibold)).foregroundStyle(FoleviColor.heading)
                            + Text(" · " + CollabTime.relative(thread.lastActivityAt)).font(.ui(12.5)).foregroundStyle(FoleviColor.inkFaint))
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        if thread.unread {
                            Circle().fill(FoleviColor.coral).frame(width: 8, height: 8).accessibilityLabel(Text("Unread"))
                        }
                    }
                    .padding(.top, 6)
                    Group {
                        if first.deleted {
                            Text("Comment deleted").italic().foregroundStyle(FoleviColor.inkFaint)
                        } else {
                            commentBodyText(first.body).foregroundStyle(FoleviColor.ink)
                        }
                    }
                    .font(.ui(13))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .padding(.top, 4)
                }
                if replies > 0 || thread.isResolved {
                    HStack(spacing: 8) {
                        if replies > 0 {
                            Label(replies == 1 ? "1 reply" : "\(replies) replies", systemImage: "arrow.turn.down.right")
                        }
                        if thread.isResolved {
                            Text(thread.resolvedBy.map { String(localized: "Resolved by \($0)") } ?? String(localized: "Resolved"))
                        }
                    }
                    .font(.ui(11.5))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .padding(.top, 4)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(hover || expanded ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityAddTraits(expanded ? .isSelected : [])
    }

    /// What a thread is attached to, in a few words.
    @ViewBuilder private var anchor: some View {
        if thread.blockExists == false {
            Label("On a deleted block", systemImage: "link").italic()
        } else if let text = thread.blockText, !text.isEmpty {
            Text("\u{201C}\(text)\u{201D}")
        } else if thread.blockId != nil {
            Text("On a block")
        } else {
            Text("On the whole note")
        }
    }
}

/// "Notify me about" for one note: All comments, Replies and @mentions, Only @mentions.
struct NoteNotifyRow: View {
    var comments: NoteComments

    var body: some View {
        if let sub = comments.subscription {
            // For the note's creator "default" already means every comment.
            let value = sub.isAuthor && sub.mode == "follow" ? "default" : sub.mode
            let options: [(value: String, title: String)] = sub.isAuthor
                ? [("default", String(localized: "All comments")), ("mute", String(localized: "Only @mentions"))]
                : [("follow", String(localized: "All comments")), ("default", String(localized: "Replies and @mentions")), ("mute", String(localized: "Only @mentions"))]
            VStack(spacing: 0) {
                FoleviColor.line.opacity(0.7).frame(height: 1)
                HStack(spacing: 12) {
                    Text("Notify me about").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                    Spacer()
                    CollabChoiceButton(options: options, selection: Binding(get: { value }, set: { mode in
                        comments.setNotifyMode(mode, message: mode == "mute" ? String(localized: "Comment notifications muted for this note") : String(localized: "Saved"))
                    }), accessibilityLabel: "Notify me about", width: 190)
                }
                .padding(.horizontal, 4)
                .padding(.top, 12)
            }
        }
    }
}

/// "Follow comments" / "Mute comment notifications" for a note's "…" menu (the web's useNoteNotifyItems).
struct NoteNotifyMenuItems: View {
    var comments: NoteComments

    var body: some View {
        if let sub = comments.subscription {
            if !sub.isAuthor {
                if sub.mode == "follow" {
                    Button { comments.setNotifyMode("default", message: String(localized: "You'll hear about replies and @mentions only")) } label: {
                        Label("Unfollow comments", systemImage: "bell.badge.slash")
                    }
                } else {
                    Button { comments.setNotifyMode("follow", message: String(localized: "You'll hear about every comment on this note")) } label: {
                        Label("Follow comments", systemImage: "bell.badge")
                    }
                }
            }
            if sub.mode == "mute" {
                Button { comments.setNotifyMode("default", message: String(localized: "Comment notifications are on again")) } label: {
                    Label("Unmute comment notifications", systemImage: "bell")
                }
            } else {
                Button { comments.setNotifyMode("mute", message: String(localized: "Muted. You'll still hear when someone @mentions you.")) } label: {
                    Label("Mute comment notifications", systemImage: "bell.slash")
                }
            }
        }
    }
}
