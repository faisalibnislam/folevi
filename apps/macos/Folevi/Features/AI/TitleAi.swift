import SwiftUI

/// The title's AI, as on the web (TitleAi.tsx): "Edit with AI" while words in the title are selected, and a
/// menu (⌘J in the title) with the same rewrites for the selected words or the whole title, a fresh title
/// suggested from the note, and a free-form instruction. Attached to the title field.
struct TitleAiAttachment: View {
    var model: EditorModel

    private var ai: EditorAi { model.ai }

    private var showPill: Bool {
        model.aiWritable && ai.titleRange == nil && model.focusedBlockId == "__title__" && (ai.titleSelection?.length ?? 0) > 0
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            Color.clear
                .frame(width: 1, height: 1)
                .popover(isPresented: Binding(get: { ai.titleRange != nil && model.aiWritable }, set: { if !$0 { ai.titleRange = nil } }),
                         arrowEdge: .bottom) {
                    if let range = ai.titleRange {
                        TitleAiMenu(model: model, range: range)
                    }
                }
            Spacer(minLength: 0)
            if showPill {
                Button {
                    if let r = ai.titleSelection { model.openTitleAi(range: r) }
                } label: {
                    HStack(spacing: 6) {
                        AiIcon(size: 14)
                        Text("Edit with AI").font(.ui(12.5, .medium)).foregroundStyle(FoleviColor.ink)
                        Text("⌘J").font(.ui(11)).foregroundStyle(FoleviColor.inkFaint)
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .capsule, shadow: FoleviShadow.pop)
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .help(Text("Edit with AI (⌘J)"))
                .accessibilityIdentifier("title.editWithAi")
                .transition(.opacity)
            }
        }
        .allowsHitTesting(showPill || ai.titleRange != nil)
    }
}

/// The title's AI menu.
struct TitleAiMenu: View {
    var model: EditorModel
    var range: NSRange
    @Environment(AppModel.self) private var app
    @State private var busy: String?
    @State private var problem: AiProblem?
    @State private var instruction = ""
    @FocusState private var focused: Bool

    private var title: String { model.titleDraft }
    private var whole: Bool {
        let length = (title as NSString).length
        return range.length == 0 || (range.location == 0 && range.length >= length) || NSMaxRange(range) > length
    }
    private var target: String { whole ? title : (title as NSString).substring(with: range) }
    private var hasContent: Bool {
        model.rows.contains { !RichText.plainText($0.block.text).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                AiIcon(size: 16)
                TextField(whole ? "Ask AI to edit the title…" : "Ask AI to edit the selected words…", text: $instruction)
                    .textFieldStyle(.plain)
                    .font(.ui(14))
                    .focused($focused)
                    .disabled(busy != nil)
                    .onSubmit(sendInstruction)
                if !instruction.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button(action: sendInstruction) {
                        Image(systemName: "arrow.up").font(.system(size: 12, weight: .bold)).foregroundStyle(FoleviColor.accentInk)
                            .frame(width: 26, height: 26)
                            .background(FoleviColor.heading, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(busy != nil)
                    .accessibilityLabel(Text("Send"))
                }
                IconButton(systemImage: "xmark", label: "Close AI", shortcutHint: "Esc", size: 26) { close() }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            if let problem {
                AiProblemNotice(problem: problem).padding(.horizontal, 12).padding(.bottom, 8)
            }
            FoleviColor.line.opacity(0.6).frame(height: 1)
            VStack(alignment: .leading, spacing: 1) {
                if hasContent {
                    item(busy == "title" ? String(localized: "Thinking of a title…") : String(localized: "Suggest a new title from the note")) {
                        run("title", task: "title")
                    }
                }
                if !target.trimmingCharacters(in: .whitespaces).isEmpty {
                    ForEach(AiCatalog.titleActions, id: \.task) { a in
                        item(busy == a.label ? String(localized: "Working…") : a.label) { run(a.label, task: a.task) }
                    }
                }
            }
            .padding(6)
            if busy == "instruction" {
                Text("Working…").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 16).padding(.bottom, 10)
            }
            FoleviColor.line.opacity(0.6).frame(height: 1)
            Text("AI can make mistakes. Sent to Google Gemini.")
                .font(.ui(11.5))
                .foregroundStyle(FoleviColor.inkFaint)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
        }
        .frame(width: 360)
        .background(FoleviColor.surfaceRaised)
        .onAppear { focused = true }
        .onExitCommand(perform: close)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("AI for the title"))
        .accessibilityIdentifier("title.aiMenu")
    }

    private func item(_ label: String, action: @escaping () -> Void) -> some View {
        TitleAiRow(label: label, disabled: busy != nil, action: action)
    }

    private func close() {
        model.ai.titleRange = nil
        model.focus = FocusRequest(blockId: "__title__", caret: .range(range.location, range.length))
    }

    private func sendInstruction() {
        let i = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !i.isEmpty, !target.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        run("instruction", task: "refine", instruction: i)
    }

    private func run(_ label: String, task: String, instruction: String? = nil) {
        guard busy == nil, let session = app.session else { return }
        busy = label
        problem = nil
        let original = title
        let sent = target
        let r = range
        let documentId = model.documentId
        Task {
            do {
                var args: [String: JSONValue] = ["scope": session.scope.arg, "task": .string(task), "documentId": .string(documentId)]
                if task != "title" { args["text"] = .string(sent) }
                if let instruction { args["instruction"] = .string(instruction) }
                let out: AiWritten = try await session.convex.action("ai:write", args, timeout: 90)
                let next = task == "title" ? AiCatalog.applyTitle(out.text, to: original, range: NSRange(location: 0, length: 0))
                    : AiCatalog.applyTitle(out.text, to: original, range: whole ? NSRange(location: 0, length: 0) : r)
                guard let next else {
                    problem = .other(String(localized: "The AI didn't return a title. Try again."))
                    busy = nil
                    return
                }
                model.applyAiTitle(next)
                model.focus = FocusRequest(blockId: "__title__", caret: .end)
            } catch {
                problem = AiProblem.from(error)
                busy = nil
            }
        }
    }
}

private struct TitleAiRow: View {
    var label: String
    var disabled: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.ui(13.5))
                .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(hovering ? FoleviGlass.hover : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .onHover { hovering = $0 && !disabled }
    }
}
