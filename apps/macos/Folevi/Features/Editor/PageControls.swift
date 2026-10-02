import SwiftUI

// The web's small controls as the document page uses them (globals.css): .ui-btn (6pt corners), the square
// quiet icon button, .ui-input, .ui-seg in a .ui-well, and .ui-caps labels.

/// `.ui-btn` with its variants and the `sm` / `md` sizes (Button.tsx).
struct PageButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, quiet, danger }
    enum Size { case sm, md }
    var kind: Kind = .secondary
    var size: Size = .sm
    var fullWidth = false

    func makeBody(configuration: Configuration) -> some View {
        PageButtonBody(configuration: configuration, kind: kind, size: size, fullWidth: fullWidth)
    }
}

extension ButtonStyle where Self == PageButtonStyle {
    static func page(_ kind: PageButtonStyle.Kind = .secondary, _ size: PageButtonStyle.Size = .sm, fullWidth: Bool = false) -> PageButtonStyle {
        PageButtonStyle(kind: kind, size: size, fullWidth: fullWidth)
    }
}

private struct PageButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let kind: PageButtonStyle.Kind
    let size: PageButtonStyle.Size
    let fullWidth: Bool
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        configuration.label
            .font(.ui(size == .sm ? 13 : 14, .semibold))
            .tracking(-0.005 * (size == .sm ? 13 : 14))
            .lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, size == .sm ? 14 : 16)
            .frame(height: size == .sm ? 32 : 36)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background { background(shape) }
            .contentShape(shape)
            .opacity(isEnabled ? 1 : 0.5)
            .onHover { hovering = $0 && isEnabled }
    }

    private var foreground: Color {
        switch kind {
        case .primary: return FoleviColor.accentInk
        case .secondary: return hovering ? FoleviColor.heading : FoleviColor.ink
        case .quiet: return hovering ? FoleviColor.heading : FoleviColor.inkMuted
        case .danger: return .white
        }
    }

    @ViewBuilder private func background(_ shape: RoundedRectangle) -> some View {
        switch kind {
        case .primary:
            shape.fill(FoleviColor.accent).brightness(hovering ? 0.03 : 0).shadow(color: .black.opacity(0.12), radius: 1, y: 1)
        case .secondary:
            shape.fill(configuration.isPressed ? FoleviColor.surfaceSunken : hovering ? FoleviColor.surfaceRaised : FoleviColor.surfaceRaised.opacity(0.72))
                .overlay(shape.strokeBorder(FoleviGlass.border))
                .shadow(color: .black.opacity(0.06), radius: 1, y: 1)
        case .quiet:
            shape.fill(hovering || configuration.isPressed ? FoleviGlass.hover : .clear)
        case .danger:
            shape.fill(FoleviColor.destructive)
        }
    }
}

/// A square quiet icon button (IconButton.tsx: 6pt corners, the label as tooltip and for VoiceOver).
struct PageIconButton: View {
    var systemImage: String
    var label: String
    var shortcut: String? = nil
    var size: CGFloat = 32
    var width: CGFloat? = nil
    var iconSize: CGFloat = 14
    var isOn = false
    var action: () -> Void
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: iconSize, weight: .medium))
                .foregroundStyle(isOn ? FoleviColor.canvas : hovering ? FoleviColor.heading : FoleviColor.inkMuted)
                .frame(width: width ?? size, height: size)
                .background(isOn ? FoleviColor.heading : hovering ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.4)
        .onHover { hovering = $0 && isEnabled }
        .help(Text(shortcut.map { "\(label) (\($0))" } ?? label))
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// `.ui-input`: the surface, 6pt corners, a soft inset and a line ring; a soft heading ring when focused.
struct PageInputBackground: ViewModifier {
    var focused: Bool
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        content
            .background(FoleviColor.surface, in: shape)
            .overlay(shape.strokeBorder(focused ? FoleviColor.heading.opacity(0.165) : FoleviColor.line, lineWidth: focused ? 1.5 : 1))
            .shadow(color: .black.opacity(focused ? 0.08 : 0), radius: 1.5, y: 1)
    }
}

extension View {
    func pageInput(focused: Bool) -> some View { modifier(PageInputBackground(focused: focused)) }

    /// `.ui-caps`: 11pt semibold, tracked, uppercase, faint.
    func pageCaps() -> some View {
        // `.ui-caps` at the body's 1.55 line height.
        self.font(.ui(11, .semibold)).tracking(0.06 * 11).textCase(.uppercase).foregroundStyle(FoleviColor.inkFaint)
            .uiLineHeight(11 * 1.55, size: 11, weight: .semibold)
    }
}

/// `.ui-seg.ui-well`: a translucent track; the chosen item is a glass-active pill (4pt corners).
struct PageSegmented<Value: Hashable>: View {
    struct Item {
        var value: Value
        var title: String
        var systemImage: String? = nil
        var font: Font? = nil
        var accessibilityLabel: String? = nil
    }

    @Binding var selection: Value
    var items: [Item]
    var label: String
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        HStack(spacing: 2) {
            ForEach(items, id: \.value) { item in
                let on = item.value == selection
                Button {
                    selection = item.value
                } label: {
                    HStack(spacing: 5.6) {
                        if let icon = item.systemImage { Image(systemName: icon).font(.system(size: 13, weight: .medium)) }
                        Text(item.title).font(item.font ?? .ui550(12.5)).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .foregroundStyle(on ? FoleviColor.heading : FoleviColor.inkMuted)
                    .padding(.horizontal, 9.6)
                    .frame(maxWidth: .infinity, minHeight: 28)
                    .background {
                        if on {
                            RoundedRectangle(cornerRadius: 4, style: .continuous).fill(FoleviGlass.active)
                                .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(.white.opacity(0.6)))
                                .shadow(color: .black.opacity(0.08), radius: 1.5, y: 1)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(item.accessibilityLabel ?? item.title))
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(FoleviGlass.hover, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviGlass.border))
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(label))
    }
}
