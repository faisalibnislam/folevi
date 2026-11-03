// The floating note window's bar (the Mac's Float Note, apps/mac Chrome/FloatingNotes.swift), as Apple Notes'
// floating note: room for the window buttons, the note's emoji and title, and the pin that keeps the window on
// top of other apps. Dragging the bar moves the window. The note page under it brings its own bottom bar.
import SwiftUI
import Observation
import FoleviDesign

/// What the window tells its bar: whether it stays on top, and the title bar's height and buttons.
@MainActor
@Observable
public final class FloatingNoteState {
    public var onTop: Bool
    /// The system title bar's height (the window buttons are centred on it).
    public var barHeight: CGFloat = 28
    /// From the window's left edge to just past its zoom button.
    public var buttonsWidth: CGFloat = 72

    public init(onTop: Bool) {
        self.onTop = onTop
    }
}

public struct FloatingNoteBar: View {
    let model: FrameModel
    let state: FloatingNoteState
    let toggleOnTop: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(model: FrameModel, state: FloatingNoteState, toggleOnTop: @escaping () -> Void) {
        self.model = model
        self.state = state
        self.toggleOnTop = toggleOnTop
    }

    /// The note's title as its tab has it until the page says (the window's title too).
    public static func title(_ model: FrameModel) -> String {
        model.activeNote?.title.nonEmpty ?? model.tabs.active.title.nonEmpty ?? "Untitled"
    }

    private var title: String { Self.title(model) }

    /// The note's emoji, when its icon is one (not a named icon).
    private var emoji: String? {
        guard let icon = model.activeNote?.icon, icon.count == 1, icon.unicodeScalars.contains(where: { $0.properties.isEmojiPresentation || $0.properties.isEmoji && $0.value > 0xFF }) else { return nil }
        return icon
    }

    private func color(_ name: String, _ fallback: Color) -> Color {
        WebStyles.vars[name]?.resolve(scheme).color ?? fallback
    }

    public var body: some View {
        HStack(spacing: 6) {
            Color.clear.frame(width: state.buttonsWidth)
            if let emoji {
                Text(emoji).font(.system(size: 13))
            }
            TruncatingLabel(text: title, style: WebTextStyle(size: 13, leading: 16, weight: 600, letterSpacing: 0))
                .foregroundStyle(color("color-ink", .primary))
                .frame(maxWidth: .infinity, alignment: .leading)
            pinButton
        }
        .padding(.trailing, 8)
        .frame(height: state.barHeight)
        .frame(maxWidth: .infinity)
        .background(color("color-canvas", .white))
        .overlay(alignment: .bottom) {
            Rectangle().fill(color("color-heading", .black).opacity(0.08)).frame(height: 1)
        }
        .contentShape(Rectangle())
        .windowDrag()
    }

    /// The pin: filled while the window stays on top of other apps.
    private var pinButton: some View {
        let on = state.onTop
        let hint = on ? "Stop keeping on top" : "Keep on top"
        return Button(action: toggleOnTop) {
            ZStack {
                if on { WebIconShape(icon: .pin).fill().frame(width: 12, height: 12) }
                WebIconView(.pin, size: 12)
            }
            .frame(width: 24, height: 22)
            .foregroundStyle(on ? color("color-ink", .primary) : color("color-ink-faint", .secondary))
            .contentShape(Rectangle())
        }
        .buttonStyle(WebHoverRowStyle(radius: 6, hover: WebStyles.vars["glass-hover"], press: WebStyles.vars["mac-press"], selected: false))
        .accessibilityLabel(hint)
        .accessibilityAddTraits(on ? .isSelected : [])
        .foleviTooltip(hint)
    }
}
