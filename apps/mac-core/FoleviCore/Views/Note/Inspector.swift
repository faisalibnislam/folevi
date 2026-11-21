// The note's inspector (⌥⌘0): Foli AI about the note on screen, and the note's info from the page (its outline to
// jump to, the pages inside it, tasks, links, attachments, comments). Native Mac inspector, SF Pro.
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
            Picker("Inspector", selection: $window.inspectorTab) {
                ForEach(WindowModel.InspectorTab.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(10)
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
                        ForEach(t.outline, id: \.id) { item in
                            Button {
                                if let doc = item.documentId, item.kind == .page { window.go(.note(doc)) } else { window.editor(EditorCommands.BlockJump(BlockJumpArgs(blockId: item.id))) }
                            } label: {
                                Text(item.text.nonEmpty ?? "Untitled")
                                    .padding(.leading, CGFloat(max(0, item.level - 1)) * 12)
                                    .fontWeight(item.id == t.current ? .semibold : .regular)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                if !t.pages.isEmpty {
                    Section("Pages") {
                        ForEach(t.pages, id: \.id) { p in
                            Button(p.title.nonEmpty ?? "Untitled") { window.go(.note(p.id)) }
                                .buttonStyle(.plain)
                                .padding(.leading, CGFloat(p.depth) * 12)
                        }
                    }
                }
                if !t.tasks.isEmpty {
                    Section("Tasks") {
                        ForEach(t.tasks, id: \.id) { task in
                            Toggle(isOn: Binding(get: { task.checked }, set: { _ in window.editor(EditorCommands.TaskToggle(TaskToggleArgs(blockId: task.id))) })) {
                                Text(task.text)
                            }
                            .toggleStyle(.checkbox)
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
                            .buttonStyle(.plain)
                        }
                    }
                }
                if !t.attachments.isEmpty {
                    Section("Attachments") {
                        ForEach(t.attachments, id: \.id) { a in
                            Label(a.name, systemImage: a.kind == "image" ? "photo" : a.kind == "audio" ? "waveform" : "paperclip")
                                .foregroundStyle(a.uploading ? .secondary : .primary)
                        }
                    }
                }
                if t.comments.available {
                    Section("Comments") {
                        if t.comments.threads.isEmpty { Text("No comments").foregroundStyle(.secondary) }
                        ForEach(t.comments.threads, id: \.id) { th in
                            Button {
                                window.editor(EditorCommands.ThreadOpen(ThreadOpenArgs(threadId: th.id)))
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(th.author).font(.caption.weight(.semibold))
                                    Text(th.text).lineLimit(3)
                                    if th.replies > 0 { Text("\(th.replies) replies").font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                        Button("Show Comments") { window.panel(.comments) }
                    }
                }
            }
            .listStyle(.sidebar)
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
