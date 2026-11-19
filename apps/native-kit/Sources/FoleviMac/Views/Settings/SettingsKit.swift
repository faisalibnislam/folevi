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
    static func v(_ name: String, _ scheme: ColorScheme) -> Color {
        // The Mac's Settings are native (docs/MAC_NATIVE_LOOK.md): the words' and lines' colours are the system's; so
        // are the iPad's wide layout's.
        if Self.native, let system = Self.system(name) { return system }
        return (WebStyles.vars[name]?.resolve(scheme) ?? RGBA(0, 0, 0, 1)).color
    }

    /// Whether Settings draws natively here: on the Mac; on iOS while the iPad's wide layout shows.
    static var native: Bool {
        #if os(macOS)
        true
        #else
        MacLook.padWide
        #endif
    }

    /// The system's semantic colour for a colour the sections name (nil: a fill the web's controls draw).
    static func system(_ name: String) -> Color? {
        switch name {
        case "color-danger": MacLook.Colors.red
        case "color-heading", "color-ink": MacLook.Colors.label
        case "color-ink-muted": MacLook.Colors.secondary
        case "color-ink-faint": MacLook.Colors.tertiary
        case "color-line": MacLook.Colors.separator
        case "color-surface": MacLook.Colors.window
        case "color-focus": MacLook.Colors.accent
        case "color-accent-soft": MacLook.Colors.selection
        case "glass-hover": MacLook.Colors.hover.opacity(0.6)
        default: nil
        }
    }
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
    @Environment(\.settingsNative) private var native
    @State private var width: CGFloat = 0

    init(_ text: String, _ style: String, weight: CGFloat? = nil, color: Color? = nil, lines: Int? = nil) {
        self.text = text
        self.style = style
        self.weight = weight
        self.color = color
        self.lines = lines
    }

    var body: some View {
        if native {
            Text(text)
                .font(SettingsNativeText.font(style, weight: weight))
                .lineLimit(lines)
                .foregroundStyle(color ?? SettingsNativeText.color(style))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: lines != 1 && text.count > 60 ? .infinity : nil, alignment: .leading)
        } else {
            web
        }
    }

    private var web: some View {
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
    /// Where Settings' search scrolls to (the title, unless the title changes with the space or the version).
    let anchor: String
    let content: Content

    init(_ title: String, anchor: String? = nil, description: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.description = description
        self.anchor = anchor ?? title
        self.content = content()
    }

    @Environment(\.colorScheme) private var scheme
    @Environment(\.settingsNative) private var native

    var body: some View {
        if native {
            NativeSettingsCard(title: title, description: description, anchor: anchor, content: content)
        } else {
            web
        }
    }

    @ViewBuilder private var web: some View {
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

/// A setting's value while a change is on its way (MAC-04): the control shows the chosen value at once, keeps
/// showing it until the stored value arrives, and goes back to the stored one when the change fails.
struct SettingsPending<Value: Equatable>: Equatable {
    private(set) var value: Value?

    /// What the control shows: the chosen value while it's on its way, else the stored one.
    func shown(_ stored: Value) -> Value { value ?? stored }

    /// A change starts.
    mutating func begin(_ v: Value) { value = v }

    /// The change's answer: a failure rolls back; a success settles once the stored value says so.
    mutating func finish(ok: Bool, stored: Value) {
        if !ok || value == stored { value = nil }
    }

    /// The stored value changed (the change arrived, or someone else's did): it wins.
    mutating func stored(_ v: Value) { value = nil }
}

/// The switch's picture (ui/Switch.tsx: 40 x 24, the knob 20 x 20 sliding 16 pt), a shade deeper while the
/// pointer is over it.
struct SettingsSwitchKnob: View {
    let isOn: Bool
    var over = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let track = SettingsStyle.pair(isOn ? "switch.on" : "switch.off")
        let knob = SettingsStyle.pair(isOn ? "switch.on.knob" : "switch.off.knob")
        let t = track.resolve(scheme), k = knob.resolve(scheme)
        ZStack(alignment: .leading) {
            Color.clear.frame(width: t.width, height: t.height).webBox(track)
            if over {
                // The hover: the press fill over an off track, a faint lift over an on one (the knob stays).
                RoundedRectangle(cornerRadius: t.radius, style: .circular)
                    .fill(isOn ? SettingsColor.v("glass-active", scheme).opacity(0.18) : SettingsColor.v("mac-press", scheme))
                    .frame(width: t.width, height: t.height)
            }
            Color.clear.frame(width: k.width, height: k.height).webBox(knob)
                .offset(x: k.x - t.x)
        }
        .frame(width: t.width, height: t.height)
        .animation(.easeOut(duration: 0.15), value: isOn)
    }
}

/// No system press dimming: the switch and its row draw their own hover.
struct SettingsNoHighlight: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label.contentShape(Rectangle()) }
}

/// Flips a switch optimistically: shows the new value at once, saves it, and rolls back if saving fails (the
/// model's error toast says why).
@MainActor
func settingsFlip(_ shown: Bool, stored: @escaping @MainActor () -> Bool, pending: Binding<SettingsPending<Bool>>, save: @escaping (Bool) async -> Bool) {
    let next = !shown
    pending.wrappedValue.begin(next)
    Task { @MainActor in
        let ok = await save(next)
        // (Only the change still showing settles: a later click owns the switch now.)
        guard pending.wrappedValue.value == next else { return }
        pending.wrappedValue.finish(ok: ok, stored: stored())
    }
}

/// A button over a filled box (a theme tile, the shortcut field): the hover and press fills lie over the box, as
/// its own fill would hide them underneath. No system dimming.
struct SettingsHoverOverlayStyle: ButtonStyle {
    let radius: CGFloat
    var enabled = true

    func makeBody(configuration: Configuration) -> some View {
        Fill(label: configuration.label, pressed: configuration.isPressed, radius: radius, enabled: enabled)
    }

    private struct Fill<L: View>: View {
        let label: L
        let pressed: Bool
        let radius: CGFloat
        let enabled: Bool
        @State private var over = false
        @Environment(\.colorScheme) private var scheme

        var body: some View {
            label
                .overlay {
                    if enabled, pressed || over {
                        RoundedRectangle(cornerRadius: radius, style: .circular)
                            .fill(SettingsColor.v(pressed ? "mac-press" : "mac-hover", scheme))
                            .allowsHitTesting(false)
                    }
                }
                .contentShape(Rectangle())
                .onHover { over = $0 }
        }
    }
}

/// A link inside Settings' text (MAC-55, MAC-56): only its words take the click; underlined faintly, fully
/// under the pointer, in the heading colour then.
struct SettingsLink: View {
    let title: String
    let style: String
    var weight: CGFloat?
    let action: () -> Void
    @State private var over = false
    @Environment(\.colorScheme) private var scheme

    init(_ title: String, style: String, weight: CGFloat? = nil, action: @escaping () -> Void) {
        self.title = title
        self.style = style
        self.weight = weight
        self.action = action
    }

    @Environment(\.settingsNative) private var native

    var body: some View {
        let s = SettingsStyle.pair(style).resolve(scheme)
        let color = over ? SettingsColor.v("color-heading", scheme) : s.color.color
        Button(action: action) {
            Text(title).sFont(weight.map { s.text.weight($0) } ?? s.text, nativeFont)
                .foregroundStyle(color)
                .underline(true, color: color.opacity(over ? 1 : 0.4))
                .fixedSize(horizontal: false, vertical: true)
        }
        .buttonStyle(SettingsNoHighlight())
        .onHover { over = $0 }
        .accessibilityAddTraits(.isLink)
    }

    private var nativeFont: Font {
        SettingsNativeText.font(style, weight: weight)
    }
}

/// A sentence with a link in it, wrapping as one paragraph: only the link's words open it (MAC-55). The link is
/// the ink colour, underlined (heading colour while the pointer is on it).
struct SettingsLinkedText: View {
    let before: String
    let link: String
    let after: String
    let style: String
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    static let target = URL(string: "folevi-settings-link:open")!

    var body: some View {
        let s = SettingsStyle.pair(style).resolve(scheme)
        var text = AttributedString(before)
        var l = AttributedString(link)
        l.link = Self.target
        l.foregroundColor = SettingsColor.v("color-ink", scheme)
        l.underlineStyle = .single
        text += l
        text += AttributedString(after)
        let font = SettingsNativeText.font("muted", weight: nil)
        return Text(text)
            .sFont(s.text, font)
            .foregroundStyle(s.color.color)
            .tint(SettingsColor.v("color-ink", scheme))
            .fixedSize(horizontal: false, vertical: true)
            .environment(\.openURL, OpenURLAction { url in
                guard url == Self.target else { return .systemAction }
                action()
                return .handled
            })
    }
}

/// `ui/Switch.tsx` whose change goes to the engine. `save` answers whether the change was made.
struct SettingsSwitch: View {
    let isOn: Bool
    let label: String
    var disabled = false
    let save: (Bool) async -> Bool
    @State private var pending = SettingsPending<Bool>()
    @State private var over = false

    init(isOn: Bool, label: String, disabled: Bool = false, save: @escaping (Bool) async -> Bool) {
        self.isOn = isOn
        self.label = label
        self.disabled = disabled
        self.save = save
    }

    @Environment(\.settingsNative) private var native

    var body: some View {
        if native {
            NativeSettingsSwitch(isOn: Binding(get: { pending.shown(isOn) }, set: { v in
                let shown = pending.shown(isOn)
                if v != shown { settingsFlip(shown, stored: { isOn }, pending: $pending, save: save) }
            }), label: label)
            .disabled(disabled)
            .onChange(of: isOn) { _, v in pending.stored(v) }
        } else {
            web
        }
    }

    private var web: some View {
        let shown = pending.shown(isOn)
        return Button { settingsFlip(shown, stored: { isOn }, pending: $pending, save: save) } label: {
            SettingsSwitchKnob(isOn: shown, over: over && !disabled)
        }
        .buttonStyle(SettingsNoHighlight())
        .onHover { over = $0 }
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .onChange(of: isOn) { _, v in pending.stored(v) }
        .accessibilityLabel(label)
        .accessibilityValue(shown ? "On" : "Off")
        .accessibilityAddTraits(.isToggle)
    }
}

/// A row whose words and switch are one control (MAC-27): a click anywhere on it flips the switch, and the row
/// shows the hover fill under the pointer.
struct SettingsToggleRow<Words: View>: View {
    let isOn: Bool
    let label: String
    var disabled = false
    var alignment: VerticalAlignment = .center
    var spacing: CGFloat
    var switchTop: CGFloat = 0
    let save: (Bool) async -> Bool
    @ViewBuilder let words: Words
    @State private var pending = SettingsPending<Bool>()
    @State private var over = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.settingsNative) private var native

    var body: some View {
        if native {
            // The words and a native switch: a click on the words flips it too (MAC-27), the switch takes its own.
            HStack(alignment: alignment == .top ? .firstTextBaseline : .center, spacing: MacLook.Space.l) {
                words
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .onTapGesture { if !disabled { settingsFlip(pending.shown(isOn), stored: { isOn }, pending: $pending, save: save) } }
                NativeSettingsSwitch(isOn: Binding(get: { pending.shown(isOn) }, set: { v in
                    let shown = pending.shown(isOn)
                    if v != shown { settingsFlip(shown, stored: { isOn }, pending: $pending, save: save) }
                }), label: label)
                .disabled(disabled)
            }
            .opacity(disabled ? 0.55 : 1)
            .onChange(of: isOn) { _, v in pending.stored(v) }
            .modifier(SettingsFoundHighlight(anchor: SettingsAnchor.row(label), radius: 6))
        } else {
            web
        }
    }

    @ViewBuilder private var web: some View {
        let shown = pending.shown(isOn)
        Button { settingsFlip(shown, stored: { isOn }, pending: $pending, save: save) } label: {
            HStack(alignment: alignment, spacing: spacing) {
                words
                SettingsSwitchKnob(isOn: shown, over: over && !disabled).padding(.top, switchTop)
            }
            .background {
                // The fill reaches a little past the words, so the row reads as one target without moving them.
                if over && !disabled {
                    RoundedRectangle(cornerRadius: 8, style: .circular).fill(SettingsColor.v("mac-hover", scheme)).padding(-6)
                }
            }
        }
        .buttonStyle(SettingsNoHighlight())
        .onHover { over = $0 }
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .onChange(of: isOn) { _, v in pending.stored(v) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(shown ? "On" : "Off")
        .accessibilityAddTraits([.isToggle, .isButton])
    }
}

/// `ui/Select.tsx` as an input well: the chosen label and a chevron; a Folevi menu of the choices. A choice that
/// is saved shows at once and goes back if saving it fails.
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
    let save: (String) async -> Bool
    @State private var pending = SettingsPending<String>()
    @Environment(\.colorScheme) private var scheme

    /// A choice kept on the page (a form's own state): it changes at once.
    init(options: [Option], value: String, width: CGFloat? = nil, style: String = "select", disabled: Bool = false, onChange: @escaping (String) -> Void) {
        self.init(options: options, value: value, width: width, style: style, disabled: disabled, save: { v in onChange(v); return true })
    }

    /// A choice saved to the engine: `save` answers whether it was.
    init(options: [Option], value: String, width: CGFloat? = nil, style: String = "select", disabled: Bool = false, save: @escaping (String) async -> Bool) {
        self.options = options
        self.value = value
        self.width = width
        self.style = style
        self.disabled = disabled
        self.save = save
    }

    @Environment(\.settingsNative) private var native

    var body: some View {
        if native {
            Picker("", selection: Binding(get: { pending.shown(value) }, set: { choose($0) })) {
                ForEach(options, id: \.value) { o in Text(o.label).tag(o.value) }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .fixedSize()
            .frame(minWidth: width.map { min($0, 160) }, alignment: .leading)
            .disabled(disabled)
            .onChange(of: value) { _, v in pending.stored(v) }
        } else {
            web
        }
    }

    @ViewBuilder private var web: some View {
        let pair = SettingsStyle.pair(style)
        let s = pair.resolve(scheme)
        let label = SettingsStyle.pair("select.label").resolve(scheme)
        let chevron = SettingsStyle.pair("select.chevron").resolve(scheme)
        let chosen = pending.shown(value)
        let current = options.first { $0.value == chosen }?.label ?? chosen
        WebMenuButton(select: true, hover: s.radius, entries: {
            options.map { o in WebMenuEntry(.item(o.label, checked: o.value == chosen, id: o.value)) { choose(o.value) } }
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
        .onChange(of: value) { _, v in pending.stored(v) }
    }

    private func choose(_ v: String) {
        guard v != pending.shown(value) else { return }
        pending.begin(v)
        Task { @MainActor in
            let ok = await save(v)
            guard pending.value == v else { return }
            pending.finish(ok: ok, stored: value)
        }
    }
}

/// `.ui-input h-9 rounded-chip px-3 text-callout`: a one-line field (secure for keys and passphrases), with the
/// input's focus ring while it has the cursor (MAC-26). A click anywhere in the well puts the cursor in it.
struct SettingsField: View {
    let placeholder: String
    @Binding var text: String
    var secure = false
    var height: CGFloat?
    var onSubmit: () -> Void = {}
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme
    @Environment(\.settingsNative) private var native

    var body: some View {
        if native {
            Group {
                if secure { SecureField(placeholder, text: $text) } else { TextField(placeholder, text: $text) }
            }
            .onSubmit(onSubmit)
            // (One height for every field in Settings, whatever the web gave this one.)
            .nativeTextField()
            .frame(maxWidth: .infinity)
        } else {
            web
        }
    }

    @ViewBuilder private var web: some View {
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
        .focused($focused)
        .webText(s.text)
        .lineLimit(1)
        .onSubmit(onSubmit)
        .padding(s.padding.edgeInsets)
        .frame(height: height ?? s.height)
        .frame(maxWidth: .infinity)
        .foregroundStyle(s.color.color)
        .webBox(focused ? webFocused(pair) : pair)
        .contentShape(Rectangle())
        .onTapGesture { focused = true } // (no hover: a field, the click puts the cursor in it)
        .animation(.easeOut(duration: 0.12), value: focused)
    }
}

/// A row with a label, a hint and a switch (Settings > Desktop app's rows): the whole row flips it.
struct SettingsSwitchRow: View {
    let label: String
    let hint: String
    let isOn: Bool
    var disabled = false
    let save: (Bool) async -> Bool

    var body: some View {
        SettingsToggleRow(isOn: isOn, label: label, disabled: disabled, spacing: SettingsStyle.pair("row").light.gap, save: save) {
            VStack(alignment: .leading, spacing: 0) {
                SText(label, "row.label")
                SText(hint, "row.hint")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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

    @Environment(\.settingsNative) private var native

    var body: some View {
        let color: Color = {
            if native { return MacLook.Colors.separator }
            return SettingsStyle.pair(line).resolve(scheme).borderColor.color
        }()
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

    @Environment(\.settingsNative) private var native

    var body: some View {
        if native {
            Grid(alignment: .topLeading, horizontalSpacing: MacLook.Space.m, verticalSpacing: MacLook.Space.s) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                    GridRow {
                        Text(r.0).font(MacLook.Text.body).foregroundStyle(MacLook.Colors.secondary)
                            .frame(width: MacSettingsLook.termWidth, alignment: .leading)
                        Text(r.1).font(MacLook.Text.body).foregroundStyle(r.2 ?? MacLook.Colors.label)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        } else {
            web
        }
    }

    @ViewBuilder private var web: some View {
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
    @Environment(\.settingsNative) private var native
    var body: some View {
        if native {
            // A narrow window stacks them rather than clip one (the guide's planned reflow).
            ViewThatFits(in: .horizontal) {
                HStack(spacing: MacLook.Space.s) { content }
                VStack(alignment: .leading, spacing: MacLook.Space.s) { content }
            }
        } else {
            HStack(spacing: SettingsStyle.pair("buttons").light.gap) { content }
        }
    }
}

// MARK: dialogs

/// ui/Dialog.tsx on the Mac: a panel over the window (no dimming: the web's backdrop is transparent), title, an
/// optional description, the body and a footer of buttons; Escape and ⌘. close it, Return presses the default (Cancel, in a confirmation).
struct SettingsDialogView<Body: View, Footer: View>: View {
    let title: String
    let description: String?
    let width: CGFloat
    let close: () -> Void
    @ViewBuilder let content: Body
    @ViewBuilder let footer: Footer
    @Environment(\.colorScheme) private var scheme
    @Environment(\.settingsNative) private var native

    var body: some View {
        if native {
            // A sheet's content: the title and what it does, the body, the buttons trailing (Escape cancels).
            VStack(alignment: .leading, spacing: MacLook.Space.m) {
                VStack(alignment: .leading, spacing: MacLook.Space.xs) {
                    Text(title).font(MacLook.Text.title3Strong).foregroundStyle(MacLook.Colors.label)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    if let description {
                        Text(description).font(MacLook.Text.body).foregroundStyle(MacLook.Colors.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                content.frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: MacLook.Space.s) {
                    Spacer(minLength: 0)
                    footer
                }
                .padding(.top, MacLook.Space.xs)
            }
            .padding(MacLook.Space.xl - 4)
            .frame(width: min(width, 460))
        } else {
            web
        }
    }

    @ViewBuilder private var web: some View {
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
/// One dialog at a time as a sheet on the window that asked (the Settings window): the system's presentation in the
/// native look (docs/MAC_NATIVE_LOOK.md: dialogs are stock macOS parts). Escape and ⌘. close it, as Cancel does.
@MainActor
final class SettingsDialogWindow: NSPanel {
    private static weak var current: SettingsDialogWindow?
    private var onClose: (() -> Void)?

    /// Shows `content` (a SettingsDialogView) as a sheet on `window`.
    @discardableResult
    static func show<V: View>(over window: NSWindow, onClose: (() -> Void)? = nil, @ViewBuilder content: () -> V) -> SettingsDialogWindow {
        current?.dismiss()
        // A sheet on a sheet waits for it: present on the window under any sheet already showing.
        let parent = window.sheetParent ?? window
        let host = ClickThroughHostingView(rootView: content()
            .environment(\.settingsNative, true)
            .controlSize(MacLook.controlSize)
            .environment(\.settingsWindowed, true)
            .macClickThrough())
        let size = host.fittingSize
        let panel = SettingsDialogWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: true)
        panel.isReleasedWhenClosed = false
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden
        panel.onClose = onClose
        host.frame = NSRect(origin: .zero, size: size)
        host.autoresizingMask = [.width, .height]
        panel.contentView = host
        current = panel
        parent.beginSheet(panel)
        return panel
    }

    static func closeCurrent() { current?.dismiss() }

    /// Whether a dialog shows (tests).
    static var isShowing: Bool { current != nil && current?.closing == false }

    override var canBecomeKey: Bool { true }

    /// Escape and ⌘. (the system sends both here).
    override func cancelOperation(_ sender: Any?) { dismiss() }

    private var closing = false

    func dismiss() {
        guard !closing else { return }
        closing = true
        let done = onClose
        onClose = nil
        done?()
        if let parent = sheetParent { parent.endSheet(self) } else { close() }
        if Self.current === self { Self.current = nil }
    }
}

/// A confirmation as the Mac asks it in the native look: the system's alert, as a sheet on the window that asked.
/// A destructive action's alert keeps Cancel as the default (Return) and marks the action destructive; a
/// non-destructive action is the default. Escape is Cancel.
@MainActor
func settingsConfirm(_ title: String, message: String?, confirm: String, destructive: Bool = true, in window: NSWindow?, then run: @escaping () -> Void) {
    guard let window = window ?? NSApp.keyWindow ?? NSApp.mainWindow else { return }
    let alert = settingsConfirmAlert(title, message: message, confirm: confirm, destructive: destructive)
    let confirmed: NSApplication.ModalResponse = destructive ? .alertSecondButtonReturn : .alertFirstButtonReturn
    alert.beginSheetModal(for: window.sheetParent ?? window) { response in
        if response == confirmed { run() }
    }
}

/// settingsConfirm's alert (tests read it).
@MainActor
func settingsConfirmAlert(_ title: String, message: String?, confirm: String, destructive: Bool) -> NSAlert {
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = message ?? ""
    alert.alertStyle = destructive ? .warning : .informational
    if destructive {
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: confirm).hasDestructiveAction = true
    } else {
        alert.addButton(withTitle: confirm)
        alert.addButton(withTitle: "Cancel")
    }
    return alert
}

/// settingsConfirm's dialog: the title, what will happen, Cancel and the action.
struct SettingsConfirmDialog: View {
    let title: String
    let message: String?
    let confirm: String
    var destructive = true
    let run: () -> Void

    var body: some View {
        SettingsDialogView(title: title, description: message, width: 384, close: { SettingsDialogWindow.closeCurrent() }) {
            EmptyView()
        } footer: {
            if destructive {
                WebButton("Cancel") { SettingsDialogWindow.closeCurrent() }.keyboardShortcut(.defaultAction)
                WebButton(confirm, variant: .danger) {
                    SettingsDialogWindow.closeCurrent()
                    run()
                }
            } else {
                WebButton("Cancel") { SettingsDialogWindow.closeCurrent() }.keyboardShortcut(.cancelAction)
                WebButton(confirm, variant: .primary) {
                    SettingsDialogWindow.closeCurrent()
                    run()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
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
        if MacLook.padWide, let presenter = window.rootViewController?.topmostPresented {
            // The iPad's wide layout: the system's form sheet with the native dialog in it, as the Mac's sheet.
            let h = UIHostingController(rootView: AnyView(content()
                .environment(\.settingsNative, true)
                .environment(\.settingsWindowed, true)
                .environment(\.macNativeLook, true)
                .macNativeChrome()
                .tint(MacLook.Colors.accent)))
            h.sizingOptions = .preferredContentSize
            h.modalPresentationStyle = .formSheet
            h.isModalInPresentation = true
            d.host = h
            d.sheet = h
            current = d
            presenter.present(h, animated: !WebMotion.reduced)
            return d
        }
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

    /// The iPad's wide layout's form sheet, while it shows.
    private weak var sheet: UIViewController?

    func dismiss() {
        if let sheet { sheet.presentingViewController?.dismiss(animated: !WebMotion.reduced) }
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
