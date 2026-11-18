// The floating note window's bar (the Mac's Float Note, apps/mac Chrome/FloatingNotes.swift), as Apple Notes'
// floating note: room for the window buttons, the note's emoji and title, and the pin that keeps the window on
// top of other apps. Dragging the bar moves the window. The note page under it brings its own bottom bar. The
// title and the pin are the system's type, symbol and colours (2026-11-18); the bar keeps the note's canvas so it
// reads as the note's own title bar.
import SwiftUI
import Observation
#if os(macOS)
import AppKit
#endif
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

    /// What a title bar's double-click does, from System Settings > Desktop & Dock ("Double-click a window's title
    /// bar to"): AppleActionOnDoubleClick says Maximize (zoom, the default), Minimize, or None.
    enum DoubleClick: Equatable { case zoom, minimize, none }

    static func doubleClickAction(_ setting: String?) -> DoubleClick {
        switch setting {
        case "Minimize": .minimize
        case "None": .none
        default: .zoom
        }
    }

    static func titleBarDoubleClick() {
        #if os(macOS)
        guard let window = NSApp.keyWindow else { return }
        switch doubleClickAction(UserDefaults.standard.persistentDomain(forName: UserDefaults.globalDomain)?["AppleActionOnDoubleClick"] as? String) {
        case .zoom: window.performZoom(nil)
        case .minimize: window.performMiniaturize(nil)
        case .none: break
        }
        #endif
    }
}

public struct FloatingNoteBar: View {
    let model: FrameModel
    let state: FloatingNoteState
    let toggleOnTop: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var pinHover = false

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
            titleLabel
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
        // A double-click does what it does on any title bar (MAC-50): zoom or minimise, as the Mac is set.
        .simultaneousGesture(TapGesture(count: 2).onEnded { FloatingNoteState.titleBarDoubleClick() })
    }

    /// The note's title as a window title: the system font's 13 pt semibold in the label colour on the Mac.
    @ViewBuilder private var titleLabel: some View {
        #if os(macOS)
        Text(verbatim: title).font(MacLook.Text.headline).foregroundStyle(MacLook.Colors.label).lineLimit(1).truncationMode(.tail)
        #else
        TruncatingLabel(text: title, style: WebTextStyle(size: 13, leading: 16, weight: 600, letterSpacing: 0))
            .foregroundStyle(color("color-ink", .primary))
        #endif
    }

    /// The pin: filled while the window stays on top of other apps.
    private var pinButton: some View {
        #if os(macOS)
        let on = state.onTop
        let hint = on ? "Stop keeping on top" : "Keep on top"
        // The system's: the pin symbol (filled while on top), the quaternary hover fill, a tooltip.
        return Button(action: toggleOnTop) {
            MacSymbol("pin", size: 12, weight: .medium)
                .frame(width: 24, height: 22)
                .foregroundStyle(on ? MacLook.Colors.label : MacLook.Colors.secondary)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(pinHover ? MacLook.Colors.hover : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { pinHover = $0 }
        .accessibilityLabel(hint)
        .accessibilityAddTraits(on ? .isSelected : [])
        .foleviTooltip(hint)
        #else
        drawnPin
        #endif
    }

    private var drawnPin: some View {
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
