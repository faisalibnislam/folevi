import AppKit
import SwiftUI

/// "Ask AI" (the web's AskAiChat): a chat with your notes. Each answer cites the notes it used; follow-ups
/// keep the conversation; answers stream in as they're written. On a note (`documentId`), it can answer
/// from this note only or from all your notes, starting with this one. When credits run low it says so, and
/// a refused request (out of credits, or AI not included) says what helps.
struct AskAiPanel: View {
    var openDocument: (String) -> Void
    var close: () -> Void
    /// Ask about this note (the note's AI); nil asks across all notes.
    var documentId: String?
    @Environment(AppModel.self) private var app
    @State private var turns: [Turn] = []
    @State private var question = ""
    @State private var busy = false
    @State private var range: Range = .all
    @State private var stream = AiStreamRunner()
    @FocusState private var focused: Bool

    enum Range: Hashable { case note, all }

    struct Turn: Identifiable {
        let id = UUID()
        var question: String
        var answer: String?
        var sources: [AiAnswer.Source] = []
        var problem: AiProblem?
    }

    private static let suggestions = [
        String(localized: "What am I working on this week?"), String(localized: "Summarize my notes about travel"),
        String(localized: "Which tasks are still open?"), String(localized: "What ideas have I written down recently?"),
    ]
    private static let noteSuggestions = [
        String(localized: "Summarize this note"), String(localized: "What are the open questions here?"),
        String(localized: "What decisions have been made?"), String(localized: "What should I do next?"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                AiIcon(size: 20)
                Text("Ask AI").font(.ui(14.5, .semibold)).foregroundStyle(FoleviColor.heading)
                Spacer()
                IconButton(systemImage: "xmark", label: "Close chat", size: 28, action: close)
            }
            .padding(.horizontal, 16)
            .frame(height: 52)
            divider
            if !app.aiIncludedHere {
                notIncluded
            } else {
                conversation
                divider
                composer
            }
        }
        .frame(width: 420, height: 560)
        .foleviPop(radius: 18)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .onAppear { focused = true }
        .onExitCommand(perform: close)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Ask AI"))
        .accessibilityIdentifier("ai.askPanel")
    }

    private var divider: some View { FoleviColor.line.opacity(0.7).frame(height: 1) }

    /// AI isn't part of the plan here (Core).
    private var notIncluded: some View {
        VStack(spacing: 12) {
            AiIcon(size: 28)
            Text("AI isn't included here").font(FoleviType.display(20)).foregroundStyle(FoleviColor.heading)
            Text("Core doesn't include AI, so nothing in your notes is sent to an AI model. Pro and Pro AI come with AI credits every month.")
                .multilineTextAlignment(.center).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
            if app.workspace == nil {
                Button("Upgrade") { openBilling(app) }
                    .buttonStyle(.folevi(.primary))
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Conversation

    private var intro: String {
        guard documentId != nil else { return String(localized: "Answers come from your notes, with links to the notes used.") }
        return range == .note ? String(localized: "Answers come from this note only.")
            : String(localized: "Answers come from this note and your other notes, with links to the notes used.")
    }

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if turns.isEmpty {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(intro).font(.ui(13.5)).foregroundStyle(FoleviColor.inkMuted)
                            HStack(spacing: 8) {
                                AiIcon(size: 13)
                                Text("Try asking").font(.ui(12.5, .medium)).foregroundStyle(FoleviColor.inkMuted)
                            }
                            .padding(.top, 20)
                            .padding(.bottom, 10)
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(documentId == nil ? Self.suggestions : Self.noteSuggestions, id: \.self) { s in
                                    Button { send(s) } label: {
                                        Text(s)
                                            .font(.ui(13))
                                            .foregroundStyle(FoleviColor.ink)
                                            .multilineTextAlignment(.leading)
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 6)
                                            .background(FoleviGlass.hover, in: Capsule())
                                            .overlay(Capsule().strokeBorder(FoleviGlass.border))
                                            .contentShape(Capsule())
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    ForEach(turns) { turn in
                        turnView(turn).id(turn.id)
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: turns.count) { _, _ in withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
            .onChange(of: stream.text) { _, _ in proxy.scrollTo("end", anchor: .bottom) }
        }
    }

    @ViewBuilder private func turnView(_ turn: Turn) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(turn.question)
                .font(.ui(14))
                .foregroundStyle(FoleviColor.canvas)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(FoleviColor.heading, in: UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 14, bottomTrailingRadius: 4, topTrailingRadius: 14, style: .continuous))
                .textSelection(.enabled)
                .frame(maxWidth: 340, alignment: .trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
            if let answer = turn.answer {
                VStack(alignment: .leading, spacing: 10) {
                    AiMarkdownView(markdown: answer)
                    if !turn.sources.isEmpty {
                        divider
                        SourceList(sources: turn.sources, openDocument: openDocument)
                    }
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(AiCatalog.markdownToPlain(answer), forType: .string)
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc").font(.ui(12))
                    }
                    .buttonStyle(.folevi(.quiet, .small))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(FoleviGlass.active, in: UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 4, bottomTrailingRadius: 14, topTrailingRadius: 14, style: .continuous))
            } else if let problem = turn.problem {
                AiProblemNotice(problem: problem)
            } else if !stream.text.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    AiMarkdownView(markdown: stream.text)
                    AiStopButton { stream.stop() }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(FoleviGlass.active, in: UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 4, bottomTrailingRadius: 14, topTrailingRadius: 14, style: .continuous))
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

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            AiCreditsNote(documentId: documentId != nil && range == .note ? documentId : nil)
            if documentId != nil {
                FoleviSegmented(selection: $range, items: [
                    .init(value: .note, title: "This note"),
                    .init(value: .all, title: "All notes"),
                ], accessibilityLabel: "What to ask about")
                .frame(width: 220)
                .disabled(busy)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(turns.isEmpty ? "Ask anything about your notes…" : "Ask a follow-up…", text: $question, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.ui(14))
                    .lineLimit(2...6)
                    .focused($focused)
                    .onSubmit { send(question) }
                    .accessibilityLabel(Text("Ask a question about your notes"))
                Button { send(question) } label: {
                    Image(systemName: "arrow.up").font(.system(size: 13, weight: .bold)).foregroundStyle(FoleviColor.canvas)
                        .frame(width: 30, height: 30)
                        .background(FoleviColor.heading, in: Circle())
                }
                .buttonStyle(.plain)
                .opacity(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy ? 0.3 : 1)
                .disabled(busy || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel(Text("Ask"))
            }
            .padding(.leading, 14)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(FoleviGlass.border))
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("AI can make mistakes. Questions and the notes they need go to Google Gemini.")
                    .font(.ui(11))
                    .foregroundStyle(FoleviColor.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if !turns.isEmpty {
                    Button { turns = [] } label: { Label("New chat", systemImage: "arrow.counterclockwise").font(.ui(12)) }
                        .buttonStyle(.folevi(.quiet, .small))
                        .disabled(busy)
                }
            }
            .padding(.horizontal, 4)
        }
        .padding(12)
    }

    private func send(_ text: String) {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy, let session = app.session else { return }
        let history: [JSONValue] = turns.flatMap { t -> [JSONValue] in
            guard let a = t.answer else { return [] }
            return [.object(["role": "user", "text": .string(t.question)]), .object(["role": "assistant", "text": .string(a)])]
        }
        turns.append(Turn(question: q))
        question = ""
        busy = true
        let documentId = self.documentId
        let range = self.range
        Task {
            defer {
                stream.end()
                busy = false
                focused = true
            }
            let streamId = await stream.begin(session)
            do {
                var args: [String: JSONValue] = ["scope": session.scope.arg, "question": .string(q), "history": .array(history)]
                if let documentId {
                    args["documentId"] = .string(documentId)
                    args["range"] = .string(range == .note ? "note" : "all")
                }
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

/// The notes an answer used, as chips that open them.
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
                VStack(alignment: .leading, spacing: 12) {
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
                    Group {
                        if let problem { AiProblemNotice(problem: problem) } else { AiCreditsNote() }
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
                    IconButton(systemImage: "arrow.counterclockwise", label: "Refresh brief", size: 30, action: run)
                    IconButton(systemImage: "xmark", label: "Close brief", size: 30, action: clear)
                }
            }
            if busy && !stream.text.isEmpty {
                AiMarkdownView(markdown: stream.text)
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
