// A message's parts (web chat/ChatMessage.tsx, ActionsCard.tsx, AgentRunCard.tsx, SaveMemoryCard.tsx,
// ResearchCard.tsx): your words on the right in a soft bubble; Foli AI's as plain text with, under it, the
// sources as chips, proposed changes with Apply, the agent's changes to approve and undo, a memory offer, a
// research report's steps, Continue, Copy, Regenerate, Export and follow-up suggestions.
import SwiftUI
import FoleviDesign
import FoleviEngine

struct UserBubble: View {
    let text: String
    let compact: Bool
    var body: some View {
        HStack {
            Spacer(minLength: compact ? 48 : 80)
            Text(text)
                .font(FoleviFonts.font(.ui, size: compact ? 17 : 15.5, weight: .regular, relativeTo: .body))
                .lineSpacing(3)
                .foregroundStyle(Folevi.color.ink)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous).fill(Folevi.color.surfaceSunken))
                .textSelection(.enabled)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("You: \(text)")
    }
}

struct UserMessageView: View {
    let model: FoliChatModel
    let message: ChatMessage
    let compact: Bool

    var body: some View {
        let editable = message.id == model.lastUserMessageId && !model.isWorking && model.conversationId != nil
        VStack(alignment: .trailing, spacing: 4) {
            if !message.attachments.isEmpty {
                HStack(spacing: 6) {
                    ForEach(message.attachments, id: \.id) { a in
                        Label(a.name, systemImage: a.kind == "image" ? "photo" : "doc").foleviFont(.caption).lineLimit(1)
                            .padding(.horizontal, 9).frame(minHeight: 26)
                            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).fill(Folevi.color.surfaceSunken))
                    }
                }
            }
            UserBubble(text: message.text, compact: compact)
                .contextMenu {
                    Button { model.copy(message) } label: { Label("Copy", systemImage: "doc.on.doc") }
                    if editable { Button { model.edit(message) } label: { Label("Edit", systemImage: "pencil") } }
                }
            if editable {
                RowButton(title: "Edit", systemImage: "pencil") { model.edit(message) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// The small actions under an answer, 44 pt tall on touch screens.
struct RowButton: View {
    let title: String
    let systemImage: String
    var disabled = false
    let action: () -> Void
    @ScaledMetric(relativeTo: .footnote) private var height: CGFloat = 36

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .foleviFont(.footnote).fontWeight(.medium)
                .foregroundStyle(Folevi.color.inkMuted)
                .padding(.horizontal, 8)
                #if os(iOS)
                .frame(minHeight: max(44, height))
                #else
                .frame(minHeight: 28)
                #endif
                .contentShape(Rectangle())
        }
        .buttonStyle(PressFade())
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
    }
}

/// What sits above an answer's text: its status before the first words, the agent's steps, a refusal.
struct AnswerHeadView: View {
    let model: FoliChatModel
    let message: ChatMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let job = model.job(for: message.id) {
                ResearchStepsView(job: job)
            }
            let steps = AgentStepLines.lines(message.agentSteps)
            if !steps.isEmpty {
                FlowChips(items: steps)
                    .accessibilityLabel(message.status == "streaming" ? "What Foli AI is doing: \(steps.joined(separator: ", "))" : "What Foli AI did: \(steps.joined(separator: ", "))")
            }
            if message.status == "streaming", (model.answer(message.id)?.shownText ?? "").isEmpty, model.job(for: message.id) == nil {
                // The words appear here; until then, a quiet placeholder (the status line says what's happening).
                HStack(spacing: 6) {
                    ForEach(0..<3) { _ in Circle().fill(Folevi.color.inkFaint).frame(width: 6, height: 6) }
                }
                .padding(.vertical, 8)
                .accessibilityHidden(true)
            }
            if message.status == "error" {
                VStack(alignment: .leading, spacing: 6) {
                    Label(message.error?.message ?? "Foli AI couldn't answer.", systemImage: "exclamationmark.circle")
                        .foleviFont(.callout)
                        .foregroundStyle(Folevi.color.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).fill(Folevi.color.destructiveSoft))
            }
        }
        .padding(.top, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// An agent's steps as a few short lines (web chatText.ts `stepLines`).
enum AgentStepLines {
    static let write: Set<String> = ["create_note", "update_note", "append_to_note", "rename_note", "move_note", "create_folder", "add_tags", "create_checklist", "create_tasks", "merge_notes"]
    static let read: Set<String> = ["get_note", "get_notes", "compare_notes"]

    static func lines(_ steps: [ChatAgentStep]) -> [String] {
        var order: [String] = []
        var groups: [String: (n: Int, count: Int)] = [:]
        var refused = 0
        for s in steps {
            guard s.ok else { refused += 1; continue }
            let key = read.contains(s.tool) ? "read" : write.contains(s.tool) ? "write" : s.tool
            if groups[key] == nil { order.append(key) }
            var g = groups[key] ?? (0, 0)
            g.n += 1
            g.count += s.count
            groups[key] = g
        }
        func plural(_ n: Int, _ one: String, _ many: String) -> String { n == 1 ? one : "\(n) \(many)" }
        var out: [String] = []
        for key in order {
            let g = groups[key]!
            switch key {
            case "search_notes": out.append(g.n == 1 ? "Searched notes" : "Searched notes \(g.n) times")
            case "read": out.append("Read \(plural(g.count, "a note", "notes"))")
            case "write": out.append("Proposed \(plural(g.count, "a change", "changes"))")
            case "get_note_page": out.append(g.count == 1 ? "Read on in the note" : "Read \(g.count) more pages")
            case "get_note_outline": out.append("Read the outline")
            case "list_folders": out.append("Looked at folders")
            case "list_tags": out.append("Looked at tags")
            case "find_related": out.append("Found related notes")
            case "find_duplicates": out.append("Looked for duplicates")
            case "get_workspace_context": out.append("Looked around")
            case "search_web": out.append(g.n == 1 ? "Searched the web" : "Searched the web \(g.n) times")
            case "read_web_page": out.append("Read \(plural(g.count, "a web page", "web pages"))")
            case "calculate": out.append(g.n == 1 ? "Did a calculation" : "Did \(g.n) calculations")
            default: out.append("Looked something up")
            }
        }
        if refused > 0 { out.append("\(plural(refused, "A step", "steps")) didn't work") }
        return out
    }
}

/// Small grey chips that wrap.
struct FlowChips: View {
    let items: [String]
    var body: some View {
        WrapLayout(spacing: 6) {
            ForEach(items, id: \.self) { t in
                Text(t).foleviFont(.caption).foregroundStyle(Folevi.color.inkMuted)
                    .padding(.horizontal, 9).frame(minHeight: 24)
                    .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).fill(Folevi.color.surfaceSunken))
            }
        }
    }
}

/// Lays children out in rows, wrapping to the next row when one is full.
struct WrapLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0, x + size.width > width { y += row + spacing; x = 0; row = 0 }
            x += size.width + spacing
            row = max(row, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + row)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX, x + size.width > bounds.maxX { y += row + spacing; x = bounds.minX; row = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}

/// Under an answer: sources, cards, Continue, the row of actions and follow-ups.
struct AnswerFootView: View {
    let model: FoliChatModel
    let message: ChatMessage
    let compact: Bool
    @Environment(\.openURL) private var openURL

    var revealing: Bool { model.answer(message.id)?.revealing ?? false }
    var isLast: Bool { message.id == model.messages.last?.id }

    var body: some View {
        if message.status == "streaming" || revealing {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 10) {
                if message.status == "stopped", message.text.isEmpty {
                    Text("Stopped before it said anything.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted)
                }
                if let run = message.agentRun { AgentRunCard(model: model, run: run) }
                if !message.actions.isEmpty { ActionsCard(model: model, message: message) }
                if let memory = message.memory, memory.status != "dismissed" { MemoryCard(model: model, message: message, memory: memory) }
                if let job = model.job(for: message.id), job.status != "running" { ResearchFoot(model: model, job: job) }
                if !message.citations.isEmpty || !message.webCitations.isEmpty { sources }
                if model.offersContinue(message) {
                    HStack(spacing: 10) {
                        Button { model.continueAgent() } label: { Label("Continue", systemImage: "play.fill") }
                            .buttonStyle(FoleviButtonStyle(.primary, size: .small))
                            .disabled(model.isWorking)
                        Text("Carries on from where it stopped.").foleviFont(.caption).foregroundStyle(Folevi.color.inkMuted)
                    }
                }
                actions
                if isLast, !message.suggestions.isEmpty, !model.isWorking {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(message.suggestions, id: \.self) { s in
                            Button { model.send(s) } label: {
                                Text(s).foleviFont(compact ? .callout : .footnote).foregroundStyle(Folevi.color.ink).multilineTextAlignment(.leading)
                                    .padding(.horizontal, 14).padding(.vertical, compact ? 11 : 8)
                                    .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous).fill(Folevi.color.surfaceSunken))
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(PressFade())
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Suggested follow-ups")
                }
            }
            .padding(.top, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    var sources: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Sources").foleviFont(.caps).foregroundStyle(Folevi.color.inkFaint)
            WrapLayout(spacing: 6) {
                ForEach(message.citations, id: \.self) { c in
                    Button { model.openCitation(c) } label: { sourceChip(n: c.n, icon: "doc.text", title: c.title, domain: nil) }
                        .buttonStyle(PressFade())
                        .accessibilityLabel("Source \(c.n): \(c.title). Opens the note.")
                }
                ForEach(message.webCitations, id: \.self) { c in
                    Button { if let u = URL(string: c.url) { openURL(u) } } label: { sourceChip(n: c.n, icon: "globe", title: c.title, domain: c.domain) }
                        .buttonStyle(PressFade())
                        .accessibilityLabel("Source \(c.n): \(c.title), \(c.domain). Opens the page.")
                }
            }
        }
    }

    func sourceChip(n: Int, icon: String, title: String, domain: String?) -> some View {
        HStack(spacing: 6) {
            Text("\(n)").fontWeight(.semibold).foregroundStyle(Folevi.color.inkMuted)
            Image(systemName: icon).font(.system(size: 11, weight: .medium)).foregroundStyle(Folevi.color.inkMuted)
            Text(title).lineLimit(1).foregroundStyle(Folevi.color.ink)
            if let domain, domain != title.lowercased() { Text(domain).lineLimit(1).foregroundStyle(Folevi.color.inkMuted) }
        }
        .foleviFont(.footnote)
        .padding(.horizontal, 10)
        .frame(minHeight: compact ? 34 : 28)
        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).fill(Folevi.color.surfaceSunken))
        .contentShape(Rectangle())
    }

    var actions: some View {
        HStack(spacing: 0) {
            if !message.text.isEmpty {
                RowButton(title: "Copy", systemImage: "doc.on.doc") { model.copy(message) }
            }
            if isLast, message.status != "streaming" {
                RowButton(title: message.status == "error" ? "Try again" : "Regenerate", systemImage: "arrow.counterclockwise", disabled: model.isWorking) { model.regenerate() }
            }
            if !message.text.isEmpty {
                Menu {
                    Button { model.saveAsNote(message.id) } label: { Label("Save as note", systemImage: "square.and.arrow.down") }
                    ShareLink(item: model.plainText(message)) { Label("Share...", systemImage: "square.and.arrow.up") }
                    Button { model.copy(message) } label: { Label("Copy as text", systemImage: "doc.on.doc") }
                } label: {
                    Label("Export", systemImage: "ellipsis.circle")
                        .foleviFont(.footnote).fontWeight(.medium)
                        .foregroundStyle(Folevi.color.inkMuted)
                        .padding(.horizontal, 8)
                        .frame(minHeight: compact ? 44 : 28)
                        .contentShape(Rectangle())
                }
                .menuStyle(.button)
                .buttonStyle(PressFade())
                .fixedSize()
                .accessibilityLabel("Export this answer")
            }
            if message.status == "stopped" { Text("Stopped").foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint).padding(.horizontal, 8) }
            Spacer(minLength: 0)
        }
        .padding(.leading, -8)
    }
}

/// A soft card under an answer.
struct AnswerCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).foleviFont(.caps).foregroundStyle(Folevi.color.inkFaint)
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).fill(Folevi.color.surfaceSunken))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }
}

/// Proposed changes (make a folder, make a note, move a note): Apply or Not now.
struct ActionsCard: View {
    let model: FoliChatModel
    let message: ChatMessage

    var body: some View {
        let outcome = message.actionsOutcome
        AnswerCard(title: outcome == "applied" ? "Done" : "Changes to make") {
            ForEach(Array(message.actions.enumerated()), id: \.offset) { _, a in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: outcome == "applied" ? "checkmark" : a.type == "createFolder" ? "folder.badge.plus" : a.type == "createNote" ? "doc.badge.plus" : "arrow.right")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(Folevi.color.inkMuted).frame(width: 18)
                    Text(describe(a)).foleviFont(.callout).foregroundStyle(Folevi.color.ink).fixedSize(horizontal: false, vertical: true)
                }
            }
            if outcome == "dismissed" {
                Text("Not applied.").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
            } else if outcome == nil {
                HStack(spacing: 8) {
                    Button { model.applyActions(message, apply: true) } label: {
                        if model.busy.contains(message.id) { ProgressView().controlSize(.small) } else { Label("Apply changes", systemImage: "checkmark") }
                    }
                    .buttonStyle(FoleviButtonStyle(.primary, size: .small))
                    Button("Not now") { model.applyActions(message, apply: false) }
                        .buttonStyle(FoleviButtonStyle(.ghost, size: .small))
                }
                .disabled(model.busy.contains(message.id))
                .padding(.top, 4)
            }
        }
    }

    func describe(_ a: ChatAction) -> AttributedString {
        var s = AttributedString()
        func bold(_ t: String) -> AttributedString { var b = AttributedString(t); b.font = FoleviFonts.font(.ui, size: 14, weight: .semibold); return b }
        switch a.type {
        case "createFolder": s += AttributedString("New folder "); s += bold(a.title)
        case "createNote": s += AttributedString("New note "); s += bold(a.title); if let f = a.folderName { s += AttributedString(" in \(f)") }
        case "moveNote": s += AttributedString("Move "); s += bold(a.title); s += AttributedString(" to \(a.folderName ?? "the folder")")
        default: s += AttributedString(a.title)
        }
        return s
    }
}

/// The agent's proposed changes (revision 8): tick, approve, discard; once done, Undo.
struct AgentRunCard: View {
    let model: FoliChatModel
    let run: ChatAgentRun
    @State private var picked: Set<String>?
    @State private var previews: Set<String> = []

    static let doneTitles = ["done": "Done", "partial": "Partly done", "failed": "Not done", "undone": "Undone", "undoing": "Undoing", "running": "Applying changes", "executing": "Applying changes", "discarded": "Not applied"]

    var preview: Bool { run.status == "preview" }
    var chosen: Set<String> { picked ?? Set(run.operations.map(\.id)) }

    var body: some View {
        let busy = model.busy.contains(run.id)
        AnswerCard(title: preview ? "Proposed changes" : (Self.doneTitles[run.status] ?? "Changes")) {
            ForEach(run.operations, id: \.id) { op in operation(op) }
            if preview {
                Text("Nothing changes until you approve. A version of each note is saved first, and you can undo it all.")
                    .foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    Button { model.approve(run, operations: run.operations.map(\.id).filter(chosen.contains)) } label: {
                        if busy { ProgressView().controlSize(.small) } else { Text(chosen.count == run.operations.count ? "Approve all" : "Approve selected (\(chosen.count))") }
                    }
                    .buttonStyle(FoleviButtonStyle(.primary, size: .small))
                    .disabled(chosen.isEmpty)
                    Button("Not now") { model.discard(run) }.buttonStyle(FoleviButtonStyle(.ghost, size: .small))
                }
                .disabled(busy)
            } else if run.status == "discarded" {
                Text("Nothing was changed.").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
            } else if run.status == "running" || run.status == "executing" || run.status == "undoing" {
                HStack(spacing: 8) { ProgressView().controlSize(.small); Text(run.status == "undoing" ? "Undoing..." : "Applying...").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted) }
            } else if run.status == "undone" {
                Text("Everything Foli AI changed was put back. The notes' earlier versions are in their version history.").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).fixedSize(horizontal: false, vertical: true)
            } else if run.status == "done" || run.status == "partial" {
                let made = run.operations.filter { $0.status == "done" || $0.status == "applied" }.count
                HStack(spacing: 8) {
                    Text(made > 0 ? "\(made) change\(made == 1 ? "" : "s") made" : "No changes made").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                    Spacer()
                    if made > 0 {
                        Button { model.undo(run) } label: { if busy { ProgressView().controlSize(.small) } else { Label("Undo", systemImage: "arrow.uturn.backward") } }
                            .buttonStyle(FoleviButtonStyle(.secondary, size: .small))
                            .disabled(busy)
                    }
                }
            }
        }
    }

    @ViewBuilder
    func operation(_ op: ChatAgentOperation) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if preview {
                    Checkbox(isOn: Binding(get: { chosen.contains(op.id) }, set: { on in
                        var s = chosen
                        if on { s.insert(op.id) } else { s.remove(op.id) }
                        picked = s
                    }), label: op.summary)
                } else {
                    Image(systemName: op.status == "failed" ? "xmark.circle" : op.status == "skipped" ? "minus.circle" : op.status == "pending" ? "circle" : "checkmark.circle")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(op.status == "failed" ? Folevi.color.destructive : Folevi.color.inkMuted)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(op.summary).foleviFont(.callout).foregroundStyle(Folevi.color.ink).fixedSize(horizontal: false, vertical: true)
                    if let title = op.noteTitle, let id = op.noteId {
                        Button { model.onOpen(.note(id: id)) } label: { Label(title, systemImage: "doc.text").foleviFont(.footnote).foregroundStyle(Folevi.color.accentStrong) }
                            .buttonStyle(PressFade())
                    }
                    if let error = op.error { Text(error).foleviFont(.footnote).foregroundStyle(Folevi.color.destructive) }
                }
                Spacer(minLength: 0)
                if !op.edits.isEmpty || op.markdown != nil {
                    Button(previews.contains(op.id) ? "Hide" : "Preview") {
                        if previews.contains(op.id) { previews.remove(op.id) } else { previews.insert(op.id) }
                    }
                    .foleviFont(.footnote).buttonStyle(PressFade()).foregroundStyle(Folevi.color.inkMuted)
                }
            }
            if previews.contains(op.id) {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(op.edits.enumerated()), id: \.offset) { _, e in
                        if !e.before.isEmpty { diffLine(e.before, added: false) }
                        if !e.after.isEmpty { diffLine(e.after, added: true) }
                    }
                    if let md = op.markdown, op.edits.isEmpty { diffLine(md, added: true) }
                }
                .padding(.leading, 26)
            }
        }
    }

    func diffLine(_ text: String, added: Bool) -> some View {
        Text(text)
            .font(FoleviFonts.font(.ui, size: 13.5, weight: .regular, relativeTo: .footnote))
            .strikethrough(!added)
            .foregroundStyle(added ? Folevi.color.mossInk : Folevi.color.coralInk)
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous).fill(added ? Folevi.color.mossSoft : Folevi.color.coralSoft))
            .accessibilityLabel((added ? "Added: " : "Removed: ") + text)
    }
}

/// "Remember this for next time?": Save or Not now; once saved it says so.
struct MemoryCard: View {
    let model: FoliChatModel
    let message: ChatMessage
    let memory: ChatMemoryOffer

    var body: some View {
        if memory.status == "saved" {
            Label("Saved to memory. You can change it in Settings > Foli AI.", systemImage: "checkmark")
                .foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
        } else {
            AnswerCard(title: "Remember this for next time?") {
                Text(memory.text).foleviFont(.bodyStrong).foregroundStyle(Folevi.color.heading)
                HStack(spacing: 8) {
                    Button("Save") { model.memory(message, save: true) }.buttonStyle(FoleviButtonStyle(.secondary, size: .small))
                    Button("Not now") { model.memory(message, save: false) }.buttonStyle(FoleviButtonStyle(.ghost, size: .small))
                }
                .disabled(model.busy.contains(message.id))
            }
        }
    }
}

/// A research job's steps while it runs.
struct ResearchStepsView: View {
    let job: ResearchJob
    var body: some View {
        if job.status == "running" {
            AnswerCard(title: "Research") {
                ForEach(Array(job.steps.enumerated()), id: \.offset) { _, s in
                    HStack(spacing: 8) {
                        Group {
                            if s.status == "running" { ProgressView().controlSize(.mini) } else {
                                Image(systemName: s.status == "done" ? "checkmark.circle.fill" : s.status == "failed" ? "xmark.circle" : "minus.circle")
                                    .foregroundStyle(s.status == "done" ? Folevi.color.moss : Folevi.color.inkFaint)
                            }
                        }
                        .frame(width: 16)
                        Text(s.label + (s.count.map { " (\($0))" } ?? "")).foleviFont(.callout).foregroundStyle(s.status == "running" ? Folevi.color.ink : Folevi.color.inkMuted)
                    }
                }
                Text("This can take a few minutes. You can close the chat; the report appears here when it's ready.")
                    .foleviFont(.footnote).foregroundStyle(Folevi.color.inkFaint).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// A finished research report: Save as note (or Open note), and its sources.
struct ResearchFoot: View {
    let model: FoliChatModel
    let job: ResearchJob
    var body: some View {
        HStack(spacing: 8) {
            if job.status == "cancelled" {
                Text("Research cancelled").foleviFont(.footnote).foregroundStyle(Folevi.color.inkFaint)
            } else if job.status == "done" {
                Button { model.saveResearch(job) } label: {
                    Label(job.noteId == nil ? "Save as note" : "Open note", systemImage: job.noteId == nil ? "square.and.arrow.down" : "doc.text")
                }
                .buttonStyle(FoleviButtonStyle(.secondary, size: .small))
                .disabled(model.busy.contains(job.id))
            } else if let error = job.error {
                Text(error.message).foleviFont(.footnote).foregroundStyle(Folevi.color.destructive)
            }
        }
    }
}
