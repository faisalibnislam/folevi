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
import SwiftUI

public enum MacLook {
    // MARK: Window

    /// The sidebar's fixed width. It is always visible; only Focus mode hides it.
    public static let sidebarWidth: CGFloat = 228
    /// The content card's margin on its top, trailing and bottom edges (the sidebar is its leading edge).
    public static let containerMargin: CGFloat = 12
    public static let containerRadius: CGFloat = 12
    /// Where the sidebar's content starts, under the traffic lights.
    public static let sidebarTop: CGFloat = 46
    /// The sidebar's outer horizontal inset.
    public static let sidebarInset: CGFloat = 12
    /// The smallest window: sidebar, a usable card, and the top bar's essential controls without clipping.
    public static let minWindowSize = CGSize(width: 820, height: 520)
    /// The strip above the card while the sidebar is hidden (Focus mode): the traffic lights' room, and where the
    /// window is dragged from (the guide's no-sidebar profile).
    public static let titlebarStrip: CGFloat = 28

    // MARK: Top bar (drawn inside the card, first thing in it)

    public static let barPaddingTop: CGFloat = 14
    public static let barPaddingSides: CGFloat = 14
    public static let barPaddingBottom: CGFloat = 10
    /// Every top bar control is a capsule this tall.
    public static let barControlHeight: CGFloat = 36
    /// The gap between top bar groups.
    public static let barSpacing: CGFloat = 10
    /// The room the bar takes at the card's top: the note page leaves this much space (its top inset).
    public static var barHeight: CGFloat { barPaddingTop + barControlHeight + barPaddingBottom }
    /// The inset of a selected capsule inside its capsule track (selectedHeight = trackHeight - 2 * inset).
    public static let capsuleInset: CGFloat = 3

    // MARK: Sidebar rows (the compact scale; Settings' category list reuses it)

    public static let rowHeight: CGFloat = 28
    public static let rowRadius: CGFloat = 8
    public static let rowSymbolSize: CGFloat = 14
    public static let rowIconSlot: CGFloat = 18
    public static let rowIconGap: CGFloat = 8
    /// One indentation step per hierarchy level (folders inside folders).
    public static let rowIndent: CGFloat = 14

    // MARK: Panels

    /// A side panel inside the card (the note's inspector): a flat fill with these corners, no glass, no shadow.
    public static let panelRadius: CGFloat = 18
    /// The gutter between the card's content and a side panel, and the panel's inset from the card's edges.
    public static let panelGutter: CGFloat = 10
    public static let inspectorWidth: CGFloat = 272
    /// The least room the content keeps beside the inspector: in a narrower card the inspector steps aside until
    /// the window is wider again (the page never runs under it).
    public static let inspectorMinContent: CGFloat = 440

    /// A horizontal overflow fade at a scroll view's edge (only while content continues past that edge).
    public static let edgeFadeWidth: CGFloat = 20

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

    // MARK: Motion

    /// Restrained, prompt transitions; Reduce Motion gets none (state still changes).
    public static func animation(_ reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .smooth(duration: 0.18)
    }
}

extension NSAppearance {
    var isDark: Bool { bestMatch(from: [.aqua, .darkAqua]) == .darkAqua }
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
