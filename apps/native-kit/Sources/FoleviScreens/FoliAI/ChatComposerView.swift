// The composer (web ChatThread.tsx's box, ContextChips.tsx, WebToggle.tsx): what the chat is about as chips
// at its top (the place, a folder or notes, Add, Web), the text box (grows to six lines), Chat / Research,
// and Send, which becomes Stop while Foli AI answers. Above it, one status line; under it, "Foli AI can make
// mistakes." On iOS it rides the keyboard from FoliChatController (keyboard layout guide), in one motion.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct FoliComposerView: View {
    @Bindable var model: FoliChatModel
    var compact: Bool
    @FocusState private var focused: Bool
    @State private var picking = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var sendSize: CGFloat = 36

    public init(model: FoliChatModel, compact: Bool) {
        self.model = model
        self.compact = compact
    }

    public var body: some View {
        VStack(spacing: 8) {
            statusLine
            VStack(alignment: .leading, spacing: 0) {
                chips.padding(.horizontal, 10).padding(.top, 10)
                if model.editingMessageId != nil {
                    HStack {
                        Label("Editing your question", systemImage: "pencil").foleviFont(.caption).foregroundStyle(Folevi.color.inkMuted)
                        Spacer()
                        Button("Cancel") { model.cancelEdit() }.foleviFont(.caption).buttonStyle(PressFade()).foregroundStyle(Folevi.color.inkMuted)
                    }
                    .padding(.horizontal, 14).padding(.top, 8)
                }
                field
                bottomRow.padding(.horizontal, 10).padding(.bottom, 10)
            }
            .background(RoundedRectangle(cornerRadius: compact ? FoleviTokens.Radius.sheet : FoleviTokens.Radius.panel, style: .continuous).fill(Folevi.color.surfaceRaised))
            .overlay(RoundedRectangle(cornerRadius: compact ? FoleviTokens.Radius.sheet : FoleviTokens.Radius.panel, style: .continuous).stroke(Folevi.color.line, lineWidth: 0.5))
            .foleviShadow(.card, radius: compact ? FoleviTokens.Radius.sheet : FoleviTokens.Radius.panel)
            Text(model.footnote)
                .foleviFont(compact ? .footnote : .caption)
                .foregroundStyle(Folevi.color.inkFaint)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, compact ? 12 : 16)
        .padding(.bottom, 8)
        .padding(.top, 4)
        .sheet(isPresented: $picking) {
            FoliNotePicker(model: model) { picking = false }
                #if os(iOS)
                .presentationDetents([.medium, .large])
                #else
                .frame(minWidth: 380, minHeight: 420)
                #endif
        }
        .onChange(of: model.editingMessageId) { _, id in if id != nil { focused = true } }
    }

    // MARK: Status

    @ViewBuilder
    var statusLine: some View {
        if let status = model.status {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(status).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(status)
            .accessibilityAddTraits(.updatesFrequently)
            .transition(.opacity)
        }
    }

    // MARK: Chips

    var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                if let label = model.conversationContextLabel, !model.isNew {
                    chip(label, icon: "text.bubble", removable: nil)
                } else if model.context.isEmpty {
                    chip(model.placeName, icon: "square.stack", removable: nil)
                        .accessibilityLabel("About: everything in \(model.placeName)")
                } else {
                    ForEach(model.context) { item in
                        chip(item.name, icon: item.kind == .folder ? "folder" : "doc.text", removable: item.id)
                    }
                }
                if model.isNew, model.context.first?.kind != .folder {
                    Button { picking = true } label: { chipLabel("Add", icon: "plus", selected: false) }
                        .buttonStyle(PressFade())
                        .disabled(model.isWorking)
                        .accessibilityLabel("Add a note for Foli AI to read")
                }
                if model.webAvailable, model.effectiveMode == .chat {
                    Button { model.web.toggle() } label: { chipLabel("Web", icon: "globe", selected: model.web) }
                        .buttonStyle(PressFade())
                        .disabled(model.isWorking)
                        .accessibilityLabel("Search the web")
                        .accessibilityAddTraits(model.web ? .isSelected : [])
                }
            }
            .padding(1)
        }
    }

    func chip(_ title: String, icon: String, removable id: String?) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold))
            Text(title).lineLimit(1).truncationMode(.tail).frame(maxWidth: 180, alignment: .leading).fixedSize()
            if let id {
                Button { model.removeContext(id) } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).frame(width: 18, height: 18).contentShape(Rectangle()) }
                    .buttonStyle(PressFade())
                    .accessibilityLabel("Remove \(title)")
            }
        }
        .foleviFont(.caption).fontWeight(.semibold)
        .foregroundStyle(Folevi.color.accentSoftInk)
        .padding(.leading, 9).padding(.trailing, id == nil ? 9 : 3)
        .frame(minHeight: compact ? 30 : 24)
        .background(Capsule().fill(Folevi.color.accentSoft))
    }

    func chipLabel(_ title: String, icon: String, selected: Bool) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold))
            Text(title)
        }
        .foleviFont(.caption).fontWeight(.semibold)
        .foregroundStyle(selected ? Folevi.color.accentInk : Folevi.color.inkMuted)
        .padding(.horizontal, 10)
        .frame(minHeight: compact ? 30 : 24)
        .background(Capsule().fill(selected ? Folevi.color.accent : Color.clear))
        .overlay(Capsule().stroke(selected ? Color.clear : Folevi.color.lineStrong, lineWidth: 1))
        .contentShape(Capsule())
    }

    // MARK: Field

    var field: some View {
        TextField(model.placeholder, text: $model.draft, axis: .vertical)
            .textFieldStyle(.plain)
            .font(FoleviFonts.font(.ui, size: compact ? 17 : 15, weight: .regular, relativeTo: .body))
            .foregroundStyle(Folevi.color.ink)
            .lineLimit(compact ? 1...6 : 2...8)
            .focused($focused)
            .disabled(!model.available)
            .padding(.horizontal, 14)
            .padding(.top, 10)
            .padding(.bottom, 6)
            .onKeyPress(.return, phases: .down) { press in
                // Return sends (Shift-Return is a new line), as on the web.
                if press.modifiers.contains(.shift) { return .ignored }
                model.send()
                return .handled
            }
            .accessibilityLabel(model.effectiveMode == .research ? "What should Foli AI research?" : "Ask about your notes, or ask Foli AI to change them")
            .accessibilityIdentifier("foli-composer")
    }

    var bottomRow: some View {
        HStack(spacing: 8) {
            if model.webAvailable {
                SegmentedControl(selection: $model.mode, options: [(FoliChatMode.chat, "Chat"), (FoliChatMode.research, "Research")])
                    .frame(maxWidth: 200)
                    .disabled(model.isWorking)
                    .accessibilityLabel("How Foli AI helps")
            }
            Spacer(minLength: 0)
            if model.isWorking {
                Button { model.stop() } label: {
                    Image(systemName: "stop.fill").font(.system(size: 13, weight: .bold))
                        .frame(width: sendSize, height: sendSize)
                        .foregroundStyle(Folevi.color.canvas)
                        .background(Circle().fill(Folevi.color.heading))
                        .contentShape(Circle())
                }
                .buttonStyle(PressFade())
                .accessibilityLabel(model.effectiveMode == .research ? "Stop research" : "Stop")
                .accessibilityIdentifier("foli-stop")
                .keyboardShortcut(".", modifiers: .command)
            } else {
                Button { model.send() } label: {
                    Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold))
                        .frame(width: sendSize, height: sendSize)
                        .foregroundStyle(Folevi.color.canvas)
                        .background(Circle().fill(Folevi.color.heading))
                        .opacity(model.canSend ? 1 : 0.3)
                        .contentShape(Circle())
                }
                .buttonStyle(PressFade())
                .disabled(!model.canSend)
                .accessibilityLabel(model.effectiveMode == .research ? "Start research" : "Ask")
                .accessibilityIdentifier("foli-send")
            }
        }
        .foleviAnimation(FoleviTokens.Motion.fast, value: model.isWorking)
    }
}

/// The Add chip's picker: notes found as you type.
struct FoliNotePicker: View {
    let model: FoliChatModel
    let done: () -> Void
    @State private var text = ""
    @State private var hits: [SearchHit] = []

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Add a note").foleviFont(.headline).foregroundStyle(Folevi.color.heading)
                Spacer()
                Button("Done", action: done).foleviFont(.button)
            }
            .padding(16)
            SearchField(text: $text, prompt: "Find a note")
                .padding(.horizontal, 16)
            List(hits, id: \.id) { hit in
                Button {
                    model.addNote(id: hit.id, title: hit.title)
                    done()
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(hit.title.isEmpty ? "Untitled" : hit.title).foleviFont(.bodyStrong).foregroundStyle(Folevi.color.ink)
                        if !hit.snippet.isEmpty { Text(hit.snippet).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).lineLimit(1) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .listStyle(.plain)
            .overlay {
                if hits.isEmpty { Text(text.isEmpty ? "Type to find a note." : "No notes match.").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted) }
            }
        }
        .background(Folevi.color.canvas)
        .task(id: text) {
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled else { return }
            hits = await model.findNotes(text)
        }
    }
}
