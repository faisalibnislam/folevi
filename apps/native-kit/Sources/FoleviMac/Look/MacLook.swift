// Folevi for Mac's native look (owner decision 2026-11-18, docs/MAC_NATIVE_LOOK.md). The window profile from the
// owner's Mac UI guide: a translucent frame and sidebar (one continuous surface, no divider), one opaque rounded
// content card holding the top bar and the screen, and Liquid Glass only on the top bar's controls. Interface text
// is the system font in four sizes (11, 13, 15, 22 pt); Folevi's own fonts (Instrument Sans, Spectral) stay for
// note content only: note titles and text, note cards, the editor. Colours are the system's semantic ones plus
// Folevi's black-and-white accent.
//
// Every metric the frame, the Settings window, the menus and the screens use comes from here, so nothing restates
// a number. macOS only: the iPad's wide layout keeps the web's look until the owner decides (2026-11-18).
#if os(macOS)
import AppKit
import FoleviDesign
import SwiftUI

public enum MacLook {
    // MARK: Window
    //
    // The owner's layout (2026-11-18, after the HIG pass): the window's top strip is the title bar and holds the
    // traffic lights, the sidebar's button and Folevi's tabs; under it the sidebar on the window's material, the
    // content card, and on a note the inspector on the material at the right. The card's own controls float in
    // Liquid Glass at its top, with no bar behind them.

    /// The title bar strip at the window's top: the traffic lights, the sidebar's button, the tabs, the bell.
    public static let titleBarHeight: CGFloat = 52
    /// Where the traffic lights' first button starts (they're centred on the strip).
    public static let trafficLightsX: CGFloat = 18
    /// The traffic lights' room in the strip, the sidebar's button after it.
    public static let trafficLightsRoom: CGFloat = 78
    /// The sidebar's width (under the strip). The sidebar's button, ⌘\ and View > Hide Sidebar hide it; so does
    /// Focus mode on a note.
    public static let sidebarWidth: CGFloat = 240
    /// The content card's margin on its trailing and bottom edges (the sidebar, or the margin when it's hidden, is
    /// its leading edge; the strip its top).
    public static let containerMargin: CGFloat = 8
    public static let containerRadius: CGFloat = 12
    /// Where the sidebar's content starts, under the strip.
    public static let sidebarTop: CGFloat = 2
    /// The sidebar's outer horizontal inset.
    public static let sidebarInset: CGFloat = 12
    /// The smallest window: sidebar, a usable card, and the card's controls without clipping.
    public static let minWindowSize = CGSize(width: 820, height: 520)

    // MARK: The title bar's tabs

    /// A tab: a capsule this tall, an SF Symbol and a 13 pt title.
    public static let tabHeight: CGFloat = 28
    /// A tab's width: its own up to `tabMaxWidth`, shrinking to `tabMinWidth` before the strip scrolls (Home and
    /// pinned tabs are their icon's width).
    public static let tabMinWidth: CGFloat = 90
    public static let tabMaxWidth: CGFloat = 180

    // MARK: The card's floating controls (Liquid Glass, no bar behind them)

    /// The controls' inset from the card's top and sides.
    public static let barPaddingTop: CGFloat = 12
    public static let barPaddingSides: CGFloat = 12
    public static let barPaddingBottom: CGFloat = 12
    /// Every card control is a circle or a capsule this tall.
    public static let barControlHeight: CGFloat = 36
    /// The gap between controls.
    public static let barSpacing: CGFloat = 8
    /// A screen's title with no control before it: inset from the controls' leading edge so that it starts where
    /// the screens' content does (34 pt from the card's edge).
    public static let titleInset: CGFloat = 22
    /// The room the controls take at the card's top: screens and the note page leave this much space (their top
    /// inset) and run on under the controls.
    public static var barHeight: CGFloat { barPaddingTop + barControlHeight + barPaddingBottom }
    /// The inset of a selected capsule inside its capsule track (selectedHeight = trackHeight - 2 * inset).
    public static let capsuleInset: CGFloat = 3

    // MARK: Sidebar rows (the compact scale; Settings' category list reuses it)

    // The owner asked for more breathing room in the sidebar (2026-11-18): rows 32 pt tall with 2 pt between
    // them (macOS 26's own sidebars grew the same way), a larger symbol slot, wider gaps between sections.

    /// A row's own height: its hover and selection fill.
    public static let rowHeight: CGFloat = 32
    /// The air between two rows' fills (half above, half below each row).
    public static let rowGap: CGFloat = 2
    /// From one row's top to the next row's.
    public static var rowPitch: CGFloat { rowHeight + rowGap }
    public static let rowRadius: CGFloat = 8
    /// A row's content inset from its fill's leading and trailing edges.
    public static let rowPadding: CGFloat = 10
    public static let rowSymbolSize: CGFloat = 15
    public static let rowIconSlot: CGFloat = 20
    public static let rowIconGap: CGFloat = 8
    /// One indentation step per hierarchy level (folders inside folders).
    public static let rowIndent: CGFloat = 16
    /// The air above a sidebar section's heading, and under it before its first row.
    public static let sectionGap: CGFloat = 22
    public static let headingGap: CGFloat = 6

    // MARK: Panels

    /// A side panel's corners (a flat fill, no glass, no shadow).
    public static let panelRadius: CGFloat = 18
    /// The gutter between the card's content and a side panel, and the panel's inset from the card's edges.
    public static let panelGutter: CGFloat = 10
    /// The note's inspector: a column on the window's material at the right, under the strip (the page's own
    /// panel takes the same column while it's open).
    public static let inspectorWidth: CGFloat = 272
    /// The least room the content keeps beside the inspector: in a narrower card the inspector steps aside until
    /// the window is wider again (the page never runs under it).
    public static let inspectorMinContent: CGFloat = 440

    /// A horizontal overflow fade at a scroll view's edge (only while content continues past that edge).
    public static let edgeFadeWidth: CGFloat = 24

    // MARK: Controls in the content (push buttons, pop-up buttons, text fields, segmented choices)

    /// The one size of the system's controls in the card's screens, the Settings window, sheets and popovers.
    public static let controlSize = ControlSize.large
    /// That size's height: a push button, a field, a pop-up button. Folevi's own drawn buttons (the one prominent
    /// action) match it.
    public static let controlHeight: CGFloat = 28
    /// A compact control's height, for an action inside a row.
    public static let compactControlHeight: CGFloat = 24
    /// An icon-only button's hit area and its symbol's size, everywhere outside the card's glass controls.
    public static let iconButton: CGFloat = 28
    public static let iconButtonSymbol: CGFloat = 15

    // MARK: Spacing scale

    public enum Space {
        public static let xs: CGFloat = 4
        public static let s: CGFloat = 8
        public static let m: CGFloat = 12
        public static let l: CGFloat = 16
        public static let xl: CGFloat = 24
        public static let xxl: CGFloat = 32
    }

    // MARK: Type: the system font in four sizes, for every piece of interface text

    public enum Text {
        /// 11 pt: secondary text, captions, sidebar and form section headings.
        public static let small = Font.subheadline
        public static let smallStrong = Font.subheadline.weight(.semibold)
        /// 13 pt: almost everything.
        public static let body = Font.body
        public static let headline = Font.headline
        /// 15 pt: section and page titles.
        public static let title3 = Font.title3
        public static let title3Strong = Font.title3.weight(.semibold)
        /// 22 pt: large numbers and hero text, rarely.
        public static let title = Font.title
        public static let titleStrong = Font.title.weight(.semibold)

        /// The four styles' point sizes on macOS, for text laid out by size (the shared web components under
        /// NativeChrome).
        public enum Size {
            public static let small: CGFloat = 11
            public static let body: CGFloat = 13
            public static let title3: CGFloat = 15
            public static let title: CGFloat = 22
        }
    }

    // MARK: Colour roles (views never use literals)

    public enum Colors {
        public static let window = Color(nsColor: .windowBackgroundColor)
        /// The content card and cards in it.
        public static let container = Color(nsColor: .controlBackgroundColor)
        public static let separator = Color(nsColor: .separatorColor)
        public static let label = Color(nsColor: .labelColor)
        public static let secondary = Color(nsColor: .secondaryLabelColor)
        public static let tertiary = Color(nsColor: .tertiaryLabelColor)
        /// Hover fills and capsule tracks.
        public static let hover = Color(nsColor: .quaternaryLabelColor)
        /// A selected sidebar or list row (neutral, as Folevi's selection is black and white).
        public static let selection = Color(nsColor: .quaternaryLabelColor)
        /// A raised selection inside a track (the selected segment): white in light, a lighter grey in dark. Never
        /// the card's own dark fill there, which reads as a hole in the track.
        public static let raised = Color(nsColor: NSColor(name: "FoleviRaised") { $0.isDark ? NSColor(white: 1, alpha: 0.16) : .white })
        /// A side panel's flat fill.
        public static let panel = Color(nsColor: .quaternaryLabelColor).opacity(0.6)
        /// Folevi's accent: near black in light, near white in dark (the web's neutral chrome, tokens.css).
        public static let accent = Color(nsColor: MacLook.accent)
        /// Text and symbols on the accent.
        public static let onAccent = Color(nsColor: MacLook.onAccent)
        public static let green = Color(nsColor: .systemGreen)
        public static let orange = Color(nsColor: .systemOrange)
        public static let red = Color(nsColor: .systemRed)
    }

    /// Folevi's accent (packages/design-tokens, `.ui-neutral-chrome`: #1F1F22 light, #F2F2F3 dark).
    public static let accent = NSColor(name: "FoleviAccent") { appearance in
        appearance.isDark ? NSColor(srgbRed: 0xF2 / 255, green: 0xF2 / 255, blue: 0xF3 / 255, alpha: 1)
            : NSColor(srgbRed: 0x1F / 255, green: 0x1F / 255, blue: 0x22 / 255, alpha: 1)
    }

    /// Ink on the accent (#FFFFFF light, #101011 dark).
    public static let onAccent = NSColor(name: "FoleviOnAccent") { appearance in
        appearance.isDark ? NSColor(srgbRed: 0x10 / 255, green: 0x10 / 255, blue: 0x11 / 255, alpha: 1) : .white
    }

    // MARK: The screens' native chrome

    /// What the shared web components (FoleviDesign) draw natively inside the card's screens and their dialogs:
    /// interface text in the four sizes, the accent for the one prominent action, the hover fill.
    public static let chrome = NativeChrome(title: Text.Size.title, title3: Text.Size.title3, body: Text.Size.body, small: Text.Size.small,
                                            accent: Colors.accent, onAccent: Colors.onAccent, hover: Colors.hover)

    // MARK: Motion

    /// Restrained, prompt transitions; Reduce Motion gets none (state still changes).
    public static func animation(_ reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .smooth(duration: 0.18)
    }
}

extension NSAppearance {
    var isDark: Bool { bestMatch(from: [.aqua, .darkAqua]) == .darkAqua }
}

// MARK: - Which look FoleviMac's SwiftUI draws

extension EnvironmentValues {
    /// The native look (true on the Mac). False where FoleviMac's SwiftUI stands for the iPad's wide layout or the
    /// iPhone's (the tests that picture those layouts on the Mac): they keep the web's look until the owner decides.
    @Entry public var macNativeLook = true
    /// The room the card's floating controls take at its top (FrameModel.barHeight), for a screen's own views that
    /// reach up under them.
    @Entry public var macBarRoom: CGFloat = MacLook.barHeight
}

public extension View {
    /// The screens' native chrome (MacLook.chrome) for everything inside, unless this draws the iPad's or iPhone's
    /// layout (`macNativeLook` false).
    func macNativeChrome() -> some View { modifier(MacNativeChromeModifier()) }
}

struct MacNativeChromeModifier: ViewModifier {
    @Environment(\.macNativeLook) private var native
    func body(content: Content) -> some View {
        content
            .environment(\.nativeChrome, native ? MacLook.chrome : nil)
            // One control size across the app (the owner, 2026-11-18: no small buttons, one size and weight): the
            // system's large controls, 28 pt push buttons, pop-up buttons and fields with 13 pt labels. A control
            // that must be smaller says so itself (a spinner inside a button, a row's inline action).
            .controlSize(native ? MacLook.controlSize : .regular)
    }
}

// MARK: - The window's translucent material (behind the sidebar and the card's margins)

/// The frame's surface: the sidebar material, behind the window, following the window's active state.
public final class WindowMaterialView: NSVisualEffectView {
    public override init(frame: NSRect) {
        super.init(frame: frame)
        material = .sidebar
        blendingMode = .behindWindow
        state = .followsWindowActiveState
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }
}

/// The same material for SwiftUI windows and surfaces.
public struct WindowMaterial: NSViewRepresentable {
    public init() {}
    public func makeNSView(context: Context) -> WindowMaterialView { WindowMaterialView(frame: .zero) }
    public func updateNSView(_ view: WindowMaterialView, context: Context) {}
}
#endif
