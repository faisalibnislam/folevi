// Small Folevi controls the web draws itself and the Mac had borrowed from the system (the UI audit's MAC-24,
// MAC-25 and MAC-57): the spinner (lucide's loader-circle turning, `animate-spin`), the checkbox (an 18 pt box
// with the tiny radius that fills with the heading colour and shows a tick) and the slider (a line with a filled
// part and a small rounded-square thumb). Colours are the web's variables, so they follow light and dark.
import SwiftUI

@MainActor
private func webColor(_ name: String, _ scheme: ColorScheme, _ fallback: Color = .gray) -> Color {
    WebStyles.vars[name]?.resolve(scheme).color ?? fallback
}

/// `<Loader2 className="animate-spin">`: the loader arc turning once a second, in the muted ink (or the colour
/// around it with `tinted`). Still under Reduce Motion, as `motion-reduce:animate-none`.
public struct WebSpinner: View {
    let size: CGFloat
    let tinted: Bool
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(size: CGFloat = 14, tinted: Bool = false) {
        self.size = size
        self.tinted = tinted
    }

    public var body: some View {
        let arc = WebIconView(.loaderCircle, size: size)
        Group {
            if reduceMotion {
                arc
            } else {
                TimelineView(.animation) { t in
                    let turn = t.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1)
                    arc.rotationEffect(.degrees(turn * 360))
                }
            }
        }
        .foregroundStyle(tinted ? AnyShapeStyle(.foreground) : AnyShapeStyle(webColor("color-ink-muted", scheme)))
        .frame(width: size, height: size)
        .accessibilityLabel("Loading")
    }
}

/// A checkbox as the web draws its own (an 18 pt box, the tiny 4 pt radius, a 1.5 pt muted edge; ticked, the
/// heading colour with a tick), with the label beside it. The whole row toggles it; the box darkens its edge
/// under the pointer.
public struct WebCheckboxStyle: ToggleStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        CheckboxRow(configuration: configuration)
    }

    struct CheckboxRow: View {
        let configuration: Configuration
        @State private var over = false
        @Environment(\.colorScheme) private var scheme
        @Environment(\.isEnabled) private var enabled

        var body: some View {
            let on = configuration.isOn
            Button { configuration.isOn.toggle() } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    WebCheckboxBox(on: on, over: over && enabled)
                        .alignmentGuide(.firstTextBaseline) { d in d[.bottom] - 4 }
                    configuration.label
                        .foregroundStyle(webColor("color-ink", scheme))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(WebCheckboxPress())
            .onHover { over = $0 }
            .opacity(enabled ? 1 : 0.5)
            .accessibilityAddTraits(on ? [.isSelected, .isToggle] : .isToggle)
            .accessibilityValue(on ? "Checked" : "Unchecked")
        }
    }
}

/// The checkbox's box alone (for rows that draw their own label).
public struct WebCheckboxBox: View {
    let on: Bool
    let over: Bool
    @Environment(\.colorScheme) private var scheme

    public init(on: Bool, over: Bool = false) {
        self.on = on
        self.over = over
    }

    public var body: some View {
        let heading = webColor("color-heading", scheme)
        let edge = over ? heading : webColor("color-ink-muted", scheme)
        RoundedRectangle(cornerRadius: 4, style: .circular)
            .fill(on ? heading : webColor("color-surface", scheme))
            .overlay(RoundedRectangle(cornerRadius: 4, style: .circular).strokeBorder(on ? .clear : edge, lineWidth: 1.5))
            .overlay { if on { WebIconView(.check, size: 13, strokeWidth: 3).foregroundStyle(webColor("color-surface", scheme, .white)) } }
            .frame(width: 18, height: 18)
            .animation(.easeOut(duration: 0.12), value: on)
    }
}

private struct WebCheckboxPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label.opacity(configuration.isPressed ? 0.85 : 1) }
}

/// The web's range input as Folevi draws it: a 4 pt line in the line colour, filled with the accent up to the
/// value, and a 16 pt rounded-square thumb on the surface with a hairline and a soft shadow. Drag or click on the
/// line to move it (in `step`s); the arrow keys step it while it has the focus. `onChange` follows every step;
/// `onCommit` runs when a drag ends or a key steps it, for saving.
public struct WebSlider: View {
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    let label: String
    let onCommit: (Double) -> Void
    @State private var over = false
    @State private var dragging = false
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled

    static let thumb: CGFloat = 16
    static let track: CGFloat = 4

    public init(value: Binding<Double>, in range: ClosedRange<Double>, step: Double, label: String, onCommit: @escaping (Double) -> Void = { _ in }) {
        self._value = value
        self.range = range
        self.step = step
        self.label = label
        self.onCommit = onCommit
    }

    /// The value at `x` along a line `width` wide (the thumb's centre runs from half a thumb in to half a thumb
    /// short of the end), snapped to `step` and kept in `range`.
    public static func value(at x: CGFloat, width: CGFloat, range: ClosedRange<Double>, step: Double) -> Double {
        let usable = max(1, width - thumb)
        let f = min(1, max(0, (x - thumb / 2) / usable))
        return snap(range.lowerBound + Double(f) * (range.upperBound - range.lowerBound), range: range, step: step)
    }

    /// `v` on the step grid from the range's start, inside the range (and free of float dust: 1.1, not 1.1000000001).
    public static func snap(_ v: Double, range: ClosedRange<Double>, step: Double) -> Double {
        guard step > 0 else { return min(range.upperBound, max(range.lowerBound, v)) }
        let n = ((v - range.lowerBound) / step).rounded()
        let snapped = range.lowerBound + n * step
        return (min(range.upperBound, max(range.lowerBound, snapped)) * 1e6).rounded() / 1e6
    }

    public var body: some View {
        GeometryReader { g in
            let w = g.size.width
            let f = CGFloat((value - range.lowerBound) / max(0.0001, range.upperBound - range.lowerBound))
            let x = Self.thumb / 2 + f * max(0, w - Self.thumb)
            let accent = webColor("color-accent", scheme)
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2, style: .circular).fill(webColor("color-line", scheme))
                    .frame(height: Self.track)
                RoundedRectangle(cornerRadius: 2, style: .circular).fill(accent)
                    .frame(width: max(Self.track, x), height: Self.track)
                RoundedRectangle(cornerRadius: 5, style: .circular)
                    .fill(webColor("color-surface-raised", scheme, .white))
                    .overlay(RoundedRectangle(cornerRadius: 5, style: .circular).strokeBorder(over || dragging ? accent : webColor("color-line", scheme), lineWidth: over || dragging ? 1.5 : 1))
                    .shadow(color: .black.opacity(0.16), radius: 2, y: 1)
                    .overlay {
                        if focused {
                            RoundedRectangle(cornerRadius: 7, style: .circular).strokeBorder(webColor("color-focus", scheme), lineWidth: 2).padding(-3)
                        }
                    }
                    .frame(width: Self.thumb, height: Self.thumb)
                    .offset(x: x - Self.thumb / 2)
            }
            .frame(width: w, height: g.size.height)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { d in
                dragging = true
                let v = Self.value(at: d.location.x, width: w, range: range, step: step)
                if v != value { value = v }
            }.onEnded { _ in
                dragging = false
                onCommit(value)
            })
        }
        .frame(height: 20)
        .onHover { over = $0 }
        .focusable(enabled)
        .focused($focused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .downArrow, .upArrow]) { press in
            let up = press.key == .rightArrow || press.key == .upArrow
            let next = Self.snap(value + (up ? step : -step), range: range, step: step)
            guard next != value else { return .handled }
            value = next
            onCommit(next)
            return .handled
        }
        .opacity(enabled ? 1 : 0.5)
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue("\(Int((value * 100).rounded())) percent")
        .accessibilityAdjustableAction { dir in
            let next = Self.snap(value + (dir == .increment ? step : -step), range: range, step: step)
            value = next
            onCommit(next)
        }
    }
}
