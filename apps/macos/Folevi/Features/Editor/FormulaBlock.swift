import SwiftUI

/// Formula blocks this person just inserted open straight into editing (the web's OPEN_ON_MOUNT), and
/// Return on a selected formula opens it (`request`).
@MainActor
@Observable
final class FormulaEditing {
    static let shared = FormulaEditing()
    static var openOnMount: Set<String> = []
    var request: String?
}

/// TeX formula block, as on the web: the rendered formula; click it to edit the LaTeX with a live
/// preview. Escape, ⌘Return or leaving the field finishes.
struct FormulaBlockView: View {
    let block: Block
    let props: FormulaProps
    @Bindable var model: EditorModel
    @Environment(AppModel.self) private var app
    @State private var editing = false
    @State private var hovering = false
    @FocusState private var fieldFocused: Bool

    private var scale: CGFloat { CGFloat(app.editorScale) }
    private var editable: Bool { !model.isReadOnly }
    /// KaTeX draws at 1.21em of the page text.
    private var mathSize: CGFloat { BlockStyles.bodySize(model.style.font) * 1.21 * scale }
    private var ink: Color { model.sheetPalette?.ink ?? FoleviColor.ink }

    var body: some View {
        Group {
            if editing { editor } else { display }
        }
        .onAppear {
            if FormulaEditing.openOnMount.remove(block.id) != nil, editable { startEditing() }
        }
        .onChange(of: FormulaEditing.shared.request) { _, id in
            // Return on the selected formula opens it (keyboard access).
            guard id == block.id else { return }
            FormulaEditing.shared.request = nil
            if editable { startEditing() }
        }
    }

    private var display: some View {
        let latex = props.latex.trimmingCharacters(in: .whitespacesAndNewlines)
        return ScrollView(.horizontal, showsIndicators: false) {
            Group {
                if latex.isEmpty {
                    Text(editable ? "Empty formula. Click to write LaTeX" : "Empty formula")
                        .font(.ui(14))
                        .foregroundStyle(model.sheetPalette?.faint ?? FoleviColor.inkFaint)
                } else {
                    MathFormulaView(latex: props.latex, fontSize: mathSize, color: ink)
                }
            }
            .frame(minWidth: 0)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
        .frame(maxWidth: .infinity, minHeight: 2.6 * BlockStyles.bodySize(model.style.font) * scale)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(editable && hovering ? FoleviColor.surfaceSunken.opacity(0.6) : .clear))
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onHover { hovering = $0 }
        .onTapGesture {
            if editable { startEditing() } else { model.select(block.id, extend: false) }
        }
        .help(editable ? Text("Click to edit the formula (Enter when selected)") : Text(""))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(latex.isEmpty ? "Empty formula" : "Formula: \(latex)"))
        .accessibilityAddTraits(editable ? .isButton : [])
        .accessibilityAction { if editable { startEditing() } }
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextEditor(text: Binding(get: { props.latex }, set: { setLatex($0) }))
                .font(.mono(13.5))
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 6)
                .padding(.vertical, 6)
                .frame(minHeight: CGFloat(min(8, max(2, props.latex.split(separator: "\n", omittingEmptySubsequences: false).count))) * 21 + 12)
                .fixedSize(horizontal: false, vertical: true)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(FoleviColor.surfaceRaised))
                .overlay {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .strokeBorder(fieldFocused ? FoleviColor.focus : FoleviColor.lineStrong, lineWidth: 1)
                }
                .shadow(color: fieldFocused ? FoleviColor.focus.opacity(0.2) : .clear, radius: 0, x: 0, y: 0)
                .focused($fieldFocused)
                .overlay(alignment: .topLeading) {
                    if props.latex.isEmpty {
                        Text("e.g. E = mc^2").font(.mono(13.5)).foregroundStyle(FoleviColor.inkFaint)
                            .padding(.horizontal, 11).padding(.vertical, 6).allowsHitTesting(false)
                    }
                }
                .onExitCommand { finish() }
                .onKeyPress(.return, phases: .down) { press in
                    guard press.modifiers.contains(.command) else { return .ignored }
                    finish()
                    return .handled
                }
                .accessibilityLabel(Text("LaTeX formula"))
                .accessibilityHint(Text("LaTeX · Esc or ⌘↩ to finish"))
            Text("LaTeX · Esc or ⌘↩ to finish")
                .font(.ui(11.5, .medium))
                .foregroundStyle(FoleviColor.inkMuted)
            if !props.latex.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    MathFormulaView(latex: props.latex, fontSize: mathSize, color: ink)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(FoleviColor.surfaceSunken))
        .onChange(of: fieldFocused) { _, focused in
            if !focused { editing = false }
        }
    }

    private func startEditing() {
        editing = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(30))
            fieldFocused = true
        }
    }

    private func finish() {
        editing = false
        fieldFocused = false
        model.select(block.id, extend: false)
    }

    private func setLatex(_ value: String) {
        let clipped = String(value.prefix(FoleviLimits.maxFormulaLength))
        model.update(block.id, actionName: String(localized: "Edit Formula"), undoable: false) { b in
            guard case .formula(var p) = b.content else { return }
            p.latex = clipped
            b.content = .formula(p)
        }
    }
}
