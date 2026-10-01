import AppKit
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

/// TeX formula block, as on the web (FormulaView.tsx): the rendered formula; click it (or press Return
/// while it is selected) to edit the LaTeX with a live preview. Escape, ⌘Return or leaving the field
/// finishes.
struct FormulaBlockView: View {
    let block: Block
    let props: FormulaProps
    @Bindable var model: EditorModel
    @Environment(AppModel.self) private var app
    @State private var editing = false
    @State private var hovering = false
    @FocusState private var fieldFocused: Bool

    /// `.fb-formula-input`: 13.5pt mono at a 1.55 line height.
    private static let fieldFontSize: CGFloat = 13.5
    private static let fieldLineHeight: CGFloat = fieldFontSize * 1.55
    @MainActor private static let fieldNaturalLineHeight: CGFloat =
        NSLayoutManager().defaultLineHeight(for: FoleviFont.nsFont(.mono, size: fieldFontSize))

    private var scale: CGFloat { CGFloat(app.editorScale) }
    private var editable: Bool { !model.isReadOnly }
    private var bodySize: CGFloat { BlockStyles.bodySize(model.style.font) * scale }
    /// KaTeX draws at 1.21em of the page text.
    private var mathSize: CGFloat { bodySize * 1.21 }
    /// `.katex-display` keeps 0.35em above and below; the formula view already pads by a tenth of its size.
    private var displayMargin: CGFloat { max(0, bodySize * 0.35 - mathSize * 0.1) }
    private var ink: Color { model.sheetPalette?.ink ?? FoleviColor.ink }
    private var isSelected: Bool { model.selectedBlockIds.contains(block.id) }

    var body: some View {
        Group {
            if editing { editor } else { display }
        }
        .richAtomOutline(isSelected && !editing, accent: model.documentAccent)
        // `.fb-formula-box`: 0.4em above and below.
        .padding(.vertical, bodySize * 0.4)
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

    /// The rendered formula, centred, scrolling sideways when it is wider than the page.
    private func rendered(_ latex: String) -> some View {
        ViewThatFits(in: .horizontal) {
            MathFormulaView(latex: latex, fontSize: mathSize, color: ink)
                .padding(.vertical, displayMargin)
                .frame(maxWidth: .infinity)
            ScrollView(.horizontal, showsIndicators: false) {
                MathFormulaView(latex: latex, fontSize: mathSize, color: ink)
                    .padding(.vertical, displayMargin)
            }
        }
    }

    private var display: some View {
        let latex = props.latex.trimmingCharacters(in: .whitespacesAndNewlines)
        return Group {
            if latex.isEmpty {
                Text(editable ? "Empty formula. Click to write LaTeX" : "Empty formula")
                    .font(.ui(14))
                    .foregroundStyle(model.sheetPalette?.faint ?? FoleviColor.inkFaint)
                    .frame(maxWidth: .infinity)
            } else {
                rendered(props.latex)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, minHeight: 2.6 * bodySize)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(editable && hovering ? FoleviColor.surfaceSunken.opacity(0.6) : .clear))
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onHover { hovering = $0 }
        .pointerStyle(editable ? .link : nil)
        .onTapGesture {
            if editable { startEditing() } else { model.select(block.id, extend: false) }
        }
        .help(editable ? Text("Click to edit the formula (Enter when selected)") : Text(""))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Formula"))
        .accessibilityValue(Text(latex.isEmpty ? String(localized: "Empty formula") : latex))
        .accessibilityAddTraits(editable ? .isButton : [])
        .accessibilityAction { if editable { startEditing() } }
    }

    /// Rows shown by the field: the line count, between 2 and 8 (the web's textarea `rows`).
    private var rows: CGFloat {
        CGFloat(min(8, max(2, props.latex.split(separator: "\n", omittingEmptySubsequences: false).count)))
    }

    private var editor: some View {
        let field = RoundedRectangle(cornerRadius: 9, style: .continuous)
        return VStack(alignment: .leading, spacing: 0) {
            TextEditor(text: Binding(get: { props.latex }, set: { setLatex($0) }))
                .font(.mono(Self.fieldFontSize))
                .lineSpacing(max(0, Self.fieldLineHeight - Self.fieldNaturalLineHeight))
                .foregroundStyle(FoleviColor.ink)
                .scrollContentBackground(.hidden)
                .autocorrectionDisabled()
                // 8 × 10 like the web (the text view adds 5pt of line padding on each side).
                .padding(.horizontal, 5)
                .padding(.vertical, 8)
                .frame(height: rows * Self.fieldLineHeight + 16)
                .background(field.fill(FoleviColor.surfaceRaised))
                .overlay {
                    field.inset(by: -1).strokeBorder(fieldFocused ? FoleviColor.focus : FoleviColor.lineStrong, lineWidth: 1)
                }
                .background {
                    // Focus: a 1pt focus edge and a soft 4pt halo (20% focus colour).
                    if fieldFocused {
                        RoundedRectangle(cornerRadius: 13, style: .continuous).fill(FoleviColor.focus.opacity(0.2)).padding(-4)
                    }
                }
                .focused($fieldFocused)
                .overlay(alignment: .topLeading) {
                    if props.latex.isEmpty {
                        Text("e.g. E = mc^2").font(.mono(Self.fieldFontSize)).foregroundStyle(FoleviColor.inkFaint)
                            .padding(.horizontal, 10).padding(.vertical, 8).allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                .onExitCommand { finish() }
                .onKeyPress(.return, phases: .down) { press in
                    guard press.modifiers.contains(.command) || press.modifiers.contains(.control) else { return .ignored }
                    finish()
                    return .handled
                }
                .accessibilityLabel(Text("LaTeX formula"))
                .accessibilityHint(Text("LaTeX · Esc or ⌘↩ to finish"))
            Text("LaTeX · Esc or ⌘↩ to finish")
                .font(.ui(11.5, .medium))
                .foregroundStyle(FoleviColor.inkMuted)
                .padding(.top, 6)
                .accessibilityHidden(true)
            if !props.latex.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                rendered(props.latex)
                    .padding(.top, 6)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(FoleviColor.surfaceSunken))
        .onChange(of: fieldFocused) { _, focused in
            // Leaving the field finishes, without moving the selection (the web's onBlur).
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

    /// Escape or ⌘Return: close the field and select the formula, as the web does.
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
