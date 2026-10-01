import SwiftUI

/// A choice from a short list (the web's custom Select): a pill showing the current choice, and a popover
/// of rows with a check on the chosen one. Never the OS pop-up button.
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
    @State private var open = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 6) {
                Text(options.first { $0.value == selection }?.title ?? "")
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.ink)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(FoleviColor.inkMuted)
            }
            .padding(.horizontal, 12)
            .frame(width: width, height: height)
            .fixedSize(horizontal: width == nil, vertical: false)
            .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .capsule, shadow: FoleviShadow.control)
            .contentShape(Capsule())
            .opacity(isEnabled ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(accessibilityLabel))
        .accessibilityValue(Text(options.first { $0.value == selection }?.title ?? ""))
        .popover(isPresented: $open, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 1) {
                ForEach(options) { o in
                    SelectRow(title: o.title, checked: o.value == selection) {
                        open = false
                        if o.value != selection { selection = o.value }
                    }
                }
            }
            .padding(6)
            .frame(minWidth: max(180, width ?? 0))
        }
    }
}

private struct SelectRow: View {
    var title: String
    var checked: Bool
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(title).font(.ui(13)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                Spacer(minLength: 12)
                if checked { Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(FoleviColor.heading) }
            }
            .padding(.horizontal, 8)
            .frame(height: 28)
            .background(hover ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}
