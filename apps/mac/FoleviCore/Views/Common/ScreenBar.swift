// The window's top bar, drawn inside the content card (the owner's Mac UI guide, docs/design/macloving-mac-ui.md:
// the main-window profile with a hidden title bar, chosen on 23 November 2026). The system toolbar can't sit inside
// the card, so each screen says what its bar holds (`.screenActions`, `.screenSearch`, `.screenSubtitle`) and the
// window draws one bar from it: Back and Forward, the title, the screen's actions in one glass capsule, New Note,
// then the screen's search field. Every control is 36 pt tall; only controls are glass.
import AppKit
import FoleviDesign
import SwiftUI

/// The guide's window metrics, in one place.
enum WindowMetrics {
    static let sidebarWidth: CGFloat = 228
    static let containerMargin: CGFloat = 12
    static let containerRadius: CGFloat = 12
    static let barControlHeight: CGFloat = 36
    /// The bar's height: 14 pt above the controls, 10 pt below.
    static let barHeight: CGFloat = 14 + barControlHeight + 10
    /// Where the sidebar's content starts, below the traffic lights.
    static let trafficLightsInset: CGFloat = 46
    static let inspectorWidth: CGFloat = 320
    static let inspectorRadius: CGFloat = 18
}

extension EnvironmentValues {
    /// The window shows macOS's tab bar: the traffic lights sit above it, so the sidebar needs no room for them.
    @Entry var windowTabBarVisible = false
}

/// A screen's search field in the bar: its text, its prompt.
struct BarSearch {
    var text: Binding<String>
    var prompt: String
}

/// What a screen puts in the window's bar.
struct ScreenBarSpec {
    var title: String?
    var subtitle: String?
    var leading: AnyView?
    var actions: AnyView?
    var search: BarSearch?
    var hidesNewNote = false

    /// `other`'s fields over these (a modifier closer to the screen's root wins).
    mutating func merge(_ other: ScreenBarSpec) {
        if let v = other.title { title = v }
        if let v = other.subtitle { subtitle = v }
        if let v = other.leading { leading = v }
        if let v = other.actions { actions = v }
        if let v = other.search { search = v }
        if other.hidesNewNote { hidesNewNote = true }
    }
}

struct ScreenBarKey: PreferenceKey {
    static let defaultValue = ScreenBarSpec()
    static func reduce(value: inout ScreenBarSpec, nextValue: () -> ScreenBarSpec) { value.merge(nextValue()) }
}

extension View {
    /// The screen's actions in the window's bar: buttons and menus, grouped in one glass capsule.
    func screenActions<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        let view = AnyView(BarGroup { content() })
        return transformPreference(ScreenBarKey.self) { $0.merge(ScreenBarSpec(actions: view)) }
    }

    /// Something before the title (a note's folder chip).
    func screenLeading<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        let view = AnyView(content())
        return transformPreference(ScreenBarKey.self) { $0.merge(ScreenBarSpec(leading: view)) }
    }

    /// The screen's search field, at the bar's trailing end (⌘F focuses it, through the window's filterFocus).
    func screenSearch(text: Binding<String>, prompt: String) -> some View {
        transformPreference(ScreenBarKey.self) { $0.merge(ScreenBarSpec(search: BarSearch(text: text, prompt: prompt))) }
    }

    /// The line under the title (a count, a date).
    func screenSubtitle(_ subtitle: String) -> some View {
        transformPreference(ScreenBarKey.self) { $0.merge(ScreenBarSpec(subtitle: subtitle)) }
    }

    /// A title other than the window's.
    func screenTitle(_ title: String) -> some View {
        transformPreference(ScreenBarKey.self) { $0.merge(ScreenBarSpec(title: title)) }
    }
}

/// The bar: drawn over the card's top by the window, from the screen's spec.
struct ScreenTopBar: View {
    let window: WindowModel
    let spec: ScreenBarSpec
    private var app: AppModel { .shared }

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                BarGroup {
                    Button { window.back() } label: { WebIcon.chevronLeft.image(size: 16) }
                        .disabled(!window.canGoBack)
                        .help("Back")
                        .accessibilityLabel("Back")
                    Button { window.forward() } label: { WebIcon.chevronRight.image(size: 16) }
                        .disabled(!window.canGoForward)
                        .help("Forward")
                        .accessibilityLabel("Forward")
                }
                if let leading = spec.leading { leading }
                VStack(alignment: .leading, spacing: 0) {
                    Text(spec.title ?? window.title).font(.headline).lineLimit(1)
                    if let subtitle = spec.subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .layoutPriority(-1)
                Spacer(minLength: 8)
                if let actions = spec.actions { actions.fixedSize() }
                if !spec.hidesNewNote {
                    Button {
                        NoteActions.newNote(app: app, window: window)
                    } label: {
                        Label { Text("New Note") } icon: { WebIcon.plus.image(size: 14) }
                            .labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(InkPillStyle(height: WindowMetrics.barControlHeight))
                    .help("New Note (⌘N)")
                    .fixedSize()
                }
                if let search = spec.search { BarSearchField(search: search, window: window) }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .frame(height: WindowMetrics.barHeight)
        .background(alignment: .top) { ScrollEdgeFade() }
    }
}

/// The bar's soft scroll edge: content scrolling under the bar fades into the card, so the title and the glass
/// controls stay legible. macOS draws its own scroll edge effect only under system toolbars, not under a bar a
/// window draws itself, so the window draws this one (the system's soft style: no line, a fade).
private struct ScrollEdgeFade: View {
    var body: some View {
        let card = Color(nsColor: .controlBackgroundColor)
        LinearGradient(
            stops: [.init(color: card, location: 0), .init(color: card.opacity(0.85), location: 0.55), .init(color: card.opacity(0), location: 1)],
            startPoint: .top, endPoint: .bottom
        )
        .frame(height: WindowMetrics.barHeight + 16)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// Related bar buttons in one glass capsule, 36 pt tall, each with a hover surface of its own.
struct BarGroup<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        // Nothing to show (a screen whose actions all depend on state): no empty capsule.
        Group(subviews: content) { subviews in
            if !subviews.isEmpty { capsule(subviews) }
        }
    }

    private func capsule(_ subviews: SubviewsCollection) -> some View {
        HStack(spacing: 0) { ForEach(subviews) { $0 } }
            .labelStyle(.iconOnly)
            .buttonStyle(BarButtonStyle())
            .menuStyle(.button)
            .menuIndicator(.hidden)
            .pickerStyle(.segmented)
            .padding(.horizontal, 3)
            .frame(height: WindowMetrics.barControlHeight)
            .glassEffect(.regular.interactive(), in: .capsule)
    }
}

/// A button in the bar: its symbol (or short label) in a capsule hover surface, inset 3 pt in the 36 pt group.
struct BarButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovered = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .padding(.horizontal, 8)
            .frame(minWidth: 32, minHeight: WindowMetrics.barControlHeight - 6)
            .opacity(isEnabled ? 1 : 0.35)
            .background(Capsule().fill(Color(nsColor: .quaternaryLabelColor).opacity(configuration.isPressed ? 1 : hovered && isEnabled ? 0.7 : 0)))
            .contentShape(Capsule())
            .onHover { hovered = $0 }
    }
}

/// The screen's search field: a glass capsule with a clear button; ⌘F (the window's Find) focuses it.
struct BarSearchField: View {
    let search: BarSearch
    let window: WindowModel
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(search.prompt, text: search.text)
                .textFieldStyle(.plain)
                .focused($focused)
                .onKeyPress(.escape) {
                    if search.text.wrappedValue.isEmpty { focused = false } else { search.text.wrappedValue = "" }
                    return .handled
                }
            if !search.text.wrappedValue.isEmpty {
                Button { search.text.wrappedValue = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                    .buttonStyle(.plain)
                    .help("Clear")
                    .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: WindowMetrics.barControlHeight)
        .frame(minWidth: 170, idealWidth: 240, maxWidth: 280)
        .contentShape(Capsule())
        .glassEffect(.regular.interactive(), in: .capsule)
        .onChange(of: window.filterFocus) { focused = true }
    }
}

/// One of a few views or filters, in the bar: capsule segments on the group's capsule track, the selected one a
/// capsule inset 3 pt (the guide: selection height = track height - 2 x inset), sliding between choices. Each
/// segment shows its symbol (or a short title), with the title as tooltip and accessibility label.
struct BarChoice<Value: Hashable>: View {
    struct Option {
        let value: Value
        let title: String
        var symbol: String? = nil
    }

    @Binding var selection: Value
    let options: [Option]
    @Namespace private var space
    @State private var hovered: Value?

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options.indices, id: \.self) { i in
                let option = options[i]
                let selected = option.value == selection
                Button {
                    Motion.run(Motion.tap) { selection = option.value }
                } label: {
                    Group {
                        if let symbol = option.symbol { CoreIcon.image(symbol) } else { Text(option.title) }
                    }
                    .font(.body.weight(.medium))
                    .foregroundStyle(selected ? .primary : .secondary)
                    .padding(.horizontal, option.symbol == nil ? 12 : 8)
                    .frame(minWidth: 32, minHeight: WindowMetrics.barControlHeight - 6)
                    .background {
                        if selected {
                            Capsule().fill(Color.primary.opacity(0.1)).matchedGeometryEffect(id: "selected", in: space)
                        } else {
                            Capsule().fill(Color(nsColor: .quaternaryLabelColor).opacity(hovered == option.value ? 0.7 : 0))
                        }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .onHover { inside in
                    if inside { hovered = option.value } else if hovered == option.value { hovered = nil }
                }
                .help(option.title)
                .accessibilityLabel(option.title)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }
}

/// A search field inside a pane (a list of its own, such as Foli AI's chats): a quiet rounded fill, not glass.
struct InlineSearchField: View {
    @Binding var text: String
    let prompt: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(prompt, text: $text).textFieldStyle(.plain)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                    .buttonStyle(.plain)
                    .help("Clear")
                    .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 30)
        .background(Color(nsColor: .quaternaryLabelColor).opacity(0.6), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// The translucent surface behind the sidebar and the card's margins (one continuous surface, no divider).
struct WindowMaterial: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .sidebar
        view.blendingMode = .behindWindow
        view.state = .followsWindowActiveState
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}
