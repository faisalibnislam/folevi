import AppKit
import Observation
import SwiftUI

extension Notification.Name {
    /// Opens Ask AI, optionally with a question typed in (`question`) or on one folder's notes
    /// (`folderId`, `folderName`): the command palette's "Ask AI", a folder's "Ask AI about this folder…".
    static let foleviOpenAskAi = Notification.Name("FoleviOpenAskAi")
}

/// A folder Ask AI answers from (only its notes).
struct AskFolder: Equatable, Sendable {
    var id: String
    var name: String
}

/// Ask AI's conversation (the web's AskAiChat): kept while the chat is closed, so it survives closing and
/// reopening. Each answer cites the notes it used; follow-ups keep the conversation.
@MainActor
@Observable
final class AskAiChat {
    struct Turn: Identifiable {
        let id = UUID()
        var question: String
        var answer: String?
        var sources: [AiAnswer.Source] = []
        var problem: AiProblem?
    }

    var isOpen = false
    var turns: [Turn] = []
    var draft = ""
    private(set) var busy = false
    /// Only this folder's notes; nil searches all notes.
    var scope: AskFolder?
    /// Moves the keyboard to the question field.
    private(set) var focusToken = 0
    let stream = AiStreamRunner()

    /// Opens the chat: with a question typed in, or on a folder (a new conversation).
    func open(question: String? = nil, folder: AskFolder? = nil) {
        if let question, !question.isEmpty { draft = question }
        scope = folder
        if folder != nil { turns = [] }
        isOpen = true
        focusToken += 1
    }

    func toggle() {
        if isOpen { isOpen = false } else { open() }
    }

    func send(_ question: String, app: AppModel) {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy, let session = app.session else { return }
        let history: [JSONValue] = turns.flatMap { t -> [JSONValue] in
            guard let a = t.answer else { return [] }
            return [.object(["role": "user", "text": .string(t.question)]), .object(["role": "assistant", "text": .string(a)])]
        }
        turns.append(Turn(question: q))
        draft = ""
        busy = true
        let folderId = scope?.id
        Task {
            defer {
                stream.end()
                busy = false
                focusToken += 1
            }
            let streamId = await stream.begin(session)
            do {
                var args: [String: JSONValue] = ["scope": session.scope.arg, "question": .string(q), "history": .array(history)]
                if let folderId { args["folderId"] = .string(folderId) }
                if let streamId { args["streamId"] = .string(streamId) }
                let answer: AiAnswer = try await session.convex.action("ai:ask", args, timeout: 120)
                await stream.finish(answer.answer)
                update { $0.answer = answer.answer.isEmpty ? String(localized: "(stopped)") : answer.answer; $0.sources = answer.sources }
            } catch {
                update { $0.problem = AiProblem.from(error) }
            }
        }
    }

    private func update(_ change: (inout Turn) -> Void) {
        guard !turns.isEmpty else { return }
        change(&turns[turns.count - 1])
    }
}

/// "Ask AI" (the web's AskAiChat): a chat with your notes that pops out from the floating button in the
/// bottom-right corner (on a note, from ⌘J and the note's AI panel). It isn't modal: you can keep reading
/// and writing while it's open. Each answer cites the notes it used; follow-ups keep the conversation.
/// When credits run low it says so, and a refused request (out of credits) says what helps.
struct AskAiPanel: View {
    @Bindable var chat: AskAiChat
    var openDocument: (String) -> Void
    var close: () -> Void
    @Environment(AppModel.self) private var app
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                AiIcon(size: 20)
                Text("Ask AI").font(.ui(14.5, .semibold)).foregroundStyle(FoleviColor.heading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                IconButton(systemImage: "xmark", label: "Close chat", size: 32, action: close)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            divider
            conversation
            divider
            composer
        }
        .frame(width: 420)
        .frame(minHeight: 200, idealHeight: 640, maxHeight: 640)
        // Clip the content first, then the pop surface and its shadow (clipping after it cut the shadow away).
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .foleviPop(radius: 18)
        .claimsFocus($focused)
        .onChange(of: chat.focusToken) { _, _ in focused = true }
        .onExitCommand(perform: close)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Ask AI"))
        .accessibilityIdentifier("ai.askPanel")
    }

    private var divider: some View { FoleviColor.line.opacity(0.7).frame(height: 1) }

    // MARK: Conversation

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if chat.turns.isEmpty {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(chat.scope.map { String(localized: "Answers come from the notes in “\($0.name)”, with links to the notes used.") }
                                 ?? String(localized: "Answers come from your notes, with links to the notes used."))
                                .font(.ui(13.5)).foregroundStyle(FoleviColor.inkMuted)
                                .fixedSize(horizontal: false, vertical: true)
                            HStack(spacing: 8) {
                                AiIcon(size: 13)
                                Text("Try asking").font(.ui(12.5, .medium)).foregroundStyle(FoleviColor.inkMuted)
                            }
                            .padding(.top, 20)
                            .padding(.bottom, 10)
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(chat.scope == nil ? AskAiCatalog.suggestions : AskAiCatalog.folderSuggestions, id: \.self) { s in
                                    AiChipButton(title: s, fontSize: 13, horizontal: 12, height: 30) { chat.send(s, app: app) }
                                }
                            }
                        }
                    }
                    ForEach(chat.turns) { turn in
                        turnView(turn).id(turn.id)
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onAppear { proxy.scrollTo("end", anchor: .bottom) }
            .onChange(of: chat.turns.count) { _, _ in withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
            .onChange(of: chat.stream.text) { _, _ in proxy.scrollTo("end", anchor: .bottom) }
        }
        .accessibilityElement(children: .contain)
    }

    private static let answerShape = UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 4, bottomTrailingRadius: 14,
                                                            topTrailingRadius: 14, style: .continuous)

    @ViewBuilder private func turnView(_ turn: AskAiChat.Turn) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(turn.question)
                .font(.ui(14))
                .foregroundStyle(FoleviColor.canvas)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(FoleviColor.heading, in: UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 14, bottomTrailingRadius: 4, topTrailingRadius: 14, style: .continuous))
                .textSelection(.enabled)
                .frame(maxWidth: 330, alignment: .trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
            if let answer = turn.answer {
                VStack(alignment: .leading, spacing: 0) {
                    AiMarkdownView(markdown: answer)
                    if !turn.sources.isEmpty {
                        VStack(alignment: .leading, spacing: 0) {
                            divider
                            SourceList(sources: turn.sources, openDocument: openDocument).padding(.top, 10)
                        }
                        .padding(.top, 12)
                    }
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(AiCatalog.markdownToPlain(answer), forType: .string)
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc").font(.ui(12))
                    }
                    .buttonStyle(AiQuietButtonStyle())
                    .padding(.top, 8)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(FoleviGlass.active, in: Self.answerShape)
                .overlay(Self.answerShape.strokeBorder(FoleviGlass.border))
            } else if let problem = turn.problem {
                AiProblemNotice(problem: problem)
            } else if !chat.stream.text.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    AiMarkdownView(markdown: chat.stream.text, streaming: true)
                    AiStopButton { chat.stream.stop() }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(FoleviGlass.active, in: Self.answerShape)
                .overlay(Self.answerShape.strokeBorder(FoleviGlass.border))
            } else {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Reading your notes…").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                }
                .padding(.horizontal, 4)
            }
        }
    }

    // MARK: Composer

    private var canSend: Bool { !chat.busy && !chat.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            AiCreditsNote()
            if let folder = chat.scope {
                HStack(spacing: 6) {
                    Image(systemName: "folder").font(.system(size: 12)).accessibilityHidden(true)
                    (Text("In folder ") + Text(folder.name).fontWeight(.semibold).foregroundColor(FoleviColor.heading))
                        .lineLimit(1)
                    Button("Search all notes instead") { chat.scope = nil }
                        .buttonStyle(AiQuietButtonStyle())
                }
                .font(.ui(12.5))
                .foregroundStyle(FoleviColor.inkMuted)
                .padding(.horizontal, 4)
            }
            ZStack(alignment: .bottomTrailing) {
                TextField(chat.turns.isEmpty ? "Ask anything about your notes…" : "Ask a follow-up…", text: $chat.draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.ui(14))
                    .foregroundStyle(FoleviColor.ink)
                    .lineLimit(2, reservesSpace: true)
                    .focused($focused)
                    .onSubmit { chat.send(chat.draft, app: app) }
                    .padding(.leading, 14)
                    .padding(.trailing, 48)
                    .padding(.top, 12)
                    .padding(.bottom, 8)
                    .accessibilityLabel(Text("Ask a question about your notes"))
                Button { chat.send(chat.draft, app: app) } label: {
                    Image(systemName: "arrow.up").font(.system(size: 14, weight: .bold)).foregroundStyle(FoleviColor.canvas)
                        .frame(width: 32, height: 32)
                        .background(FoleviColor.heading, in: Circle())
                }
                .buttonStyle(.plain)
                .opacity(canSend ? 1 : 0.3)
                .disabled(!canSend)
                .padding(10)
                .accessibilityLabel(Text("Ask"))
            }
            .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(focused ? FoleviColor.heading.opacity(0.22) : FoleviGlass.border, lineWidth: focused ? 1.5 : 1))
            HStack(alignment: .center, spacing: 8) {
                Text("AI can make mistakes. Questions and the notes they need go to Google Gemini.")
                    .font(.ui(11))
                    .foregroundStyle(FoleviColor.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !chat.turns.isEmpty {
                    Button { chat.turns = [] } label: { Label("New chat", systemImage: "arrow.counterclockwise").font(.ui(11)) }
                        .buttonStyle(AiQuietButtonStyle())
                }
            }
            .padding(.horizontal, 4)
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 12)
    }
}

/// The small quiet text buttons in the AI panels (Copy, Stop, New chat): muted, a soft fill on hover.
struct AiQuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        AiQuietButtonBody(configuration: configuration)
    }
}

private struct AiQuietButtonBody: View {
    let configuration: ButtonStyle.Configuration
    @State private var hovering = false

    var body: some View {
        configuration.label
            .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.inkMuted)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(hovering || configuration.isPressed ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
    }
}

/// A rounded suggestion or quick-change chip ("Try asking", "Shorter", "More formal").
struct AiChipButton: View {
    var title: String
    var fontSize: CGFloat = 12
    var horizontal: CGFloat = 10
    var height: CGFloat = 26
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.ui(fontSize))
                .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.ink)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, horizontal)
                .frame(minHeight: height)
                .background(hovering ? FoleviGlass.active : FoleviGlass.hover, in: Capsule())
                .overlay(Capsule().strokeBorder(FoleviGlass.border))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

struct SourceList: View {
    var sources: [AiAnswer.Source]
    var openDocument: (String) -> Void
    var showsLabel = true

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if showsLabel { Text("Sources").foleviCapsLabel() }
            FlowLayout(spacing: 6) {
                ForEach(Array(sources.enumerated()), id: \.element.id) { i, s in
                    Button {
                        openDocument(s.id)
                    } label: {
                        HStack(spacing: 6) {
                            Text("\(i + 1)").font(.ui(12.5, .semibold)).foregroundStyle(FoleviColor.inkMuted)
                            Image(systemName: "doc.text").font(.system(size: 11)).foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                            Text(s.title.isEmpty ? String(localized: "Untitled") : s.title)
                                .font(.ui(12.5))
                                .foregroundStyle(FoleviColor.ink)
                                .lineLimit(1)
                        }
                        .padding(.horizontal, 10)
                        .frame(height: 26)
                        .background(FoleviGlass.hover, in: Capsule())
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Source \(i + 1): \(s.title.isEmpty ? String(localized: "Untitled") : s.title)"))
                }
            }
        }
    }
}

/// "Catch me up" on Home (the web's CatchUp): a short AI brief of this week's notes and what's due, citing
/// the notes. Generated on request (never automatically), kept while the app runs.
struct CatchUpView: View {
    var openDocument: (String) -> Void
    @Environment(AppModel.self) private var app
    @State private var data: AiAnswer?
    @State private var busy = false
    @State private var problem: AiProblem?
    @State private var stream = AiStreamRunner()

    /// Briefs per context (Personal or a workspace), for this run of the app.
    @MainActor private static var saved: [String: AiAnswer] = [:]

    var body: some View {
        Group {
            if data == nil && !busy {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 12) {
                        Button(action: run) {
                            HStack(spacing: 8) {
                                AiIcon(size: 15)
                                Text("Catch me up").font(.ui(13.5, .semibold))
                            }
                            .foregroundStyle(FoleviColor.heading)
                            .padding(.horizontal, 16)
                            .frame(height: 40)
                            .background(FoleviGlass.active, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviGlass.border))
                            .shadow(color: .black.opacity(0.06), radius: 3, y: 1)
                            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        Text("A quick AI brief of this week’s notes and what’s due.").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                        Spacer(minLength: 0)
                    }
                    // The web's flex-wrap row: the notice takes the 12pt gap only when it shows.
                    Group {
                        if let problem { AiProblemNotice(problem: problem).padding(.top, 12) } else { AiCreditsNote(spacingAbove: 12) }
                    }
                    .frame(maxWidth: 576, alignment: .leading)
                }
            } else {
                brief
            }
        }
        .onAppear { data = Self.saved[app.scope.key] }
        .onChange(of: app.scope.key) { _, key in
            data = Self.saved[key]
            problem = nil
        }
    }

    private var brief: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                AiIcon(size: 15)
                Text("Your week").font(FoleviType.display(18)).foregroundStyle(FoleviColor.heading)
                Spacer()
                if data != nil && !busy {
                    IconButton(systemImage: "arrow.counterclockwise", label: "Refresh brief", size: 32, action: run)
                    IconButton(systemImage: "xmark", label: "Close brief", size: 32, action: clear)
                }
            }
            if busy && !stream.text.isEmpty {
                AiMarkdownView(markdown: stream.text, streaming: true)
            } else if busy {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Reading this week’s notes…").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    AiShimmer(widths: [0.9, 0.75, 0.82, 0.6], height: 11)
                }
            } else if let data {
                AiMarkdownView(markdown: data.answer)
                if !data.sources.isEmpty {
                    SourceList(sources: data.sources, openDocument: openDocument, showsLabel: false)
                }
            }
            if let problem {
                AiProblemNotice(problem: problem)
            } else if data != nil && !busy {
                AiCreditsNote()
            }
        }
        .padding(20)
        .frame(maxWidth: 760, alignment: .leading)
        .foleviCard(radius: 16, fill: FoleviGlass.active)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Catch-up brief"))
    }

    private func clear() {
        data = nil
        Self.saved[app.scope.key] = nil
    }

    private func run() {
        guard let session = app.session, !busy else { return }
        busy = true
        problem = nil
        let key = app.scope.key
        Task {
            defer {
                stream.end()
                busy = false
            }
            let streamId = await stream.begin(session)
            do {
                var args: [String: JSONValue] = ["scope": session.scope.arg, "today": .string(TaskLogic.localDate())]
                if let streamId { args["streamId"] = .string(streamId) }
                let r: AiAnswer = try await session.convex.action("ai:brief", args, timeout: 120)
                await stream.finish(r.answer)
                Self.saved[key] = r
                if app.scope.key == key { data = r }
            } catch {
                problem = AiProblem.from(error)
            }
        }
    }
}
