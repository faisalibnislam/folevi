// Foli AI drawn as the web draws it (apps/web/src/components/ai/**): the pieces the AI page, the floating chat
// and the thread share, on the Mac and on the iPhone (FoleviPhone's sheet and page set `aiPhone`, where the
// web's iPhone layout differs: useIphoneApp() in ChatMessage.tsx and ChatThread.tsx). Sizes, colours and type come from the live web app's computed styles
// (packages/design-tokens/match/app-styles/ai.json, "ai.*"); a few values the styles can't carry (a corner that
// is smaller than the others, the size of a list's bullet) are the web's Tailwind classes, named where used.
import SwiftUI
#if canImport(AppKit)
import AppKit
#endif
#if canImport(UIKit)
import UIKit
#endif
import FoleviDesign
import FoleviEngine

/// The web's styles for Foli AI, resolved for the colour scheme.
@MainActor
public struct AiLook {
    public let scheme: ColorScheme
    /// The iPhone's layout: a style measured there (`phone.<id>`, phone.json) wins over the shared one.
    public let phone: Bool

    public init(scheme: ColorScheme, phone: Bool = false) {
        self.scheme = scheme
        self.phone = phone
    }

    public func pair(_ id: String) -> WebStylePair {
        if phone, let p = WebStyles.all["phone." + id] { return p }
        return WebStyles.named(id)
    }

    public func s(_ id: String) -> WebComputedStyle { pair(id).resolve(scheme) }
    public func text(_ id: String) -> WebTextStyle { s(id).text }
    public func color(_ v: String) -> Color { (WebStyles.vars[v]?.resolve(scheme) ?? RGBA(0, 0, 0, 0)).color }

    public var heading: Color { color("color-heading") }
    public var ink: Color { color("color-ink") }
    public var muted: Color { color("color-ink-muted") }
    public var faint: Color { color("color-ink-faint") }
    public var canvas: Color { color("color-canvas") }
    public var glassHover: Color { color("glass-hover") }
    public var glassActive: Color { color("glass-active") }
    public var glassBorder: Color { color("glass-border") }
    /// `border-line/70`
    public var line70: Color { color("color-line").opacity(0.7) }
    public var danger: Color { color("color-danger") }
    public var dangerSoft: Color { color("color-danger-soft") }

    /// Tailwind's `rounded-tiny` (the small corner of a chat bubble).
    public static let tiny: CGFloat = 4
}

public extension View {
    /// A web element's box with one corner of its own (the bubbles' `rounded-br-tiny` / `rounded-bl-tiny`):
    /// the style's fill and its 1 px rings (the glass edge), drawn on an uneven rounded rectangle.
    func aiBubble(_ pair: WebStylePair, scheme: ColorScheme, small corner: UnitPoint) -> some View {
        let s = pair.resolve(scheme)
        let r = s.radius, t = AiLook.tiny
        let shape = UnevenRoundedRectangle(
            topLeadingRadius: r,
            bottomLeadingRadius: corner == .bottomLeading ? t : r,
            bottomTrailingRadius: corner == .bottomTrailing ? t : r,
            topTrailingRadius: r,
            style: .circular
        )
        return self.background {
            ZStack {
                ForEach(Array(s.shadows.enumerated().filter { !$0.element.inset && $0.element.color.a > 0 }), id: \.offset) { item in
                    // A spread-only ring outside the box (`0 0 0 1px`): the box grown by the spread, its border.
                    shape.inset(by: -item.element.spread).strokeBorder(item.element.color.color, lineWidth: item.element.spread)
                }
                shape.fill(s.background.color)
                ForEach(Array(s.shadows.enumerated().filter { $0.element.inset && $0.element.color.a > 0 }), id: \.offset) { item in
                    shape.strokeBorder(item.element.color.color, lineWidth: max(0.5, item.element.spread))
                }
            }
            .allowsHitTesting(false)
        }
    }
}

/// A plain button whose background shows on hover and press (`hover:bg-[var(--glass-hover)]`), with the text
/// going to the heading colour on hover (`hover:text-heading`).
public struct AiHoverStyle: ButtonStyle {
    var radius: CGFloat
    var hover: String = "glass-hover"
    var base: Color? = nil
    var hoverText: Bool = true

    public init(radius: CGFloat, hover: String = "glass-hover", base: Color? = nil, hoverText: Bool = true) {
        self.radius = radius
        self.hover = hover
        self.base = base
        self.hoverText = hoverText
    }

    public func makeBody(configuration: Configuration) -> some View {
        HoverBody(configuration: configuration, radius: radius, hover: hover, base: base, hoverText: hoverText)
    }

    struct HoverBody: View {
        let configuration: Configuration
        let radius: CGFloat
        let hover: String
        let base: Color?
        let hoverText: Bool
        @State private var over = false
        @Environment(\.colorScheme) private var scheme
        @Environment(\.aiPhone) private var phone
        @Environment(\.isEnabled) private var enabled

        var body: some View {
            let look = AiLook(scheme: scheme, phone: phone)
            configuration.label
                .foregroundStyle(over && hoverText && enabled ? AnyShapeStyle(look.heading) : AnyShapeStyle(.foreground))
                .background {
                    RoundedRectangle(cornerRadius: radius, style: .circular)
                        .fill((over || configuration.isPressed) && enabled ? look.color(hover) : (base ?? .clear))
                }
                .contentShape(RoundedRectangle(cornerRadius: radius, style: .circular))
                .onHover { over = $0 }
        }
    }
}

/// "Just now", "5 mins ago", "1 hour ago", "Sep 10" (apps/web/src/lib/format.ts ageText).
public enum AiAge {
    public static func text(_ ms: Double, now: Date = Date()) -> String {
        let ts = Date(timeIntervalSince1970: ms / 1000)
        let exact = abs(now.timeIntervalSince(ts)) / 60
        let ahead = ts > now
        func unit(_ n: Int, _ u: String) -> String {
            let words = "\(n) \(u)\(n == 1 ? "" : "s")"
            return ahead ? "in \(words)" : "\(words) ago"
        }
        let mins = ahead ? max(1, Int(exact.rounded())) : Int(exact.rounded())
        let out: String
        if mins < 1 { out = "just now" } else if mins < 60 { out = unit(mins, "min") } else {
            let hours = Int((Double(mins) / 60).rounded())
            if hours < 24 { out = unit(hours, "hour") } else {
                let days = Int((Double(hours) / 24).rounded())
                if days < 7 { out = unit(days, "day") } else {
                    let f = DateFormatter()
                    let sameYear = Calendar.current.component(.year, from: ts) == Calendar.current.component(.year, from: now)
                    f.setLocalizedDateFormatFromTemplate(sameYear ? "MMM d" : "MMM d y")
                    out = f.string(from: ts)
                }
            }
        }
        return out.prefix(1).uppercased() + out.dropFirst()
    }
}

/// Copies plain text to the pasteboard.
@MainActor
public enum AiPasteboard {
    public static func copy(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }
}

/// Opens a web page outside the app (a link or a web source in an answer): the browser on the Mac; on the
/// iPhone whatever the frame sets (an in-app Safari sheet), else the system.
@MainActor
public enum AiExternal {
    public static var opener: ((URL) -> Void)?

    public static func open(_ url: URL) {
        if let opener { return opener(url) }
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }
}

public extension EnvironmentValues {
    /// Foli AI drawn in the iPhone's layout (the web's useIphoneApp()): bigger type, no bubbles on answers.
    @Entry var aiPhone = false
}

/// The web's `RunStatus`: three softly pulsing dots, what Foli AI is doing, and Stop.
public struct AiRunStatus: View {
    let label: String
    var onStop: (() -> Void)?

    public init(label: String, onStop: (() -> Void)? = nil) {
        self.label = label
        self.onStop = onStop
    }
    @Environment(\.aiPhone) private var phone
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    public var body: some View {
        let look = AiLook(scheme: scheme, phone: phone)
        HStack(spacing: 10) {
            HStack(spacing: 3) {
                ForEach(0..<3, id: \.self) { i in
                    Circle().fill(look.muted).frame(width: 5, height: 5)
                        .opacity(reduceMotion ? 1 : (pulse ? 0.5 : 1))
                        .animation(reduceMotion ? nil : .easeInOut(duration: 1).repeatForever().delay(Double(i) * 0.16), value: pulse)
                }
            }
            Text(label).webText(.role(.subheadline)).lineLimit(1).foregroundStyle(look.muted)
                .accessibilityAddTraits(.updatesFrequently)
            if let onStop {
                Button(action: onStop) {
                    HStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 2).frame(width: 9, height: 9)
                        Text("Stop").webText(.role(phone ? .subheadline : .footnote, weight: 500)).lineLimit(1)
                    }
                    .padding(.horizontal, phone ? 12 : 10)
                    .frame(height: phone ? 32 : 28)
                    .foregroundStyle(look.heading)
                    .background(RoundedRectangle(cornerRadius: 12).fill(look.ink.opacity(0.07)))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.leading, 4)
                .keyboardShortcut(".", modifiers: .command)
            }
        }
        .frame(minHeight: phone ? 44 : 32)
        .onAppear { pulse = true }
    }
}

/// A small row action under an answer (`.ai-row-btn`: Copy, Regenerate, Try again, Edit).
public struct AiRowButton: View {
    let icon: WebIcon
    let title: String
    let action: () -> Void

    public init(icon: WebIcon, title: String, action: @escaping () -> Void) {
        self.icon = icon
        self.title = title
        self.action = action
    }
    @Environment(\.colorScheme) private var scheme
    @Environment(\.aiPhone) private var phone

    public var body: some View {
        let look = AiLook(scheme: scheme, phone: phone)
        let s = look.s("ai.rowbtn")
        Button(action: action) {
            HStack(spacing: s.gap) {
                WebIconView(icon, size: phone ? 16 : 12)
                Text(title).webText(s.text).lineLimit(1)
            }
            .padding(.horizontal, s.padding.left)
            .frame(height: s.height)
            .foregroundStyle(s.color.color)
        }
        .buttonStyle(AiHoverStyle(radius: s.radius))
    }
}
/// A paragraph wrapped as WebKit's `text-wrap: pretty` wraps every `p` in the app (globals.css): the same number
/// of lines as greedy wrapping, with the breaks that make the lines' leftover room most even (the least sum of
/// squared slack, the last line's counting for less: it may stay shorter, as WebKit sets it). Lines are measured
/// in the web font with its letter spacing.
public struct AiPrettyText: View {
    let text: String
    let style: WebTextStyle

    public init(text: String, style: WebTextStyle) {
        self.text = text
        self.style = style
    }
    @State private var width: CGFloat = 0

    public var body: some View {
        Text(width > 0 ? AiPretty.lines(text, style: style, width: width).joined(separator: "\n") : text)
            .webText(style)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

public enum AiPretty {
    /// How much the last line's room counts (fitted to WebKit's breaks on the Foli AI page and chat).
    static let lastLineWeight: CGFloat = 0.4

    static func measure(_ s: String, _ style: WebTextStyle) -> CGFloat {
        let attr = NSAttributedString(string: s, attributes: [.font: style.ctFont as Any, .kern: style.letterSpacing])
        let line = CTLineCreateWithAttributedString(attr)
        return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    }

    public static func lines(_ text: String, style: WebTextStyle, width: CGFloat) -> [String] {
        let words = text.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
        guard words.count > 2, !text.contains("\n") else { return [text] }
        let w = words.map { measure($0, style) }
        let space = measure(" ", style)
        func lineWidth(_ i: Int, _ j: Int) -> CGFloat { w[i...j].reduce(0, +) + CGFloat(j - i) * space }
        // Greedy: how many lines the browser would need anyway.
        var count = 1
        var x: CGFloat = 0
        for (k, ww) in w.enumerated() {
            let next = k == 0 || x == 0 ? ww : x + space + ww
            if next > width + 0.01, x > 0 { count += 1; x = ww } else { x = next }
        }
        guard count > 1 else { return [text] }
        let n = words.count
        // best[k][i]: least cost to set words i..<n in k lines.
        let inf = CGFloat.greatestFiniteMagnitude
        var best = Array(repeating: Array(repeating: inf, count: n + 1), count: count + 1)
        var next = Array(repeating: Array(repeating: -1, count: n + 1), count: count + 1)
        best[0][n] = 0
        for k in 1...count {
            for i in stride(from: n - 1, through: 0, by: -1) {
                for j in i..<n {
                    let lw = lineWidth(i, j)
                    if lw > width + 0.01 { break }
                    let rest = best[k - 1][j + 1]
                    guard rest < inf else { continue }
                    let slack = width - lw
                    // (k == 1: this is the last line.)
                    let cost = slack * slack * (k == 1 ? lastLineWeight : 1) + rest
                    if cost < best[k][i] { best[k][i] = cost; next[k][i] = j + 1 }
                }
            }
        }
        guard best[count][0] < inf else { return [text] }
        var out: [String] = []
        var i = 0, k = count
        while i < n, k > 0 {
            let j = next[k][i]
            out.append(words[i..<j].joined(separator: " "))
            i = j
            k -= 1
        }
        return out
    }
}
