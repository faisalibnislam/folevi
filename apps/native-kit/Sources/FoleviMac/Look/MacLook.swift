// Folevi for Mac's native look (owner decision 2026-11-18, docs/MAC_NATIVE_LOOK.md). The window profile from the
// owner's Mac UI guide: a translucent frame and sidebar (one continuous surface, no divider), one opaque rounded
// content card holding the top bar and the screen, and Liquid Glass only on the top bar's controls. Interface text
// is the system font in four sizes (11, 13, 15, 22 pt); Folevi's own fonts (Instrument Sans, Spectral) stay for
// note content only: note titles and text, note cards, the editor. Colours are the system's semantic ones plus
// Folevi's black-and-white accent.
//
// Every metric the frame, the Settings window, the menus and the screens use comes from here, so nothing restates
// a number.
//
// The iPad's wide layout has the same look (the owner, 2026-11-19: "the same layout as the Mac", with iPadOS 26
// controls and touch sizes): one source of numbers, each the Mac's or the iPad's (`pick`). The iPad's are a finger's
// (44 pt targets: rows, the strip's buttons, the card's controls) and iPadOS's text styles (the same roles, iOS's
// sizes: 13, 17, 20, 28); pointer hover stays for a trackpad. The iPhone never draws these (`macNativeLook` is false
// outside the iPad's frame).
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import FoleviDesign
import SwiftUI

public enum MacLook {
    /// The Mac's value, or the iPad's.
    @inline(__always) static func pick<T>(_ mac: T, _ pad: T) -> T {
        #if os(macOS)
        mac
        #else
        pad
        #endif
    }

    // MARK: Window
    //
    // The owner's layout (2026-11-18, after the HIG pass): the window's top strip is the title bar and holds the
    // traffic lights, the sidebar's button and Folevi's tabs; under it the sidebar on the window's material, the
    // content card, and on a note the inspector on the material at the right. The card's own controls float in
    // Liquid Glass at its top, with no bar behind them.

    /// The title bar strip at the window's top: the traffic lights, the sidebar's button, the tabs, the bell.
    public static let titleBarHeight: CGFloat = pick(52, 56)
    /// Where the traffic lights' first button starts (they're centred on the strip).
    public static let trafficLightsX: CGFloat = pick(18, 0)
    /// The traffic lights' room in the strip, the sidebar's button after it.
    public static let trafficLightsRoom: CGFloat = pick(78, 4)
    /// The sidebar's width (under the strip), the same as the page's tools column at the right (inspectorWidth: the
    /// owner, 2026-11-18). The sidebar's button, ⌘\ and View > Hide Sidebar hide it; so does Focus mode on a note.
    public static let sidebarWidth: CGFloat = pick(288, 300)
    /// The content card's margin on its trailing and bottom edges (the sidebar, or the margin when it's hidden, is
    /// its leading edge; the strip its top).
    public static let containerMargin: CGFloat = 8
    public static let containerRadius: CGFloat = pick(12, 18)
    /// Where the sidebar's content starts, under the strip.
    public static let sidebarTop: CGFloat = pick(2, 4)
    /// The sidebar's outer horizontal inset.
    public static let sidebarInset: CGFloat = 12
    /// The smallest window: sidebar, a usable card, and the card's controls without clipping.
    public static let minWindowSize = CGSize(width: 820, height: 520)

    // MARK: The title bar's tabs

    /// A tab: a capsule this tall, an SF Symbol and a 13 pt title.
    public static let tabHeight: CGFloat = pick(28, 36)
    /// A tab's width: its own up to `tabMaxWidth`, shrinking to `tabMinWidth` before the strip scrolls (Home and
    /// pinned tabs are their icon's width).
    public static let tabMinWidth: CGFloat = pick(90, 110)
    public static let tabMaxWidth: CGFloat = pick(180, 220)

    // MARK: The card's floating controls (Liquid Glass, no bar behind them)

    /// The controls' inset from the card's top and sides.
    public static let barPaddingTop: CGFloat = 12
    public static let barPaddingSides: CGFloat = 12
    public static let barPaddingBottom: CGFloat = 12
    /// Every card control is a circle or a capsule this tall.
    public static let barControlHeight: CGFloat = pick(36, 44)
    /// The gap between controls.
    public static let barSpacing: CGFloat = 8
    /// A screen's title: inset from the controls' leading edge so that it starts where the screens' content does
    /// (34 pt from the card's edge).
    public static let titleInset: CGFloat = pick(22, 20)
    /// The gap over a note's sheet: nothing floats over a note, so it is the sheet's least gap at its sides (the
    /// page's px-3), whatever the window's width.
    public static let notePageTop: CGFloat = 12
    /// The room the controls take at the card's top: screens and the note page leave this much space (their top
    /// inset) and run on under the controls.
    public static var barHeight: CGFloat { barPaddingTop + barControlHeight + barPaddingBottom }
    /// The inset of a selected capsule inside its capsule track (selectedHeight = trackHeight - 2 * inset).
    public static let capsuleInset: CGFloat = pick(3, 4)
    /// How much of the web's own drawn shadows the native look keeps (FoleviDesign's `nativeShadowScale`).
    public static let webShadowScale: Double = 0.5
    /// A segmented control's track, everywhere (the owner, 2026-11-18: "settle on one design", the pill): the title
    /// bar's tab track's height, a 28 pt pill inside it. The note page's own segmented controls match it in CSS
    /// (`:root[data-mac-native] .ui-seg`).
    public static var segmentHeight: CGFloat { tabHeight + capsuleInset * 2 }

    // MARK: Sidebar rows (the compact scale; Settings' category list reuses it)

    // The owner asked for more breathing room in the sidebar (2026-11-18): rows 32 pt tall with 2 pt between
    // them (macOS 26's own sidebars grew the same way), a larger symbol slot, wider gaps between sections.

    /// A row's own height: its hover and selection fill.
    public static let rowHeight: CGFloat = pick(32, 44)
    /// The air between two rows' fills (half above, half below each row).
    public static let rowGap: CGFloat = 2
    /// From one row's top to the next row's.
    public static var rowPitch: CGFloat { rowHeight + rowGap }
    public static let rowRadius: CGFloat = 8
    /// A row's content inset from its fill's leading and trailing edges.
    public static let rowPadding: CGFloat = pick(10, 12)
    public static let rowSymbolSize: CGFloat = pick(15, 19)
    public static let rowIconSlot: CGFloat = pick(20, 26)
    public static let rowIconGap: CGFloat = pick(8, 12)
    /// One indentation step per hierarchy level (folders inside folders).
    public static let rowIndent: CGFloat = pick(16, 20)
    /// The air above a sidebar section's heading, and under it before its first row.
    public static let sectionGap: CGFloat = pick(22, 24)
    public static let headingGap: CGFloat = 6
    /// A section heading's row (its hover fill): a row's height.
    public static let headingHeight: CGFloat = pick(28, 36)

    // MARK: Panels

    /// A side panel's corners (a flat fill, no glass, no shadow).
    public static let panelRadius: CGFloat = 18
    /// The gutter between the card's content and a side panel, and the panel's inset from the card's edges.
    public static let panelGutter: CGFloat = 10
    /// The page's own tools column at the right (Foli AI, Insert, Format, Style), under the strip: as wide as the
    /// sidebar, its 8 pt gap and the page's 280 px panel (globals.css).
    public static let inspectorWidth: CGFloat = pick(288, 300)
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
    public static let controlHeight: CGFloat = pick(28, 44)
    /// A compact control's height, for an action inside a row.
    public static let compactControlHeight: CGFloat = pick(24, 32)
    /// A button in the title bar strip (a symbol in a capsule): its width, its height `iconButton`.
    public static let stripButtonWidth: CGFloat = pick(32, 44)
    /// An icon-only button's hit area and its symbol's size, everywhere outside the card's glass controls.
    public static let iconButton: CGFloat = pick(28, 44)
    public static let iconButtonSymbol: CGFloat = pick(15, 19)

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
        /// 11 pt (iPad 13): secondary text, captions, sidebar and form section headings.
        public static let small = pick(Font.subheadline, Font.footnote)
        public static let smallStrong = small.weight(.semibold)
        /// 13 pt (iPad 17): almost everything.
        public static let body = Font.body
        public static let headline = Font.headline
        /// 15 pt (iPad 20): section and page titles.
        public static let title3 = Font.title3
        public static let title3Strong = Font.title3.weight(.semibold)
        /// 22 pt (iPad 28): large numbers and hero text, rarely.
        public static let title = Font.title
        public static let titleStrong = Font.title.weight(.semibold)
        /// A tab's title in the strip: the body size on the Mac, iPadOS's subheadline (15) on the iPad, so a strip of
        /// tabs keeps its titles.
        public static let tab = pick(Font.body, Font.subheadline)

        /// The four styles' point sizes, for text laid out by size (the shared web components under NativeChrome).
        public enum Size {
            public static let small: CGFloat = pick(11, 13)
            public static let body: CGFloat = pick(13, 17)
            public static let title3: CGFloat = pick(15, 20)
            public static let title: CGFloat = pick(22, 28)
        }
    }

    // MARK: Colour roles (views never use literals)

    public enum Colors {
        #if os(macOS)
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
        /// A capsule track's fill on the window's material (the title bar's tab track, its round buttons).
        public static let track = Color(nsColor: .quaternaryLabelColor).opacity(0.7)
        /// A side panel's flat fill.
        public static let panel = Color(nsColor: .quaternaryLabelColor).opacity(0.6)
        public static let green = Color(nsColor: .systemGreen)
        public static let orange = Color(nsColor: .systemOrange)
        public static let red = Color(nsColor: .systemRed)
        #else
        // The iPad: the Mac's roles in the Mac's neutral values (iOS's own label colours lean blue; Folevi's chrome
        // is black and white). The frame is a solid grey: an iPad window has nothing behind it to blur.
        public static let window = MacLook.color(MacLook.dynamic(light: UIColor(white: 0.925, alpha: 1), dark: UIColor(white: 0.165, alpha: 1)))
        /// The content card and cards in it.
        public static let container = MacLook.color(MacLook.dynamic(light: .white, dark: UIColor(white: 0.118, alpha: 1)))
        public static let separator = MacLook.color(MacLook.dynamic(light: UIColor(white: 0, alpha: 0.12), dark: UIColor(white: 1, alpha: 0.14)))
        public static let label = MacLook.color(MacLook.dynamic(light: UIColor(white: 0, alpha: 0.88), dark: UIColor(white: 1, alpha: 0.9)))
        public static let secondary = MacLook.color(MacLook.dynamic(light: UIColor(white: 0, alpha: 0.55), dark: UIColor(white: 1, alpha: 0.58)))
        public static let tertiary = MacLook.color(MacLook.dynamic(light: UIColor(white: 0, alpha: 0.28), dark: UIColor(white: 1, alpha: 0.28)))
        /// Hover fills and capsule tracks.
        public static let hover = MacLook.color(MacLook.dynamic(light: UIColor(white: 0, alpha: 0.08), dark: UIColor(white: 1, alpha: 0.1)))
        /// A selected sidebar or list row (neutral, as Folevi's selection is black and white).
        public static let selection = MacLook.color(MacLook.dynamic(light: UIColor(white: 0, alpha: 0.08), dark: UIColor(white: 1, alpha: 0.1)))
        /// A capsule track's fill on the frame (the strip's tab track, its round buttons).
        public static let track = MacLook.color(MacLook.dynamic(light: UIColor(white: 0, alpha: 0.06), dark: UIColor(white: 1, alpha: 0.08)))
        /// A side panel's flat fill.
        public static let panel = MacLook.color(MacLook.dynamic(light: UIColor(white: 0, alpha: 0.05), dark: UIColor(white: 1, alpha: 0.06)))
        public static let green = Color(uiColor: .systemGreen)
        public static let orange = Color(uiColor: .systemOrange)
        public static let red = Color(uiColor: .systemRed)
        #endif
        /// A raised selection inside a track (the selected segment): white in light, a lighter grey in dark. Never
        /// the card's own dark fill there, which reads as a hole in the track.
        public static let raised = MacLook.color(MacLook.dynamic(name: "FoleviRaised", light: .white, dark: NSColor(white: 1, alpha: 0.16)))
        /// Folevi's accent: near black in light, near white in dark (the web's neutral chrome, tokens.css).
        public static let accent = MacLook.color(MacLook.accent)
        /// Text and symbols on the accent.
        public static let onAccent = MacLook.color(MacLook.onAccent)
    }

    /// A colour for light and dark (an AppKit or UIKit colour that follows the appearance).
    static func dynamic(name: String = "", light: NSColor, dark: NSColor) -> NSColor {
        #if os(macOS)
        NSColor(name: name.isEmpty ? nil : name) { $0.isDark ? dark : light }
        #else
        UIColor { $0.userInterfaceStyle == .dark ? dark : light }
        #endif
    }

    /// SwiftUI's colour for a platform colour.
    static func color(_ c: NSColor) -> Color {
        #if os(macOS)
        Color(nsColor: c)
        #else
        Color(uiColor: c)
        #endif
    }

    /// An sRGB colour from its 8-bit channels.
    static func rgb(_ r: Int, _ g: Int, _ b: Int) -> NSColor {
        #if os(macOS)
        NSColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
        #else
        UIColor(red: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
        #endif
    }

    /// Folevi's accent (packages/design-tokens, `.ui-neutral-chrome`: #1F1F22 light, #F2F2F3 dark).
    public static let accent = dynamic(name: "FoleviAccent", light: rgb(0x1F, 0x1F, 0x22), dark: rgb(0xF2, 0xF2, 0xF3))

    /// Ink on the accent (#FFFFFF light, #101011 dark).
    public static let onAccent = dynamic(name: "FoleviOnAccent", light: .white, dark: rgb(0x10, 0x10, 0x11))

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

#if os(macOS)
extension NSAppearance {
    var isDark: Bool { bestMatch(from: [.aqua, .darkAqua]) == .darkAqua }
}
#endif

// MARK: - Which look FoleviMac's SwiftUI draws

#if os(iOS)
extension MacLook {
    /// Whether the iPad's wide layout is on screen (IPadFrameView sets it while it shows). A layer the frame presents
    /// over the window (a dialog, a popover, a menu, the account menu) has a hosting view of its own and doesn't
    /// inherit the frame's environment: it takes the look from here (`presentedLook`). Never set on an iPhone.
    /// (Set and read on the main thread only; nonisolated so value helpers can read it.)
    nonisolated(unsafe) public static var padWide = false
}
#endif

public extension View {
    /// A layer presented in a hosting view of its own (a dialog, a popover, a menu): the look of the frame that
    /// presents it. On the Mac the default (native); on iOS the iPad's wide layout's while it shows.
    @ViewBuilder func presentedLook() -> some View {
        #if os(iOS)
        environment(\.macNativeLook, MacLook.padWide)
        #else
        self
        #endif
    }
}

extension EnvironmentValues {
    /// The native look: true on the Mac, and in the iPad's wide layout (IPadFrameView sets it, the owner,
    /// 2026-11-19). False everywhere else on iOS (the iPhone's screens that borrow FoleviMac's, DeskScreen), and
    /// where a test pictures the web-matched layout on the Mac.
    @Entry public var macNativeLook = MacLook.pick(true, false)
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
        #if os(iOS)
        // (The iPhone's screens that borrow FoleviMac's: untouched, as before the iPad took the native look.)
        if native { chrome(content) } else { content }
        #else
        chrome(content)
        #endif
    }

    private func chrome(_ content: Content) -> some View {
        content
            .environment(\.nativeChrome, native ? MacLook.chrome : nil)
            // Half of the web's drawn shadows (a note card's lift, a dialog's drop): the owner, 2026-11-18, "less
            // shadows ... looks better on the Mac app".
            .environment(\.nativeShadowScale, native ? MacLook.webShadowScale : 1)
            // One control size across the app (the owner, 2026-11-18: no small buttons, one size and weight): the
            // system's large controls, 28 pt push buttons, pop-up buttons and fields with 13 pt labels. A control
            // that must be smaller says so itself (a spinner inside a button, a row's inline action).
            .controlSize(native ? MacLook.controlSize : .regular)
    }
}

// MARK: - The window's translucent material (behind the sidebar and the card's margins)

#if os(macOS)
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
#else
/// The iPad's frame surface: the window's grey (an iPad window has nothing behind it to blur, so the Mac's
/// translucent sidebar material is its solid colour here, and costs nothing while the screens scroll).
public struct WindowMaterial: View {
    public init() {}
    public var body: some View { MacLook.Colors.window }
}
#endif
#endif
