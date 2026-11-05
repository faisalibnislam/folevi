// Hover states for the lists' small controls (the UI audit's MAC-17 and MAC-46): the view switch's segments, the
// Sort select, the Tags page's chips, Home's carousel arrows and a card's "…" chip showed nothing under the
// pointer while their neighbours did. Each gets the web's hover: a translucent fill laid over its own box (so it
// shows on a raised or filled control too) and, where the web has it, the heading colour for its icon or words.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign

private struct ListHoverTint: ViewModifier {
    let radius: CGFloat
    let fill: String
    let enabled: Bool
    @State private var over = false
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content
            .overlay {
                if over && enabled {
                    RoundedRectangle(cornerRadius: radius, style: .circular)
                        .fill(WebStyles.vars[fill]?.resolve(scheme).color ?? .clear)
                        .allowsHitTesting(false)
                }
            }
            .onHover { over = $0 }
    }
}

extension View {
    /// The hover fill (`--mac-hover` unless named) over the control's own box, `radius` round.
    func listHoverTint(radius: CGFloat, fill: String = "mac-hover", enabled: Bool = true) -> some View {
        modifier(ListHoverTint(radius: radius, fill: fill, enabled: enabled))
    }
}

/// What a list shows while its first page loads (MAC-47): faint placeholder cards, rows or chips that breathe
/// slowly (still with Reduce Motion), as the notifications panel's skeleton does, in place of a blank gap.
struct ListSkeleton: View {
    enum Shape { case cards(width: CGFloat), rows, chips, carousel(width: CGFloat) }
    let shape: Shape
    @State private var dim = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let fill = WebStyles.vars["glass-hover"]?.resolve(scheme).color ?? .gray.opacity(0.1)
        Group {
            switch shape {
            case .cards(let width):
                let cols = max(1, Int((width + 24) / (260 + 24)))
                HStack(alignment: .top, spacing: 24) {
                    ForEach(0..<cols, id: \.self) { _ in RoundedRectangle(cornerRadius: 16, style: .circular).fill(fill).aspectRatio(0.92, contentMode: .fit) }
                }
            case .carousel(let width):
                let cols = max(1, Int((width + 16) / (220 + 16)))
                HStack(spacing: 16) {
                    ForEach(0..<cols, id: \.self) { _ in RoundedRectangle(cornerRadius: 16, style: .circular).fill(fill).frame(height: 200) }
                }
            case .rows:
                VStack(spacing: 8) {
                    ForEach(0..<5, id: \.self) { i in RoundedRectangle(cornerRadius: 8, style: .circular).fill(fill).frame(height: 36).padding(.trailing, CGFloat(i % 3) * 60) }
                }
            case .chips:
                HStack(spacing: 8) {
                    ForEach([120, 96, 140, 88, 112], id: \.self) { w in RoundedRectangle(cornerRadius: 8, style: .circular).fill(fill).frame(width: CGFloat(w), height: 36) }
                }
            }
        }
        .opacity(dim ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
        }
        .accessibilityElement()
        .accessibilityLabel("Loading")
    }
}

/// A focused field's edge for the lists' own search fields (MAC-46): the input's focus ring (as `.ui-input:focus`)
/// while it has the cursor.
@MainActor
func listFieldStyle(_ pair: WebStylePair, focused: Bool) -> WebStylePair { focused ? webFocused(pair) : pair }
#endif
