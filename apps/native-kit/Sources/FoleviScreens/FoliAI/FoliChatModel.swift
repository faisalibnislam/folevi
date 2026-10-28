// Foli AI's chat, the view model (plan 5.9; web AskAiPanel.tsx and chat/ChatThread.tsx). One conversation at a
// time: `ai.conversation` for its messages, `ai.stream` for each answer while it's live (revealed word by word
// here, StreamReveal), `ai.research` for Research jobs, `ai.capabilities` for what's offered. Every write is a
// command; native holds no authority over the conversation.
//
// It's container-agnostic: the iPhone sheet, the iPad form sheet and the Mac panel all drive the same model and
// set `onOpen` (a citation, a note made from an answer) and `onClose`. Keep one model per window so the
// conversation survives closing and reopening the chat (as the web keeps its panel mounted).
import Foundation
import Observation
import FoleviDesign
import FoleviEngine

public enum FoliChatMode: String, CaseIterable, Sendable {
    /// Answers from the notes (and the web with Web on); a request to change notes goes to the agent.
    case chat
    /// A report with sources from the web and the notes, written in the background.
    case research
}

/// What the person sent, shown until the conversation has it.
public struct FoliPendingQuestion: Equatable, Sendable {
    public var text: String
    /// How many messages the conversation had when it was sent.
    public var after: Int
}

/// What a new conversation is about, as chips.
public struct FoliContextItem: Hashable, Sendable, Identifiable {
    public enum Kind: Hashable, Sendable { case folder, note }
    public var id: String
    public var kind: Kind
    public var name: String
}

/// One answer's display: its reveal while it streams and its Markdown blocks (observed per answer, so a
/// streaming answer redraws only itself).
@MainActor
@Observable
public final class FoliAnswer {
    public let messageId: String
    public private(set) var blocks: [MDBlock] = []
    /// The text on screen now (what the reveal has shown, or the whole answer).
    public private(set) var shownText = ""
    /// Whether any of it is on screen yet: what the status line and the placeholder follow (it changes once,
    /// not on every reveal tick, so they don't redraw the chat with each word).
    public private(set) var hasText = false
    @ObservationIgnored var reveal: StreamReveal?
    @ObservationIgnored var markdown = IncrementalMarkdown()

    init(messageId: String) { self.messageId = messageId }

    public var revealing: Bool { reveal != nil }

    func show(_ text: Substring) {
        // Same bytes, nothing to do (compared as memory, not character by character).
        let next = String(text)
        guard next.utf8.count != shownText.utf8.count || !UTF8Prefix.has(next, shownText) else { return }
        shownText = next
        if hasText == next.isEmpty { hasText = !next.isEmpty }
        markdown.update(shownText)
        if markdown.blocks != blocks { blocks = markdown.blocks }
    }
}

@MainActor
@Observable
public final class FoliChatModel {
    public static let suggestions = ["What am I working on this week?", "Which tasks are still open?", "Put my notes about travel in a Travel folder", "Tag my recent notes by topic"]
    public static let folderSuggestions = ["Summarize this folder", "What are the open questions here?", "What decisions have been made?", "What should I do next?"]
    public static let noteSuggestions = ["Summarize this", "What questions are still open?", "Tidy up the headings", "Turn the action items into tasks with dates"]
    public static let researchSuggestions = ["Compare the best note-taking methods", "What changed in remote work rules this year?", "How do heat pumps compare with gas boilers?", "What are good habits for deep work?"]
    /// The agent carries on where it stopped (web editIntent.ts CONTINUE_AGENT).
    public static let continueText = "Continue where you stopped."

    public let client: EngineClient
    public let capabilities: ValueStore<ChatCapabilities>
    public let session: ValueStore<SessionValue>
    @ObservationIgnored let feedback: ScreenFeedback
    @ObservationIgnored let defaults: UserDefaults

    public private(set) var conversationId: String?
    public private(set) var conversation: ValueStore<ChatConversationValue>?
    public private(set) var research: ValueStore<ResearchValue>?
    @ObservationIgnored private var streams: [String: ValueStore<ChatStreamValue>] = [:]
    @ObservationIgnored private var answers: [String: FoliAnswer] = [:]
    /// Bumped when an answer's display is made or dropped, so views that asked for one before it existed redraw.
    private var answersVersion = 0

    // Composer
    public var draft = ""
    public var mode: FoliChatMode {
        didSet { defaults.set(mode.rawValue, forKey: Self.modeKey) }
    }
    public var web = false
    /// What a new conversation is about (empty: the whole place).
    public private(set) var context: [FoliContextItem] = []
    /// Editing the last question: Send replaces it (`ai.edit`).
    public private(set) var editingMessageId: String?

    public private(set) var pending: FoliPendingQuestion?
    public private(set) var sending = false
    /// A refusal or failure to show in the thread (out of credits, offline).
    public private(set) var problem: String?
    /// The same refusal as the engine said it (its code and what helps: out of credits, not on the plan).
    public private(set) var problemError: EngineError?
    /// Row actions on their way (Apply, Approve, Save): by message or run id.
    public private(set) var busy: Set<String> = []
    /// Shown in the history list.
    public var historyOpen = false
    /// Said to VoiceOver once an answer is done (the streaming text isn't read word by word).
    public private(set) var announcement: String?

    /// Reduce Motion: answers appear whole.
    @ObservationIgnored public var reduceMotion = false
    /// Opens a route (a cited note, a note made from an answer). The container also closes a covering sheet.
    @ObservationIgnored public var onOpen: @MainActor @Sendable (ScreenRoute) -> Void = { _ in }
    /// Closes the chat's container.
    @ObservationIgnored public var onClose: @MainActor @Sendable () -> Void = {}
    @ObservationIgnored private var lastSentMessageId: String?
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private var observing = false
    @ObservationIgnored private var wasWorking = false

    static let modeKey = "folevi.ai.chatMode"

    public init(client: EngineClient, about: FoliContext? = nil, feedback: ScreenFeedback = ScreenFeedback(), defaults: UserDefaults = .standard) {
        self.client = client
        self.feedback = feedback
        self.defaults = defaults
        self.mode = FoliChatMode(rawValue: defaults.string(forKey: Self.modeKey) ?? "") ?? .chat
        self.capabilities = client.watch(.aiCapabilities, snapshotKey: "ai.capabilities.\(client.place)")
        self.session = client.watch(.session, snapshotKey: "session.\(client.place)")
        setAbout(about)
        observe()
    }

    // MARK: What the chat shows

    public var caps: ChatCapabilities? { capabilities.value }
    public var available: Bool { caps?.available ?? true }
    /// Research and the Web chip need web research (Settings > Foli AI, and the plan).
    public var webAvailable: Bool { caps?.webResearch ?? false }
    public var effectiveMode: FoliChatMode { webAvailable ? mode : .chat }
    public var webOn: Bool { web && webAvailable && effectiveMode == .chat }

    public var info: ChatConversationInfo? { conversation?.value?.conversation }
    public var messages: [ChatMessage] { conversation?.value?.messages ?? [] }
    public var title: String {
        let t = info?.title.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "New chat" : t
    }
    public var isNew: Bool { conversationId == nil }
    public var isMissing: Bool { conversationId != nil && conversation?.value?.found == false && pending == nil }
    public var isLoading: Bool { conversationId != nil && conversation?.value == nil && pending == nil }
    /// The question just sent, until the conversation has it.
    public var shownPending: FoliPendingQuestion? {
        guard let p = pending, messages.count <= p.after else { return nil }
        return p
    }
    public var isEmpty: Bool { messages.isEmpty && shownPending == nil && !isLoading }
    public var streamingMessage: ChatMessage? { messages.last { $0.role == .assistant && $0.status == "streaming" } }
    public var isWorking: Bool { sending || streamingMessage != nil || shownPending != nil }
    public var canSend: Bool { available && !isWorking && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    public var lastUserMessageId: String? { messages.last { $0.role == .user }?.id }

    public var suggestions: [String] {
        if effectiveMode == .research { return Self.researchSuggestions }
        switch context.first?.kind {
        case .folder: return Self.folderSuggestions
        case .note: return Self.noteSuggestions
        case nil: return Self.suggestions
        }
    }

    public var placeholder: String { effectiveMode == .research ? "What should Foli AI research?" : "Ask Foli AI anything..." }

    public var footnote: String {
        var parts = ["Foli AI can make mistakes."]
        if webOn || effectiveMode == .research { parts.append("Web searches go through Google Search.") }
        if info?.ephemeral == true { parts.append("History is off: this chat is deleted when you close it.") }
        return parts.joined(separator: " ")
    }

    /// The place's name for the context chip when a new chat is about everything ("Personal", a workspace).
    public var placeName: String {
        guard let s = session.value else { return "Personal" }
        return s.spaces.first { $0.id == s.space }?.name ?? "Personal"
    }

    /// An existing conversation's context, as one read-only chip.
    public var conversationContextLabel: String? {
        guard let c = info?.context else { return nil }
        switch c {
        case "folder": return "This folder"
        case "note": return "A note"
        case "notes": return "Some notes"
        case "selection": return "A selection"
        default: return placeName
        }
    }

    /// The one status line while an answer is on its way (with Stop beside it).
    public var status: String? {
        guard isWorking else { return nil }
        if let m = streamingMessage {
            if let job = job(for: m.id), job.status == "running" {
                return (job.steps.last { $0.status == "running" }?.label).map { "\($0)..." } ?? "Researching..."
            }
            return answer(m.id)?.hasText == true ? "Writing..." : Self.phaseLabel(m.phase)
        }
        return "Thinking..."
    }

    /// The status line's words for what the answer is doing (web chatText.ts `phaseLabel`).
    public static func phaseLabel(_ phase: String?) -> String {
        switch phase {
        case "searching": "Searching your notes..."
        case "reading": "Reading your notes..."
        case "writing": "Writing..."
        case "web": "Searching the web..."
        case "page": "Reading the page..."
        case "research": "Researching..."
        case "planning": "Planning..."
        case "working": "Working on it..."
        case let p? where !p.isEmpty: p.hasSuffix("...") || p.hasSuffix("…") ? p : "\(p)..."
        default: "Thinking..."
        }
    }

    public func answer(_ messageId: String) -> FoliAnswer? {
        _ = answersVersion
        return answers[messageId]
    }

    public func job(for messageId: String) -> ResearchJob? { research?.value?.jobs.first { $0.messageId == messageId } }

    /// The Continue button: the last answer is an agent's that ran out of room.
    public func offersContinue(_ m: ChatMessage) -> Bool {
        (caps?.agent ?? true) && m.id == messages.last?.id && m.agentMore && m.status == "done"
    }

    // MARK: Sending

    public func send(_ text: String? = nil, mode forced: ChatSendArgs.Mode? = nil) {
        let q = (text ?? draft).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, available, !isWorking else { return }
        if let editing = editingMessageId, let id = conversationId, text == nil {
            editingMessageId = nil
            draft = ""
            run(pendingText: nil, after: messages.count) {
                try await self.client.command(.aiEdit(conversationId: id, messageId: editing, text: q, web: self.webOn ? true : nil))
            }
            return
        }
        if text == nil { draft = "" }
        let mode: ChatSendArgs.Mode? = forced ?? (effectiveMode == .research ? .research : nil)
        let isNew = conversationId == nil
        let ctx = isNew ? contextArgs : nil
        let id = conversationId
        let web = webOn && mode != .research ? true : nil
        run(pendingText: q, after: messages.count) {
            try await self.client.command(.aiSend(conversationId: id, text: q, context: ctx, web: web, mode: mode))
        }
    }

    private var contextArgs: ChatContextArgs? {
        guard let first = context.first else { return nil }
        if first.kind == .folder { return ChatContextArgs(kind: .folder, ids: [first.id]) }
        let ids = context.filter { $0.kind == .note }.map(\.id)
        return ChatContextArgs(kind: ids.count == 1 ? .note : .notes, ids: ids)
    }

    private func run(pendingText: String?, after: Int, _ work: @escaping @MainActor () async throws -> ChatSendResult) {
        problem = nil
        problemError = nil
        sending = true
        if let pendingText { pending = FoliPendingQuestion(text: pendingText, after: after) }
        feedback.haptic(.impactLight)
        Task {
            do {
                let r = try await work()
                lastSentMessageId = r.messageId
                if conversationId != r.conversationId { show(conversationId: r.conversationId) }
            } catch {
                problem = Self.message(error)
                if case .engine(let e)? = error as? EngineFailure { problemError = e } else { problemError = nil }
                pending = nil
            }
            sending = false
            // The pending question goes once the conversation has it (shownPending); clear it after that.
            if let p = pending, messages.count > p.after { pending = nil }
        }
    }

    public func stop() {
        if let m = streamingMessage, let job = job(for: m.id), job.status == "running" {
            act(job.id) { try await self.client.command(.aiResearchCancel(researchId: job.id)) }
            return
        }
        guard let id = streamingMessage?.id ?? lastSentMessageId else { return }
        feedback.haptic(.selection)
        act(id) { try await self.client.command(.aiStop(messageId: id)) }
    }

    public func regenerate() {
        guard let id = conversationId, !isWorking else { return }
        let usedWeb = webOn || !(messages.last?.webCitations.isEmpty ?? true)
        run(pendingText: nil, after: messages.count) {
            try await self.client.command(.aiRegenerate(conversationId: id, web: usedWeb ? true : nil))
        }
    }

    public func continueAgent() { send(Self.continueText, mode: .agent) }

    /// Puts the last question in the composer; Send replaces it.
    public func edit(_ message: ChatMessage) {
        guard message.id == lastUserMessageId, !isWorking else { return }
        editingMessageId = message.id
        draft = message.text
    }

    public func cancelEdit() {
        editingMessageId = nil
        draft = ""
    }

    // MARK: Conversations

    /// Starts a new chat (keeps what it's about when the chat was opened about a folder or note).
    public func newChat() {
        discardIfEphemeral()
        switchTo(nil)
        draft = ""
        editingMessageId = nil
        problem = nil
        historyOpen = false
    }

    /// Opens a conversation from the history.
    public func open(conversationId id: String) {
        discardIfEphemeral()
        switchTo(id)
        historyOpen = false
    }

    /// What the chat is about when it opens from a folder or a note (a new conversation).
    public func setAbout(_ about: FoliContext?) {
        switch about {
        case .folder(let id, let name)?: context = [FoliContextItem(id: id, kind: .folder, name: name)]
        case .note(let id, let title)?: context = [FoliContextItem(id: id, kind: .note, name: title.isEmpty ? "Untitled" : title)]
        case nil: context = []
        }
    }

    /// Opens the chat about something new: a fresh conversation about it.
    public func reopen(about: FoliContext?) {
        guard let about else { return }
        newChat()
        setAbout(about)
    }

    public func addNote(id: String, title: String) {
        guard isNew else { return }
        var notes = context.filter { $0.kind == .note && $0.id != id }
        notes.append(FoliContextItem(id: id, kind: .note, name: title.isEmpty ? "Untitled" : title))
        context = Array(notes.suffix(5))
    }

    public func removeContext(_ id: String) {
        guard isNew else { return }
        context.removeAll { $0.id == id }
    }

    /// The chat closed: a conversation with history off goes (as the web does).
    public func closed() {
        if discardIfEphemeral() { switchTo(nil) }
        announcement = nil
    }

    @discardableResult
    private func discardIfEphemeral() -> Bool {
        guard let id = conversationId, info?.ephemeral == true else { return false }
        Task { _ = try? await client.command(.aiRemove(conversationId: id)) }
        return true
    }

    private func switchTo(_ id: String?) {
        conversation?.cancel()
        research?.cancel()
        for s in streams.values { s.cancel() }
        streams = [:]
        answers = [:]
        answersVersion &+= 1
        pending = nil
        lastSentMessageId = nil
        conversationId = nil
        conversation = nil
        research = nil
        if let id { show(conversationId: id) }
    }

    private func show(conversationId id: String) {
        conversationId = id
        conversation = client.watch(.aiConversation(conversationId: id))
        if webAvailable || caps == nil { research = client.watch(.aiResearch(conversationId: id)) }
    }

    public func rename(_ id: String, to title: String) {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        act(id) { try await self.client.command(.aiRename(conversationId: id, title: t)) }
    }

    public func pin(_ id: String, _ pinned: Bool) {
        act(id) { try await self.client.command(.aiPin(conversationId: id, pinned: pinned)) }
    }

    public func remove(_ id: String) {
        if id == conversationId { switchTo(nil) }
        act(id, success: "Chat deleted.") { try await self.client.command(.aiRemove(conversationId: id)) }
    }

    // MARK: Answers

    public func copy(_ message: ChatMessage) {
        feedback.copy(MarkdownPlain.plain(message.text))
        feedback.haptic(.success)
        feedback.toast(ScreenToast("Copied.", tone: .success))
    }

    /// Saves one answer (with its question), or the whole chat, as a note.
    public func saveAsNote(_ messageId: String? = nil) {
        guard let id = conversationId else { return }
        act(messageId ?? id) {
            let r = try await self.client.command(.aiSaveAsNote(conversationId: id, messageId: messageId))
            self.feedback.toast(ScreenToast("Saved as a note.", tone: .success, actionTitle: "Open") { [open = self.onOpen] in open(.note(id: r.id)) })
        }
    }

    /// Saves any of your conversations as a note (the history's menu).
    public func saveAsNote(conversationId id: String) {
        act(id) {
            let r = try await self.client.command(.aiSaveAsNote(conversationId: id, messageId: nil))
            self.feedback.toast(ScreenToast("Saved as a note.", tone: .success, actionTitle: "Open") { [open = self.onOpen] in open(.note(id: r.id)) })
        }
    }

    public func plainText(_ message: ChatMessage) -> String { MarkdownPlain.plain(message.text) }

    /// The whole conversation as plain text (Share).
    public var transcript: String {
        messages.map { ($0.role == .user ? "You: " : "Foli AI: ") + MarkdownPlain.plain($0.text) }.joined(separator: "\n\n")
    }

    /// The proposed changes under an answer (folders, notes, moves): Apply or Not now.
    public func applyActions(_ message: ChatMessage, apply: Bool) {
        guard let id = conversationId else { return }
        act(message.id, success: apply ? "Changes applied." : nil) { try await self.client.command(.aiActions(conversationId: id, messageId: message.id, apply: apply)) }
    }

    public func memory(_ message: ChatMessage, save: Bool) {
        act(message.id, success: save ? "Saved to memory." : nil) { try await self.client.command(.aiMemory(messageId: message.id, save: save)) }
    }

    /// The agent's proposed changes: run the ticked ones.
    public func approve(_ run: ChatAgentRun, operations: [String]) {
        guard !operations.isEmpty else { return }
        act(run.id) { try await self.client.command(.aiAgentApprove(runId: run.id, operationIds: operations)) }
    }

    public func discard(_ run: ChatAgentRun) {
        act(run.id) { try await self.client.command(.aiAgentDiscard(runId: run.id)) }
    }

    /// Undo everything the agent did. When notes changed since, `undoConflict` asks what to do.
    public private(set) var undoConflict: (run: ChatAgentRun, changed: [String])?

    public func undo(_ run: ChatAgentRun, force: AgentUndoArgs.Force? = nil) {
        undoConflict = nil
        act(run.id) {
            let r = try await self.client.command(.aiAgentUndo(runId: run.id, force: force))
            if r.status == "changed" { self.undoConflict = (run, r.changed) } else { self.feedback.toast(ScreenToast("Undone.", tone: .success)) }
        }
    }

    public func dismissUndoConflict() { undoConflict = nil }

    public func cancelResearch(_ job: ResearchJob) {
        act(job.id) { try await self.client.command(.aiResearchCancel(researchId: job.id)) }
    }

    public func saveResearch(_ job: ResearchJob) {
        if let note = job.noteId { return onOpen(.note(id: note)) }
        act(job.id) {
            let r = try await self.client.command(.aiResearchSave(researchId: job.id))
            self.feedback.toast(ScreenToast("Report saved as a note.", tone: .success, actionTitle: "Open") { [open = self.onOpen] in open(.note(id: r.id)) })
        }
    }

    public func openCitation(_ c: ChatCitation) { onOpen(.note(id: c.noteId)) }

    /// A link in an answer: a note's path opens natively; anything else is a web route.
    public func openLink(_ url: URL) -> Bool {
        if url.scheme == "folevi-cite" { return false }
        if url.scheme == nil || url.host == "app.folevi.com" {
            onOpen(ScreenRoute(webRoute: url.path))
            return true
        }
        return false
    }

    private func act<T: Sendable>(_ key: String, success: String? = nil, _ work: @escaping @MainActor () async throws -> T) {
        busy.insert(key)
        Task {
            do {
                _ = try await work()
                if let success { feedback.toast(ScreenToast(success, tone: .success)) }
            } catch {
                feedback.toast(ScreenToast(Self.message(error), tone: .error))
                feedback.haptic(.error)
            }
            busy.remove(key)
        }
    }

    static func message(_ error: any Error) -> String {
        if let f = error as? EngineFailure { return f.message }
        return "Foli AI couldn't do that. Try again."
    }

    // MARK: Following the views

    /// Syncs, then arms one observation of the conversation, its streams and its research jobs (re-armed after
    /// each change, so there's never more than one).
    private func observe() {
        sync()
        guard !observing else { return }
        observing = true
        withObservationTracking {
            _ = conversation
            _ = conversation?.value
            _ = research?.value
            _ = capabilities.value
            for s in streams.values { _ = s.value }
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.observing = false
                self.observe()
            }
        }
    }

    /// Brings the answers' displays and the stream subscriptions in line with the conversation.
    func sync() {
        let msgs = messages
        var live = Set<String>()
        for m in msgs where m.role == .assistant {
            if m.live {
                live.insert(m.id)
                if streams[m.id] == nil { streams[m.id] = client.watch(.aiStream(messageId: m.id)) }
            }
            let text = m.live ? (streams[m.id]?.value?.text ?? m.text) : m.text
            let a: FoliAnswer
            if let existing = answers[m.id] {
                a = existing
            } else {
                a = FoliAnswer(messageId: m.id)
                answers[m.id] = a
                answersVersion &+= 1
                if m.status == "streaming" { a.reveal = StreamReveal() }
            }
            if a.reveal != nil {
                a.reveal?.receive(text)
                if m.status != "streaming", a.reveal?.caughtUp == true {
                    a.reveal = nil
                    a.show(text[...])
                }
            } else {
                a.show(text[...])
            }
        }
        for (id, s) in streams where !live.contains(id) {
            s.cancel()
            streams[id] = nil
        }
        if let p = pending, msgs.count > p.after, !sending { pending = nil }
        if answers.values.contains(where: \.revealing) { startTicker() }
        let working = isWorking
        if wasWorking, !working, let last = msgs.last, last.role == .assistant {
            announcement = last.status == "stopped" ? "Stopped." : last.status == "error" ? (last.error?.message ?? "Foli AI couldn't answer.") : "Answer ready."
        } else if working, !wasWorking {
            announcement = nil
        }
        wasWorking = working
    }

    /// Reveals streaming answers a few words every 30 ms until they've caught up.
    private func startTicker() {
        guard ticker == nil else { return }
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(30))
                guard let self else { return }
                if !self.tick() { break }
            }
            self?.ticker = nil
        }
    }

    /// One reveal step for every streaming answer; false when none is revealing any more.
    @discardableResult
    func tick() -> Bool {
        var any = false
        for a in answers.values where a.reveal != nil {
            any = true
            if a.reveal!.tick(reduceMotion: reduceMotion) {
                a.show(a.reveal!.shown)
            }
            if a.reveal!.caughtUp, let m = messages.first(where: { $0.id == a.messageId }), m.status != "streaming" {
                a.reveal = nil
                a.show(m.text[...])
            }
        }
        return any
    }

    // MARK: Picking notes for the context

    /// Notes matching `text` for the Add chip's picker.
    public func findNotes(_ text: String) async -> [SearchHit] {
        let q = text.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return [] }
        return (try? await client.query(.search(text: q, limit: 20)).hits) ?? []
    }
}

/// The history list's view model: `ai.conversations`, searched as you type.
@MainActor
@Observable
public final class FoliHistoryModel {
    public let client: EngineClient
    public private(set) var store: ValueStore<ChatConversationsValue>
    public var search = "" {
        didSet { scheduleSearch() }
    }
    @ObservationIgnored private var debounce: Task<Void, Never>?

    public init(client: EngineClient) {
        self.client = client
        self.store = client.watch(.aiConversations(), snapshotKey: "ai.conversations.\(client.place)")
    }

    public var pinned: [ChatConversationRow] { store.value?.pinned ?? [] }
    public var recent: [ChatConversationRow] { store.value?.recent ?? [] }
    public var isLoading: Bool { store.value == nil }
    public var isEmpty: Bool { pinned.isEmpty && recent.isEmpty }

    private func scheduleSearch() {
        debounce?.cancel()
        let text = search
        debounce = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard let self, !Task.isCancelled else { return }
            self.store.cancel()
            let q = text.trimmingCharacters(in: .whitespaces)
            self.store = self.client.watch(.aiConversations(search: q.isEmpty ? nil : q))
        }
    }
}
