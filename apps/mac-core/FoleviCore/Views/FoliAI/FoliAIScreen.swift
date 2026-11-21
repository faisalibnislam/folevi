// Foli AI: the conversations (pinned, then recent, searchable) beside one conversation. Answers stream in as
// they're written, with the notes and web pages they cite, suggested follow-ups, actions Foli AI proposes
// (write a note, add tasks), agent runs to approve or undo, and memories to keep. The composer picks the mode
// (Auto, Ask, Agent, Research), web search and what Foli AI looks at (the space, the open note, a folder).
// Also the note's inspector: the same chat about the note on screen.
import AppKit
import FoleviDesign
import FoleviEngine
import SwiftUI

struct FoliAIScreen: View {
    let window: WindowModel
    let conversation: String?
    private var app: AppModel { .shared }
    @State private var list = Live<Views.AiConversations>()
    @State private var search = ""

    var body: some View {
        HSplitView {
            conversations.frame(minWidth: 220, idealWidth: 260, maxWidth: 340)
            ChatView(window: window, conversationId: conversation, context: nil) { id in
                window.replaceCurrent(.foliAI(id))
            }
            .frame(minWidth: 420)
        }
        .task(id: search) { list.bind(app.client, Views.AiConversations(ChatConversationsArgs(space: nil, search: search.isEmpty ? nil : search))) }
        .toolbar {
            ToolbarItem(placement: .secondaryAction) {
                Button { window.go(.foliAI(nil)) } label: { Label("New Chat", systemImage: "plus.bubble") }.help("New Chat")
            }
        }
    }

    private var conversations: some View {
        List(selection: Binding(get: { conversation }, set: { if let id = $0 { window.replaceCurrent(.foliAI(id)) } })) {
            if let v = list.value {
                if !v.pinned.isEmpty { Section("Pinned") { ForEach(v.pinned, id: \.id, content: row) } }
                Section("Recent") {
                    ForEach(v.recent, id: \.id, content: row)
                    if v.recent.isEmpty && v.pinned.isEmpty { Text("No chats yet").foregroundStyle(.secondary) }
                }
            }
        }
        .listStyle(.sidebar)
        .searchable(text: $search, placement: .sidebar, prompt: "Search Chats")
    }

    private func row(_ c: ChatConversationRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(c.title.nonEmpty ?? "New chat").lineLimit(1)
                if c.shared { Image(systemName: "person.2.fill").font(.caption2).foregroundStyle(.secondary) }
            }
            Text(CoreDates.short(c.lastMessageAt)).font(.caption).foregroundStyle(.secondary)
        }
        .tag(c.id)
        .contextMenu {
            Button(c.pinned ? "Unpin" : "Pin") { app.perform { _ = try await $0.command(Commands.AiPin(ChatPinArgs(conversationId: c.id, pinned: !c.pinned))) } }
            Button("Rename…") { ChatActions.rename(c.id, current: c.title) }
            Button("Save as Note") { ChatActions.saveAsNote(c.id, window: window) }
            Button("Export as Markdown…") { ChatActions.export(c.id) }
            Divider()
            Button("Delete Chat", role: .destructive) {
                app.perform { _ = try await $0.command(Commands.AiRemove(ChatConversationArgs(conversationId: c.id, web: nil))) }
                if conversation == c.id { window.replaceCurrent(.foliAI(nil)) }
            }
        }
    }
}

/// One conversation and its composer. `context` (the inspector): what Foli AI looks at.
struct ChatView: View {
    let window: WindowModel
    let conversationId: String?
    let context: ChatContextArgs?
    var onStarted: (String) -> Void = { _ in }
    private var app: AppModel { .shared }
    @State private var conversation = Live<Views.AiConversation>()
    @State private var caps = Live<Views.AiCapabilities>()
    @State private var draft = ""
    @State private var mode: ChatSendArgs.Mode = .auto
    @State private var web = false
    @State private var sending = false
    @FocusState private var composing: Bool

    var body: some View {
        VStack(spacing: 0) {
            if let c = caps.value, !c.available {
                EmptyScreen(symbol: "sparkles", title: "Foli AI Isn't Available", message: c.unavailable ?? "Foli AI isn't set up for this account.")
            } else {
                messages
                composer
            }
        }
        .task(id: conversationId) {
            caps.bind(app.client, Views.AiCapabilities())
            if let id = conversationId { conversation.bind(app.client, Views.AiConversation(ChatConversationArgs(conversationId: id, web: nil))) } else { conversation.cancel() }
            composing = true
        }
    }

    private var messages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    if conversationId == nil || (conversation.value?.messages ?? []).isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            AiMarkGlyph(size: 34).foregroundStyle(.secondary)
                            Text(context == nil ? "Ask Foli AI about your notes" : "Ask about this note").font(CoreType.screenTitle(24))
                            Text("Foli AI answers from your notes and shows where each answer comes from. It can also write notes, add tasks and research the web.").foregroundStyle(.secondary)
                        }
                        .padding(.top, 40)
                    }
                    ForEach(conversation.value?.messages ?? [], id: \.id) { m in
                        MessageView(message: m, conversationId: conversationId ?? "", window: window)
                            .id(m.id)
                    }
                }
                .padding(24)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: conversation.value?.messages.last?.text) {
                if let last = conversation.value?.messages.last?.id { proxy.scrollTo(last, anchor: .bottom) }
            }
        }
    }

    private var live: ChatMessage? { conversation.value?.messages.last(where: { $0.live }) }

    private var composer: some View {
        VStack(spacing: 8) {
            if let suggestions = conversation.value?.messages.last?.suggestions, !suggestions.isEmpty, live == nil {
                ScrollView(.horizontal) {
                    HStack {
                        ForEach(suggestions, id: \.self) { s in
                            Button(s) { send(s) }.buttonStyle(.bordered).controlSize(.small)
                        }
                    }
                }
                .scrollIndicators(.never)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(context == nil ? "Ask Foli AI" : "Ask about this note", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...8)
                    .focused($composing)
                    .onSubmit { send(draft) }
                    .padding(.vertical, 6)
                if let live {
                    Button {
                        app.perform { _ = try await $0.command(Commands.AiStop(ChatMessageArgs(messageId: live.id))) }
                    } label: { Image(systemName: "stop.circle.fill").font(.title2) }
                        .buttonStyle(.plain)
                        .help("Stop")
                        .keyboardShortcut(".", modifiers: .command)
                } else if !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    // Send shows only once there's something to send (the owner's rule: hidden, not faded).
                    Button { send(draft) } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                        .buttonStyle(.plain)
                        .foregroundStyle(Color.foleviInk)
                        .help("Send (Return)")
                        .disabled(sending)
                }
            }
            HStack(spacing: 12) {
                Picker("Mode", selection: $mode) {
                    Text("Auto").tag(ChatSendArgs.Mode.auto)
                    Text("Ask").tag(ChatSendArgs.Mode.ask)
                    if caps.value?.agent == true { Text("Agent").tag(ChatSendArgs.Mode.agent) }
                    if caps.value?.webResearch == true { Text("Research").tag(ChatSendArgs.Mode.research) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                if caps.value?.webResearch == true {
                    Toggle(isOn: $web) { Label("Web", systemImage: "globe") }.toggleStyle(.button).help("Search the web too")
                }
                Spacer()
                if let credits = caps.value?.credits, !credits.included {
                    Text("\(credits.available) credits").font(.caption).foregroundStyle(credits.low ? .orange : .secondary)
                }
            }
            .controlSize(.small)
        }
        .padding(12)
        .background(.background.secondary, in: .rect(cornerRadius: 16))
        .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(.separator) }
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
        .frame(maxWidth: 800)
        .frame(maxWidth: .infinity)
    }

    private func send(_ text: String) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, !sending else { return }
        draft = ""
        sending = true
        let args = ChatSendArgs(conversationId: conversationId, text: clean, space: nil, context: context, web: web, attachments: nil, mode: mode)
        Task { @MainActor in
            defer { sending = false }
            do {
                guard let client = app.client else { return }
                let r = try await client.command(Commands.AiSend(args))
                if conversationId != r.conversationId {
                    conversation.bind(client, Views.AiConversation(ChatConversationArgs(conversationId: r.conversationId, web: nil)))
                    onStarted(r.conversationId)
                }
            } catch let f as EngineFailure {
                draft = clean
                app.toast(f.message, tone: .error)
            } catch {
                draft = clean
            }
        }
    }
}

/// One message: the person's question, or Foli AI's answer with its sources and what it offers to do.
struct MessageView: View {
    let message: ChatMessage
    let conversationId: String
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var stream = Live<Views.AiStream>()

    private var text: String {
        if message.live, let t = stream.value?.text { return t }
        return message.text
    }

    var body: some View {
        if message.role == .user {
            HStack {
                Spacer(minLength: 80)
                Text(message.text)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(Color.foleviInk.opacity(0.14), in: .rect(cornerRadius: 14))
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                if message.live && text.isEmpty {
                    HStack(spacing: 8) { ProgressView().controlSize(.small); Text(message.phase ?? "Working on it…").foregroundStyle(.secondary) }
                }
                if !text.isEmpty {
                    Text(markdown(text))
                        .font(CoreType.noteText(15))
                        .lineSpacing(3)
                        .textSelection(.enabled)
                }
                if let e = message.error { Label(e.message, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
                if !message.agentSteps.isEmpty {
                    HStack { ForEach(message.agentSteps, id: \.tool) { s in Label("\(s.tool) ×\(s.count)", systemImage: s.ok ? "checkmark" : "xmark").font(.caption).foregroundStyle(.secondary) } }
                }
                if !message.citations.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(message.citations, id: \.n) { c in
                            Button { window.go(.note(c.noteId)) } label: { Label("\(c.n). \(c.title.nonEmpty ?? "Untitled")", systemImage: "doc.text") }
                                .buttonStyle(.bordered).controlSize(.small)
                        }
                        ForEach(message.webCitations, id: \.n) { c in
                            Link(destination: URL(string: c.url) ?? URL(string: "https://folevi.com")!) { Label("\(c.n). \(c.domain)", systemImage: "globe") }
                                .buttonStyle(.bordered).controlSize(.small)
                        }
                    }
                }
                if !message.actions.isEmpty, message.actionsOutcome == nil {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(message.actions, id: \.title) { a in Label(a.title, systemImage: "wand.and.stars").font(.callout) }
                        HStack {
                            Button("Do It") { app.perform { _ = try await $0.command(Commands.AiActions(ChatActionsArgs(conversationId: conversationId, messageId: message.id, apply: true))) } }
                                .buttonStyle(.borderedProminent)
                            Button("No Thanks") { app.perform { _ = try await $0.command(Commands.AiActions(ChatActionsArgs(conversationId: conversationId, messageId: message.id, apply: false))) } }
                        }
                        .controlSize(.small)
                    }
                    .padding(12)
                    .background(.fill.quinary, in: .rect(cornerRadius: 10))
                } else if let outcome = message.actionsOutcome {
                    Text(outcome).font(.caption).foregroundStyle(.secondary)
                }
                if let run = message.agentRun { AgentRunView(run: run) }
                if let memory = message.memory, memory.status == "offered" {
                    HStack {
                        Label("Remember: \(memory.text)", systemImage: "brain").font(.callout)
                        Spacer()
                        Button("Keep") { app.perform { _ = try await $0.command(Commands.AiMemory(ChatMemoryArgs(messageId: message.id, save: true))) } }
                        Button("Don't") { app.perform { _ = try await $0.command(Commands.AiMemory(ChatMemoryArgs(messageId: message.id, save: false))) } }
                    }
                    .controlSize(.small)
                    .padding(10)
                    .background(.fill.quinary, in: .rect(cornerRadius: 10))
                }
                if !message.live && !text.isEmpty {
                    HStack(spacing: 14) {
                        Button { copy(text) } label: { Image(systemName: "doc.on.doc") }.help("Copy")
                        Button { ChatActions.saveAsNote(conversationId, message: message.id, window: window) } label: { Image(systemName: "square.and.arrow.down") }.help("Save as Note")
                        Button { app.perform { _ = try await $0.command(Commands.AiRegenerate(ChatConversationArgs(conversationId: conversationId, web: nil))) } } label: { Image(systemName: "arrow.clockwise") }.help("Try Again")
                        if let credits = message.credits, credits > 0 { Text("\(credits) credits").font(.caption2).foregroundStyle(.tertiary) }
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
                }
            }
            .task(id: message.live) {
                if message.live { stream.bind(app.client, Views.AiStream(ChatStreamArgs(messageId: message.id))) } else { stream.cancel() }
            }
        }
    }

    private func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }

    private func copy(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
    }
}

/// An agent run: the changes Foli AI wants to make to notes, to approve one by one or all, and undo after.
struct AgentRunView: View {
    let run: ChatAgentRun
    private var app: AppModel { .shared }
    @State private var picked: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(run.status == "pending" ? "Foli AI wants to make these changes" : "Changes", systemImage: "wand.and.stars").font(.headline)
            ForEach(run.operations, id: \.id) { op in
                HStack(alignment: .top) {
                    if run.status == "pending" {
                        Toggle("", isOn: Binding(get: { picked.contains(op.id) }, set: { if $0 { picked.insert(op.id) } else { picked.remove(op.id) } })).toggleStyle(.checkbox).labelsHidden()
                    } else {
                        Image(systemName: op.status == "done" ? "checkmark.circle.fill" : op.status == "undone" ? "arrow.uturn.backward.circle" : "circle").foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading) {
                        Text(op.summary)
                        if let t = op.noteTitle { Text(t).font(.caption).foregroundStyle(.secondary) }
                        if let e = op.error { Text(e).font(.caption).foregroundStyle(.red) }
                    }
                }
            }
            HStack {
                if run.status == "pending" {
                    Button("Apply \(picked.isEmpty ? "All" : "\(picked.count)")") {
                        let ids = picked.isEmpty ? run.operations.map(\.id) : Array(picked)
                        app.perform { _ = try await $0.command(Commands.AiAgentApprove(AgentApproveArgs(runId: run.id, operationIds: ids))) }
                    }
                    .buttonStyle(.borderedProminent)
                    Button("Discard") { app.perform { _ = try await $0.command(Commands.AiAgentDiscard(AgentRunArgs(runId: run.id))) } }
                } else if run.status == "done" || run.status == "applied" {
                    Button("Undo Changes") { app.perform { _ = try await $0.command(Commands.AiAgentUndo(AgentUndoArgs(runId: run.id, force: nil))) } }
                }
            }
            .controlSize(.small)
        }
        .padding(12)
        .background(.fill.quinary, in: .rect(cornerRadius: 10))
        .onAppear { picked = Set(run.operations.map(\.id)) }
    }
}

@MainActor
enum ChatActions {
    static func rename(_ id: String, current: String) {
        let alert = NSAlert()
        alert.messageText = "Rename Chat"
        let field = NSTextField(string: current)
        field.frame = NSRect(x: 0, y: 0, width: 260, height: 24)
        alert.accessoryView = field
        alert.addButton(withTitle: "Rename")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let title = field.stringValue.trimmingCharacters(in: .whitespaces)
        guard !title.isEmpty else { return }
        AppModel.shared.perform { _ = try await $0.command(Commands.AiRename(ChatRenameArgs(conversationId: id, title: title))) }
    }

    static func saveAsNote(_ id: String, message: String? = nil, window: WindowModel) {
        AppModel.shared.perform { client in
            let r = try await client.command(Commands.AiSaveAsNote(ChatSaveArgs(conversationId: id, messageId: message)))
            AppModel.shared.toast("Saved as a note", tone: .success, action: "Open") { window.go(.note(r.id)) }
        }
    }

    static func export(_ id: String) {
        AppModel.shared.perform { client in
            let r = try await client.command(Commands.AiExportMarkdown(ChatSaveArgs(conversationId: id, messageId: nil)))
            _ = await ShellFiles.shared.save(name: r.filename, bytes: Data(r.markdown.utf8), from: NSApp.keyWindow)
        }
    }
}

extension WindowModel {
    /// Changes where the window is without a new history step (a chat started, a tab picked inside a screen).
    func replaceCurrent(_ dest: Destination) {
        replace(with: dest)
    }
}
