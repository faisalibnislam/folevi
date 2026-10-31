// A conversation's messages as the web draws them (apps/web/src/components/ai/chat/ChatMessage.tsx, ActionsCard,
// AgentRunCard, SaveMemoryCard, ResearchCard): your words in the dark bubble on the right (the last one can be
// edited and sent again), Foli AI's answer on the glass with its sources, proposed changes, Copy, Regenerate
// and follow-ups; while it streams, what it's doing and Stop; a refusal as the web's notice.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

// MARK: your message

struct AiUserMessage: View {
    let text: String
    /// The last question of a saved conversation: Edit puts it in a box here and sends it again.
    var onEdit: ((String) -> Void)?
    var disabled = false
    @State private var editing = false
    @State private var draft = ""
    @State private var over = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        let bubble = look.s("ai.user.bubble")
        if editing, let onEdit {
            VStack(alignment: .trailing, spacing: 4) {
                TextField("", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(WebFont.font(.sans, size: bubble.fontSize))
                    .foregroundStyle(look.ink)
                    .lineLimit(3...8)
                    .padding(.horizontal, 6).padding(.vertical, 4)
                    .onKeyPress(.escape) { editing = false; return .handled }
                    .onSubmit { submit(onEdit) }
                    .accessibilityLabel("Edit your message")
                HStack(spacing: 6) {
                    Button { editing = false } label: {
                        Text("Cancel").webText(.role(.subheadline)).lineLimit(1).padding(.horizontal, 10).frame(height: 28).foregroundStyle(look.muted)
                    }
                    .buttonStyle(AiHoverStyle(radius: 6, hover: "glass-active"))
                    Button { submit(onEdit) } label: {
                        Text("Send").webText(.role(.subheadline, weight: 500)).lineLimit(1).padding(.horizontal, 10).frame(height: 28)
                            .foregroundStyle(look.canvas).background(RoundedRectangle(cornerRadius: 6).fill(look.heading))
                    }
                    .buttonStyle(.plain)
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 14).fill(look.glassHover))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(look.glassBorder))
            .containerRelativeFrame(.horizontal, alignment: .trailing) { w, _ in w * 0.85 }
            .frame(maxWidth: .infinity, alignment: .trailing)
        } else {
            VStack(alignment: .trailing, spacing: look.s("ai.user").gap) {
                Text(text)
                    .webText(bubble.text)
                    .foregroundStyle(bubble.color.color)
                    .multilineTextAlignment(.leading)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(bubble.padding.edgeInsets)
                    .aiBubble(WebStyles.named("ai.user.bubble"), scheme: scheme, small: .bottomTrailing)
                    .frame(maxWidth: 0.85 * 768, alignment: .trailing)
                if let onEdit {
                    AiRowButton(icon: .pencil, title: "Edit") {
                        draft = text
                        editing = true
                        _ = onEdit
                    }
                    .opacity(over ? 1 : 0)
                    .disabled(disabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .contentShape(Rectangle())
            .onHover { over = $0 }
        }
    }

    private func submit(_ onEdit: (String) -> Void) {
        let t = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        editing = false
        onEdit(t)
    }
}

// MARK: Foli AI's answer

/// A refusal or failure, as the web reads it (chatText.ts storedProblem, AiCredits.tsx aiProblem).
struct AiProblem: Equatable {
    enum Kind { case credits, notIncluded, other }
    var kind: Kind
    var message: String
    /// "buy" or "upgrade" when that helps (shown only where buying is allowed).
    var action: String?

    init(_ error: EngineError) {
        let reason = error.data?["reason"]?.string
        let action = error.data?["action"]?.string
        message = error.message
        if error.code == "out_of_credits" { kind = .credits; self.action = action == "buy" || action == "upgrade" ? action : nil }
        else if error.code == "forbidden", reason == "ai_not_included" { kind = .notIncluded; self.action = nil }
        else { kind = .other; self.action = nil }
    }

    init(message: String) {
        kind = .other
        self.message = message
        action = nil
    }
}

struct AiProblemNotice: View {
    let problem: AiProblem
    /// Buying is allowed here (account mode, not iOS): "Buy more" / "Upgrade" open Settings > Billing.
    var purchases = false
    var onBilling: () -> Void = {}
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        if problem.kind == .other {
            Text(problem.message)
                .webText(.role(.subheadline))
                .foregroundStyle(look.danger)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 14).fill(look.dangerSoft))
                .accessibilityAddTraits(.isStaticText)
        } else {
            HStack(spacing: 12) {
                Text(problem.message).webText(.role(.subheadline)).foregroundStyle(look.ink).frame(maxWidth: .infinity, alignment: .leading)
                if purchases, let a = problem.action {
                    WebButton(a == "buy" ? "Buy more" : "Upgrade", variant: .secondary, size: .sm, action: onBilling)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 10).fill(look.glassHover))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(look.glassBorder))
        }
    }
}

struct AiAssistantMessage: View {
    let model: FoliChatModel
    let message: ChatMessage
    let last: Bool
    var purchases = false
    var onBilling: () -> Void = {}
    @Environment(\.colorScheme) private var scheme
    @State private var copied = false

    var body: some View {
        let look = AiLook(scheme: scheme)
        let answer = model.answer(message.id)
        let shown = answer?.shownText ?? ""
        let streaming = message.status == "streaming"
        let job = model.job(for: message.id)
        let busy = model.isWorking
        Group {
            if message.status == "error", let error = message.error {
                VStack(alignment: .leading, spacing: 6) {
                    if !message.text.isEmpty { box { AiAnswerText(blocks: answer?.blocks ?? MarkdownBlocks.parse(message.text[...])) } }
                    AiProblemNotice(problem: AiProblem(error), purchases: purchases, onBilling: onBilling)
                    if last { AiRowButton(icon: .rotateCcw, title: "Try again") { model.regenerate() }.disabled(busy) }
                }
            } else if streaming, shown.isEmpty, let job, job.status == "running" {
                AiResearchProgress(job: job) { model.cancelResearch(job) }
            } else if streaming, shown.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    AiRunStatus(label: Self.phase(message.phase, hasText: false)) { model.stop() }
                    if !message.agentSteps.isEmpty { AiAgentSteps(steps: message.agentSteps) }
                }
                .padding(.horizontal, 4)
            } else if answer?.revealing == true || streaming {
                box {
                    VStack(alignment: .leading, spacing: 0) {
                        AiAnswerText(blocks: answer?.blocks ?? [], cited: cited)
                        if streaming { AiRunStatus(label: Self.phase(message.phase, hasText: !shown.trimmingCharacters(in: .whitespaces).isEmpty)) { model.stop() }.padding(.top, 8) }
                    }
                }
                .accessibilityElement(children: .contain)
            } else {
                finished(look: look, answer: answer, job: job, busy: busy)
            }
        }
    }

    private var cited: Set<Int> { Set(message.citations.map(\.n) + message.webCitations.map(\.n)) }

    private func cite(_ n: Int) {
        if let c = message.citations.first(where: { $0.n == n }) { model.openCitation(c) } else if let w = message.webCitations.first(where: { $0.n == n }), let url = URL(string: w.url) { NSWorkspace.shared.open(url) }
    }

    /// The web's phaseLabel (with its ellipsis character).
    static func phase(_ phase: String?, hasText: Bool) -> String {
        if hasText { return "Writing…" }
        switch phase {
        case "searching": return "Searching your notes…"
        case "reading": return "Reading your notes…"
        case "writing": return "Writing…"
        case "web": return "Searching the web…"
        case "page": return "Reading the page…"
        case "research": return "Researching…"
        case "planning": return "Planning…"
        case "working": return "Working on it…"
        default: return "Thinking…"
        }
    }

    private func box<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        let s = WebStyles.named("ai.answer").resolve(scheme)
        return content()
            .padding(s.padding.edgeInsets)
            .frame(maxWidth: .infinity, alignment: .leading)
            .aiBubble(WebStyles.named("ai.answer"), scheme: scheme, small: .bottomLeading)
    }

    @ViewBuilder
    private func finished(look: AiLook, answer: FoliAnswer?, job: ResearchJob?, busy: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            box {
                VStack(alignment: .leading, spacing: 0) {
                    if !message.agentSteps.isEmpty { AiAgentSteps(steps: message.agentSteps).padding(.bottom, 8) }
                    if message.text.isEmpty {
                        Text("Stopped before it said anything.").webText(.role(.body)).foregroundStyle(look.muted)
                    } else {
                        AiAnswerText(blocks: answer?.blocks ?? MarkdownBlocks.parse(message.text[...]), cited: cited, onCite: cite, onLink: { model.openLink($0) })
                    }
                    if let run = message.agentRun { AiAgentRunCard(model: model, run: run).padding(.top, 12) }
                    if !message.actions.isEmpty { AiActionsCard(model: model, message: message).padding(.top, 12) }
                    if let memory = message.memory, memory.status != "dismissed" { AiMemoryCard(model: model, message: message, memory: memory).padding(.top, 12) }
                    if !message.citations.isEmpty || !message.webCitations.isEmpty { sources(look: look) }
                    if model.offersContinue(message) {
                        HStack(spacing: 8) {
                            WebButton("Continue", icon: .play, variant: .primary, size: .sm) { model.continueAgent() }.disabled(busy)
                            Text("Carries on from where it stopped. Changes above stay as they are.").webText(.role(.footnote)).foregroundStyle(look.muted)
                        }
                        .padding(.top, 12)
                    }
                    actions(look: look, job: job, busy: busy)
                }
            }
            if last, !message.suggestions.isEmpty, !busy {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(message.suggestions, id: \.self) { s in
                        AiSuggestionButton(text: s, style: "ai.panel.suggestion", radius: 6) { model.send(s) }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Suggested follow-ups")
            }
        }
    }

    private func sources(look: AiLook) -> some View {
        let sec = look.s("ai.sources")
        let chip = look.s("ai.source")
        return VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(look.line70).frame(height: 1)
            Text("SOURCES").webText(look.text("ai.sources.title")).lineLimit(1).foregroundStyle(look.s("ai.sources.title").color.color)
                .padding(.top, sec.padding.top).padding(.bottom, 6)
            AiFlow(spacing: look.s("ai.sources.list").gap) {
                ForEach(message.citations, id: \.n) { c in
                    Button { model.openCitation(c) } label: {
                        HStack(spacing: chip.gap) {
                            Text("\(c.n)").webText(look.text("ai.source.n")).lineLimit(1).foregroundStyle(look.muted)
                            WebIconView(.fileText, size: 12).foregroundStyle(look.muted)
                            Text(c.title.isEmpty ? "Untitled" : c.title).webText(chip.text).lineLimit(1).truncationMode(.tail)
                        }
                        .padding(chip.padding.edgeInsets)
                        .foregroundStyle(look.ink)
                    }
                    .buttonStyle(AiHoverStyle(radius: chip.radius, hover: "glass-active", base: look.glassHover))
                    .foleviTooltip(c.title)
                }
                ForEach(message.webCitations, id: \.n) { c in
                    Button { if let u = URL(string: c.url) { NSWorkspace.shared.open(u) } } label: {
                        HStack(spacing: chip.gap) {
                            Text("\(c.n)").webText(look.text("ai.source.n")).lineLimit(1).foregroundStyle(look.muted)
                            WebIconView(.globe, size: 12).foregroundStyle(look.muted)
                            Text(c.title).webText(chip.text).lineLimit(1).truncationMode(.tail)
                            if !c.domain.isEmpty, c.domain != c.title.lowercased() { Text(c.domain).webText(chip.text).lineLimit(1).foregroundStyle(look.muted) }
                        }
                        .padding(chip.padding.edgeInsets)
                        .foregroundStyle(look.ink)
                    }
                    .buttonStyle(AiHoverStyle(radius: chip.radius, hover: "glass-active", base: look.glassHover))
                    .foleviTooltip(c.url)
                }
            }
        }
        .padding(.top, sec.margin.top)
    }

    private func actions(look: AiLook, job: ResearchJob?, busy: Bool) -> some View {
        let row = look.s("ai.answer.actions")
        return HStack(spacing: row.gap) {
            if !message.text.isEmpty {
                AiRowButton(icon: copied ? .check : .copy, title: copied ? "Copied" : "Copy") {
                    AiPasteboard.copy(model.plainText(message))
                    copied = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
                }
            }
            if last { AiRowButton(icon: .rotateCcw, title: "Regenerate") { model.regenerate() }.disabled(busy) }
            if let job {
                if job.status == "cancelled" {
                    Text("Research cancelled").webText(.role(.footnote)).foregroundStyle(look.faint).padding(.horizontal, 6)
                } else if job.status == "done" {
                    AiRowButton(icon: .fileText, title: job.noteId == nil ? "Save as note" : "Open note") { model.saveResearch(job) }
                        .disabled(model.busy.contains(job.id))
                }
            } else if message.agentRun != nil, !message.text.isEmpty {
                AiRowButton(icon: .fileText, title: "Save as note") { model.saveAsNote(message.id) }
            }
            if message.status == "stopped", job?.status != "cancelled" {
                Text("Stopped").webText(.role(.footnote)).foregroundStyle(look.faint).padding(.horizontal, 6)
            }
        }
        .padding(.top, row.margin.top)
        .padding(.bottom, row.margin.bottom)
    }
}

/// The follow-ups and "Try asking" suggestions: glass chips with a hairline.
struct AiSuggestionButton: View {
    let text: String
    let style: String
    var radius: CGFloat?
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        let s = look.s(style)
        Button(action: action) {
            Text(text)
                .webText(s.text)
                .multilineTextAlignment(.leading)
                .foregroundStyle(look.ink)
                .padding(s.padding.edgeInsets)
                .overlay(RoundedRectangle(cornerRadius: radius ?? s.radius).strokeBorder(look.glassBorder))
        }
        .buttonStyle(AiHoverStyle(radius: radius ?? s.radius, hover: "glass-active", base: look.glassHover))
    }
}

/// What an agent did, in a few words ("Searched notes", "Read 3 notes"): chatText.ts stepLines.
struct AiAgentSteps: View {
    let steps: [ChatAgentStep]
    @Environment(\.colorScheme) private var scheme

    static let writes: Set<String> = ["create_note", "update_note", "append_to_note", "rename_note", "move_note", "create_folder", "add_tags", "create_checklist", "create_tasks", "merge_notes"]
    static let reads: Set<String> = ["get_note", "get_notes", "compare_notes"]

    static func lines(_ steps: [ChatAgentStep]) -> [String] {
        var order: [String] = []
        var groups: [String: (n: Int, count: Int)] = [:]
        for s in steps where s.ok {
            let key = reads.contains(s.tool) ? "read" : writes.contains(s.tool) ? "write" : s.tool
            if groups[key] == nil { order.append(key) }
            let g = groups[key] ?? (0, 0)
            groups[key] = (g.n + 1, g.count + s.count)
        }
        let plural = { (n: Int, one: String, many: String) in n == 1 ? one : "\(n) \(many)" }
        return order.compactMap { key in
            let g = groups[key]!
            switch key {
            case "search_notes": return g.n == 1 ? "Searched notes" : "Searched notes \(g.n) times"
            case "read": return "Read \(plural(g.count, "a note", "notes"))"
            case "write": return "Proposed \(plural(g.count, "a change", "changes"))"
            case "get_note_page": return g.count == 1 ? "Read on in the note" : "Read \(g.count) more pages"
            case "get_note_outline": return "Read the outline"
            case "list_folders": return "Looked at folders"
            case "list_tags": return "Looked at tags"
            case "find_related": return "Found related notes"
            case "find_duplicates": return "Looked for duplicates"
            case "get_workspace_context": return "Looked around"
            default: return nil
            }
        }
    }

    var body: some View {
        let look = AiLook(scheme: scheme)
        AiFlow(spacing: 6) {
            ForEach(Self.lines(steps), id: \.self) { l in
                Text(l).webText(.role(.footnote)).lineLimit(1).foregroundStyle(look.muted)
                    .padding(.horizontal, 10).padding(.vertical, 2)
                    .background(RoundedRectangle(cornerRadius: 6).fill(look.glassHover))
            }
        }
    }
}

/// A glass card inside an answer (`rounded-panel bg-[var(--glass-hover)] p-3` with the hairline).
struct AiCard<C: View>: View {
    @ViewBuilder let content: () -> C
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        content()
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14).fill(look.glassHover))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(look.glassBorder))
    }
}

/// The changes an answer proposes (folders, notes, moves): Apply changes or Not now (ActionsCard.tsx).
struct AiActionsCard: View {
    let model: FoliChatModel
    let message: ChatMessage
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        let applied = message.actionsOutcome == "applied"
        let applying = model.busy.contains(message.id)
        AiCard {
            VStack(alignment: .leading, spacing: 0) {
                Text(applied ? "DONE" : "CHANGES TO MAKE").webText(.caps).foregroundStyle(look.faint).padding(.bottom, 8)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(message.actions.enumerated()), id: \.offset) { _, a in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            WebIconView(applied ? .check : a.type == "createFolder" ? .folderPlus : a.type == "createNote" ? .fileText : .arrowRight, size: 14).foregroundStyle(look.muted)
                            Text(line(a, look: look)).webText(.role(.subheadline)).foregroundStyle(look.ink)
                        }
                    }
                }
                if message.actionsOutcome == "dismissed" {
                    Text("Not applied.").webText(.role(.subheadline)).foregroundStyle(look.muted).padding(.top, 8)
                } else if !applied {
                    HStack(spacing: 8) {
                        WebButton(applying ? "Applying…" : "Apply changes", icon: .check, variant: .primary, size: .sm) { model.applyActions(message, apply: true) }.disabled(applying)
                        WebButton("Not now", variant: .ghost, size: .sm) { model.applyActions(message, apply: false) }.disabled(applying)
                    }
                    .padding(.top, 12)
                }
            }
        }
    }

    private func line(_ a: ChatAction, look: AiLook) -> AttributedString {
        func strong(_ s: String) -> AttributedString {
            var t = AttributedString(s)
            t.font = WebFont.font(.sans, size: WebTypeRole.subheadline.desktop.size, weight: 600)
            t.foregroundColor = look.heading
            return t
        }
        switch a.type {
        case "createFolder": return AttributedString("New folder ") + strong(a.title)
        case "createNote": return AttributedString("New note ") + strong(a.title) + AttributedString(a.folderName.map { " in \($0)" } ?? "")
        default: return AttributedString("Move ") + strong(a.title) + AttributedString(" to \(a.folderName ?? "the folder")")
        }
    }
}

/// An offer to remember a preference (SaveMemoryCard.tsx).
struct AiMemoryCard: View {
    let model: FoliChatModel
    let message: ChatMessage
    let memory: ChatMemoryOffer
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        let busy = model.busy.contains(message.id)
        if memory.status == "saved" {
            HStack(spacing: 6) {
                WebIconView(.check, size: 13)
                Text("Saved to memory. You can change it in Settings > AI.").webText(.role(.subheadline))
            }
            .foregroundStyle(look.muted)
        } else {
            AiCard {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Remember this for next time?").webText(.role(.footnote)).foregroundStyle(look.muted)
                    Text(memory.text).webText(.role(.subheadline, weight: 600)).foregroundStyle(look.heading)
                    HStack(spacing: 6) {
                        Button { model.memory(message, save: true) } label: {
                            Text("Save").webText(.role(.subheadline, weight: 500)).lineLimit(1).padding(.horizontal, 12).padding(.vertical, 4).foregroundStyle(look.heading)
                        }
                        .buttonStyle(AiHoverStyle(radius: 6, hover: "glass-active", base: look.glassActive))
                        Button { model.memory(message, save: false) } label: {
                            Text("Not now").webText(.role(.subheadline)).lineLimit(1).padding(.horizontal, 12).padding(.vertical, 4).foregroundStyle(look.muted)
                        }
                        .buttonStyle(AiHoverStyle(radius: 6, hover: "glass-active"))
                    }
                    .padding(.top, 6)
                    .disabled(busy)
                }
            }
        }
    }
}

/// The agent's proposed changes: tick them, Approve, Discard; after, what happened and one Undo (AgentRunCard.tsx).
struct AiAgentRunCard: View {
    let model: FoliChatModel
    let run: ChatAgentRun
    @State private var unticked: Set<String> = []
    @Environment(\.colorScheme) private var scheme

    static let done: [String: String] = ["done": "Done", "partial": "Partly done", "failed": "Not done", "undone": "Undone", "undoing": "Undoing", "executing": "Applying changes", "discarded": "Not applied", "running": "Applying changes"]

    var body: some View {
        let look = AiLook(scheme: scheme)
        let busy = model.busy.contains(run.id)
        let preview = run.status == "preview"
        let picked = run.operations.map(\.id).filter { !unticked.contains($0) }
        let all = picked.count == run.operations.count
        let applied = run.operations.filter { $0.status == "applied" || $0.status == "done" }.count
        let failed = run.operations.filter { $0.status == "failed" }.count
        AiCard {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text((preview ? "Proposed changes" : (Self.done[run.status] ?? "Changes")).uppercased()).webText(.caps).foregroundStyle(look.faint)
                    Spacer()
                    if preview, run.operations.count > 1 {
                        Button(all ? "Select none" : "Select all") { unticked = all ? Set(run.operations.map(\.id)) : [] }
                            .buttonStyle(.plain).font(WebFont.font(.sans, size: 12)).foregroundStyle(look.muted).disabled(busy)
                    }
                }
                .padding(.bottom, 6)
                if preview {
                    Text("Nothing changes until you approve. A version of each note is saved first, and you can undo it all.").webText(.role(.subheadline)).foregroundStyle(look.muted).padding(.bottom, 4)
                    ForEach(run.operations, id: \.id) { op in
                        Toggle(isOn: Binding(get: { !unticked.contains(op.id) }, set: { on in if on { unticked.remove(op.id) } else { unticked.insert(op.id) } })) {
                            Text(op.summary).webText(.role(.subheadline)).foregroundStyle(look.ink)
                        }
                        #if os(macOS)
                        .toggleStyle(.checkbox)
                        #endif
                        .disabled(busy)
                        .padding(.vertical, 6)
                        Rectangle().fill(look.color("color-line").opacity(0.6)).frame(height: 1)
                    }
                    HStack(spacing: 8) {
                        WebButton(busy ? "Applying…" : all ? "Approve all" : "Approve selected (\(picked.count))", icon: .check, variant: .primary, size: .sm) { model.approve(run, operations: picked) }
                            .disabled(busy || picked.isEmpty)
                        WebButton("Discard", variant: .ghost, size: .sm) { model.discard(run) }.disabled(busy)
                    }
                    .padding(.top, 12)
                } else if run.status == "discarded" {
                    Text("Nothing was changed.").webText(.role(.subheadline)).foregroundStyle(look.muted)
                } else {
                    Text(run.status == "undone" ? "Everything Foli AI changed was put back. The notes' versions before the undo are in their version history." : "\(applied > 0 ? "\(applied) change\(applied == 1 ? "" : "s") made" : "No changes made")\(failed > 0 ? ", \(failed) couldn't be made" : "").")
                        .webText(.role(.subheadline)).foregroundStyle(look.muted).padding(.bottom, 4)
                    ForEach(run.operations, id: \.id) { op in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            WebIconView(op.status == "failed" ? .circleAlert : op.status == "skipped" ? .x : .check, size: 14)
                                .foregroundStyle(op.status == "failed" ? look.danger : look.muted)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(op.summary).webText(.role(.subheadline)).foregroundStyle(op.status == "skipped" ? look.muted : look.ink)
                                if let e = op.error { Text(e).webText(.role(.subheadline)).foregroundStyle(look.danger) }
                                if run.status != "undone", op.status != "failed", let id = op.noteId {
                                    Button { model.onOpen(.note(id: id)) } label: {
                                        HStack(spacing: 6) {
                                            WebIconView(.fileText, size: 12).foregroundStyle(look.muted)
                                            Text("Open \(op.noteTitle ?? "note")").webText(.role(.footnote)).lineLimit(1)
                                        }
                                        .padding(.horizontal, 10).padding(.vertical, 2).foregroundStyle(look.ink)
                                    }
                                    .buttonStyle(AiHoverStyle(radius: 6, base: look.glassActive))
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    if run.status == "done" || run.status == "partial", applied > 0 {
                        WebButton(busy ? "Undoing…" : "Undo", icon: .rotateCcw, variant: .secondary, size: .sm) { model.undo(run) }
                            .disabled(busy).padding(.top, 8)
                    }
                }
            }
        }
    }
}

/// A research job while it runs: its steps and Cancel (ResearchCard.tsx ResearchProgress).
struct AiResearchProgress: View {
    let job: ResearchJob
    let onCancel: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let look = AiLook(scheme: scheme)
        let s = WebStyles.named("ai.answer").resolve(scheme)
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.mini)
                    Text("Researching…").webText(.role(.subheadline, weight: 500)).foregroundStyle(look.heading)
                }
                Spacer()
                AiRowButton(icon: .square, title: "Cancel", action: onCancel)
            }
            .padding(.bottom, 4)
            ForEach(Array(job.steps.enumerated()), id: \.offset) { _, step in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    WebIconView(step.status == "done" ? .check : step.status == "failed" ? .x : step.status == "running" ? .loaderCircle : .minus, size: 13)
                    Text(step.label).webText(.role(.subheadline))
                }
                .foregroundStyle(step.status == "running" ? look.ink : look.muted)
            }
            Text("This can take a few minutes. You can leave; the report appears here when it's ready.").webText(.role(.footnote)).foregroundStyle(look.faint).padding(.top, 4)
        }
        .padding(s.padding.edgeInsets)
        .frame(maxWidth: .infinity, alignment: .leading)
        .aiBubble(WebStyles.named("ai.answer"), scheme: scheme, small: .bottomLeading)
    }
}

/// Wrapping rows (CSS `flex flex-wrap gap-*`).
struct AiFlow: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0, x + s.width > width { y += row + spacing; x = 0; row = 0 }
            x += s.width + spacing
            row = max(row, s.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > 0, x + s.width > bounds.width { y += row + spacing; x = 0; row = 0 }
            v.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), proposal: ProposedViewSize(width: min(s.width, bounds.width), height: s.height))
            x += s.width + spacing
            row = max(row, s.height)
        }
    }
}
#endif
