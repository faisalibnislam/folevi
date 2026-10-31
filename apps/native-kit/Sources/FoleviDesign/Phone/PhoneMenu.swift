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
    public var id: String { item.id }

    public init(_ item: WebMenuItem, action: @escaping @MainActor () -> Void = {}) {
        self.item = item
        self.action = action
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

    public init() {}

    public func show(_ entries: [PhoneMenuEntry], from anchor: CGRect, side: PhoneMenuSide = .bottom, align: PhoneMenuAlign = .start, minWidth: CGFloat = 224) {
        open = Open(entries: entries, anchor: anchor, side: side, align: align, minWidth: minWidth)
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
                    .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
                    .scaleEffect(reduceMotion ? 1 : leaving ? 0.9 : grown ? 1 : 0.5, anchor: spot.anchorPoint)
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
                    if reduceMotion {
                        withAnimation(.linear(duration: 0.15)) { grown = true }
                    } else {
                        withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) { grown = true }
                    }
                }
            } else if shown != nil {
                let gone = shown?.id
                withAnimation(reduceMotion ? .linear(duration: 0.15) : .easeIn(duration: 0.16)) { leaving = true } completion: {
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
