// The pieces the card's screens share under the Mac's native look (docs/MAC_NATIVE_LOOK.md): the page title rule,
// section headings, a list row's rounded highlight and the separators beside it, the layout switch as a segmented
// control, and the system's search field. A screen draws these only while it has a NativeChrome (ScreenRoot sets
// one on the Mac): the iPad's wide layout, which builds these screens too, never has one and keeps the web's look.
// The numbers and colours are MacLook's; on iOS (where nothing draws these) the same roles' system values stand in.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign
#if os(macOS)
import AppKit
#endif

/// The native look's interface type and colours, from MacLook.
enum NativeLook {
    #if os(macOS)
    /// Every screen's page title ("Work", "Folders", "Tasks"): 22 pt semibold, leading.
    static let pageTitle = MacLook.Text.titleStrong
    /// A section's title inside a page ("Recent notes", "Today"): 15 pt semibold.
    static let sectionTitle = MacLook.Text.title3Strong
    /// A small heading over a group ("Folders", "Built-in templates"): 11 pt semibold, secondary.
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
    #else
    static let pageTitle = Font.title.weight(.semibold)
    static let sectionTitle = Font.title3.weight(.semibold)
    static let heading = Font.subheadline.weight(.semibold)
    static let body = Font.body
    static let small = Font.subheadline
    static let label = Color.primary
    static let secondary = Color.secondary
    static let tertiary = Color.secondary.opacity(0.7)
    static let separator = Color.secondary.opacity(0.3)
    static let hover = Color.secondary.opacity(0.15)
    static let selection = Color.secondary.opacity(0.2)
    static let container = Color(uiColor: .systemBackground)
    static let accent = Color.primary
    static let onAccent = Color(uiColor: .systemBackground)
    static let rowRadius: CGFloat = 8
    static let space = (xs: CGFloat(4), s: CGFloat(8), m: CGFloat(12), l: CGFloat(16), xl: CGFloat(24))
    #endif
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
        #if os(macOS)
        macNativeChrome()
        #else
        self
        #endif
    }
}

#if os(macOS)
/// The system's search field (NSSearchField): magnifier, placeholder, clear button, Escape clears.
struct NativeSearchField: NSViewRepresentable {
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
/// (Never drawn on iOS: only the Mac's native look uses it. A plain field keeps the shared screens compiling.)
struct NativeSearchField: View {
    let placeholder: String
    @Binding var text: String
    var width: CGFloat = 220
    var body: some View { TextField(placeholder, text: $text).frame(maxWidth: width) }
}
#endif
#endif
