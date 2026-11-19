// The pieces the card's screens share under the native look (docs/MAC_NATIVE_LOOK.md): the page title rule,
// section headings, a list row's rounded highlight and the separators beside it, the layout switch as a segmented
// control, and the system's search field. A screen draws these only while it has a NativeChrome (ScreenRoot sets
// one on the Mac and in the iPad's wide layout); the iPhone's screens that borrow these never have one. The numbers
// and colours are MacLook's (the iPad's own on iOS).
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign
#if os(macOS)
import AppKit
#endif

/// The native look's interface type and colours, from MacLook.
enum NativeLook {
    /// Every screen's page title ("Work", "Folders", "Tasks"): 22 pt semibold (iPad 28), leading.
    static let pageTitle = MacLook.Text.titleStrong
    /// A section's title inside a page ("Recent notes", "Today"): 15 pt semibold (iPad 20).
    static let sectionTitle = MacLook.Text.title3Strong
    /// A small heading over a group ("Folders", "Built-in templates"): 11 pt semibold (iPad 13), secondary.
    static let heading = MacLook.Text.smallStrong
    static let body = MacLook.Text.body
    static let small = MacLook.Text.small
    static let label = MacLook.Colors.label
    static let secondary = MacLook.Colors.secondary
    static let tertiary = MacLook.Colors.tertiary
    static let separator = MacLook.Colors.separator
    static let hover = MacLook.Colors.hover
    static let selection = MacLook.Colors.selection
    static let container = MacLook.Colors.container
    static let accent = MacLook.Colors.accent
    static let onAccent = MacLook.Colors.onAccent
    static let rowRadius = MacLook.rowRadius
    static let space = (xs: MacLook.Space.xs, s: MacLook.Space.s, m: MacLook.Space.m, l: MacLook.Space.l, xl: MacLook.Space.xl)
}

/// A heading over a group in a page (`Folders`, `Built-in templates`): 11 pt semibold, secondary, not capitals.
struct NativeHeading: View {
    let title: String
    init(_ title: String) { self.title = title }
    var body: some View {
        Text(title).font(NativeLook.heading).foregroundStyle(NativeLook.secondary).lineLimit(1)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A list row's rounded highlight: the selection (a neutral fill, gray in an inactive window too) or the hover.
struct NativeRowHighlight: View {
    let selected: Bool
    let hovered: Bool
    #if os(macOS)
    @Environment(\.controlActiveState) private var active
    #endif

    var body: some View {
        RoundedRectangle(cornerRadius: NativeLook.rowRadius, style: .continuous).fill(fill)
    }

    private var fill: Color {
        #if os(macOS)
        if selected { return active == .inactive ? NativeLook.hover.opacity(0.7) : NativeLook.selection }
        #else
        if selected { return NativeLook.selection }
        #endif
        return hovered ? NativeLook.hover.opacity(0.5) : .clear
    }
}

/// The point of room between two list rows. It was a separator line, hidden beside a highlighted row; the owner had
/// the lines between rows removed (2026-11-19: "keep the spacing but remove the horizontal lines") and the room
/// kept, so no row moved. A row's spacing and its rounded hover tell the rows apart.
struct NativeRowGap: View {
    var body: some View {
        Color.clear.frame(height: 1).accessibilityHidden(true)
    }
}

/// The grid and list switch as the system's segmented control (icons, each with its name for VoiceOver and a
/// tooltip).
struct NativeLayoutPicker<T: Hashable>: View {
    let options: [(T, String, String)]
    @Binding var value: T

    /// `options`: the value, an SF Symbol, its name.
    init(_ options: [(T, String, String)], value: Binding<T>) {
        self.options = options
        _value = value
    }

    var body: some View {
        Picker("View", selection: $value) {
            ForEach(options, id: \.0) { o in
                Image(systemName: o.1).accessibilityLabel(o.2).tag(o.0)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        .foleviTooltip("View as")
    }
}

extension View {
    /// A dialog's or panel's content in the Mac's native look (system type, native buttons and fields). Its frame
    /// (the sheet's panel, title and Close) stays its presenter's.
    @ViewBuilder func nativeDialogContent() -> some View {
        // (On iOS only where the iPad's wide layout set `macNativeLook`: the iPhone's dialogs keep the web's look.)
        macNativeChrome()
    }
}

#if os(macOS)
/// A search field. Searching: the system's (NSSearchField). With `filter`, a field that filters the list under it,
/// Folevi's funnel in place of the magnifier (the owner, 2026-11-19): drawn as the system's field (macOS 26 keeps its
/// magnifier over any image given to NSSearchField's button).
struct NativeSearchField: View {
    let placeholder: String
    @Binding var text: String
    var width: CGFloat = 220
    var filter = false

    var body: some View {
        if filter {
            MacFilterField(placeholder: placeholder, text: $text, width: width)
        } else {
            SystemSearchField(placeholder: placeholder, text: $text, width: width)
        }
    }
}

/// A field that filters a list: the system search field's capsule, edge and height, the funnel, a clear button,
/// Escape clears.
private struct MacFilterField: View {
    let placeholder: String
    @Binding var text: String
    let width: CGFloat

    var body: some View {
        HStack(spacing: 5) {
            WebIconView(.funnel, size: 13).foregroundStyle(MacLook.Colors.secondary)
            TextField("", text: $text)
                .textFieldStyle(.plain)
                .font(MacLook.Text.body)
                .onExitCommand { text = "" }
                // (The placeholder in the system field's grey: a plain field's own is the text colour.)
                .overlay(alignment: .leading) {
                    if text.isEmpty {
                        Text(placeholder).font(MacLook.Text.body).foregroundStyle(MacLook.Colors.tertiary)
                            .lineLimit(1).allowsHitTesting(false).accessibilityHidden(true)
                    }
                }
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(MacLook.Colors.tertiary)
                }
                .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
                .foleviTooltip("Clear filter")
                .accessibilityLabel("Clear filter")
            }
        }
        .padding(.leading, 9)
        .padding(.trailing, 6)
        .frame(height: MacLook.controlHeight)
        .background(Capsule().fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(Capsule().strokeBorder(MacLook.Colors.separator, lineWidth: 1))
        .frame(maxWidth: width)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(placeholder)
    }
}

/// The system's search field (NSSearchField): magnifier, placeholder, clear button, Escape clears.
private struct SystemSearchField: NSViewRepresentable {
    let placeholder: String
    @Binding var text: String
    var width: CGFloat = 220

    func makeNSView(context: Context) -> NSSearchField {
        let f = NSSearchField()
        f.placeholderString = placeholder
        f.delegate = context.coordinator
        f.sendsSearchStringImmediately = true
        f.controlSize = .regular
        f.setAccessibilityLabel(placeholder)
        return f
    }

    func updateNSView(_ f: NSSearchField, context: Context) {
        context.coordinator.text = $text
        if f.stringValue != text { f.stringValue = text }
        f.placeholderString = placeholder
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSSearchField, context: Context) -> CGSize? {
        CGSize(width: min(width, proposal.width ?? width), height: nsView.intrinsicContentSize.height)
    }

    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

    final class Coordinator: NSObject, NSSearchFieldDelegate {
        var text: Binding<String>
        init(text: Binding<String>) { self.text = text }
        func controlTextDidChange(_ note: Notification) {
            guard let f = note.object as? NSSearchField else { return }
            text.wrappedValue = f.stringValue
        }
    }
}
#else
/// The iPad's search field: the system's search look (a magnifier, the placeholder, a clear button) in a field of the
/// control height.
struct NativeSearchField: View {
    let placeholder: String
    @Binding var text: String
    var width: CGFloat = 220
    /// A field that filters the list under it: Folevi's funnel in place of the magnifier.
    var filter = false
    var body: some View {
        HStack(spacing: 6) {
            if filter {
                WebIconView(.funnel, size: 15).foregroundStyle(MacLook.Colors.secondary)
            } else {
                Image(systemName: "magnifyingglass").foregroundStyle(MacLook.Colors.secondary)
            }
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(MacLook.Text.body)
                .submitLabel(.search)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(MacLook.Colors.tertiary).padding(2) }
                    .buttonStyle(QuietHoverStyle(shape: AnyShape(Circle())))
                    .accessibilityLabel(filter ? "Clear filter" : "Clear search")
            }
        }
        .padding(.horizontal, 10)
        .frame(height: MacLook.compactControlHeight + 4)
        .background(MacLook.Colors.hover, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .frame(maxWidth: width)
        .accessibilityLabel(placeholder)
    }
}
#endif
#endif
