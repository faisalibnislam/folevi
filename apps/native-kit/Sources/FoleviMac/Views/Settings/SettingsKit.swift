// The building blocks of Settings on the Mac, drawn from the web's computed styles ("settings.*", app-styles/
// settings.json, read from /settings/<section> in the web frame): the section card (views/settings/Card.tsx), the
// switch (ui/Switch.tsx), the select (ui/Select.tsx, a Folevi menu), text fields (.ui-input), term and value rows,
// rows with a hint and a switch, and dialogs (ui/Dialog.tsx) in a panel over the window.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine

/// A settings style by its id without the "settings." prefix.
enum SettingsStyle {
    static func pair(_ id: String) -> WebStylePair { WebStyles.named("settings.\(id)") }
}

/// The web's row width (a list of switches, the notifications table), or the card's whole width in the Settings
/// window, so rows end at the card's edge there instead of short of it.
struct SettingsRowWidth: ViewModifier {
    let width: CGFloat
    var alignment: Alignment = .leading
    @Environment(\.settingsWindowed) private var windowed

    func body(content: Content) -> some View {
        content.frame(maxWidth: windowed ? .infinity : width, alignment: alignment)
    }
}

extension View {
    func settingsRowWidth(_ width: CGFloat, alignment: Alignment = .leading) -> some View { modifier(SettingsRowWidth(width: width, alignment: alignment)) }
}

/// The colour variables Settings uses (`--color-danger`, `--color-line`).
enum SettingsColor {
    static func v(_ name: String, _ scheme: ColorScheme) -> Color { (WebStyles.vars[name]?.resolve(scheme) ?? RGBA(0, 0, 0, 1)).color }
}

/// Where the web breaks paragraphs (`p { text-wrap: pretty }`): asked of the page (settings.run text.lines), kept
/// by text, width and type, so a paragraph wraps at the same words as on the web.
@MainActor
@Observable
final class SettingsLineBreaks {
    private var known: [String: [Int]] = [:]
    @ObservationIgnored private var asked: Set<String> = []
    @ObservationIgnored private var queue: [(String, [String: JSONValue])] = []
    @ObservationIgnored private weak var client: EngineClient?

    init(client: EngineClient) { self.client = client }

    static func key(_ text: String, _ width: CGFloat, _ s: WebTextStyle) -> String { "\(Int((width * 2).rounded()))|\(s.size)|\(s.weight)|\(s.family == .display)|\(text)" }

    /// The last word of each line but the last, when known (nil until the page answers).
    func breaks(_ text: String, width: CGFloat, style: WebTextStyle) -> [Int]? {
        let k = Self.key(text, width, style)
        if let b = known[k] { return b }
        if !asked.contains(k) {
            asked.insert(k)
            queue.append((k, ["text": .string(text), "width": .number(Double(width)), "size": .number(Double(style.size)), "leading": .number(Double(style.leading)), "weight": .number(Double(style.weight)), "tracking": .number(Double(style.letterSpacing)), "display": .bool(style.family == .display)]))
            if queue.count == 1 { DispatchQueue.main.async { MainActor.assumeIsolated { self.flush() } } }
        }
        return nil
    }

    private func flush() {
        let batch = queue
        queue = []
        guard let client, !batch.isEmpty else { return }
        Task {
            guard let r = try? await client.command(.settingsRun(key: .textLines, args: ["texts": .array(batch.map { .object($0.1) })])),
                  case .object(let o) = r.data, case .array(let lines)? = o["lines"] else { return }
            for (i, item) in batch.enumerated() where i < lines.count {
                if case .array(let b) = lines[i] { known[item.0] = b.compactMap { if case .number(let n) = $0 { Int(n) } else { nil } } }
            }
        }
    }

    /// The text with a line break after each word the web ends a line on.
    static func apply(_ text: String, _ breaks: [Int]) -> String {
        guard !breaks.isEmpty else { return text }
        var out = ""
        var word = -1
        var inWord = false
        let set = Set(breaks)
        var pendingBreak = false
        for ch in text {
            if ch == " " {
                if inWord { inWord = false; if set.contains(word) { pendingBreak = true; continue } }
                if pendingBreak { continue }
                out.append(ch)
            } else {
                if !inWord { inWord = true; word += 1; if pendingBreak { out.append("\n"); pendingBreak = false } }
                out.append(ch)
            }
        }
        return out
    }
}

private struct LineBreaksKey: EnvironmentKey {
    static let defaultValue: SettingsLineBreaks? = nil
}

extension EnvironmentValues {
    var settingsLineBreaks: SettingsLineBreaks? {
        get { self[LineBreaksKey.self] }
        set { self[LineBreaksKey.self] = newValue }
    }
}

/// Text in a settings style: its font, line box and colour; a paragraph wraps where the web wraps it.
struct SText: View {
    let text: String
    let style: String
    var weight: CGFloat?
    var color: Color?
    var lines: Int?
    @Environment(\.colorScheme) private var scheme
    @Environment(\.settingsLineBreaks) private var breaker
    @State private var width: CGFloat = 0

    init(_ text: String, _ style: String, weight: CGFloat? = nil, color: Color? = nil, lines: Int? = nil) {
        self.text = text
        self.style = style
        self.weight = weight
        self.color = color
        self.lines = lines
    }

    var body: some View {
        let s = SettingsStyle.pair(style).resolve(scheme)
        var t = s.text
        if let weight { t = t.weight(weight) }
        // A paragraph (long enough to wrap) takes its container's width, as a <p> does, and wraps as the web wraps it.
        let paragraph = lines != 1 && text.count > 60
        let shown: String = {
            guard paragraph, let breaker, width > 0, let b = breaker.breaks(text, width: width, style: t) else { return text }
            return SettingsLineBreaks.apply(text, b)
        }()
        return Text(shown)
            .webText(t)
            .lineLimit(lines)
            .foregroundStyle(color ?? s.color.color)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: paragraph ? .infinity : nil, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { if paragraph { width = $0 } }
    }
}

/// `<Card title description>`: a `.ui-card` with a Spectral title, an optional muted line and its content 16 pt below.
struct SettingsCard<Content: View>: View {
    let title: String
    let description: String?
    let content: Content

    init(_ title: String, description: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.description = description
        self.content = content()
    }

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let card = SettingsStyle.pair("card")
        let c = card.resolve(scheme)
        VStack(alignment: .leading, spacing: 0) {
            SText(title, "card.title", lines: 1)
            if let description {
                SText(description, "card.description").padding(.top, SettingsStyle.pair("card.description").light.margin.top)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, SettingsStyle.pair("card.body").light.margin.top)
        }
        .padding(c.padding.edgeInsets)
        .frame(maxWidth: .infinity, alignment: .leading)
        .webBox(card)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }
}

/// The muted paragraph inside a card (`text-subheadline text-muted`).
struct SMuted: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { SText(text, "muted") }
}

/// `ui/Switch.tsx`: 40 x 24, the knob 20 x 20 sliding 16 pt.
struct SettingsSwitch: View {
    let isOn: Bool
    let label: String
    var disabled = false
    let onChange: (Bool) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let track = SettingsStyle.pair(isOn ? "switch.on" : "switch.off")
        let knob = SettingsStyle.pair(isOn ? "switch.on.knob" : "switch.off.knob")
        let t = track.resolve(scheme), k = knob.resolve(scheme)
        Button { onChange(!isOn) } label: {
            ZStack(alignment: .leading) {
                Color.clear.frame(width: t.width, height: t.height).webBox(track)
                Color.clear.frame(width: k.width, height: k.height).webBox(knob)
                    .offset(x: k.x - t.x)
            }
            .frame(width: t.width, height: t.height)
            .contentShape(Rectangle())
            .animation(.easeOut(duration: 0.15), value: isOn)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(label)
        .accessibilityValue(isOn ? "On" : "Off")
        .accessibilityAddTraits(.isToggle)
    }
}

/// `ui/Select.tsx` as an input well: the chosen label and a chevron; a Folevi menu of the choices.
struct SettingsSelect: View {
    struct Option: Hashable {
        var value: String
        var label: String
    }

    let options: [Option]
    let value: String
    var width: CGFloat?
    var style = "select"
    var disabled = false
    let onChange: (String) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let pair = SettingsStyle.pair(style)
        let s = pair.resolve(scheme)
        let label = SettingsStyle.pair("select.label").resolve(scheme)
        let chevron = SettingsStyle.pair("select.chevron").resolve(scheme)
        let current = options.first { $0.value == value }?.label ?? value
        WebMenuButton(select: true, entries: {
            options.map { o in WebMenuEntry(.item(o.label, checked: o.value == value, id: o.value)) { onChange(o.value) } }
        }) {
            HStack(spacing: s.gap) {
                Text(current).webText(label.text).lineLimit(1).truncationMode(.tail)
                Spacer(minLength: 0)
                WebIconView(.chevronDown, size: 14).opacity(chevron.opacity)
            }
            .padding(s.padding.edgeInsets)
            .frame(width: width, height: s.height)
            .frame(maxWidth: width == nil ? .infinity : nil)
            .foregroundStyle(s.color.color)
            .webBox(pair)
            .contentShape(Rectangle())
        }
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
    }
}

/// `.ui-input h-9 rounded-chip px-3 text-callout`: a one-line field (secure for keys and passphrases).
struct SettingsField: View {
    let placeholder: String
    @Binding var text: String
    var secure = false
    var height: CGFloat?
    var onSubmit: () -> Void = {}
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let pair = SettingsStyle.pair("input")
        let s = pair.resolve(scheme)
        Group {
            if secure {
                SecureField(placeholder, text: $text)
            } else {
                TextField(placeholder, text: $text)
            }
        }
        .textFieldStyle(.plain)
        .webText(s.text)
        .lineLimit(1)
        .offset(x: -1.125, y: 1.035)
        .onSubmit(onSubmit)
        .padding(s.padding.edgeInsets)
        .frame(height: height ?? s.height)
        .frame(maxWidth: .infinity)
        .foregroundStyle(s.color.color)
        .webBox(pair)
    }
}

/// A row with a label, a hint and a switch (Settings > Desktop app's rows).
struct SettingsSwitchRow: View {
    let label: String
    let hint: String
    let isOn: Bool
    var disabled = false
    let onChange: (Bool) -> Void

    var body: some View {
        HStack(alignment: .center, spacing: SettingsStyle.pair("row").light.gap) {
            VStack(alignment: .leading, spacing: 0) {
                SText(label, "row.label")
                SText(hint, "row.hint")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            SettingsSwitch(isOn: isOn, label: label, disabled: disabled, onChange: onChange)
        }
    }
}

/// A list with 1 pt lines between its rows (`divide-y divide-line/70`), rows padded `py` apart.
struct SettingsDivided<Item: Identifiable, Row: View>: View {
    let items: [Item]
    let gap: CGFloat
    var line = "key.row"
    let row: (Item) -> Row
    @Environment(\.colorScheme) private var scheme

    init(_ items: [Item], gap: CGFloat, line: String = "key.row", @ViewBuilder row: @escaping (Item) -> Row) {
        self.items = items
        self.gap = gap
        self.line = line
        self.row = row
    }

    var body: some View {
        let color = SettingsStyle.pair(line).resolve(scheme).borderColor.color
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                row(item)
                    .padding(.top, i == 0 ? 0 : gap)
                    .padding(.bottom, i == items.count - 1 ? 0 : gap)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if i < items.count - 1 { Rectangle().fill(color).frame(height: 1) }
            }
        }
    }
}

/// A term and its value (`<dl>` with a 9rem term column).
struct SettingsTerms: View {
    let rows: [(String, String, Color?)]
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let dl = SettingsStyle.pair("dl").light
        let dt = SettingsStyle.pair("dt").light
        Grid(alignment: .topLeading, horizontalSpacing: dl.gap, verticalSpacing: 8) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                GridRow {
                    SText(r.0, "dt").frame(width: dt.width, alignment: .leading)
                    SText(r.1, "dd", color: r.2).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(maxWidth: dl.width, alignment: .leading)
    }
}

/// The card's buttons in a row, 8 pt apart.
struct SettingsButtons<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        HStack(spacing: SettingsStyle.pair("buttons").light.gap) { content }
    }
}

// MARK: dialogs

/// ui/Dialog.tsx on the Mac: a panel over the window (no dimming: the web's backdrop is transparent), title, an
/// optional description, the body and a footer of buttons; Escape and ⌘. close it, Return presses the default.
struct SettingsDialogView<Body: View, Footer: View>: View {
    let title: String
    let description: String?
    let width: CGFloat
    let close: () -> Void
    @ViewBuilder let content: Body
    @ViewBuilder let footer: Footer
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let panel = WebStyles.named("dialog.panel")
        let p = panel.resolve(scheme)
        let header = WebStyles.named("dialog.header").resolve(scheme)
        let t = WebStyles.named("dialog.title").resolve(scheme)
        let d = WebStyles.named("dialog.description").resolve(scheme)
        let bodyStyle = WebStyles.named("dialog.body").resolve(scheme)
        let footerStyle = WebStyles.named("dialog.footer")
        let f = footerStyle.resolve(scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).webText(t.text).foregroundStyle(t.color.color).fixedSize(horizontal: false, vertical: true)
                    if let description {
                        Text(description).webText(d.text).foregroundStyle(d.color.color).padding(.top, 4).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                WebIconButton(.x, label: "Close", action: close)
            }
            .padding(header.padding.edgeInsets)
            content
                .padding(bodyStyle.padding.edgeInsets)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: f.gap) {
                Spacer(minLength: 0)
                footer
            }
            .padding(f.padding.edgeInsets)
            .frame(maxWidth: .infinity)
            .webBox(footerStyle)
        }
        .frame(width: width)
        .clipShape(RoundedRectangle(cornerRadius: p.radius, style: .circular))
        .webBox(panel)
    }
}

#if os(macOS)
/// A borderless panel over a window holding one dialog (one at a time), centred on the window.
@MainActor
final class SettingsDialogWindow: NSPanel {
    private static weak var current: SettingsDialogWindow?
    private var monitor: Any?
    private var onClose: (() -> Void)?
    static let margin: CGFloat = 60

    /// Shows `content` (a SettingsDialogView) over `window`.
    @discardableResult
    static func show<V: View>(over window: NSWindow, onClose: (() -> Void)? = nil, @ViewBuilder content: () -> V) -> SettingsDialogWindow {
        current?.dismiss()
        let panel = SettingsDialogWindow(contentRect: .zero, styleMask: [.borderless], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isReleasedWhenClosed = false
        panel.onClose = onClose
        let host = NSHostingView(rootView: content().padding(margin).environment(\.colorScheme, window.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .dark : .light))
        host.safeAreaRegions = []
        panel.contentView = host
        let size = host.fittingSize
        let f = window.frame
        // A little above the middle, as `m-auto` in the window's height puts it.
        panel.setFrame(NSRect(x: f.midX - size.width / 2, y: f.midY - size.height / 2, width: size.width, height: size.height), display: false)
        panel.appearance = window.appearance
        window.addChildWindow(panel, ordered: .above)
        panel.makeKeyAndOrderFront(nil)
        panel.monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak panel] e in
            guard let panel, panel.isKeyWindow else { return e }
            if e.keyCode == 53 || (e.modifierFlags.contains(.command) && e.charactersIgnoringModifiers == ".") {
                panel.dismiss()
                return nil
            }
            return e
        }
        current = panel
        return panel
    }

    static func closeCurrent() { current?.dismiss() }

    override var canBecomeKey: Bool { true }

    func dismiss() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        parent?.removeChildWindow(self)
        close()
        let done = onClose
        onClose = nil
        done?()
    }
}

/// A confirmation as the Mac app asks it (ui/Dialog.tsx with `confirm`: the system's alert).
@MainActor
func settingsConfirm(_ title: String, message: String?, confirm: String, destructive: Bool = true, in window: NSWindow?, then run: @escaping () -> Void) {
    let alert = NSAlert()
    alert.messageText = title
    if let message { alert.informativeText = message }
    let yes = alert.addButton(withTitle: confirm)
    yes.hasDestructiveAction = destructive
    alert.addButton(withTitle: "Cancel")
    if let window {
        alert.beginSheetModal(for: window) { r in if r == .alertFirstButtonReturn { run() } }
    } else if alert.runModal() == .alertFirstButtonReturn {
        run()
    }
}
#else
/// One dialog over the window (one at a time), centred, in a layer that takes every touch while it shows.
@MainActor
final class SettingsDialogWindow {
    private static var current: SettingsDialogWindow?
    private let layer = UIView()
    private var host: UIHostingController<AnyView>?
    private var onClose: (() -> Void)?
    static let margin: CGFloat = 60

    /// Shows `content` (a SettingsDialogView) over `window`.
    @discardableResult
    static func show<V: View>(over window: UIWindow, onClose: (() -> Void)? = nil, @ViewBuilder content: () -> V) -> SettingsDialogWindow {
        current?.dismiss()
        let d = SettingsDialogWindow()
        d.onClose = onClose
        let h = UIHostingController(rootView: AnyView(content().padding(margin)))
        h.view.backgroundColor = .clear
        h.safeAreaRegions = []
        d.host = h
        d.layer.frame = window.bounds
        d.layer.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        d.layer.backgroundColor = UIColor.black.withAlphaComponent(0.0001)
        let size = h.sizeThatFits(in: window.bounds.size)
        h.view.frame = CGRect(x: window.bounds.midX - size.width / 2, y: window.bounds.midY - size.height / 2, width: size.width, height: size.height)
        d.layer.addSubview(h.view)
        window.addSubview(d.layer)
        current = d
        return d
    }

    static func closeCurrent() { current?.dismiss() }

    func dismiss() {
        layer.removeFromSuperview()
        host = nil
        if Self.current === self { Self.current = nil }
        let done = onClose
        onClose = nil
        done?()
    }
}

/// A confirmation as the iPad asks it: the system's alert.
@MainActor
func settingsConfirm(_ title: String, message: String?, confirm: String, destructive: Bool = true, in window: UIWindow?, then run: @escaping () -> Void) {
    guard let presenter = (window ?? NSApp.keyWindow)?.rootViewController?.topmostPresented else { return }
    let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: confirm, style: destructive ? .destructive : .default) { _ in run() })
    presenter.present(alert, animated: true)
}
#endif

// MARK: data

extension JSONValue {
    /// The value as a Codable type (the shapes `settings.query` sends, viewsSettings.ts).
    func decoded<T: Decodable>(_ type: T.Type) -> T? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    static func from(_ any: Any?) -> JSONValue {
        switch any {
        case nil: return .null
        case let v as JSONValue: return v
        case let b as Bool: return .bool(b)
        case let i as Int: return .number(Double(i))
        case let d as Double: return .number(d)
        case let s as String: return .string(s)
        case let a as [Any?]: return .array(a.map(from))
        case let o as [String: Any?]: return .object(o.mapValues(from))
        default: return .null
        }
    }
}
#endif
