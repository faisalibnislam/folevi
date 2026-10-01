import SwiftUI

/// Folevi's AI mark: eight petals in the brand's violet-to-coral gradient, the same image the web
/// draws (FoleviAI, rendered from packages/design-tokens/brand/source/ai-icon.svg by brand-icons.mjs).
/// It keeps its own colours, so a foreground style on it has no effect.
struct AiIcon: View {
    var size: CGFloat = 16

    var body: some View {
        Image("FoleviAI")
            .resizable()
            .interpolation(.high)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Renders the AI's Markdown answers: "## " headings, "- " bullets and "- [ ]" to-dos, paragraphs, and
/// inline Markdown (bold, italic, code, links). Citations [n] stay as written.
struct AiMarkdownView: View {
    var markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .heading(let t):
                    inline(t).font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading).padding(.top, 4)
                case .bullet(let t):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("•").foregroundStyle(FoleviColor.inkMuted)
                        inline(t)
                    }
                case .paragraph(let t):
                    inline(t)
                }
            }
        }
        .font(.ui(13.5))
        .foregroundStyle(FoleviColor.ink)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private enum Block { case heading(String), bullet(String), paragraph(String) }

    private var blocks: [Block] {
        var out: [Block] = []
        var para: [String] = []
        func flush() {
            if !para.isEmpty { out.append(.paragraph(para.joined(separator: " "))); para = [] }
        }
        for raw in markdown.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { flush(); continue }
            if let r = line.range(of: #"^#{1,6}\s+"#, options: .regularExpression) {
                flush(); out.append(.heading(String(line[r.upperBound...])))
            } else if let r = line.range(of: #"^([-*•]|\d+\.)\s+(\[[ xX]\]\s+)?"#, options: .regularExpression) {
                flush(); out.append(.bullet(String(line[r.upperBound...])))
            } else {
                para.append(line)
            }
        }
        flush()
        return out
    }

    private func inline(_ text: String) -> Text {
        if let attributed = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            return Text(attributed)
        }
        return Text(text)
    }
}

/// The floating "AI Assistant" launcher (bottom right; hidden on note pages, as on the web).
struct AiLauncher: View {
    @Binding var isOpen: Bool

    var body: some View {
        Button {
            isOpen.toggle()
        } label: {
            HStack(spacing: 9) {
                AiIcon(size: 15)
                Text("AI Assistant").font(.ui(14.5, .medium))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 18)
            .frame(height: 46)
            .background(Color.black, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .shadow(color: .black.opacity(0.1), radius: 12, y: 6)
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .help(Text("Ask about your notes"))
        .accessibilityLabel(Text(isOpen ? "Close AI Assistant" : "AI Assistant"))
        .accessibilityIdentifier("ai.launcher")
    }
}

/// "Ask AI": questions answered from your notes, with the notes it used (the web's AskAiChat).
struct AskAiPanel: View {
    var openDocument: (String) -> Void
    var close: () -> Void
    /// Ask about this note first (the note's AI); nil asks across all notes.
    var documentId: String?
    @Environment(AppModel.self) private var app
    @State private var turns: [Turn] = []
    @State private var question = ""
    @State private var busy = false
    @FocusState private var focused: Bool

    struct Turn: Identifiable {
        let id = UUID()
        var role: String
        var text: String
        var sources: [AiAnswer.Source] = []
        var failed = false
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                AiIcon(size: 14).foregroundStyle(FoleviColor.heading)
                Text(documentId == nil ? "Ask AI" : "Ask about this note").font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading)
                Spacer()
                if !turns.isEmpty {
                    Button("New Chat") { turns = [] }.buttonStyle(.plain).font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                }
                IconButton(systemImage: "xmark", label: "Close", size: 26, action: close)
            }
            .padding(.horizontal, 14)
            .frame(height: 48)
            Divider().opacity(0.5)
            if !app.aiIncludedHere {
                upsell
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            if turns.isEmpty {
                                Text(documentId == nil ? "Ask anything about your notes. Folevi answers from them and shows which notes it used."
                                     : "Ask about this note, or anything in your notes. Folevi starts with this one and shows which notes it used.")
                                    .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                            }
                            ForEach(turns) { turn in message(turn).id(turn.id) }
                            if busy {
                                HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Thinking…").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted) }
                                    .id("busy")
                            }
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .onChange(of: turns.count) { _, _ in withAnimation { proxy.scrollTo(busy ? "busy" : turns.last?.id as AnyHashable?, anchor: .bottom) } }
                }
                Divider().opacity(0.5)
                HStack(spacing: 8) {
                    TextField("Ask about your notes…", text: $question, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.ui(13.5))
                        .lineLimit(1...5)
                        .focused($focused)
                        .onSubmit(send)
                    Button(action: send) {
                        Image(systemName: "arrow.up").font(.system(size: 12, weight: .bold)).foregroundStyle(FoleviColor.accentInk)
                            .frame(width: 28, height: 28)
                            .background(FoleviColor.accent, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(busy || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel(Text("Ask"))
                }
                .padding(12)
            }
        }
        .frame(width: 400, height: 540)
        .background(FoleviColor.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(FoleviGlass.border))
        .shadow(color: .black.opacity(0.1), radius: 24, y: 10)
        .onAppear { focused = true }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Ask AI"))
    }

    private var upsell: some View {
        VStack(spacing: 12) {
            AiIcon(size: 28).foregroundStyle(FoleviColor.heading)
            Text("AI Assistant comes with Pro").font(FoleviType.display(20)).foregroundStyle(FoleviColor.heading)
            Text("Ask questions about your notes, get summaries and help with writing.")
                .multilineTextAlignment(.center).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
            Button("See Plans…") { openWebApp("settings/billing", config: app.config) }
                .buttonStyle(.folevi(.primary))
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder private func message(_ turn: Turn) -> some View {
        if turn.role == "user" {
            Text(turn.text)
                .font(.ui(13.5))
                .foregroundStyle(FoleviColor.heading)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .textSelection(.enabled)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if turn.failed {
                    Text(turn.text).font(.ui(13)).foregroundStyle(FoleviColor.destructive)
                } else {
                    AiMarkdownView(markdown: turn.text)
                }
                if !turn.sources.isEmpty {
                    SourceList(sources: turn.sources, openDocument: openDocument)
                }
            }
        }
    }

    private func send() {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy, let session = app.session else { return }
        let history = turns.filter { !$0.failed }.suffix(6).map { JSONValue.object(["role": .string($0.role), "text": .string($0.text)]) }
        turns.append(Turn(role: "user", text: q))
        question = ""
        busy = true
        Task {
            defer { busy = false }
            do {
                var args: [String: JSONValue] = [
                    "scope": session.scope.arg, "question": .string(q), "history": .array(Array(history)),
                ]
                if let documentId { args["documentId"] = .string(documentId) }
                let answer: AiAnswer = try await session.convex.action("ai:ask", args, timeout: 90)
                turns.append(Turn(role: "assistant", text: answer.answer, sources: answer.sources))
            } catch {
                turns.append(Turn(role: "assistant", text: ConvexService.mapError(error).localizedDescription, failed: true))
            }
        }
    }
}

/// The notes an answer used, as chips that open them.
struct SourceList: View {
    var sources: [AiAnswer.Source]
    var openDocument: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Sources").foleviCapsLabel()
            FlowLayout(spacing: 6) {
                ForEach(Array(sources.enumerated()), id: \.element.id) { i, s in
                    Button {
                        openDocument(s.id)
                    } label: {
                        Text("\(i + 1). \(s.title.isEmpty ? String(localized: "Untitled") : s.title)")
                            .font(.ui(12, .medium))
                            .foregroundStyle(FoleviColor.heading)
                            .lineLimit(1)
                            .padding(.horizontal, 9)
                            .frame(height: 26)
                            .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// "Catch me up" on Home: a short AI brief of this week's notes and what's due (the web's CatchUp).
struct CatchUpView: View {
    var openDocument: (String) -> Void
    @Environment(AppModel.self) private var app
    @State private var result: AiAnswer?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Button(action: run) {
                    HStack(spacing: 8) {
                        if busy { ProgressView().controlSize(.small) } else { AiIcon(size: 14) }
                        Text("Catch me up").font(.ui(13.5, .semibold))
                    }
                    .foregroundStyle(FoleviColor.heading)
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .background(FoleviColor.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviGlass.border))
                    .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
                }
                .buttonStyle(.plain)
                .disabled(busy)
                Text("A quick AI brief of this week’s notes and what’s due.").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                Spacer()
                if result != nil {
                    Button("Close") { result = nil }.buttonStyle(.plain).font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                }
            }
            if let error {
                Text(error).font(.ui(13)).foregroundStyle(FoleviColor.destructive)
            }
            if let result {
                VStack(alignment: .leading, spacing: 12) {
                    AiMarkdownView(markdown: result.answer)
                    if !result.sources.isEmpty { SourceList(sources: result.sources, openDocument: openDocument) }
                }
                .padding(18)
                .frame(maxWidth: 760, alignment: .leading)
                .background(FoleviColor.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(FoleviGlass.border))
            }
        }
    }

    private func run() {
        guard let session = app.session, !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                result = try await session.convex.action("ai:brief", [
                    "scope": session.scope.arg, "today": .string(TaskLogic.localDate()),
                ], timeout: 90)
            } catch {
                self.error = ConvexService.mapError(error).localizedDescription
            }
        }
    }
}

/// Lays out children left to right, wrapping onto new lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(maxX, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// The result of an AI action on selected text: Replace (or Insert below for Explain / Summarize) or Discard.
struct InlineAiCard: View {
    @Bindable var model: EditorModel

    private var title: String {
        guard let task = model.inlineAi?.task else { return "" }
        return BlockTextView.aiTasks.first { $0.task == task }?.title ?? String(localized: "AI")
    }

    var body: some View {
        if let ai = model.inlineAi {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    AiIcon(size: 13).foregroundStyle(FoleviColor.heading)
                    Text(title).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading)
                    Spacer()
                    IconButton(systemImage: "xmark", label: "Discard", size: 24) { model.inlineAi = nil }
                }
                if let error = ai.error {
                    Text(error).font(.ui(13)).foregroundStyle(FoleviColor.destructive)
                } else if let result = ai.result {
                    ScrollView {
                        AiMarkdownView(markdown: result).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 220)
                    HStack(spacing: 8) {
                        if ai.replaces {
                            Button("Replace") { model.applyInlineAi(replace: true) }
                                .buttonStyle(.folevi(.primary))
                                .keyboardShortcut(.defaultAction)
                        }
                        Button("Insert Below") { model.applyInlineAi(replace: false) }
                            .buttonStyle(.folevi(ai.replaces ? .secondary : .primary))
                        Button("Copy") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(result, forType: .string)
                        }
                        .buttonStyle(.folevi(.quiet))
                        Spacer()
                        Button("Discard") { model.inlineAi = nil }
                            .buttonStyle(.folevi(.quiet))
                            .keyboardShortcut(.cancelAction)
                    }
                } else {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Writing…").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    }
                }
            }
            .padding(16)
            .frame(width: 520)
            .background(FoleviColor.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(FoleviGlass.border))
            .shadow(color: .black.opacity(0.1), radius: 20, y: 8)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("AI result"))
        }
    }
}
