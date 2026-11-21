// Foli AI: the conversations (pinned, then recent, searchable) beside one conversation. Answers stream in as
// they're written, with Markdown and code blocks, linked citations and sources, follow-ups, actions Foli AI
// proposes, agent runs to approve, continue or undo, memories to keep, and research. The composer picks the mode
// (Auto, Ask, Agent, Research), web search and what Foli AI reads (chips: the space, a folder, notes). A floating
// Ask Foli AI panel (⌘J) does the same over any screen but a note (where ⌘J opens the page's own panel).
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
            } deleted: {
                window.replaceCurrent(.foliAI(nil))
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
                    if v.recent.isEmpty && v.pinned.isEmpty { Text(search.isEmpty ? "No chats yet" : "No chats match").foregroundStyle(.secondary) }
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
                if c.shared { Image(systemName: "person.2.fill").font(.caption2).foregroundStyle(.secondary).help("Shared with the workspace") }
            }
            Text(CoreDates.short(c.lastMessageAt)).font(.caption).foregroundStyle(.secondary)
        }
        .tag(c.id)
        .contextMenu {
            ConversationMenu(id: c.id, title: c.title, pinned: c.pinned, shared: c.shared, canShare: false, window: window) {
                if conversation == c.id { window.replaceCurrent(.foliAI(nil)) }
            }
        }
    }
}

/// A conversation's options: the list's context menu and the chat's "…" button.
struct ConversationMenu: View {
    let id: String
    let title: String
    let pinned: Bool
    let shared: Bool
    let canShare: Bool
    let window: WindowModel
    var deleted: () -> Void = {}
    private var app: AppModel { .shared }

    var body: some View {
        Button(pinned ? "Unpin" : "Pin") { app.perform { _ = try await $0.command(Commands.AiPin(ChatPinArgs(conversationId: id, pinned: !pinned))) } }
        Button("Rename…") { ChatActions.rename(id, current: title) }
        Divider()
        Button("Copy as Markdown") { ChatActions.copyMarkdown(id) }
        Button("Export as Markdown…") { ChatActions.export(id) }
        Button("Save as Note") { ChatActions.saveAsNote(id, window: window) }
        if canShare || shared {
            Button(shared ? "Stop Sharing with the Workspace" : "Share with the Workspace…") { ChatActions.share(id, shared: !shared) }
        }
        Divider()
        Button("Delete…", role: .destructive) { ChatActions.delete(id, then: deleted) }
    }
}

/// One conversation and its composer. `context`: what Foli AI reads (the note behind it, a folder).
struct ChatView: View {
    let window: WindowModel
    let conversationId: String?
    let context: ChatContextArgs?
    var onStarted: (String) -> Void = { _ in }
    var deleted: () -> Void = {}
    private var app: AppModel { .shared }
    @State private var conversation = Live<Views.AiConversation>()
    @State private var caps = Live<Views.AiCapabilities>()
    @State private var settings = Live<Views.SettingsAi>()
    @State private var recent = Live<Views.Recent>()
    @State private var draft = ""
    @State private var pending: String?
    @State private var mode: ChatSendArgs.Mode = .auto
    @State private var web = false
    @State private var sending = false
    @State private var chips: [ContextChip] = []
    @State private var atBottom = true
    @FocusState private var composing: Bool

    struct ContextChip: Identifiable, Hashable { let id: String; let kind: ChatContextArgs.Kind; let label: String }

    var body: some View {
        VStack(spacing: 0) {
            if let c = caps.value, !c.available {
                EmptyScreen(symbol: "sparkles", title: "Foli AI Isn't Available", message: c.unavailable ?? "Foli AI isn't set up for this account.", actionTitle: "Open Settings") { SettingsRouter.shared.open("ai") }
            } else {
                if settings.value?.history == false {
                    Label("Chat history is off, so this conversation isn't kept after you leave it.", systemImage: "clock.badge.xmark")
                        .font(.callout).frame(maxWidth: .infinity, alignment: .leading).padding(10).background(.fill.quinary)
                }
                messages
                composer
            }
        }
        .toolbar {
            if let id = conversationId, let info = conversation.value?.conversation {
                ToolbarItem(placement: .secondaryAction) {
                    Menu {
                        ConversationMenu(id: id, title: info.title, pinned: info.pinned, shared: info.shared, canShare: info.canShare, window: window, deleted: deleted)
                    } label: { Label("Conversation Options", systemImage: "ellipsis.circle") }
                    .help("Conversation Options")
                }
            }
        }
        .task(id: conversationId) {
            caps.bind(app.client, Views.AiCapabilities())
            settings.bind(app.client, Views.SettingsAi())
            recent.bind(app.client, Views.Recent(RecentArgs(scope: .place, limit: 5)))
            if let id = conversationId { conversation.bind(app.client, Views.AiConversation(ChatConversationArgs(conversationId: id, web: nil))) } else { conversation.cancel() }
            composing = true
        }
    }

    // MARK: messages

    private var messageList: [ChatMessage] { conversation.value?.messages ?? [] }

    private var messages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    if conversationId != nil, conversation.isLoading, pending == nil {
                        HStack { ProgressView().controlSize(.small); Text("Loading the conversation…").foregroundStyle(.secondary) }
                    } else if conversationId != nil, conversation.value?.found == false, pending == nil {
                        Text("This conversation isn't here anymore. Ask something to start a new one.").foregroundStyle(.secondary)
                    } else if messageList.isEmpty, pending == nil {
                        intro
                    }
                    ForEach(messageList, id: \.id) { m in
                        MessageView(message: m, conversationId: conversationId ?? "", window: window, isLastUser: m.id == lastUserId, isLast: m.id == messageList.last?.id)
                            .id(m.id)
                    }
                    if let pending {
                        UserBubble(text: pending)
                        HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Thinking…").foregroundStyle(.secondary) }
                    }
                    if let id = conversationId { ResearchJobsView(conversationId: id, window: window) }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(24)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .onScrollGeometryChange(for: Bool.self) { g in
                g.contentOffset.y + g.containerSize.height >= g.contentSize.height - 40
            } action: { _, bottom in
                atBottom = bottom
            }
            .onChange(of: messageList.last?.text) { if atBottom { proxy.scrollTo("bottom", anchor: .bottom) } }
            .onChange(of: messageList.count) {
                if messageList.contains(where: { $0.role == .user && $0.text == pending }) { pending = nil }
                proxy.scrollTo("bottom", anchor: .bottom)
            }
            .overlay(alignment: .bottom) {
                if !atBottom && !messageList.isEmpty {
                    Button { withAnimation(.snappy) { proxy.scrollTo("bottom", anchor: .bottom) } } label: { Label("Jump to Latest", systemImage: "arrow.down") }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .glassEffect(.regular.interactive(), in: .capsule)
                        .padding(10)
                }
            }
        }
    }

    private var lastUserId: String? { messageList.last(where: { $0.role == .user })?.id }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 12) {
            AiMarkGlyph(size: 34)
            Text("Foli AI").font(CoreType.screenTitle(26))
            Text(introLead).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 6) {
                Label("Answers from your notes and shows where each answer comes from.", systemImage: "quote.bubble")
                Label("Asks before it changes a note, and you can undo what it did.", systemImage: "arrow.uturn.backward")
                Label(app.session.value?.mode == .local ? "In a library on this Mac it runs here or on your own key." : "Your notes aren't used to train any model.", systemImage: "lock")
            }
            .font(.callout)
            .foregroundStyle(.secondary)
            FlowLayout(spacing: 6) {
                ForEach(starters, id: \.self) { s in
                    Button(s) { send(s) }.buttonStyle(.bordered).controlSize(.small)
                }
            }
            .padding(.top, 4)
        }
        .padding(.top, 30)
    }

    private var starters: [String] {
        if context?.kind == .note { return ["Sum up this note", "What's missing here?", "Turn this into tasks"] }
        return ["What did I write this week?", "Sum up my open tasks", "What should I work on next?"]
    }

    private var introLead: String {
        if context?.kind == .note { return "Ask about the note on screen: sum it up, find what's missing, turn it into tasks." }
        if let f = chips.first(where: { $0.kind == .folder }) { return "Ask about the notes in \(f.label)." }
        return "Ask about anything in \(app.spaceName)."
    }

    private var live: ChatMessage? { messageList.last(where: { $0.live }) }

    // MARK: composer

    private var composer: some View {
        VStack(spacing: 8) {
            if let suggestions = messageList.last?.suggestions, !suggestions.isEmpty, live == nil {
                ScrollView(.horizontal) {
                    HStack { ForEach(suggestions, id: \.self) { s in Button(s) { send(s) }.buttonStyle(.bordered).controlSize(.small) } }
                }
                .scrollIndicators(.never)
            }
            if !chips.isEmpty {
                HStack(spacing: 6) {
                    ForEach(chips) { c in
                        HStack(spacing: 4) {
                            Image(systemName: c.kind == .folder ? "folder" : c.kind == .workspace ? "square.stack.3d.up" : "doc.text")
                            Text(c.label).lineLimit(1)
                            Button { chips.removeAll { $0.id == c.id } } label: { Image(systemName: "xmark") }
                                .buttonStyle(.plain).help("Remove \(c.label)")
                        }
                        .font(.caption).padding(.horizontal, 8).padding(.vertical, 3).background(.fill.tertiary, in: .capsule)
                    }
                    Spacer()
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    contextMenuItems
                } label: { Image(systemName: "plus.circle") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("Choose what Foli AI reads")
                TextField(context == nil ? "Ask Foli AI" : "Ask about this note", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...8)
                    .focused($composing)
                    .onSubmit { send(draft) }
                    .padding(.vertical, 6)
                if let live {
                    Button { app.perform { _ = try await $0.command(Commands.AiStop(ChatMessageArgs(messageId: live.id))) } } label: { Image(systemName: "stop.circle.fill").font(.title2) }
                        .buttonStyle(.plain).help("Stop (⌘.)").keyboardShortcut(".", modifiers: .command)
                } else if !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    // Send shows only once there's something to send (the owner's rule: hidden, not faded).
                    Button { send(draft) } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                        .buttonStyle(.plain).foregroundStyle(Color.foleviInk).help("Send (Return)").disabled(sending)
                }
            }
            HStack(spacing: 12) {
                Picker("Mode", selection: $mode) {
                    Text("Auto").tag(ChatSendArgs.Mode.auto)
                    Text("Ask").tag(ChatSendArgs.Mode.ask)
                    if caps.value?.agent == true { Text("Agent").tag(ChatSendArgs.Mode.agent) }
                    if caps.value?.webResearch == true { Text("Research").tag(ChatSendArgs.Mode.research) }
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                if caps.value?.webResearch == true {
                    Toggle(isOn: $web) { Label("Web", systemImage: "globe") }.toggleStyle(.button).help("Search the web too")
                }
                Spacer()
                if let credits = caps.value?.credits, !credits.included {
                    Text("\(credits.available) credits left").font(.caption).foregroundStyle(credits.low ? .orange : .secondary)
                    if credits.low && app.session.value?.mode == .account {
                        Button("Buy More") { ChatActions.openBilling() }
                    }
                }
            }
            .controlSize(.small)
            Text(footnote).font(.caption2).foregroundStyle(.tertiary).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(.background.secondary, in: .rect(cornerRadius: 16))
        .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(.separator) }
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
        .frame(maxWidth: 800)
        .frame(maxWidth: .infinity)
    }

    private var footnote: String {
        var s = "Foli AI can make mistakes, so check what matters."
        if web { s += " Web results come from the open web." }
        return s
    }

    @ViewBuilder private var contextMenuItems: some View {
        if case .folder(let id) = window.sidebarSelection, let f = app.tree.value?.folders.first(where: { $0.id == id }) {
            Button("The Folder “\(f.name)”") { chips = [ContextChip(id: id, kind: .folder, label: f.name)] }
        }
        Section("Recent Notes") {
            ForEach((recent.value?.rows ?? []).prefix(5), id: \.row.id) { r in
                let title = r.row.title.nonEmpty ?? "Untitled"
                Button(title) {
                    chips.removeAll { $0.kind != .note }
                    if !chips.contains(where: { $0.id == r.row.id }) { chips.append(ContextChip(id: r.row.id, kind: .note, label: title)) }
                }
            }
        }
        Divider()
        Button("Everything in \(app.spaceName)") { chips = [ContextChip(id: "workspace", kind: .workspace, label: app.spaceName)] }
        if !chips.isEmpty { Button("Clear") { chips = [] } }
    }

    private var sendContext: ChatContextArgs? {
        if let f = chips.first(where: { $0.kind == .folder }) { return ChatContextArgs(kind: .folder, ids: [f.id]) }
        if chips.contains(where: { $0.kind == .workspace }) { return ChatContextArgs(kind: .workspace, ids: []) }
        let notes = chips.filter { $0.kind == .note }.map(\.id) + (context?.kind == .note ? context?.ids ?? [] : [])
        if !notes.isEmpty { return ChatContextArgs(kind: notes.count == 1 ? .note : .notes, ids: notes) }
        return context
    }

    private func send(_ text: String) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, !sending else { return }
        draft = ""
        pending = clean
        sending = true
        let args = ChatSendArgs(conversationId: conversationId, text: clean, space: nil, context: sendContext, web: web, attachments: nil, mode: mode)
        Task { @MainActor in
            defer { sending = false }
            do {
                guard let client = app.client else { pending = nil; return }
                let r = try await client.command(Commands.AiSend(args))
                if conversationId != r.conversationId {
                    conversation.bind(client, Views.AiConversation(ChatConversationArgs(conversationId: r.conversationId, web: nil)))
                    onStarted(r.conversationId)
                }
            } catch let f as EngineFailure {
                pending = nil
                draft = clean
                if f.code.contains("credit") {
                    app.toast(f.message, tone: .error, action: "Buy More") { ChatActions.openBilling() }
                } else {
                    app.toast(f.message, tone: .error)
                }
            } catch {
                pending = nil
                draft = clean
            }
        }
    }
}

struct UserBubble: View {
    let text: String
    var body: some View {
        HStack {
            Spacer(minLength: 80)
            Text(text).textSelection(.enabled)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(Color.foleviInk.opacity(0.1), in: .rect(cornerRadius: 14))
        }
    }
}

/// One message: the person's question (the last one can be edited), or Foli AI's answer with its sources, code
/// blocks, what it offers to do, an agent run, a memory, and Copy, Export, Save, Try Again.
struct MessageView: View {
    let message: ChatMessage
    let conversationId: String
    let window: WindowModel
    var isLastUser = false
    var isLast = false
    private var app: AppModel { .shared }
    @State private var stream = Live<Views.AiStream>()
    @State private var editing = false
    @State private var edited = ""
    @State private var copied = false

    private var text: String {
        if message.live, let t = stream.value?.text { return t }
        return message.text
    }

    var body: some View {
        Group {
            if message.role == .user { question } else { answer }
        }
        .task(id: message.live) {
            if message.live { stream.bind(app.client, Views.AiStream(ChatStreamArgs(messageId: message.id))) } else { stream.cancel() }
        }
    }

    @ViewBuilder private var question: some View {
        if editing {
            VStack(alignment: .trailing, spacing: 6) {
                TextField("Your question", text: $edited, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...8).onSubmit(resend)
                HStack {
                    Button("Cancel") { editing = false }.keyboardShortcut(.cancelAction)
                    Button("Send", action: resend).buttonStyle(InkPillStyle())
                }
                .controlSize(.small)
            }
        } else {
            VStack(alignment: .trailing, spacing: 2) {
                UserBubble(text: message.text)
                if isLastUser {
                    Button("Edit") { edited = message.text; editing = true }
                        .buttonStyle(.borderless).font(.caption).foregroundStyle(.secondary).help("Edit and ask again")
                }
            }
        }
    }

    private var answer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if message.live && text.isEmpty {
                HStack(spacing: 8) { ProgressView().controlSize(.small); Text(message.phase ?? "Thinking…").foregroundStyle(.secondary) }
            }
            if !text.isEmpty { AnswerText(text: text, citations: message.citations, webCitations: message.webCitations, window: window) }
            if message.status == "stopped" {
                Text(text.isEmpty ? "Stopped before it answered." : "Stopped").font(.caption).foregroundStyle(.secondary)
            }
            if let e = message.error {
                HStack {
                    Label(e.message, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    if e.code.contains("credit") || e.code.contains("plan") {
                        Button(e.code.contains("plan") ? "Upgrade" : "Buy More") { ChatActions.openBilling() }.controlSize(.small)
                    } else if isLast {
                        Button("Try Again") { regenerate() }.controlSize(.small)
                    }
                }
            }
            if !message.agentSteps.isEmpty {
                HStack { ForEach(message.agentSteps, id: \.tool) { s in Label("\(s.tool) ×\(s.count)", systemImage: s.ok ? "checkmark" : "xmark").font(.caption).foregroundStyle(.secondary) } }
            }
            if !message.citations.isEmpty || !message.webCitations.isEmpty { sources }
            actions
            if let run = message.agentRun { AgentRunView(run: run) }
            if message.agentMore, isLast, !message.live {
                Button("Continue") { continueAgent() }.controlSize(.small).help("Carry on from where Foli AI stopped")
            }
            if let memory = message.memory, memory.status == "offered" {
                HStack {
                    Label("Remember: \(memory.text)", systemImage: "brain").font(.callout)
                    Spacer()
                    Button("Remember") { app.perform { _ = try await $0.command(Commands.AiMemory(ChatMemoryArgs(messageId: message.id, save: true))) } }
                    Button("Not Now") { app.perform { _ = try await $0.command(Commands.AiMemory(ChatMemoryArgs(messageId: message.id, save: false))) } }
                }
                .controlSize(.small).padding(10).background(.fill.quinary, in: .rect(cornerRadius: 10))
            }
            if !message.live { toolbar }
        }
    }

    private var sources: some View {
        FlowLayout(spacing: 6) {
            ForEach(message.citations, id: \.n) { c in
                Button { ChatActions.open(c, window: window) } label: { Label("\(c.n). \(c.title.nonEmpty ?? "Untitled")", systemImage: "doc.text") }
                    .buttonStyle(.bordered).controlSize(.small)
            }
            ForEach(message.webCitations, id: \.n) { c in
                if let u = URL(string: c.url) {
                    Link(destination: u) { Label("\(c.n). \(c.domain)", systemImage: "globe") }.buttonStyle(.bordered).controlSize(.small)
                }
            }
        }
    }

    @ViewBuilder private var actions: some View {
        if !message.actions.isEmpty, message.actionsOutcome == nil {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(message.actions, id: \.title) { a in Label(a.title, systemImage: "wand.and.stars").font(.callout) }
                HStack {
                    Button("Do It") { app.perform { _ = try await $0.command(Commands.AiActions(ChatActionsArgs(conversationId: conversationId, messageId: message.id, apply: true))) } }
                        .buttonStyle(InkPillStyle())
                    Button("No Thanks") { app.perform { _ = try await $0.command(Commands.AiActions(ChatActionsArgs(conversationId: conversationId, messageId: message.id, apply: false))) } }
                }
                .controlSize(.small)
            }
            .padding(12).background(.fill.quinary, in: .rect(cornerRadius: 10))
        } else if let outcome = message.actionsOutcome {
            Text(outcome == "applied" ? "Done" : "Dismissed").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var toolbar: some View {
        HStack(spacing: 14) {
            if !text.isEmpty {
                Button { copy(text) } label: { Image(systemName: copied ? "checkmark" : "doc.on.doc") }.help(copied ? "Copied" : "Copy")
                Menu {
                    Button("Copy as Markdown") { copy(text) }
                    Button("Download as Markdown…") {
                        let t = text
                        Task { _ = await ShellFiles.shared.save(name: "Foli AI answer.md", bytes: Data(t.utf8), from: NSApp.keyWindow) }
                    }
                    Button("Save as Note") { ChatActions.saveAsNote(conversationId, message: message.id, window: window) }
                } label: { Image(systemName: "square.and.arrow.up") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("Export")
            }
            if isLast { Button { regenerate() } label: { Image(systemName: "arrow.clockwise") }.help("Try Again") }
            if let credits = message.credits, credits > 0 { Text("\(credits) credits").font(.caption2).foregroundStyle(.tertiary) }
        }
        .buttonStyle(.borderless)
        .foregroundStyle(.secondary)
    }

    private func regenerate() {
        app.perform { _ = try await $0.command(Commands.AiRegenerate(ChatConversationArgs(conversationId: conversationId, web: nil))) }
    }

    private func resend() {
        let t = edited.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        editing = false
        app.perform { _ = try await $0.command(Commands.AiEdit(ChatEditArgs(conversationId: conversationId, messageId: message.id, text: t))) }
    }

    private func continueAgent() {
        app.perform { _ = try await $0.command(Commands.AiSend(ChatSendArgs(conversationId: conversationId, text: "Continue", space: nil, context: nil, web: nil, attachments: nil, mode: .agent))) }
    }

    private func copy(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
        copied = true
        Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
    }
}

/// An answer's text: Markdown paragraphs with [n] citation markers as links, and code blocks with Copy.
struct AnswerText: View {
    let text: String
    let citations: [ChatCitation]
    let webCitations: [ChatWebCitation]
    let window: WindowModel

    enum Part: Hashable { case prose(String), code(String, String) }

    static func parts(_ text: String) -> [Part] {
        var out: [Part] = []
        var prose: [String] = []
        var code: [String]?
        var lang = ""
        for line in text.components(separatedBy: "\n") {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                if let c = code {
                    out.append(.code(lang, c.joined(separator: "\n")))
                    code = nil
                } else {
                    if !prose.isEmpty { out.append(.prose(prose.joined(separator: "\n"))); prose = [] }
                    lang = line.trimmingCharacters(in: .whitespaces).dropFirst(3).trimmingCharacters(in: .whitespaces)
                    code = []
                }
            } else if code != nil {
                code?.append(line)
            } else {
                prose.append(line)
            }
        }
        if let c = code { out.append(.code(lang, c.joined(separator: "\n"))) }
        if !prose.isEmpty { out.append(.prose(prose.joined(separator: "\n"))) }
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(Self.parts(text).enumerated()), id: \.offset) { _, part in
                switch part {
                case .prose(let p):
                    Text(markdown(p)).font(CoreType.noteText(15)).lineSpacing(3).textSelection(.enabled)
                case .code(let lang, let c):
                    CodeBlock(language: lang, code: c)
                }
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "folevi-cite", let n = Int(url.host ?? "") else { return .systemAction }
            if let c = citations.first(where: { $0.n == n }) {
                ChatActions.open(c, window: window)
            } else if let w = webCitations.first(where: { $0.n == n }), let u = URL(string: w.url) {
                NSWorkspace.shared.open(u)
            }
            return .handled
        })
    }

    /// Markdown, with each [n] that names a source turned into a link to it.
    private func markdown(_ s: String) -> AttributedString {
        let known = Set(citations.map(\.n) + webCitations.map(\.n))
        let linked = s.replacing(/\[(\d{1,2})\](?!\()/) { m in
            let n = Int(m.output.1) ?? 0
            return known.contains(n) ? "[[\(n)]](folevi-cite://\(n))" : String(m.output.0)
        }
        return (try? AttributedString(markdown: linked, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }
}

struct CodeBlock: View {
    let language: String
    let code: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(language.isEmpty ? "Code" : language).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button(copied ? "Copied" : "Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(code, forType: .string)
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
                }
                .buttonStyle(.borderless).font(.caption)
            }
            ScrollView(.horizontal) {
                Text(code).font(.system(.callout, design: .monospaced)).textSelection(.enabled).fixedSize()
            }
        }
        .padding(10)
        .background(.fill.quinary, in: .rect(cornerRadius: 8))
    }
}

/// An agent run: the changes Foli AI wants to make to notes, to approve one by one or all, and undo after (with a
/// choice when the notes changed since).
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
                    Button(picked.count == run.operations.count ? "Apply All" : "Apply \(picked.count)") {
                        app.perform { _ = try await $0.command(Commands.AiAgentApprove(AgentApproveArgs(runId: run.id, operationIds: Array(picked)))) }
                    }
                    .buttonStyle(InkPillStyle())
                    .disabled(picked.isEmpty)
                    Button("Discard") { app.perform { _ = try await $0.command(Commands.AiAgentDiscard(AgentRunArgs(runId: run.id))) } }
                } else if run.status == "done" || run.status == "applied" {
                    Button("Undo Changes") { undo(nil) }
                }
            }
            .controlSize(.small)
        }
        .padding(12)
        .background(.fill.quinary, in: .rect(cornerRadius: 10))
        .onAppear { picked = Set(run.operations.map(\.id)) }
    }

    private func undo(_ force: AgentUndoArgs.Force?) {
        let app = app
        let runId = run.id
        Task { @MainActor in
            guard let client = app.client else { return }
            do {
                let r = try await client.command(Commands.AiAgentUndo(AgentUndoArgs(runId: runId, force: force)))
                guard r.status == "conflict" else { app.toast("Changes undone"); return }
                let alert = NSAlert()
                alert.messageText = "Some of these notes changed since"
                alert.informativeText = r.changed.count == 1 ? "1 note was edited after Foli AI changed it." : "\(r.changed.count) notes were edited after Foli AI changed them."
                alert.addButton(withTitle: "Undo the Others")
                alert.addButton(withTitle: "Undo All Anyway")
                alert.addButton(withTitle: "Cancel")
                switch alert.runModal() {
                case .alertFirstButtonReturn: undo(.rest)
                case .alertSecondButtonReturn: undo(.all)
                default: break
                }
            } catch let f as EngineFailure {
                app.toast(f.message, tone: .error)
            } catch {}
        }
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

    static func delete(_ id: String, then: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Delete this conversation?"
        alert.informativeText = "It's deleted with all its answers. This can't be undone."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Delete")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        CoreAlerts.cancelIsDefault(alert)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        AppModel.shared.perform { client in
            _ = try await client.command(Commands.AiRemove(ChatConversationArgs(conversationId: id, web: nil)))
            AppModel.shared.toast("Conversation deleted")
            then()
        }
    }

    static func share(_ id: String, shared: Bool) {
        if shared {
            let alert = NSAlert()
            alert.messageText = "Share this conversation with the workspace?"
            alert.informativeText = "Everyone in the workspace can read it and its answers."
            alert.addButton(withTitle: "Share")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        AppModel.shared.perform { client in
            _ = try await client.command(Commands.AiShare(ChatShareArgs(conversationId: id, shared: shared)))
            AppModel.shared.toast(shared ? "Shared with the workspace" : "No longer shared")
        }
    }

    static func saveAsNote(_ id: String, message: String? = nil, window: WindowModel) {
        AppModel.shared.perform { client in
            let r = try await client.command(Commands.AiSaveAsNote(ChatSaveArgs(conversationId: id, messageId: message)))
            AppModel.shared.toast("Saved as a note", tone: .success, action: "Open") { window.go(.note(r.id)) }
        }
    }

    static func copyMarkdown(_ id: String) {
        AppModel.shared.perform { client in
            let r = try await client.command(Commands.AiExportMarkdown(ChatSaveArgs(conversationId: id, messageId: nil)))
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(r.markdown, forType: .string)
            AppModel.shared.toast("Copied as Markdown")
        }
    }

    static func export(_ id: String) {
        AppModel.shared.perform { client in
            let r = try await client.command(Commands.AiExportMarkdown(ChatSaveArgs(conversationId: id, messageId: nil)))
            _ = await ShellFiles.shared.save(name: r.filename, bytes: Data(r.markdown.utf8), from: NSApp.keyWindow)
        }
    }

    /// A cited note, scrolled to the cited block when the answer names one.
    static func open(_ c: ChatCitation, window: WindowModel) {
        window.go(.note(c.noteId))
        guard let block = c.blockId else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            window.editor(EditorCommands.BlockJump(BlockJumpArgs(blockId: block)))
        }
    }

    static func openBilling() {
        NSWorkspace.shared.open(Paths.serviceURL.appendingPathComponent("settings/billing"))
    }
}

extension WindowModel {
    /// Changes where the window is without a new history step (a chat started, a tab picked inside a screen).
    func replaceCurrent(_ dest: Destination) { replace(with: dest) }
}

/// Ask Foli AI (⌘J) over any screen but a note: a floating chat, with New Chat and Open in Full View.
struct AskPanel: View {
    let window: WindowModel
    @State private var conversation: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                AiMarkGlyph(size: 16)
                Text("Foli AI").font(.headline)
                Spacer()
                Button { conversation = nil } label: { Image(systemName: "plus.bubble") }.help("New Chat")
                Button {
                    let id = conversation
                    window.askShown = false
                    window.go(.foliAI(id))
                } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }.help("Open in Full View")
                Button { withAnimation(.snappy) { window.askShown = false } } label: { Image(systemName: "xmark") }
                    .help("Close").keyboardShortcut(.cancelAction)
            }
            .buttonStyle(.borderless)
            .padding(12)
            Divider()
            ChatView(window: window, conversationId: conversation, context: folderContext) { conversation = $0 } deleted: { conversation = nil }
        }
        .frame(width: 440, height: 580)
        .background(.background, in: .rect(cornerRadius: 18))
        .clipShape(.rect(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(.separator) }
        .shadow(color: .black.opacity(0.18), radius: 24, y: 10)
        .padding(18)
    }

    private var folderContext: ChatContextArgs? {
        if case .folder(let id) = window.current { return ChatContextArgs(kind: .folder, ids: [id]) }
        return nil
    }
}
