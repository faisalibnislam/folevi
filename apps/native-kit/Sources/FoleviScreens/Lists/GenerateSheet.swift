// Generate a template (or a note) with Foli AI (web ai/AiGenerateDialog.tsx): describe it (or pick an example),
// Foli AI writes it, you check it with its name, and only Save makes it. A saved template is a regular one.
// Commands `ai.generate` and `ai.saveDraft` (R9.4).
import SwiftUI
import FoleviDesign
import FoleviEngine

@MainActor
@Observable
public final class GenerateModel {
    public enum Kind: String, Sendable { case template, note }
    public let kind: Kind
    let client: EngineClient
    let space: SpaceRef?
    public var prompt = ""
    public var title = ""
    public private(set) var draft: AiGenerateResult?
    public private(set) var busy = false
    public private(set) var saving = false
    public private(set) var error: String?
    @ObservationIgnored private var run = 0

    public init(kind: Kind, client: EngineClient, space: SpaceRef? = nil) {
        self.kind = kind
        self.client = client
        self.space = space
    }

    public var examples: [String] {
        kind == .template ? ["Weekly team meeting", "Project kickoff", "Book notes", "Trip planner"] : ["A packing list for a weekend hike", "A plan to learn Spanish in three months", "Notes for a product launch"]
    }
    public var heading: String { kind == .template ? "Generate a template" : "Generate a note" }
    public var question: String { kind == .template ? "What's the template for?" : "What should the note be?" }
    public var placeholder: String { kind == .template ? "A one-on-one with my manager: wins, blockers, feedback, next steps" : "A plan for moving house next month" }
    public var saveTitle: String { kind == .template ? "Save template" : "Create note" }
    public var nameLabel: String { kind == .template ? "Template name" : "Title" }

    public func generate() async {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !busy else { return }
        run += 1
        let mine = run
        busy = true
        error = nil
        draft = nil
        defer { if mine == run { busy = false } }
        do {
            let out = try await client.command(PendingN7Commands.AiGenerate(AiGenerateArgs(kind: kind.rawValue, instruction: text, space: space)))
            guard mine == run else { return }
            if !out.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                draft = out
                title = out.title.isEmpty ? String(text.prefix(80)) : out.title
            }
        } catch {
            if mine == run { self.error = ScreenErrors.message(error) }
        }
    }

    /// Saves the draft; returns the new note's id.
    public func save() async -> String? {
        guard let draft, !saving else { return nil }
        saving = true
        defer { saving = false }
        do {
            return try await client.command(PendingN7Commands.AiSaveDraft(AiSaveDraftArgs(kind: kind.rawValue, title: title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? draft.title : title, text: draft.text, space: space))).id
        } catch {
            self.error = ScreenErrors.message(error)
            return nil
        }
    }

    public func tryAgain() {
        draft = nil
        error = nil
    }
}

public struct GenerateSheet: View {
    @Bindable var model: GenerateModel
    let onSaved: (String) -> Void
    let onCancel: () -> Void
    @FocusState private var nameFocused: Bool

    public init(model: GenerateModel, onSaved: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
        self.model = model
        self.onSaved = onSaved
        self.onCancel = onCancel
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let draft = model.draft, !model.busy {
                        Text(model.nameLabel).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                        TextField(model.nameLabel, text: $model.title)
                            .foleviFont(.headline)
                            .textFieldStyle(.roundedBorder)
                            .focused($nameFocused)
                            .onAppear { nameFocused = true }
                        Text(CatchUpCardView.markdown(draft.text))
                            .foleviFont(.callout)
                            .foregroundStyle(Folevi.color.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(Folevi.color.surfaceSunken))
                        Text("Foli AI can make mistakes, so check it before you save.").foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint)
                    } else {
                        Text(model.question).foleviFont(.bodyStrong).foregroundStyle(Folevi.color.heading)
                        TextField(model.placeholder, text: $model.prompt, axis: .vertical)
                            .lineLimit(3...6)
                            .textFieldStyle(.roundedBorder)
                            .disabled(model.busy)
                            .accessibilityIdentifier("generate-prompt")
                        if model.busy {
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("Writing the \(model.kind.rawValue)…").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                            }
                            .accessibilityElement(children: .combine)
                        } else {
                            FlowLayout(spacing: 6) {
                                ForEach(model.examples, id: \.self) { x in
                                    Button(x) { model.prompt = x }.buttonStyle(.folevi(.secondary, size: .small))
                                }
                            }
                            .accessibilityLabel("Examples")
                        }
                    }
                    if let error = model.error { Text(error).foleviFont(.footnote).foregroundStyle(Folevi.color.destructive) }
                }
                .padding(20)
            }
            .navigationTitle(model.heading)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                ToolbarItem(placement: .confirmationAction) {
                    if model.draft != nil && !model.busy {
                        Button(model.saveTitle) {
                            Task { if let id = await model.save() { onSaved(id) } }
                        }
                        .disabled(model.saving)
                    } else {
                        Button("Generate") { Task { await model.generate() } }
                            .disabled(model.busy || model.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                if model.draft != nil && !model.busy {
                    ToolbarItem(placement: .secondaryAction) { Button("Try again") { model.tryAgain() } }
                }
            }
        }
        .frame(minWidth: 440, minHeight: 420)
        .presentationDetents([.large])
        .accessibilityIdentifier("generate-sheet")
    }
}
