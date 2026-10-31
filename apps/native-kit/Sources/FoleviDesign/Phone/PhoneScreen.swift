// One screen of the iPhone app's navigation stack, as the web draws it (apps/web/src/components/iphone/Screen.tsx
// and globals.css `.iphone-bar`, `.ui-large-title`, `.iphone-small-title`): a bar over the content (Back or the
// screen's own leading control, the small title once the large one scrolls away, the screen's actions) and the
// content, which scrolls under the bar and the floating tab bar.
import SwiftUI

public struct PhoneScreenOptions {
    public var title: String
    /// A large title at the top of the content, or only the small one in the bar (a note).
    public var large = true
    /// A small caption above the large title (the workspace you're in, on Home).
    public var eyebrow: String?
    /// A line under the large title ("Today · Friday").
    public var subtitle: String?
    /// Shown in the bar's middle instead of the small title, all the time ("2 selected").
    public var status: String?
    /// The grey of grouped lists behind the content (Settings).
    public var grouped = false
    /// How far the content scrolls before the small title shows (defaults to the large title's foot).
    public var collapseAt: CGFloat?
    /// A colour washed faintly over the screen and its bar (a folder's: `.ui-view-tint`, 10%, 16% in dark).
    public var tint: RGBA?
    /// Where the content starts scrolled to (Debug: FOLEVI_REBUILD_SCROLL, for comparing a screen's lower part).
    public var startOffset: CGFloat?

    public init(title: String, large: Bool = true, eyebrow: String? = nil, subtitle: String? = nil, status: String? = nil, grouped: Bool = false, collapseAt: CGFloat? = nil) {
        self.title = title
        self.large = large
        self.eyebrow = eyebrow
        self.subtitle = subtitle
        self.status = status
        self.grouped = grouped
        self.collapseAt = collapseAt
        #if DEBUG
        startOffset = ProcessInfo.processInfo.environment["FOLEVI_REBUILD_SCROLL"].flatMap(Double.init).map { CGFloat($0) }
        #endif
    }
}

/// The phone layout's surfaces (globals.css): --iphone-grouped, --iphone-separator.
public enum PhoneSurface {
    public static let grouped = ColorPair(light: RGBA(242, 242, 244), dark: RGBA(0, 0, 0))
    public static let row = ColorPair(light: RGBA(255, 255, 255), dark: RGBA(28, 28, 30))
    public static let separator = ColorPair(light: RGBA(60, 60, 67, 0.16), dark: RGBA(84, 84, 88, 0.5))
}

public struct PhoneScreen<Leading: View, Trailing: View, Header: View, Content: View>: View {
    let options: PhoneScreenOptions
    /// No Back button (a tab's first screen).
    let root: Bool
    let back: () -> Void
    let leading: Leading
    let trailing: Trailing
    let header: Header
    let content: Content
    /// Bumped by the frame to scroll to the top (the tab on show tapped again).
    let scrollToTop: Int
    @Environment(\.colorScheme) private var scheme
    @State private var offset: CGFloat = 0
    @State private var titleFoot: CGFloat = 60
    @State private var titleHeight: CGFloat = 38
    @State private var position = ScrollPosition(edge: .top)

    public init(_ options: PhoneScreenOptions, root: Bool = false, scrollToTop: Int = 0, back: @escaping () -> Void = {}, @ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing, @ViewBuilder header: () -> Header, @ViewBuilder content: () -> Content) {
        self.options = options
        self.root = root
        self.scrollToTop = scrollToTop
        self.back = back
        self.leading = leading()
        self.trailing = trailing()
        self.header = header()
        self.content = content()
    }

    public var body: some View {
        GeometryReader { geo in
            let safe = geo.safeAreaInsets
            let at = max(8, options.collapseAt ?? titleFoot)
            // The bar's material once anything has passed 4 points under it; the small title over the last 12
            // points of the large one going under the bar; the large title fading as it goes.
            let scrolled = offset > 4
            let titleIn = options.status != nil ? 1 : (options.large ? min(1, max(0, (offset - (at - 12)) / 12)) : (offset > at - 12 && !options.title.isEmpty ? 1 : 0))
            let largeOpacity = 1 - min(1, max(0, (offset - (at - titleHeight)) / max(1, titleHeight - 12)))
            ZStack(alignment: .top) {
                surface.color
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            Color.clear.frame(height: 0).id("top")
                            if options.large {
                                largeTitle(width: geo.size.width - safe.leading - safe.trailing).opacity(largeOpacity)
                            }
                            header
                            content
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, safe.top + 52)
                        .padding(.bottom, max(10, safe.bottom - 10) + 96)
                        .padding(.leading, safe.leading)
                        .padding(.trailing, safe.trailing)
                    }
                    .scrollContentBackground(.hidden)
                    .scrollPosition($position)
                    // (After the data has come and the layout settled: a scroll before then is clamped short.)
                    .task {
                        guard let y = options.startOffset else { return }
                        try? await Task.sleep(for: .seconds(2.5))
                        position.scrollTo(y: y)
                    }
                    .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, y in offset = y }
                    .onChange(of: scrollToTop) { withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo("top", anchor: .top) } }
                }
                .ignoresSafeArea()
                barFade(height: safe.top + 52)
                    .opacity(scrolled ? 1 : 0)
                    .animation(.easeOut(duration: 0.12), value: scrolled)
                bar(top: safe.top, titleIn: titleIn)
            }
            .ignoresSafeArea()
        }
    }

    /// `px-5 pb-1.5 pt-1`: the eyebrow (caption caps), the large title, the subtitle.
    private func largeTitle(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let eyebrow = options.eyebrow {
                Text(eyebrow.uppercased())
                    .webText(WebTextStyle(size: WebTypeRole.footnote.ios.size, leading: WebTypeRole.footnote.ios.leading, weight: FoleviTokens.FontWeight.semibold, letterSpacing: 0.04 * WebTypeRole.footnote.ios.size))
                    .lineLimit(1)
                    .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
            }
            // .ui-large-title: Spectral 600 at Large Title, line height 1.12, -0.02em.
            let size = WebTypeRole.largeTitle.metrics.size
            let style = WebTextStyle(family: .display, size: size, leading: size * 1.12, weight: FoleviTokens.FontWeight.semibold, letterSpacing: -0.02 * size)
            // A title that fits on one line is framed exactly (38.08 pt; laid out as lines it took 38.33 at 3x, and
            // everything under it sat a pixel low).
            Text(options.title)
                .webText(style)
                .lineLimit(WebFittedLines.measure(options.title, style) <= width - 40 ? 1 : nil)
                .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("phone-screen-content")) } action: { r in
                    titleFoot = r.maxY
                    titleHeight = r.height
                }
            if let subtitle = options.subtitle {
                Text(subtitle)
                    .webText(WebTextStyle(size: WebTypeRole.subheadline.metrics.size, leading: 20))
                    .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 4)
        .padding(.bottom, 6)
        .coordinateSpace(name: "phone-screen-content")
    }

    /// `.iphone-bar`: the screen's colour, solid, with a hairline at its foot.
    /// The screen's surface: the canvas (the grouped grey), with the tint mixed in.
    private var surface: RGBA {
        let base = (options.grouped ? PhoneSurface.grouped : FoleviTokens.Chrome.canvas).resolve(scheme)
        guard let tint = options.tint else { return base }
        return tint.oklabMix(base, scheme == .dark ? 0.16 : 0.10)
    }

    private func barFade(height: CGFloat) -> some View {
        surface.color
            .frame(height: height)
            .overlay(alignment: .bottom) {
                PhoneSurface.separator.resolve(scheme).color.frame(height: 0.5)
            }
            .allowsHitTesting(false)
    }

    /// The bar: leading, centre, trailing, 44 tall, 16 pt in, 4 pt under the status bar; the small title centred on
    /// the screen.
    private func bar(top: CGFloat, titleIn: CGFloat) -> some View {
        ZStack {
            Text(options.status ?? options.title)
                .webText(.role(.headline, weight: FoleviTokens.FontWeight.semibold))
                .lineLimit(1)
                .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                .frame(maxWidth: 220)
                .opacity(titleIn)
                .offset(y: (1 - titleIn) * 4)
                .accessibilityHidden(titleIn < 0.5)
            HStack(spacing: 8) {
                HStack(spacing: 0) {
                    if root {
                        leading
                    } else {
                        WebGlassCircle("Back", action: back) {
                            WebIconView(.chevronLeft, size: 24, strokeWidth: 2.2).offset(x: -2)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 8) { trailing }
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(.horizontal, 16)
        }
        .frame(height: 44)
        .padding(.top, top + 4)
    }
}

public extension PhoneScreen where Header == EmptyView {
    init(_ options: PhoneScreenOptions, root: Bool = false, scrollToTop: Int = 0, back: @escaping () -> Void = {}, @ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing, @ViewBuilder content: () -> Content) {
        self.init(options, root: root, scrollToTop: scrollToTop, back: back, leading: leading, trailing: trailing, header: { EmptyView() }, content: content)
    }
}
