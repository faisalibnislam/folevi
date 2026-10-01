import AppKit
import Observation
import SwiftUI

extension Notification.Name {
    /// ⌘J outside a note: open (or close) the Ask AI chat.
    static let foleviToggleAskAi = Notification.Name("FoleviToggleAskAi")
}

/// A note's AI state: the inline composer and the title's AI menu.
@MainActor
@Observable
final class EditorAi {
    /// The inline AI composer, when open (⌘J, "/ai", AI on selected text).
    var composer: InlineAiModel?
    /// The title's AI menu is open, on this range of the title (empty: the whole title).
    var titleRange: NSRange?
    /// Words selected in the title (shows "Edit with AI").
    var titleSelection: NSRange?
}

/// The inline AI composer (the web's InlineAi): type what you want or pick a suggestion; the result appears
/// with Replace / Insert, Try again, quick refinements ("Shorter", "More formal", or anything you type) and
/// Discard. Works on selected text, on selected blocks, or at the cursor.
@MainActor
@Observable
final class InlineAiModel: Identifiable {
    /// What the composer works on.
    enum Target: Equatable {
        /// Text selected in one block.
        case text(blockId: String, range: NSRange, text: String)
        /// Whole blocks selected (as Markdown).
        case blocks(ids: [String], text: String)

        var text: String {
            switch self {
            case .text(_, _, let t), .blocks(_, let t): return t
            }
        }
    }

    struct Run: Equatable {
        var task: String
        var text: String?
        var instruction: String?
        var language: String?
    }

    enum Phase: Equatable {
        case compose
        case languages
        case busy(label: String)
        case result(text: String, label: String, last: Run)
    }

    let id = UUID()
    let target: Target?
    /// Where writing at the cursor goes (after this block; an empty paragraph is replaced).
    let cursorBlockId: String?
    var phase: Phase = .compose
    var input = ""
    var active = 0
    var problem: AiProblem?
    var notice: String?
    let stream = AiStreamRunner()
    @ObservationIgnored private var seq = 0
    @ObservationIgnored weak var editor: EditorModel?

    init(editor: EditorModel, target: Target?, cursorBlockId: String?) {
        self.editor = editor
        self.target = target
        self.cursorBlockId = cursorBlockId
    }

    var options: [AiSuggestion] {
        switch phase {
        case .compose: return AiCatalog.options(input: input, hasTarget: target != nil, languages: false)
        case .languages: return AiCatalog.options(input: input, hasTarget: target != nil, languages: true)
        default: return []
        }
    }

    var isBusy: Bool { if case .busy = phase { return true } else { return false } }

    /// The result can replace what it was made from (Explain and Summarize only insert).
    var replaceable: Bool {
        if case .result(_, _, let last) = phase { return target != nil && AiCatalog.replaces(task: last.task) }
        return false
    }

    // MARK: Running

    func run(_ r: Run, label: String) {
        guard let editor, let session = editor.app.session else { return }
        seq += 1
        let mine = seq
        problem = nil
        notice = nil
        phase = .busy(label: label)
        let documentId = editor.documentId
        Task { @MainActor in
            let streamId = await stream.begin(session)
            guard mine == seq else {
                if !isBusy { stream.end() }
                return
            }
            do {
                var args: [String: JSONValue] = ["scope": session.scope.arg, "task": .string(r.task), "documentId": .string(documentId)]
                if let t = r.text { args["text"] = .string(t) }
                if let i = r.instruction { args["instruction"] = .string(i) }
                if let l = r.language { args["language"] = .string(l) }
                if let streamId { args["streamId"] = .string(streamId) }
                let out: AiWritten = try await session.convex.action("ai:write", args, timeout: 120)
                guard mine == seq else { return }
                await stream.finish(out.text)
                guard mine == seq else { return }
                let text = out.text.trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty {
                    phase = .compose
                } else {
                    phase = .result(text: text, label: label, last: r)
                    input = ""
                }
            } catch {
                guard mine == seq else { return }
                stream.end()
                problem = AiProblem.from(error)
                phase = .compose
            }
        }
    }

    func choose(_ s: AiSuggestion?) {
        guard let s else { return }
        if s.languages {
            input = ""
            active = 0
            phase = .languages
            return
        }
        if s.id == "custom" {
            let instruction = s.label
            if let target {
                run(Run(task: "refine", text: target.text, instruction: instruction), label: instruction)
            } else {
                run(Run(task: "draft", instruction: instruction), label: instruction)
            }
            return
        }
        guard let task = s.task else { return }
        let language = s.id.hasPrefix("lang-") ? s.label : nil
        run(Run(task: task, text: target?.text, language: language), label: AiCatalog.label(task: task, language: language).replacingOccurrences(of: "…", with: ""))
    }

    func refine(_ instruction: String) {
        let i = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard case .result(let text, _, _) = phase, !i.isEmpty else { return }
        run(Run(task: "refine", text: text, instruction: i), label: i)
    }

    func tryAgain() {
        guard case .result(_, let label, let last) = phase else { return }
        run(last, label: label)
    }

    /// Return: refine with what's typed, accept the result, or run the highlighted suggestion.
    func submit() {
        switch phase {
        case .result:
            if !input.trimmingCharacters(in: .whitespaces).isEmpty { refine(input) } else { accept(replace: replaceable) }
        case .compose, .languages:
            let list = options
            choose(list.indices.contains(active) ? list[active] : list.first)
        case .busy:
            break
        }
    }

    func move(_ delta: Int) {
        let count = options.count
        guard count > 0 else { return }
        active = min(count - 1, max(0, active + delta))
    }

    func back() {
        input = ""
        active = 0
        phase = .compose
    }

    /// Escape: out of the language list, or close.
    func escape() {
        if phase == .languages { back() } else { close() }
    }

    func stop() { stream.stop() }

    /// Puts the result in the note: replacing what it was made from, or below it (at the cursor).
    func accept(replace: Bool) {
        guard case .result(let text, _, _) = phase, let editor else { return }
        let notice = editor.applyAiResult(text, target: target, replace: replace && replaceable, cursorBlockId: cursorBlockId)
        dismiss(focusEditor: false)
        if let notice { editor.app.showToast(notice) }
    }

    func close() { dismiss(focusEditor: true) }

    /// Closes without moving the focus (something else is opening).
    func cancel() { dismiss(focusEditor: false) }

    private func dismiss(focusEditor: Bool) {
        seq += 1
        if isBusy { stream.stop() }
        stream.end()
        guard let editor else { return }
        if editor.ai.composer?.id == id { editor.ai.composer = nil }
        guard focusEditor else { return }
        switch target {
        case .text(let blockId, let range, _):
            editor.focus = FocusRequest(blockId: blockId, caret: .range(range.location, range.length))
        case .blocks, .none:
            if let id = cursorBlockId, editor.blocks[id]?.content.carriesText == true {
                editor.focus = FocusRequest(blockId: id, caret: .end)
            }
        }
    }
}

// MARK: - Editor integration

extension EditorModel {
    /// AI writing is offered here: included and turned on, and the note can be edited.
    var aiWritable: Bool { app.aiAvailable && !isReadOnly }

    /// ⌘J in a note: in the title, the title's AI; anywhere else, the composer (on the selection, the selected
    /// blocks, or at the cursor).
    @discardableResult
    func aiShortcut(from view: BlockTextView?) -> Bool {
        guard aiWritable else { return false }
        // ⌘J again, from the composer itself: close it.
        if view == nil, let open = ai.composer {
            open.close()
            return true
        }
        if let view, view.blockId == "__title__" {
            openTitleAi(range: view.selectedRange())
            return true
        }
        openInlineAi()
        return true
    }

    /// Opens the composer where the person is working, optionally running a task at once ("/ai…").
    func openInlineAi(task: String? = nil, language: String? = nil, cursorBlockId: String? = nil) {
        guard aiWritable else { return }
        var target: InlineAiModel.Target?
        var cursor = cursorBlockId
        if cursor == nil {
            if let id = focusedBlockId, id != "__title__", let tv = textView(id), tv.window?.firstResponder === tv {
                let r = tv.selectedRange()
                let ns = tv.string as NSString
                if r.length > 0, NSMaxRange(r) <= ns.length {
                    let text = ns.substring(with: r)
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { target = .text(blockId: id, range: r, text: text) }
                }
                cursor = id
            } else if !selectedBlockIds.isEmpty {
                let ids = orderedByRows(Array(selectedBlockIds))
                let wires = aiSubtree(ids).compactMap { blocks[$0]?.wire }
                let markdown = MarkdownCodec.blocksToMarkdown(wires)
                if !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { target = .blocks(ids: ids, text: markdown) }
                cursor = ids.last
            } else {
                cursor = focusedBlockId.flatMap { blocks[$0] != nil ? $0 : nil } ?? rows.last?.id
            }
        }
        present(target: target, cursor: cursor, task: task, language: language)
    }

    /// AI on selected text (the text's menu): the composer on it, running `task` at once (nil: just open).
    func openInlineAi(blockId: String, range: NSRange, text: String, task: String?, language: String? = nil) {
        guard aiWritable else { return }
        present(target: .text(blockId: blockId, range: range, text: text), cursor: blockId, task: task, language: language)
    }

    private func present(target: InlineAiModel.Target?, cursor: String?, task: String?, language: String?) {
        ai.composer?.cancel()
        ai.titleRange = nil
        let model = InlineAiModel(editor: self, target: target, cursorBlockId: cursor)
        ai.composer = model
        if let task {
            let label = AiCatalog.label(task: task, language: language).replacingOccurrences(of: "…", with: "")
            model.run(InlineAiModel.Run(task: task, text: target?.text, language: language), label: label)
        }
    }

    /// The ids and all their descendants, in order.
    private func aiSubtree(_ ids: [String]) -> [String] {
        var all: [String] = []
        for id in ids {
            all.append(id)
            all += Tree.descendantIds(allNodes(), rootId: id)
        }
        var seen = Set<String>()
        return all.filter { seen.insert($0).inserted }
    }

    // MARK: Applying a result

    /// Puts AI Markdown in the note. Replacing: the selected text (inline when the reply is one paragraph,
    /// keeping the block's other text and formatting) or the selected blocks. Otherwise below the text it was
    /// made from, or at the cursor (an empty paragraph there is replaced). Returns a notice when the selection
    /// changed and the result went below instead.
    @discardableResult
    func applyAiResult(_ markdown: String, target: InlineAiModel.Target?, replace: Bool, cursorBlockId: String?) -> String? {
        guard !isReadOnly else { return nil }
        let actionName = String(localized: "Insert AI Text")
        switch target {
        case .text(let blockId, let range, let source):
            guard replace else {
                insertAiBlocks(markdown, after: blockId, actionName: actionName)
                return nil
            }
            guard let tv = textView(blockId), NSMaxRange(range) <= (tv.string as NSString).length,
                  (tv.string as NSString).substring(with: range) == source else {
                insertAiBlocks(markdown, after: blockId, actionName: actionName)
                return String(localized: "The selected text changed, so the result was inserted below it.")
            }
            let imported = MarkdownCodec.markdownToBlocks(markdown, titleFromHeading: false).blocks
            if imported.count == 1, let only = imported.first, only.type == "paragraph" {
                tv.replace(range: range, with: Block(wire: only).text, style: currentTextStyle(for: blockId))
                return nil
            }
            let whole = range.location == 0 && range.length == (tv.string as NSString).length
            if whole {
                insertAiBlocks(markdown, after: blockId, deleting: [blockId], actionName: actionName)
            } else {
                tv.replace(range: range, with: [], style: currentTextStyle(for: blockId))
                insertAiBlocks(markdown, after: blockId, actionName: actionName)
            }
            return nil
        case .blocks(let ids, _):
            let live = ids.filter { blocks[$0] != nil }
            guard let anchor = live.last else {
                insertAiBlocks(markdown, after: cursorBlockId ?? rows.last?.id, actionName: actionName)
                return nil
            }
            insertAiBlocks(markdown, after: anchor, deleting: replace ? aiSubtree(live) : [], actionName: actionName)
            if replace { selectedBlockIds = [] }
            return nil
        case .none:
            let anchor = cursorBlockId.flatMap { blocks[$0] != nil ? $0 : nil } ?? rows.last?.id
            var deleting: [String] = []
            if let anchor, let b = blocks[anchor], b.typeName == "paragraph",
               RichText.plainText(b.text).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, children(of: anchor).isEmpty {
                deleting = [anchor]
            }
            insertAiBlocks(markdown, after: anchor, deleting: deleting, actionName: actionName)
            return nil
        }
    }

    private func insertAiBlocks(_ markdown: String, after anchorId: String?, deleting: [String] = [], actionName: String) {
        let imported = MarkdownCodec.markdownToBlocks(markdown, titleFromHeading: false).blocks
        guard !imported.isEmpty, !isReadOnly else { return }
        let anchor = anchorId.flatMap { blocks[$0] }
        var upserts: [Block] = []
        var previous = anchor?.id
        for wire in imported {
            var b = Block(wire: wire)
            if wire.parentId == nil {
                b.parentId = anchor?.parentId
                b.rank = rank(parentId: anchor?.parentId, after: previous)
                previous = b.id
            }
            blocks[b.id] = b
            upserts.append(b)
        }
        let last = upserts.last { $0.content.carriesText }
        commit(upserts: upserts, deletes: deleting, focus: last.map { FocusRequest(blockId: $0.id, caret: .end) },
               actionName: actionName, explicitDelete: !deleting.isEmpty)
    }

    // MARK: Title

    func openTitleAi(range: NSRange) {
        guard aiWritable else { return }
        ai.composer?.cancel()
        ai.titleRange = range
    }

    func applyAiTitle(_ title: String) {
        guard !isReadOnly else { return }
        setTitle(title)
        ai.titleRange = nil
        ai.titleSelection = nil
    }
}

// MARK: - The composer

/// The inline AI composer, floating over the note above its tools.
struct InlineAiComposer: View {
    @Bindable var model: InlineAiModel
    @FocusState private var inputFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let target = model.target {
                (Text("Editing: ").fontWeight(.semibold) + Text("“\(String(target.text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).prefix(140)))”"))
                    .font(.ui(12))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                divider
            }
            switch model.phase {
            case .result(let text, let label, _):
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            AiIcon(size: 12)
                            Text(label).font(.ui(11.5, .semibold)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                        }
                        AiMarkdownView(markdown: text)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 300)
                .fixedSize(horizontal: false, vertical: true)
                divider
            case .busy(let label):
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 7) {
                        AiIcon(size: 12)
                        Text("\(label)…").font(.ui(11.5, .semibold)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                    }
                    if model.stream.text.isEmpty {
                        AiShimmer()
                    } else {
                        ScrollView {
                            AiMarkdownView(markdown: model.stream.text).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .defaultScrollAnchor(.bottom)
                        .frame(maxHeight: 300)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 8)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text("\(label)…"))
            default:
                EmptyView()
            }

            if model.isBusy {
                HStack {
                    Spacer()
                    AiStopButton { model.stop() }
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 8)
            } else {
                inputRow
            }

            if let problem = model.problem {
                AiProblemNotice(problem: problem).padding(.horizontal, 12).padding(.bottom, 10)
            } else if model.phase == .compose, let docId = model.editor?.documentId {
                AiCreditsNote(documentId: docId).padding(.horizontal, 12).padding(.bottom, 6)
            }
            if let notice = model.notice {
                Text(notice).font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 16).padding(.bottom, 8)
            }

            if case .result = model.phase { resultActions }
            if model.phase == .compose || model.phase == .languages { suggestions }

            divider
            Text("AI can make mistakes. Sent to Google Gemini.")
                .font(.ui(11))
                .foregroundStyle(FoleviColor.inkFaint)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
        }
        .frame(width: 560)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .foleviPop(radius: 14)
        .onAppear { inputFocused = true }
        .onChange(of: model.isBusy) { _, busy in if !busy { inputFocused = true } }
        .onChange(of: model.input) { _, _ in model.active = 0 }
        .onExitCommand { model.escape() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("AI Assistant"))
        .accessibilityIdentifier("ai.inlineComposer")
    }

    private var divider: some View { FoleviColor.line.opacity(0.6).frame(height: 1) }

    private var placeholder: String {
        switch model.phase {
        case .result: return String(localized: "Tell AI what to change… (⏎ to accept)")
        case .languages: return String(localized: "Translate to…")
        default: return model.target != nil ? String(localized: "Ask AI to edit the selected text…") : String(localized: "Ask AI to write anything…")
        }
    }

    private var inputRow: some View {
        HStack(spacing: 8) {
            if model.phase == .languages {
                IconButton(systemImage: "chevron.left", label: "Back", size: 26) { model.back() }
            } else {
                AiIcon(size: 16).frame(width: 26)
            }
            TextField(placeholder, text: $model.input)
                .textFieldStyle(.plain)
                .font(.ui(14))
                .foregroundStyle(FoleviColor.ink)
                .focused($inputFocused)
                .onSubmit { model.submit() }
                .onKeyPress(.upArrow) {
                    model.move(-1)
                    return .handled
                }
                .onKeyPress(.downArrow) {
                    model.move(1)
                    return .handled
                }
                .onKeyPress(.escape) {
                    model.escape()
                    return .handled
                }
                .onKeyPress(.leftArrow) {
                    guard model.phase == .languages, model.input.isEmpty else { return .ignored }
                    model.back()
                    return .handled
                }
                .accessibilityLabel(Text(model.phase == .languages ? "Language" : { if case .result = model.phase { return "Tell the AI what to change" } else { return "Ask AI to write or edit" } }()))
            if !model.input.trimmingCharacters(in: .whitespaces).isEmpty {
                Button { model.submit() } label: {
                    Image(systemName: "arrow.up").font(.system(size: 12, weight: .bold)).foregroundStyle(FoleviColor.accentInk)
                        .frame(width: 26, height: 26)
                        .background(FoleviColor.heading, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Send"))
            }
            IconButton(systemImage: "xmark", label: "Close AI", shortcutHint: "Esc", size: 26) { model.close() }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
    }

    private var resultActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if model.replaceable {
                    Button { model.accept(replace: true) } label: { Label("Replace", systemImage: "checkmark") }
                        .buttonStyle(.folevi(.primary, .small))
                    Button { model.accept(replace: false) } label: { Label("Insert below", systemImage: "arrow.turn.down.left") }
                        .buttonStyle(.folevi(.secondary, .small))
                } else {
                    Button { model.accept(replace: false) } label: { Label("Insert", systemImage: "arrow.turn.down.left") }
                        .buttonStyle(.folevi(.primary, .small))
                }
                Button { model.tryAgain() } label: { Label("Try again", systemImage: "arrow.counterclockwise") }
                    .buttonStyle(.folevi(.ghost, .small))
                Spacer()
                Button("Discard") { model.close() }
                    .buttonStyle(.folevi(.quiet, .small))
            }
            FlowLayout(spacing: 6) {
                ForEach(AiCatalog.refines, id: \.self) { r in
                    Button { model.refine(r) } label: {
                        Text(r)
                            .font(.ui(12))
                            .foregroundStyle(FoleviColor.ink)
                            .padding(.horizontal, 10)
                            .frame(height: 24)
                            .background(FoleviGlass.hover, in: Capsule())
                            .overlay(Capsule().strokeBorder(FoleviGlass.border))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Quick changes"))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .overlay(alignment: .top) { divider }
    }

    @ViewBuilder private var suggestions: some View {
        let options = model.options
        if !options.isEmpty {
            divider
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 1) {
                        if model.phase == .compose, model.input.trimmingCharacters(in: .whitespaces).isEmpty {
                            Text(model.target != nil ? "Edit or review" : "Write with AI")
                                .foleviCapsLabel()
                                .padding(.horizontal, 10)
                                .padding(.top, 6)
                                .padding(.bottom, 4)
                        }
                        ForEach(Array(options.enumerated()), id: \.element.id) { i, o in
                            row(o, index: i).id(o.id)
                        }
                    }
                    .padding(6)
                }
                .frame(maxHeight: 300)
                .fixedSize(horizontal: false, vertical: true)
                .onChange(of: model.active) { _, a in
                    if options.indices.contains(a) { proxy.scrollTo(options[a].id) }
                }
            }
        }
    }

    private func row(_ o: AiSuggestion, index: Int) -> some View {
        let isActive = index == model.active
        return Button { model.choose(o) } label: {
            HStack(spacing: 10) {
                Group {
                    if let icon = o.systemImage {
                        Image(systemName: icon).font(.system(size: 13, weight: .medium)).foregroundStyle(FoleviColor.inkMuted)
                    } else {
                        AiIcon(size: 14)
                    }
                }
                .frame(width: 18)
                .accessibilityHidden(true)
                Group {
                    if o.id == "custom" {
                        Text(model.target != nil ? "Edit: " : "Write: ") + Text(o.label).fontWeight(.medium)
                    } else {
                        Text(o.label)
                    }
                }
                .font(.ui(13.5))
                .foregroundStyle(isActive ? FoleviColor.heading : FoleviColor.ink)
                .lineLimit(1)
                Spacer(minLength: 8)
                if o.languages {
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(FoleviColor.inkFaint)
                }
                if isActive {
                    Image(systemName: "return").font(.system(size: 11, weight: .semibold)).foregroundStyle(FoleviColor.inkFaint)
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 34)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(isActive ? FoleviGlass.hover : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { if $0, model.active != index { model.active = index } }
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}
