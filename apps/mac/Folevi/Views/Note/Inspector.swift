// The note's inspector (⌃⌘I, the system's Show Inspector): Foli AI about the note on screen, and the note's info
// from the page (its outline to jump to, the pages inside it, tasks, links, attachments, comments). Native Mac
// inspector, SF Pro.
import FoleviDesign
import FoleviEngine
import SwiftUI

struct Inspector: View {
    @Bindable var window: WindowModel

    var body: some View {
        VStack(spacing: 0) {
            if window.current.isNote {
                NoteInfo(window: window)
            } else {
                content
            }
        }
    }

    @ViewBuilder private var content: some View {
        VStack(spacing: 0) {
            // The tabs: the system's segmented control, centered at the inspector's top.
            SegmentedChoice(selection: $window.inspectorTab, options: WindowModel.InspectorTab.allCases.map { .init(value: $0, title: $0.title) }, label: "Inspector")
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 10)
            switch window.inspectorTab {
            case .foliAI:
                if let id = window.current.noteId {
                    ChatView(window: window, conversationId: window.noteChat, context: ChatContextArgs(kind: .note, ids: [id])) { window.noteChat = $0 }
                } else {
                    ChatView(window: window, conversationId: window.noteChat, context: nil) { window.noteChat = $0 }
                }
            case .info:
                NoteInfo(window: window)
            }
        }
    }
}

struct NoteInfo: View {
    let window: WindowModel
    @State private var resolved = false

    var body: some View {
        if let t = window.noteTools {
            List {
                if !t.trail.isEmpty {
                    Section("Location") {
                        ForEach(t.trail, id: \.href) { c in
                            Button(c.label) { AppModel.shared.open(path: c.href) }.buttonStyle(InkLinkStyle())
                        }
                    }
                }
                if !t.outline.isEmpty {
                    Section("Outline") {
                        Button { window.editor(EditorCommands.ScrollToTop()) } label: {
                            Text(window.title).fontWeight(.semibold).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.hoverPlain)
                        .help("Back to the top")
                        ForEach(t.outline, id: \.id) { item in
                            Button {
                                if let doc = item.documentId, item.kind == .page { window.go(.note(doc), inNote: true) } else { window.editor(EditorCommands.BlockJump(BlockJumpArgs(blockId: item.id))) }
                            } label: {
                                Text(item.text.nonEmpty ?? "Untitled")
                                    .padding(.leading, CGFloat(max(0, item.level - 1)) * 12)
                                    .fontWeight(item.id == t.current ? .semibold : .regular)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.hoverPlain)
                        }
                    }
                }
                if !t.pages.isEmpty {
                    Section("Pages") {
                        ForEach(t.pages, id: \.id) { p in
                            Button(p.title.nonEmpty ?? "Untitled") { window.go(.note(p.id), inNote: true) }
                                .buttonStyle(.hoverPlain)
                                .padding(.leading, CGFloat(p.depth) * 12)
                        }
                    }
                }
                if !t.tasks.isEmpty {
                    Section("Tasks · \(t.tasks.filter(\.checked).count) of \(t.tasks.count) done") {
                        ForEach(t.tasks, id: \.id) { task in
                            HStack {
                                Toggle(isOn: Binding(get: { task.checked }, set: { _ in window.editor(EditorCommands.TaskToggle(TaskToggleArgs(blockId: task.id))) })) { EmptyView() }
                                    .toggleStyle(.checkbox).labelsHidden()
                                Button { window.editor(EditorCommands.BlockJump(BlockJumpArgs(blockId: task.id))) } label: {
                                    Text(task.text).strikethrough(task.checked).frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.hoverPlain).help("Show in the note")
                            }
                        }
                    }
                }
                if !t.links.isEmpty {
                    Section("Links") {
                        ForEach(t.links, id: \.key) { l in
                            Button {
                                if l.internal { AppModel.shared.open(path: l.href) } else if let u = URL(string: l.href) { NSWorkspace.shared.open(u) }
                            } label: {
                                Label(l.label, systemImage: l.internal ? "doc.text" : "link")
                            }
                            .buttonStyle(.hoverPlain)
                        }
                    }
                }
                if !t.attachments.isEmpty {
                    Section("Attachments") {
                        ForEach(t.attachments, id: \.id) { a in
                            Button { window.editor(EditorCommands.BlockJump(BlockJumpArgs(blockId: a.id))) } label: {
                                Label(a.name + (a.uploading ? " (uploading)" : ""), systemImage: a.kind == "image" ? "photo" : a.kind == "audio" ? "waveform" : "paperclip")
                                    .foregroundStyle(a.uploading ? .secondary : .primary)
                            }
                            .buttonStyle(.hoverPlain).help("Show in the note")
                        }
                    }
                }
                if t.comments.available {
                    Section("Comments") {
                        let open = t.comments.threads.filter { $0.status != .resolved }
                        let done = t.comments.threads.filter { $0.status == .resolved }
                        Picker("", selection: $resolved) {
                            Text("Open · \(open.count)").tag(false)
                            Text("Resolved · \(done.count)").tag(true)
                        }
                        .pickerStyle(.segmented).labelsHidden()
                        let shown = resolved ? done : open
                        if shown.isEmpty { Text(resolved ? "No resolved comments" : "No open comments").foregroundStyle(.secondary) }
                        ForEach(shown, id: \.id) { th in
                            Button {
                                window.editor(EditorCommands.ThreadOpen(ThreadOpenArgs(threadId: th.id)))
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 4) {
                                        if th.unread { Circle().fill(Color.foleviInk).frame(width: 6, height: 6).accessibilityLabel("Unread") }
                                        Text(th.author).font(.caption.weight(.semibold))
                                        Text(AppDates.short(th.lastActivityAt)).font(.caption2).foregroundStyle(.tertiary)
                                    }
                                    Text(th.deleted ? "Deleted" : th.text).lineLimit(3).foregroundStyle(th.deleted ? .secondary : .primary)
                                    if th.replies > 0 { Text("\(th.replies) \(th.replies == 1 ? "reply" : "replies")").font(.caption).foregroundStyle(.secondary) }
                                    if let by = th.resolvedBy { Text("Resolved by \(by)").font(.caption).foregroundStyle(.secondary) }
                                    if let w = th.waiting { Text(w == "failed" ? "Not sent" : "Waiting to send").font(.caption).foregroundStyle(.orange) }
                                }
                            }
                            .buttonStyle(.hoverPlain)
                        }
                        Button("Show Comments") { window.panel(.comments) }
                    }
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        } else {
            EmptyScreen(symbol: "info.circle", title: "No Note Info", message: "Open a note to see its outline, tasks, links and comments.")
        }
    }
}

extension WindowModel {
    /// The inspector's chat about the note (one per window).
    var noteChat: String? {
        get { inspectorChat }
        set { inspectorChat = newValue }
    }
}
