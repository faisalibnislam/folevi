// Folevi's menus on the iPhone (apps/web/src/components/ui/Menu.tsx as the app shows it): the web's menu panel,
// drawn the iOS way (WebMenuPanel), 8 pt from what opened it, above or below whichever has room, kept 8 pt inside
// the screen and under the status bar. It grows out of what opened it on the menu spring (scale 0.5 to 1, quickly
// opaque); picked or dismissed, it shrinks to 0.9 and fades over 160 ms while the choice goes ahead. A tap anywhere
// else closes it.
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import Observation

/// What a menu row does when picked.
public struct PhoneMenuEntry: Identifiable {
    public var item: WebMenuItem
    public var action: @MainActor () -> Void
    /// A submenu (the native menu's nested menu: a folder's colours).
    public var children: [PhoneMenuEntry]?
    public var id: String { item.id }

    public init(_ item: WebMenuItem, action: @escaping @MainActor () -> Void = {}) {
        self.item = item
        self.action = action
    }

    /// A row that opens a submenu of `children`.
    public init(_ item: WebMenuItem, children: [PhoneMenuEntry]) {
        self.item = item
        self.action = {}
        self.children = children
    }
}

public enum PhoneMenuSide: Sendable { case top, bottom }
public enum PhoneMenuAlign: Sendable { case start, end }

/// The menu on show, if any (one at a time), and where it opened from (in the screen's coordinates).
@MainActor @Observable
public final class PhoneMenus {
    public struct Open: Identifiable {
        public let id = UUID()
        public var entries: [PhoneMenuEntry]
        public var anchor: CGRect
        public var side: PhoneMenuSide
        public var align: PhoneMenuAlign
        public var minWidth: CGFloat
    }

    public private(set) var open: Open?
    /// While a native menu asks what it holds (`entries(_:)`): `show` hands its rows here instead of showing them.
    @ObservationIgnored private var capturing: [PhoneMenuEntry]?

    public init() {}

    public func show(_ entries: [PhoneMenuEntry], from anchor: CGRect, side: PhoneMenuSide = .bottom, align: PhoneMenuAlign = .start, minWidth: CGFloat = 224) {
        if capturing != nil {
            capturing = entries
            return
        }
        open = Open(entries: entries, anchor: anchor, side: side, align: align, minWidth: minWidth)
    }

    /// The rows a menu-building function would show (it calls `show`), for iOS's own menu to hold: the native
    /// look's menus (the owner, 2026-11-19: native menus and context menus with icons) are built by the same code
    /// that built Folevi's drawn ones.
    public func entries(_ build: () -> Void) -> [PhoneMenuEntry] {
        let outer = capturing
        capturing = []
        build()
        let got = capturing ?? []
        capturing = outer
        return got
    }

    public func close() { open = nil }
}

/// Where a menu `size` goes beside `anchor` on a screen `screen` big, with `safeTop` under the status bar and
/// `bottom` the lowest it may reach (above the keyboard): Menu.tsx's placement. Also the corner it grows from.
public enum PhoneMenuPlacement {
    public static func place(size: CGSize, anchor: CGRect, side: PhoneMenuSide, align: PhoneMenuAlign, screen: CGSize, safeTop: CGFloat, bottom: CGFloat? = nil) -> (origin: CGPoint, anchorPoint: UnitPoint) {
        let gap: CGFloat = anchor.width > 0 || anchor.height > 0 ? 8 : 2
        let margin: CGFloat = 8
        let floor = bottom ?? screen.height
        let below = floor - anchor.maxY - gap - margin
        let above = anchor.minY - gap - margin
        let h = size.height
        let up = side == .top ? !(above < h && below > above) : below < h && above > below
        var left = align == .end ? anchor.maxX - size.width : anchor.minX
        left = min(max(margin, left), screen.width - size.width - margin)
        var top = up ? anchor.minY - gap - h : anchor.maxY + gap
        let maxHeight = floor - margin * 2 - safeTop
        top = max(margin + safeTop, min(top, floor - min(h, maxHeight) - margin))
        let point = UnitPoint(x: align == .end ? 1 : 0, y: up ? 1 : 0)
        return (CGPoint(x: left, y: top), point)
    }
}

/// The layer menus show in, over the whole screen (the frame puts it on top of everything).
public struct PhoneMenuLayer: View {
    @Bindable var menus: PhoneMenus
    @State private var shown: PhoneMenus.Open?
    @State private var size: CGSize = .zero
    @State private var grown = false
    @State private var leaving = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme

    public init(menus: PhoneMenus) { self.menus = menus }

    /// The status bar's height: the layer ignores the safe area, so its own insets read 0.
    static var windowTop: CGFloat {
        #if canImport(UIKit)
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.safeAreaInsets.top ?? 0
        #else
        0
        #endif
    }

    public var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                if let open = shown {
                    // A tap anywhere else closes it (and goes no further, as on iOS).
                    Color.black.opacity(0.001)
                        .contentShape(Rectangle())
                        .onTapGesture { menus.close() }
                        .accessibilityHidden(true)
                    // In this layer's own space (the anchor comes in the screen's): the screen's foot and the
                    // status bar measured from where the layer starts.
                    let at = geo.frame(in: .global)
                    let anchor = open.anchor.offsetBy(dx: -at.minX, dy: -at.minY)
                    let spot = PhoneMenuPlacement.place(size: size, anchor: anchor, side: open.side, align: open.align, screen: CGSize(width: geo.size.width, height: geo.size.height + geo.safeAreaInsets.bottom), safeTop: max(0, geo.safeAreaInsets.top, Self.windowTop))
                    WebMenuPanel(open.entries.map(\.item), width: open.minWidth) { item in
                        guard !leaving, let e = open.entries.first(where: { $0.id == item.id }) else { return }
                        menus.close()
                        e.action()
                    }
                    .fixedSize()
                    // In dark mode a half-point light edge, so the panel doesn't melt into the near-black canvas
                    // (IPHONE-25).
                    .overlay {
                        if scheme == .dark {
                            RoundedRectangle(cornerRadius: WebStyles.named("menu.panel").resolve(scheme).radius, style: .circular)
                                .strokeBorder(Color.white.opacity(0.14), lineWidth: 0.5)
                                .allowsHitTesting(false)
                        }
                    }
                    .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
                    .scaleEffect(reduceMotion ? 1 : leaving ? 0.96 : grown ? 1 : 0.5, anchor: spot.anchorPoint)
                    .opacity(leaving ? 0 : grown ? 1 : 0)
                    .offset(x: spot.origin.x, y: spot.origin.y)
                    .opacity(size == .zero ? 0 : 1)
                    .accessibilityAddTraits(.isModal)
                    .accessibilityAction(.escape) { menus.close() }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .ignoresSafeArea()
        .allowsHitTesting(shown != nil && !leaving)
        .onChange(of: menus.open?.id) { _, id in
            if let next = menus.open, id != nil {
                shown = next
                leaving = false
                grown = false
                // (The spring grows it once its size is known, the next frame.)
                DispatchQueue.main.async {
                    withAnimation(reduceMotion ? .linear(duration: 0.15) : FoleviSpring.menu) { grown = true }
                }
            } else if shown != nil {
                let gone = shown?.id
                withAnimation(reduceMotion ? .linear(duration: 0.15) : .easeOut(duration: 0.15)) { leaving = true } completion: {
                    if shown?.id == gone {
                        shown = nil
                        size = .zero
                        leaving = false
                    }
                }
            }
        }
    }
}

// MARK: - The native look's menus

/// A Folevi menu's rows as iOS's own menu: sections between separators (a heading names its section), each row its
/// icon (Folevi's own, as the Mac's menus), label and the quieter line under it, destructive rows in red, a row that
/// can be on with its checkmark, a submenu nested. For `Menu { }` and `.contextMenu { }`.
public struct PhoneMenuItems: View {
    let entries: [PhoneMenuEntry]

    public init(_ entries: [PhoneMenuEntry]) { self.entries = entries }

    /// The rows split into sections at separators and headings.
    private var sections: [(id: Int, title: String?, rows: [PhoneMenuEntry])] {
        var out: [(id: Int, title: String?, rows: [PhoneMenuEntry])] = []
        var title: String?
        var rows: [PhoneMenuEntry] = []
        func flush() {
            if !rows.isEmpty || title != nil { out.append((out.count, title, rows)) }
            title = nil
            rows = []
        }
        for e in entries {
            switch e.item.kind {
            case .separator: flush()
            case .heading:
                flush()
                title = e.item.title
            case .item: rows.append(e)
            }
        }
        flush()
        return out
    }

    public var body: some View {
        let parts = sections
        if parts.count == 1 && parts[0].title == nil {
            ForEach(parts[0].rows) { PhoneMenuRow(entry: $0) }
        } else {
            ForEach(parts, id: \.id) { part in
                if let title = part.title {
                    Section(title) { ForEach(part.rows) { PhoneMenuRow(entry: $0) } }
                } else {
                    Section { ForEach(part.rows) { PhoneMenuRow(entry: $0) } }
                }
            }
        }
    }
}

/// One row of a native menu.
struct PhoneMenuRow: View {
    let entry: PhoneMenuEntry

    var body: some View {
        let item = entry.item
        if let children = entry.children {
            Menu { PhoneMenuItems(children) } label: { label(item) }
                .disabled(item.disabled)
        } else if item.checkable {
            Toggle(isOn: Binding(get: { item.checked }, set: { _ in entry.action() })) { label(item) }
                .disabled(item.disabled)
        } else {
            Button(role: item.danger ? .destructive : nil) { entry.action() } label: { label(item) }
                .disabled(item.disabled)
        }
    }

    @ViewBuilder
    private func label(_ item: WebMenuItem) -> some View {
        Label {
            Text(item.title)
            if let d = item.description ?? item.detail { Text(d) }
        } icon: {
            icon(item)
        }
    }

    @ViewBuilder
    private func icon(_ item: WebMenuItem) -> some View {
        #if canImport(UIKit)
        if item.aiMark {
            Image(uiImage: AiMarkImage.uiImage(size: 18))
        } else if let swatch = item.swatch {
            Image(uiImage: PhoneMenuSwatch.image(UIColor(swatch)))
        } else if let icon = item.icon {
            icon.image(size: 18)
        }
        #else
        if let icon = item.icon { icon.image(size: 18) }
        #endif
    }
}

#if canImport(UIKit)
/// A colour's dot for a menu row (a tag's or a folder's colour).
enum PhoneMenuSwatch {
    static func image(_ color: UIColor) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 18, height: 18)).image { r in
            color.setFill()
            r.cgContext.fillEllipse(in: CGRect(x: 2, y: 2, width: 14, height: 14))
        }.withRenderingMode(.alwaysOriginal)
    }
}
#endif

public extension View {
    /// iOS's own context menu (a long press lifts what was pressed and shows the menu) holding the rows `build`
    /// shows through `menus` (a menu-building function written for Folevi's drawn menus).
    func phoneContextMenu(_ menus: PhoneMenus, enabled: Bool = true, _ build: @escaping () -> Void) -> some View {
        modifier(PhoneContextMenu(menus: menus, enabled: enabled, build: build))
    }
}

private struct PhoneContextMenu: ViewModifier {
    let menus: PhoneMenus
    let enabled: Bool
    let build: () -> Void

    func body(content: Content) -> some View {
        if enabled {
            content.contextMenu { PhoneCapturedMenu(menus: menus, build: build) }
        } else {
            content
        }
    }
}

/// The rows of a menu-building function, asked for when iOS shows the menu (not each time the screen draws).
public struct PhoneCapturedMenu: View {
    let menus: PhoneMenus
    let build: () -> Void

    public init(menus: PhoneMenus, build: @escaping () -> Void) {
        self.menus = menus
        self.build = build
    }

    public var body: some View {
        PhoneMenuItems(menus.entries(build))
    }
}

/// A button that opens iOS's own menu (a screen's "…", a scope chip): its rows from a menu-building function.
public struct PhoneMenuButton<Label: View>: View {
    let menus: PhoneMenus
    let accessibility: String
    let build: () -> Void
    let label: Label

    public init(_ accessibility: String, menus: PhoneMenus, build: @escaping () -> Void, @ViewBuilder label: () -> Label) {
        self.accessibility = accessibility
        self.menus = menus
        self.build = build
        self.label = label()
    }

    public var body: some View {
        Menu { PhoneCapturedMenu(menus: menus, build: build) } label: { label }
            .accessibilityLabel(accessibility)
    }
}

/// A screen's "…" (or any icon button that opens a menu) in its bar: iOS's own menu when the screen has `menus`
/// (the native look), else the glass pill button showing Folevi's menu from where it sits.
public struct PhoneBarMenuButton: View {
    let label: String
    let icon: WebIcon
    let menus: PhoneMenus?
    let show: (CGRect) -> Void
    @State private var frame = PhoneFrameBox()
    @Environment(\.phoneMenus) private var frameMenus

    public init(_ label: String, icon: WebIcon = .ellipsis, menus: PhoneMenus? = nil, show: @escaping (CGRect) -> Void) {
        self.label = label
        self.icon = icon
        self.menus = menus
        self.show = show
    }

    public var body: some View {
        if let menus = menus ?? frameMenus {
            PhoneMenuButton(label, menus: menus, build: { show(.zero) }) {
                WebIconView(icon, size: 22, strokeWidth: 2.2)
            }
        } else {
            WebGlassPill {
                WebPillButton(label, action: { show(frame.rect) }) {
                    WebIconView(icon, size: 24, strokeWidth: 2.2)
                }
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame.rect = $0 }
            }
        }
    }
}
