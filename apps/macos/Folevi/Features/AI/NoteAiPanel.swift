import AppKit
import SwiftUI

/// Where a result from the note's AI panel goes: replacing selected text, after the block at the cursor,
/// or at the end of the note (the web's AiPlacement).
enum AiPanelPlacement: Equatable {
    case replace(blockId: String, range: NSRange, original: String)
    case cursor
    case end
}

extension EditorModel {
    /// The text selected in the note (one block), if any: context for writing.
    func aiSelectedText() -> (blockId: String, range: NSRange, text: String)? {
        guard let id = focusedBlockId, id != "__title__", let tv = textView(id) else { return nil }
        let r = tv.selectedRange()
        let ns = tv.string as NSString
        guard r.length > 0, NSMaxRange(r) <= ns.length else { return nil }
        let text = ns.substring(with: r)
        return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : (id, r, text)
    }

    /// Puts a result from the AI panel in the note. Returns a notice when the selected text changed since it
    /// was sent (the result then goes below it instead).
    @discardableResult
    func applyAiPanelResult(_ markdown: String, placement: AiPanelPlacement) -> String? {
        switch placement {
        case .replace(let blockId, let range, let original):
            return applyAiResult(markdown, target: .text(blockId: blockId, range: range, text: original), replace: true, cursorBlockId: blockId)
        case .cursor:
            let at = focusedBlockId.flatMap { $0 != "__title__" && blocks[$0] != nil ? $0 : nil } ?? rows.last?.id
            return applyAiResult(markdown, target: nil, replace: false, cursorBlockId: at)
        case .end:
            let lastRoot = rows.last { $0.block.parentId == nil }?.id
            return applyAiResult(markdown, target: nil, replace: false, cursorBlockId: lastRoot)
        }
    }
}

/// The note's AI panel (the web's AiPanel, dock → AI): one-click writing help for the note, a prompt that
/// writes or answers, and a result you can insert, use to replace the selection, copy, retry or discard.
struct NoteAiPanel: View {
    var editor: EditorModel
    var close: () -> Void
    /// Opens the full Ask AI chat with what's typed.
    var openAsk: (String) -> Void
    var openDocument: (String) -> Void
    @Environment(AppModel.self) private var app
    @State private var mode: Mode = .write
    @State private var prompt = ""
    @State private var busy: String?
    @State private var problem: AiProblem?
    @State private var result: Outcome?
    @State private var notice: String?
    @State private var stream = AiStreamRunner()
    @State private var contentHeight: CGFloat = 420
    @FocusState private var focused: Bool

    enum Mode: Hashable { case write, ask }

    struct Request: Equatable {
        var task: String
        var text: String?
        var instruction: String?
        var language: String?
        var placement: AiPanelPlacement
    }

    enum Outcome: Equatable {
        case write(task: String, text: String, placement: AiPanelPlacement, request: Request)
        case ask(question: String, text: String, sources: [AiAnswer.Source])

        var text: String {
            switch self {
            case .write(_, let t, _, _), .ask(_, let t, _): return t
            }
        }
    }

    private var readOnly: Bool { editor.isReadOnly }

    var body: some View {
        VStack(spacing: 0) {
            // Floating panel opened from the dock: only its name is shown.
            HStack(spacing: 4) {
                Text("AI")
                    .font(FoleviType.display(18))
                    .tracking(FoleviType.displayTracking(18))
                    .foregroundStyle(FoleviColor.heading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                IconButton(systemImage: "xmark", label: "Close inspector", size: 28, action: close)
            }
            .padding(.horizontal, 4)
            .frame(height: 36)
            .padding(.horizontal, 12)
            .padding(.top, 10)
            ScrollView {
                content
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                    .padding(.bottom, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .scrollIndicators(.automatic)
            // As tall as what's in it, up to the room there is (and 640 points).
            .frame(maxHeight: contentHeight)
        }
        .frame(width: 400)
        .frame(maxHeight: 640)
        .foleviPop(radius: 14)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .claimsFocus($focused)
        .onExitCommand(perform: close)
        .onDisappear { stream.end() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("AI"))
        .accessibilityIdentifier("ai.notePanel")
    }

    @ViewBuilder private var content: some View {
        VStack(alignment: .leading, spacing: 16) {
            promptSection
            if mode == .write {
                quickActions
            } else {
                Button { openAsk(prompt) } label: {
                    Text("Open the full Ask AI window (⌘J)").font(.ui(12.5))
                }
                .buttonStyle(AiLinkButtonStyle())
                .padding(.horizontal, 4)
            }
            status
            if let result, busy == nil { resultCard(result) }
            Text("AI can make mistakes, so check what it writes. Your request and the notes it needs are sent to Google Gemini.")
                .font(.ui(11))
                .foregroundStyle(FoleviColor.inkFaint)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
        }
        .font(.ui(14))
    }

    // MARK: Prompt

    private var canSubmit: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && busy == nil && !(mode == .write && readOnly)
    }

    private var promptSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            FoleviSegmented(selection: $mode, items: [
                .init(value: .write, title: "Write"),
                .init(value: .ask, title: "Ask"),
            ], accessibilityLabel: "What the AI should do")
            .padding(.bottom, 8)
            ZStack(alignment: .bottomTrailing) {
                TextField(mode == .write ? "Write a friendly intro paragraph…" : "What did we decide about…?", text: $prompt, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.ui(13.5))
                    .foregroundStyle(FoleviColor.ink)
                    .lineLimit(2, reservesSpace: true)
                    .focused($focused)
                    .disabled(mode == .write && readOnly)
                    .onSubmit(submit)
                    .padding(.horizontal, 12)
                    .padding(.top, 10)
                    .padding(.bottom, 36)
                    .accessibilityLabel(Text(mode == .write ? "Tell the AI what to write" : "Ask about this note and your other notes"))
                Button(action: submit) {
                    Image(systemName: "arrow.up").font(.system(size: 13, weight: .bold)).foregroundStyle(FoleviColor.canvas)
                        .frame(width: 28, height: 28)
                        .background(FoleviColor.heading, in: Circle())
                }
                .buttonStyle(.plain)
                .opacity(canSubmit ? 1 : 0.3)
                .disabled(!canSubmit)
                .padding(8)
                .accessibilityLabel(Text(mode == .write ? "Write" : "Ask"))
            }
            .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(focused ? FoleviColor.focus : FoleviGlass.border, lineWidth: focused ? 1.5 : 1))
            Text(mode == .write ? "Uses this note (and any selected text) as context. ↵ to send." : "Answers from this note and your other notes, with sources.")
                .font(.ui(11.5))
                .foregroundStyle(FoleviColor.inkFaint)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
                .padding(.top, 6)
            // Writing uses the note's own scope; asking searches where you are.
            AiCreditsNote(documentId: mode == .write ? editor.documentId : nil).padding(.top, 8)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Ask AI"))
    }

    private func submit() {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, busy == nil else { return }
        if mode == .ask { return doAsk(text) }
        guard !readOnly else { return }
        doWrite(Request(task: "draft", text: editor.aiSelectedText()?.text, instruction: text, placement: .cursor))
    }

    // MARK: Quick actions

    private var quickActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("For this note").foleviCapsLabel().padding(.horizontal, 4).accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
                ForEach(AiPanelCatalog.noteActions, id: \.task) { a in
                    NoteAiActionButton(title: a.label, systemImage: a.systemImage) {
                        doWrite(Request(task: a.task, placement: AiPanelCatalog.placesAtEnd(task: a.task) ? .end : .cursor))
                    }
                    .disabled(busy != nil || (readOnly && !AiPanelCatalog.availableReadOnly(task: a.task)))
                }
            }
        }
    }

    // MARK: Status

    @ViewBuilder private var status: some View {
        if let busy, !stream.text.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    AiIcon(size: 13).modifier(AiPulse())
                    Text("\(busy)…").font(.ui(12, .semibold)).foregroundStyle(FoleviColor.inkMuted)
                }
                ScrollView {
                    AiMarkdownView(markdown: stream.text, streaming: true).padding(.trailing, 4)
                }
                .defaultScrollAnchor(.bottom)
                .frame(maxHeight: 320)
                .fixedSize(horizontal: false, vertical: true)
                AiStopButton { stream.stop() }
            }
            .padding(12)
            .background(FoleviGlass.active, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(FoleviGlass.border))
            .accessibilityElement(children: .contain)
        } else if let busy {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("\(busy)…").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .accessibilityElement(children: .combine)
        }
        if let problem { AiProblemNotice(problem: problem) }
        if let notice {
            Text(notice).font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 4)
        }
    }

    // MARK: Result

    private func resultTitle(_ r: Outcome) -> String {
        switch r {
        case .ask(let question, _, _): return question
        case .write(let task, _, _, _): return AiPanelCatalog.label(task: task)
        }
    }

    @ViewBuilder private func resultCard(_ r: Outcome) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                AiIcon(size: 13)
                Text(resultTitle(r)).font(.ui(12, .semibold)).foregroundStyle(FoleviColor.inkMuted).lineLimit(2)
                Spacer(minLength: 0)
                if case .write(let task, _, _, let request) = r, task == "translate" {
                    CollabChoiceButton(options: AiCatalog.languages.map { ($0, $0) },
                                       selection: Binding(get: { request.language ?? "English" }, set: { language in
                                           var next = request
                                           next.language = language
                                           doWrite(next)
                                       }), accessibilityLabel: "Language", height: 28)
                }
            }
            .padding(.bottom, 8)
            if case .write(let task, let text, _, _) = r, task == "title" {
                Text(text).font(FoleviType.display(18)).foregroundStyle(FoleviColor.heading).textSelection(.enabled)
            } else {
                ScrollView {
                    AiMarkdownView(markdown: r.text).padding(.trailing, 4)
                }
                .frame(maxHeight: 320)
                .fixedSize(horizontal: false, vertical: true)
            }
            if case .ask(_, _, let sources) = r, !sources.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(Array(sources.enumerated()), id: \.element.id) { i, s in
                        Button { openDocument(s.id) } label: {
                            HStack(spacing: 4) {
                                Text("\(i + 1)").font(.ui(11.5, .semibold)).foregroundStyle(FoleviColor.inkMuted)
                                Text(s.title.isEmpty ? String(localized: "Untitled") : s.title).font(.ui(11.5)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                            }
                            .padding(.horizontal, 8)
                            .frame(height: 22)
                            .background(FoleviGlass.hover, in: Capsule())
                            .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Source \(i + 1): \(s.title.isEmpty ? String(localized: "Untitled") : s.title)"))
                    }
                }
                .padding(.top, 8)
            }
            actions(r).padding(.top, 12)
            if case .write(let task, let text, let placement, _) = r, task != "title" {
                FlowLayout(spacing: 6) {
                    ForEach(AiCatalog.refines, id: \.self) { change in
                        AiChipButton(title: change) {
                            doWrite(Request(task: "refine", text: text, instruction: change, placement: placement))
                        }
                    }
                }
                .padding(.top, 8)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Quick changes"))
            }
        }
        .padding(12)
        .background(FoleviGlass.active, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(FoleviGlass.border))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("AI result"))
    }

    @ViewBuilder private func actions(_ r: Outcome) -> some View {
        HStack(spacing: 6) {
            if case .write(let task, let text, let placement, _) = r {
                if task == "title" {
                    Button { useAsTitle(text) } label: { Label("Use as title", systemImage: "checkmark") }
                        .buttonStyle(.folevi(.primary, .small))
                        .disabled(readOnly)
                } else if case .replace = placement, AiCatalog.replaces(task: task) {
                    Button { apply(placement) } label: { Label("Replace selection", systemImage: "checkmark") }
                        .buttonStyle(.folevi(.primary, .small))
                        .disabled(readOnly)
                    Button { apply(.cursor) } label: { Label("Insert below", systemImage: "arrow.turn.down.left") }
                        .buttonStyle(.folevi(.secondary, .small))
                        .disabled(readOnly)
                } else {
                    let atEnd = placement == .end
                    Button { apply(atEnd ? .end : .cursor) } label: {
                        Label(atEnd ? "Add to the end" : "Insert into note", systemImage: "arrow.turn.down.left")
                    }
                    .buttonStyle(.folevi(.primary, .small))
                    .disabled(readOnly)
                }
            } else {
                Button { apply(.cursor) } label: { Label("Insert into note", systemImage: "arrow.turn.down.left") }
                    .buttonStyle(.folevi(.primary, .small))
                    .disabled(readOnly)
            }
            IconButton(systemImage: "doc.on.doc", label: "Copy", size: 32) { copy(r.text) }
            if case .write(_, _, _, let request) = r {
                IconButton(systemImage: "arrow.counterclockwise", label: "Try again", size: 32) { doWrite(request) }
            }
            Spacer(minLength: 0)
            IconButton(systemImage: "xmark", label: "Discard", size: 32) { result = nil }
        }
    }

    // MARK: Running

    private func doWrite(_ req: Request) {
        guard let session = app.session else { return }
        busy = AiPanelCatalog.label(task: req.task)
        problem = nil
        notice = nil
        let documentId = editor.documentId
        Task {
            defer {
                stream.end()
                busy = nil
            }
            let streamId = await stream.begin(session)
            do {
                var args: [String: JSONValue] = ["scope": session.scope.arg, "task": .string(req.task), "documentId": .string(documentId)]
                if let t = req.text { args["text"] = .string(t) }
                if let i = req.instruction { args["instruction"] = .string(i) }
                if let l = req.language { args["language"] = .string(l) }
                if let streamId { args["streamId"] = .string(streamId) }
                let out: AiWritten = try await session.convex.action("ai:write", args, timeout: 120)
                await stream.finish(out.text)
                if !out.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    result = .write(task: req.task, text: out.text, placement: req.placement, request: req)
                }
            } catch {
                problem = AiProblem.from(error)
            }
        }
    }

    private func doAsk(_ question: String) {
        guard let session = app.session else { return }
        busy = String(localized: "Reading your notes")
        problem = nil
        notice = nil
        let documentId = editor.documentId
        Task {
            defer {
                stream.end()
                busy = nil
            }
            let streamId = await stream.begin(session)
            do {
                var args: [String: JSONValue] = ["scope": session.scope.arg, "question": .string(question), "documentId": .string(documentId)]
                if let streamId { args["streamId"] = .string(streamId) }
                let answer: AiAnswer = try await session.convex.action("ai:ask", args, timeout: 120)
                await stream.finish(answer.answer)
                if !answer.answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    result = .ask(question: question, text: answer.answer, sources: answer.sources)
                }
            } catch {
                problem = AiProblem.from(error)
            }
        }
    }

    private func apply(_ placement: AiPanelPlacement) {
        guard let r = result, !readOnly else { return }
        if let changed = editor.applyAiPanelResult(r.text, placement: placement) { notice = changed }
        result = nil
    }

    private func useAsTitle(_ title: String) {
        guard !readOnly else { return }
        editor.applyAiTitle(title.trimmingCharacters(in: .whitespacesAndNewlines))
        result = nil
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(AiCatalog.markdownToPlain(text), forType: .string)
        notice = String(localized: "Copied")
    }
}

/// One "For this note" button: an icon and a label on a soft tile.
private struct NoteAiActionButton: View {
    var title: String
    var systemImage: String
    var action: () -> Void
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage).font(.system(size: 13, weight: .medium)).foregroundStyle(FoleviColor.inkMuted)
                    .frame(width: 16).accessibilityHidden(true)
                Text(title).font(.ui(13)).foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.ink).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(height: 40)
            .background(hovering ? FoleviGlass.active : FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.4)
        .onHover { hovering = $0 && isEnabled }
    }
}

/// A muted text link that darkens and underlines on hover ("Open the full Ask AI window").
struct AiLinkButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { AiLinkBody(configuration: configuration) }
}

private struct AiLinkBody: View {
    let configuration: ButtonStyle.Configuration
    @State private var hovering = false

    var body: some View {
        configuration.label
            .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.inkMuted)
            .underline(hovering)
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
    }
}

/// The AI mark's soft pulse while it works (still with Reduce Motion).
struct AiPulse: ViewModifier {
    @State private var on = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(on ? 0.45 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { on = true }
            }
    }
}
