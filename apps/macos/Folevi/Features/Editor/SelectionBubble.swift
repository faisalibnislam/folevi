import AppKit
import SwiftUI

/// The floating formatting toolbar over selected text (EditorMenus.tsx `SelectionBubble`): Bold, Italic,
/// Underline, Strikethrough, Inline code, Link, Colour and highlight, Highlight, Clear formatting, Ask AI
/// and Comment. Link opens a field ("Paste or type a link", Apply, Remove); the palette shows the text
/// colours and highlights.
struct SelectionBubble: View {
    @Bindable var model: EditorModel
    var state: BubbleState
    @State private var href = ""
    @State private var linkError: String?
    @FocusState private var linkFocused: Bool

    var body: some View {
        Group {
            switch state.mode {
            case .marks: marks
            case .link: link
            case .colors: colors
            }
        }
        .padding(4)
        .foleviPop(radius: 8)
        .onExitCommand { back() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Text formatting"))
    }

    // MARK: Marks

    private var marks: some View {
        let active = model.activeMarks
        let hl = model.marksAtSelection().highlight
        return HStack(spacing: 2) {
            tool("Bold (⌘B)", "bold", active.contains("bold")) { model.toggleMark(.bold) }
            tool("Italic (⌘I)", "italic", active.contains("italic")) { model.toggleMark(.italic) }
            tool("Underline (⌘U)", "underline", active.contains("underline")) { model.toggleMark(.underline) }
            tool("Strikethrough (⌘⇧X)", "strikethrough", active.contains("strike")) { model.toggleMark(.strike) }
            tool("Inline code (⌘E)", "chevron.left.forwardslash.chevron.right", active.contains("code")) { model.toggleMark(.code) }
            tool("Link (⌘⇧K)", "link", active.contains("link")) { openLink() }
            tool("Color and highlight", "paintpalette", false, pressable: false) { setMode(.colors) }
            tool("Highlight (⌘⇧H)", "highlighter", hl != nil) {
                model.setHighlight(hl == nil ? .yellow : nil)
            }
            tool("Clear formatting", "eraser", false, pressable: false) { model.clearFormatting() }
            if model.aiWritable {
                divider
                Button {
                    let id = state.blockId
                    model.bubble = nil
                    if let tv = model.textView(id) {
                        let r = tv.selectedRange()
                        let text = (tv.string as NSString).substring(with: r)
                        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { model.openInlineAi() } else {
                            model.openInlineAi(blockId: id, range: r, text: text, task: nil)
                        }
                    }
                } label: {
                    AiIcon(size: 15).frame(width: 32, height: 32).contentShape(Rectangle())
                }
                .buttonStyle(BubbleToolStyle(active: false))
                .help(Text("Ask AI (⌘J)"))
                .accessibilityLabel(Text("Ask AI (⌘J)"))
            }
            if model.comments.data?.canComment == true {
                divider
                tool("Comment on this block", "text.bubble", false, pressable: false) {
                    let id = state.blockId
                    model.bubble = nil
                    model.comments.openBlock(id)
                }
            }
        }
    }

    private var divider: some View {
        Rectangle().fill(FoleviColor.line).frame(width: 1, height: 20).padding(.horizontal, 2)
    }

    private func tool(_ label: LocalizedStringKey, _ symbol: String, _ active: Bool, pressable: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13.5, weight: .medium))
                .frame(width: 32, height: 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(BubbleToolStyle(active: active))
        .help(Text(label))
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(pressable && active ? .isSelected : [])
    }

    // MARK: Link

    private var link: some View {
        HStack(spacing: 4) {
            TextField("Paste or type a link", text: $href)
                .textFieldStyle(.plain)
                .font(.ui(14))
                .padding(.horizontal, 12)
                .frame(width: 240, height: 32)
                .foleviInput()
                .overlay {
                    if linkError != nil {
                        RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.destructive, lineWidth: 1.5)
                    }
                }
                .focused($linkFocused)
                .onSubmit(apply)
                .onChange(of: href) { _, _ in linkError = nil }
                .help(linkError.map { Text($0) } ?? Text(""))
                .accessibilityLabel(Text("Link address"))
            Button("Apply", action: apply).buttonStyle(.folevi(.primary, .small))
            if model.linkActive {
                Button("Remove") { model.removeLink() }.buttonStyle(.folevi(.quiet, .small))
            }
        }
        .onAppear {
            href = model.linkDraft
            linkFocused = true
        }
    }

    private func openLink() {
        model.linkDraft = model.textView(state.blockId)?.linkAtSelection() ?? ""
        setMode(.link)
    }

    private func apply() {
        if href.trimmingCharacters(in: .whitespaces).isEmpty {
            if model.linkActive { model.removeLink() } else { model.bubble = nil }
            return
        }
        if !model.applyLink(href) {
            linkError = String(localized: "That doesn’t look like a web address.")
            NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                                 userInfo: [.announcement: linkError ?? "", .priority: NSAccessibilityPriorityLevel.high.rawValue])
        }
    }

    // MARK: Colours

    private var colors: some View {
        let current = model.marksAtSelection()
        return HStack(spacing: 4) {
            ForEach(TextColor.allCases, id: \.self) { c in
                Button { model.setColor(c) } label: {
                    Text(verbatim: "A")
                        .font(.ui(14, .semibold))
                        .foregroundStyle(Color(nsColor: c == .accent ? NSColor(FoleviColor.emberInk) : NSColor.folevi(text: c)))
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(BubbleToolStyle(active: current.color == c))
                .accessibilityLabel(Text("Text color: \(Self.colorName(c.rawValue))"))
            }
            Rectangle().fill(FoleviColor.line).frame(width: 1, height: 20).padding(.horizontal, 4)
            ForEach(HighlightColor.allCases, id: \.self) { h in
                Button { model.setHighlight(h) } label: {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(Color(nsColor: NSColor.folevi(highlight: h)))
                        .frame(width: 16, height: 16)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(BubbleToolStyle(active: current.highlight == h))
                .accessibilityLabel(Text("Highlight: \(Self.colorName(h.rawValue))"))
            }
            Button("Reset") {
                model.setColor(nil)
                model.setHighlight(nil)
            }
            .buttonStyle(.folevi(.quiet, .small))
        }
        .padding(2)
    }

    /// The web's COLOR_NAMES.
    static func colorName(_ id: String) -> String {
        switch id {
        case "muted": return String(localized: "Gray")
        case "accent": return String(localized: "Ember")
        case "moss": return String(localized: "Moss")
        case "marigold": return String(localized: "Marigold")
        case "plum": return String(localized: "Plum")
        case "coral": return String(localized: "Coral")
        case "yellow": return String(localized: "Yellow")
        case "green": return String(localized: "Green")
        case "blue": return String(localized: "Blue")
        default: return String(localized: "Pink")
        }
    }

    private func setMode(_ mode: BubbleState.Mode) {
        guard var b = model.bubble else { return }
        b.mode = mode
        model.bubble = b
    }

    /// Escape: from the link field or the colours back to the buttons, else back to the text.
    private func back() {
        if state.mode != .marks && !state.forced {
            setMode(.marks)
        } else {
            let id = state.blockId
            model.bubble = nil
            if let tv = model.textView(id) { model.focus = FocusRequest(blockId: id, caret: .offset(NSMaxRange(tv.selectedRange()))) }
        }
    }
}

/// A 32pt toolbar button: muted, the soft accent on hover; pressed (active) with a faint accent ring.
private struct BubbleToolStyle: ButtonStyle {
    var active: Bool
    func makeBody(configuration: Configuration) -> some View {
        ToolBody(configuration: configuration, active: active)
    }

    private struct ToolBody: View {
        let configuration: ButtonStyle.Configuration
        var active: Bool
        @State private var hovering = false
        var body: some View {
            configuration.label
                .foregroundStyle(active || hovering ? FoleviColor.heading : FoleviColor.inkMuted)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(active || hovering || configuration.isPressed ? FoleviColor.accentSoft : .clear))
                .overlay {
                    if active { RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.accent.opacity(0.25), lineWidth: 1) }
                }
                .onHover { hovering = $0 }
        }
    }
}
