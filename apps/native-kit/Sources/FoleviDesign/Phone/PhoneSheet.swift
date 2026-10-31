// The iPhone's sheets, as the web draws them (apps/web/src/components/iphone/Sheet.tsx) on iOS's own sheet: the
// web's sheet copies UIKit's (a panel from the bottom on a spring, dragged 1:1, detents, the screen behind dimmed),
// so natively the system's sheet does the moving and this draws what the web draws on it: the solid surface, the
// grabber, the 56 pt header with its round buttons and centred title, and the web's detents (medium a little over
// half the screen, or fitted to whole sections; large under the status bar; a fitted sheet as tall as its content).
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public enum PhoneSheetSize: Sendable {
    /// As tall as its content (a short form, a few choices).
    case fit
    /// A little over half the screen, dragged (or scrolled) up to large.
    case medium
    /// The screen under the status bar.
    case large
}

public extension PhoneSurface {
    /// --iphone-solid: a sheet's surface (the screen's raised neutral), and solid menus.
    static let solid = ColorPair(light: RGBA(247, 247, 248), dark: RGBA(44, 44, 46))
}

/// SHEET_BUTTON: a round button in a sheet's header (Close, a menu): a 32 pt circle of the ink at 9% in a 44 pt
/// target, the icon in the muted ink; the circle shrinks to 90% while pressed.
public struct PhoneSheetButton<Label: View>: View {
    let label: String
    let action: () -> Void
    let content: Label

    public init(_ label: String, action: @escaping () -> Void, @ViewBuilder content: () -> Label) {
        self.label = label
        self.action = action
        self.content = content()
    }

    public var body: some View {
        Button(action: action) { content }
            .buttonStyle(SheetButtonStyle())
            .accessibilityLabel(label)
    }
}

private struct SheetButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var scheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
            .frame(width: 44, height: 44)
            .background {
                Circle()
                    .fill(FoleviTokens.Chrome.ink.resolve(scheme).color.opacity(0.09))
                    .frame(width: 32, height: 32)
                    .scaleEffect(configuration.isPressed ? 0.9 : 1)
                    .animation(.easeOut(duration: 0.2), value: configuration.isPressed)
            }
            .contentShape(Rectangle())
    }
}

/// The sheet's Close button: an X (15 pt, 2.6 stroke) on the round button.
public struct PhoneSheetClose: View {
    let action: () -> Void

    public init(action: @escaping () -> Void) { self.action = action }

    public var body: some View {
        PhoneSheetButton("Close", action: action) {
            WebIconView(.x, size: 15, strokeWidth: 2.6)
        }
    }
}

/// The grabber: 36 by 5, the ink at 22%, 5 pt from the sheet's top.
public struct PhoneSheetGrabber: View {
    @Environment(\.colorScheme) private var scheme

    public init() {}

    public var body: some View {
        Capsule()
            .fill(FoleviTokens.Chrome.ink.resolve(scheme).color.opacity(0.22))
            .frame(width: 36, height: 5)
            .padding(.top, 5)
            .frame(maxWidth: .infinity, alignment: .top)
            .accessibilityHidden(true)
    }
}

/// The header: 56 pt tall, 6 pt in from the sheet's sides, its two sides as wide as each other (at least 44) so the
/// title stays centred on the sheet, cut short before it reaches them.
public struct PhoneSheetHeader<Leading: View, Trailing: View>: View {
    let title: String?
    let close: (() -> Void)?
    let leading: Leading
    let trailing: Trailing
    @Environment(\.colorScheme) private var scheme
    @State private var side: CGFloat = 44

    public init(title: String?, close: (() -> Void)?, @ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.close = close
        self.leading = leading()
        self.trailing = trailing()
    }

    public var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 0) { leading }
                .fixedSize()
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { side = max(side, $0) }
                .frame(minWidth: side, alignment: .leading)
            Group {
                if let title {
                    Text(title)
                        .webText(.role(.headline, weight: FoleviTokens.FontWeight.semibold))
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                        .accessibilityAddTraits(.isHeader)
                }
            }
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity)
            HStack(spacing: 0) {
                trailing
                if let close { PhoneSheetClose(action: close) }
            }
            .fixedSize()
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { side = max(side, $0) }
            .frame(minWidth: side, alignment: .trailing)
        }
        .padding(.horizontal, 6)
        .frame(height: 56)
    }
}

public extension PhoneSheetHeader where Leading == EmptyView, Trailing == EmptyView {
    init(title: String?, close: (() -> Void)?) {
        self.init(title: title, close: close, leading: { EmptyView() }, trailing: { EmptyView() })
    }
}

/// Marks a block of a medium sheet's content (a grouped section): the medium detent ends just after the last
/// block that fits, not part way through one (the web's `snapMedium`).
public extension View {
    func phoneSheetBlock() -> some View {
        background {
            GeometryReader { g in
                Color.clear.preference(key: PhoneSheetBlocks.self, value: [g.frame(in: .named(PhoneSheetSpace.name)).maxY])
            }
        }
    }
}

/// Where a sheet's blocks end, in the sheet's own space.
struct PhoneSheetBlocks: PreferenceKey {
    static let defaultValue: [CGFloat] = []
    static func reduce(value: inout [CGFloat], nextValue: () -> [CGFloat]) { value += nextValue() }
}

enum PhoneSheetSpace {
    static let name = "phone-sheet"
}

extension EnvironmentValues {
    /// A fitted sheet hears how tall its panel would be with nothing scrolled away (its detent).
    @Entry var phoneSheetNaturalHeight: ((CGFloat) -> Void)?
}

/// What a sheet shows, as Sheet.tsx lays it out: the grabber, the header (when it has a title, buttons or Close),
/// a line under it, then the content, scrolling, with room at its foot for the home indicator, and the footer.
public struct PhoneSheetPanel<Leading: View, Trailing: View, Content: View, Footer: View>: View {
    let title: String?
    let description: String?
    let close: (() -> Void)?
    let leading: Leading
    let trailing: Trailing
    let content: Content
    let footer: Footer
    let hasFooter: Bool
    let scrolls: Bool
    let contentHeight: ((CGFloat) -> Void)?
    @Environment(\.colorScheme) private var scheme
    @Environment(\.phoneSheetNaturalHeight) private var naturalHeight
    /// The panel's height, the scroll view's and its content's: the panel with nothing scrolled away is the first
    /// less the second plus the third.
    @State private var heights = (panel: CGFloat(0), scroller: CGFloat(0), content: CGFloat(0))

    public init(title: String? = nil, description: String? = nil, close: (() -> Void)?, scrolls: Bool = true, contentHeight: ((CGFloat) -> Void)? = nil, @ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing, @ViewBuilder content: () -> Content, @ViewBuilder footer: () -> Footer) {
        self.title = title
        self.description = description
        self.close = close
        self.scrolls = scrolls
        self.contentHeight = contentHeight
        self.leading = leading()
        self.trailing = trailing()
        self.content = content()
        self.footer = footer()
        self.hasFooter = Footer.self != EmptyView.self
    }

    private var hasHeader: Bool {
        title != nil || close != nil || Leading.self != EmptyView.self || Trailing.self != EmptyView.self
    }

    public var body: some View {
        VStack(spacing: 0) {
            if hasHeader {
                PhoneSheetHeader(title: title, close: close, leading: { leading }, trailing: { trailing })
                    .overlay(alignment: .top) { PhoneSheetGrabber() }
            } else {
                PhoneSheetGrabber().frame(height: 20, alignment: .top)
            }
            if let description {
                Text(description)
                    .webText(.role(.subheadline))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
                    .frame(maxWidth: .infinity)
            }
            body(content)
            if hasFooter {
                HStack(spacing: 8) { footer }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 16)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .coordinateSpace(name: PhoneSheetSpace.name)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { heights.panel = $0; report() }
    }

    private func report() {
        guard let naturalHeight, heights.panel > 0 else { return }
        naturalHeight(scrolls ? heights.panel - heights.scroller + heights.content : heights.panel)
    }

    @ViewBuilder
    private func body(_ content: Content) -> some View {
        let inner = VStack(alignment: .leading, spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                contentHeight?($0)
                heights.content = $0
                report()
            }
        if scrolls {
            ScrollView { inner }
                .scrollBounceBehavior(.basedOnSize)
                .scrollContentBackground(.hidden)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { heights.scroller = $0; report() }
        } else {
            inner
        }
    }
}

public extension PhoneSheetPanel where Leading == EmptyView, Trailing == EmptyView, Footer == EmptyView {
    init(title: String? = nil, description: String? = nil, close: (() -> Void)?, scrolls: Bool = true, contentHeight: ((CGFloat) -> Void)? = nil, @ViewBuilder content: () -> Content) {
        self.init(title: title, description: description, close: close, scrolls: scrolls, contentHeight: contentHeight, leading: { EmptyView() }, trailing: { EmptyView() }, content: content, footer: { EmptyView() })
    }
}

/// The web's detents for a screen `screenHeight` tall with the status bar reaching `top` in: large is the screen
/// under the status bar less 10; medium is 56% of the screen (no more than large), or, fitted to blocks, the end of
/// the last block that fits in it plus 14, when that's at least 30% of the screen.
public enum PhoneSheetDetents {
    public static func large(screenHeight: CGFloat, top: CGFloat) -> CGFloat { screenHeight - top - 10 }

    public static func medium(screenHeight: CGFloat, top: CGFloat, blocks: [CGFloat] = []) -> CGFloat {
        let large = large(screenHeight: screenHeight, top: top)
        let medium = min((screenHeight * 0.56).rounded(), large)
        let best = blocks.map { $0 + 14 }.filter { $0 <= medium + 1 }.max() ?? 0
        return best >= screenHeight * 0.3 ? best.rounded() : medium
    }
}

#if os(iOS)
/// Presents `content` in a sheet the web's way (see the file's top). `content` is usually a PhoneSheetPanel.
struct PhoneSheetModifier<Body: View>: ViewModifier {
    @Binding var isPresented: Bool
    let size: PhoneSheetSize
    let snapToBlocks: Bool
    let onDismiss: (() -> Void)?
    let sheet: () -> Body

    func body(content: Content) -> some View {
        content.sheet(isPresented: $isPresented, onDismiss: onDismiss) {
            PhoneSheetHost(size: size, snapToBlocks: snapToBlocks, content: sheet)
        }
    }
}

private struct PhoneSheetHost<Body: View>: View {
    let size: PhoneSheetSize
    let snapToBlocks: Bool
    let content: () -> Body
    @Environment(\.colorScheme) private var scheme
    @State private var fitted: CGFloat = 0
    @State private var blocks: [CGFloat] = []
    @State private var screen = PhoneSheetHost.measureScreen()
    /// A medium sheet's detent: it goes to large when the keyboard comes (Sheet.tsx), as the web's does.
    @State private var detent: PresentationDetent? = {
        #if DEBUG
        // FOLEVI_REBUILD_SHEET_DETENT=large: a medium sheet opens at its large detent (the screen diffs).
        if ProcessInfo.processInfo.environment["FOLEVI_REBUILD_SHEET_DETENT"] == "large" { return .large }
        #endif
        return nil
    }()

    var body: some View {
        content()
            .environment(\.phoneSheetNaturalHeight, size == .fit ? { h in if abs(fitted - h) > 0.5 { fitted = h } } : nil)
            .frame(maxHeight: .infinity, alignment: .top)
            .modifier(Detents(detents: detents, heights: mediumHeights, selection: size == .medium && !snapToBlocks ? $detent : nil))
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
                if size == .medium, !snapToBlocks { detent = .large }
            }
            .presentationDragIndicator(.hidden)
            .presentationCornerRadius(FoleviTokens.Radius.sheet)
            .presentationBackground(PhoneSurface.solid.resolve(scheme).color)
            .presentationContentInteraction(.resizes)
            .onPreferenceChange(PhoneSheetBlocks.self) { ys in
                // Taken as it first lays out, at its top (scrolling moves the blocks, not the detent).
                if snapToBlocks, blocks.isEmpty, !ys.isEmpty { blocks = ys }
            }
    }

    /// A medium sheet's heights: medium (or fitted to its blocks) and the web's large.
    private var mediumHeights: (low: PresentationDetent, high: PresentationDetent)? {
        guard size == .medium else { return nil }
        let large = PhoneSheetDetents.large(screenHeight: screen.height, top: screen.top)
        return (.height(PhoneSheetDetents.medium(screenHeight: screen.height, top: screen.top, blocks: snapToBlocks ? blocks : []) - screen.bottom), .height(large - screen.bottom))
    }

    /// The detents, with the one shown bound when the sheet moves itself (nil: the person's drag only). A medium
    /// sheet's two are heights (the web's large stops 10 pt under the status bar, higher than iOS's `.large`):
    /// `.large` asked for is the higher of them.
    private struct Detents: ViewModifier {
        let detents: Set<PresentationDetent>
        let heights: (low: PresentationDetent, high: PresentationDetent)?
        let selection: Binding<PresentationDetent?>?

        func body(content: Content) -> some View {
            if let selection, let heights {
                content.presentationDetents(detents, selection: Binding(get: {
                    guard let want = selection.wrappedValue else { return heights.low }
                    return want == .large ? heights.high : (detents.contains(want) ? want : heights.low)
                }, set: { selection.wrappedValue = $0 == heights.high ? .large : $0 }))
            } else {
                content.presentationDetents(detents)
            }
        }
    }

    /// (iOS's height detent counts what's above the home indicator; the web's heights run to the screen's foot.)
    private var detents: Set<PresentationDetent> {
        let large = PhoneSheetDetents.large(screenHeight: screen.height, top: screen.top)
        switch size {
        case .fit:
            // (Until the panel has said how tall it is, the medium height: it settles on its own a frame later.)
            let h = fitted > 0 ? fitted : PhoneSheetDetents.medium(screenHeight: screen.height, top: screen.top) - screen.bottom
            return [.height(max(1, min(h, large - screen.bottom)))]
        case .medium:
            let m = mediumHeights!
            return [m.low, m.high]
        case .large:
            return [.large]
        }
    }

    private static func measureScreen() -> (height: CGFloat, top: CGFloat, bottom: CGFloat) {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive } ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
        let h = window?.bounds.height ?? scene?.screen.bounds.height ?? 874
        return (h, window?.safeAreaInsets.top ?? 62, window?.safeAreaInsets.bottom ?? 34)
    }
}

public extension View {
    /// A sheet drawn as the web's (Sheet.tsx) on iOS's own: `size` picks its detents; `snapToBlocks`, for a medium
    /// sheet, ends its medium detent after the last whole block (marked `.phoneSheetBlock()`) that fits.
    func phoneSheet<Content: View>(isPresented: Binding<Bool>, size: PhoneSheetSize = .fit, snapToBlocks: Bool = false, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content) -> some View {
        modifier(PhoneSheetModifier(isPresented: isPresented, size: size, snapToBlocks: snapToBlocks, onDismiss: onDismiss, sheet: content))
    }
}
#endif
