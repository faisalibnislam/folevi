import SwiftUI

// The title's AI, as on the web (TitleAi.tsx): "Edit with AI" under the title while words in it are
// selected, and a menu (⌘J in the title) with the same rewrites for the selected words or the whole title,
// a fresh title suggested from the note, and a free-form instruction. EditorAiOverlay floats both under
// the title, at its left.

/// A small "Edit with AI" button under the title while words in it are selected. Clicking it keeps the
/// title's selection.
struct TitleAiPill: View {
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                AiIcon(size: 14)
                Text("Edit with AI").font(.ui(12.5, .medium)).foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.ink)
                Text("⌘J").font(.ui(11)).foregroundStyle(FoleviColor.inkFaint).padding(.leading, 4)
            }
            .padding(.horizontal, 12)
            .frame(height: 30)
            .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .capsule, shadow: FoleviShadow.pop)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(Text("Edit with AI (⌘J)"))
        .accessibilityIdentifier("title.editWithAi")
    }
}

/// The title's AI menu.
struct TitleAiMenu: View {
    var model: EditorModel
    var range: NSRange
    @Environment(AppModel.self) private var app
    @State private var busy: String?
    @State private var error: String?
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
                    .foregroundStyle(FoleviColor.ink)
                    .focused($focused)
                    .disabled(busy != nil)
                    .onSubmit(sendInstruction)
                    .accessibilityLabel(Text(whole ? "Ask AI to edit the title" : "Ask AI to edit the selected words"))
                if !instruction.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button(action: sendInstruction) {
                        Image(systemName: "arrow.up").font(.system(size: 13, weight: .bold)).foregroundStyle(FoleviColor.canvas)
                            .frame(width: 28, height: 28)
                            .background(FoleviColor.heading, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(busy != nil)
                    .accessibilityLabel(Text("Send"))
                }
                IconButton(systemImage: "xmark", label: "Close AI", shortcutHint: "Esc", size: 28) { close() }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            if let error {
                Text(error)
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.destructive)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(FoleviColor.destructiveSoft, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
                    .accessibilityAddTraits(.isStaticText)
            }
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
            .overlay(alignment: .top) { FoleviColor.line.opacity(0.6).frame(height: 1) }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("AI suggestions"))
            if busy == "instruction" {
                Text("Working…").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 16).padding(.bottom, 10)
            }
            Text("AI can make mistakes. Sent to Google Gemini.")
                .font(.ui(11.5))
                .foregroundStyle(FoleviColor.inkFaint)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .top) { FoleviColor.line.opacity(0.6).frame(height: 1) }
        }
        .frame(width: 360)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .foleviPop(radius: 12)
        .claimsFocus($focused)
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
        error = nil
        let original = title
        let sent = target
        let r = range
        let documentId = model.documentId
        let whole = self.whole
        Task {
            do {
                var args: [String: JSONValue] = ["scope": session.scope.arg, "task": .string(task), "documentId": .string(documentId)]
                if task != "title" { args["text"] = .string(sent) }
                if let instruction { args["instruction"] = .string(instruction) }
                let out: AiWritten = try await session.convex.action("ai:write", args, timeout: 90)
                let next: String?
                if task == "title" {
                    // A suggested title replaces the whole title (the old one stays when nothing comes back).
                    next = AiCatalog.applyTitle(out.text, to: original, range: NSRange(location: 0, length: 0)) ?? original
                } else {
                    next = AiCatalog.applyTitle(out.text, to: original, range: whole ? NSRange(location: 0, length: 0) : r)
                }
                guard let next else {
                    error = String(localized: "The AI didn't return a title. Try again.")
                    busy = nil
                    return
                }
                model.applyAiTitle(next)
                model.focus = FocusRequest(blockId: "__title__", caret: .end)
            } catch {
                self.error = ConvexService.mapError(error).localizedDescription
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
                .padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(hovering ? FoleviGlass.hover : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .onHover { hovering = $0 && !disabled }
    }
}
