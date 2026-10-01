import SwiftUI

/// How a select's button looks: the web passes `.ui-input` (most forms), `.ui-well` (the palette's
/// filters), or a raised pill.
enum FoleviSelectLook { case input, well, raised }

/// A choice from a short list (the web's custom Select): a button showing the current choice and a chevron,
/// and a list of rows with a check on the chosen one (13.5pt; the chosen one semibold). Arrow keys move,
/// Return chooses. Never the OS pop-up button.
struct FoleviSelect<Value: Hashable>: View {
    struct Option: Identifiable {
        var value: Value
        var title: String
        var id: Value { value }
    }

    @Binding var selection: Value
    var options: [Option]
    var accessibilityLabel: String
    var width: CGFloat? = nil
    var height: CGFloat = 30
    var look: FoleviSelectLook = .input
    var fontSize: CGFloat = 13
    @State private var open = false
    @State private var hover = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 6) {
                Text(options.first { $0.value == selection }?.title ?? "")
                    .font(.ui(fontSize))
                    .foregroundStyle(look == .well ? (hover ? FoleviColor.ink : FoleviColor.inkMuted) : FoleviColor.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                // The web's 14pt ChevronDown, 6pt after the label.
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(FoleviColor.ink)
                    .frame(width: 14, height: 14)
                    .opacity(0.6)
                    .rotationEffect(.degrees(open ? 180 : 0))
                    .animation(.easeOut(duration: 0.15), value: open)
            }
            .padding(.horizontal, look == .well ? 10 : 12)
            .frame(width: width, height: height)
            .fixedSize(horizontal: width == nil, vertical: false)
            .background { background }
            .contentShape(Rectangle())
            .opacity(isEnabled ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityLabel(Text(accessibilityLabel))
        .accessibilityValue(Text(options.first { $0.value == selection }?.title ?? ""))
        .foleviPopover(isPresented: $open, arrowEdge: .bottom) {
            SelectList(options: options.map { ($0.title, $0.value == selection) }, minWidth: max(180, width ?? 0)) { index in
                open = false
                let value = options[index].value
                if value != selection { selection = value }
            }
        }
    }

    @ViewBuilder private var background: some View {
        switch look {
        case .input: Color.clear.foleviInputSurface(focused: open)
        case .well: Color.clear.foleviGlassWell()
        case .raised: Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .capsule, shadow: FoleviShadow.control)
        }
    }
}

private struct SelectList: View {
    var options: [(title: String, checked: Bool)]
    var minWidth: CGFloat
    var choose: (Int) -> Void
    @State private var active: Int?
    @FocusState private var focused: Bool

    var body: some View {
        Group {
            // Long lists scroll (at most 320pt); short ones take their own height.
            if options.count > 9 {
                ScrollView { rows }.frame(height: 320)
            } else {
                rows
            }
        }
        .frame(minWidth: minWidth, maxWidth: 420)
        .fixedSize(horizontal: true, vertical: false)
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onAppear {
            focused = true
            active = options.firstIndex { $0.checked }
        }
        .onKeyPress(.downArrow) {
            active = min(options.count - 1, (active ?? -1) + 1)
            return .handled
        }
        .onKeyPress(.upArrow) {
            active = max(0, (active ?? options.count) - 1)
            return .handled
        }
        .onKeyPress(.return) {
            guard let active else { return .ignored }
            choose(active)
            return .handled
        }
    }

    private var rows: some View {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(options.enumerated()), id: \.offset) { index, o in
                    Button { choose(index) } label: {
                        HStack(spacing: 8) {
                            Text(o.title.isEmpty ? " " : o.title)
                                .font(.ui(13.5, o.checked ? .semibold : .regular))
                                .foregroundStyle(o.checked || active == index ? FoleviColor.heading : FoleviColor.ink)
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "checkmark").font(.system(size: 11.5, weight: .bold)).foregroundStyle(FoleviColor.heading)
                                .opacity(o.checked ? 1 : 0)
                                .accessibilityHidden(true)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(active == index ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .onHover { if $0 { active = index } }
                    .accessibilityAddTraits(o.checked ? .isSelected : [])
                }
            }
            .padding(6)
    }
}
