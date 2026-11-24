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
    /// The header stays under the bar once the large title has scrolled away (`sticky`: the Calendar's week strip).
    public var pinsHeader = false
    /// A field that filters the screen's list (Mac redesign, 2026-11-23: it opens from the search capsule at the end
    /// of the screen's top bar, under the large title, and stays while it holds text).
    public var search: Binding<String>?
    /// The search field's prompt.
    public var searchPrompt = "Search"
    /// The field's icon: the magnifier, or `.funnel` for a field that filters the list ("Filter notes").
    public var searchIcon: WebIcon = .search
    /// The trailing items have nothing to show this time (Home's bell when not signed in): no empty glass for them.
    public var trailingEmpty = false
    /// The search capsule at the bar's end (the owner, 2026-11-23: search in each screen's top bar): on a screen with
    /// a filter it opens the filter, elsewhere the app's Search. Off for Search itself and sheets.
    public var showsSearch = true
    /// The content is iOS's own List, inset grouped (the owner, 2026-11-24: system lists): its PhoneListSection,
    /// PhoneGroupedSection and swipe rows become the List's sections, rows and swipe actions.
    public var list = false

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
    /// Home's cards and tiles (--iphone-card): a whisper of grey, lighter than the sunken surface.
    public static let card = ColorPair(light: RGBA(0, 0, 0, 0.03), dark: RGBA(255, 255, 255, 0.055))
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
    @Environment(\.phoneRootCreate) private var rootCreate
    @Environment(\.phoneOpenSearch) private var openSearch
    @State private var filterShown = false
    @State private var offset: CGFloat = 0
    @State private var titleFoot: CGFloat = 60
    @State private var titleHeight: CGFloat = 38
    @State private var largeHeight: CGFloat = 48
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
        #if os(iOS)
        nativeBody
        #else
        webBody
        #endif
    }

    #if os(iOS)
    /// The native look (the owner, 2026-11-19), redesigned after the Mac's window (the owner, 2026-11-23,
    /// docs/design/macloving-mac-ui.md as iOS has it): the screen on the frame's grey under iOS's own navigation bar,
    /// the large title collapsing into it as it scrolls, the system's Back (and its edge swipe), and at the bar's end
    /// the Mac's order: the screen's actions in one glass capsule, the one main action in Folevi's ink, then the search
    /// capsule. The content's sections are rounded opaque cards on the grey.
    @ViewBuilder private var nativeBody: some View {
        if options.list { listBody } else { stackBody }
    }

    /// The screen as iOS's own List: the filter and the header as rows of their own with no card, then the content's
    /// sections.
    private var listBody: some View {
        barChrome(listContent)
    }

    private var listContent: some View {
        let filter = options.search.flatMap { search in (filterShown || !search.wrappedValue.isEmpty) ? search : nil }
        let headerRow = !options.pinsHeader && Header.self != EmptyView.self
        return List {
            if filter != nil || headerRow {
                // The filter and the header run edge to edge, on the screen's grey, not on a card.
                Section {
                    if let filter {
                        PhoneSearchField(options.searchPrompt, text: filter, icon: options.searchIcon, autofocus: filterShown) {
                            withAnimation(PhoneLook.reveal) { filterShown = false }
                        }
                    }
                    if headerRow { header }
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .modifier(EdgeToEdgeSection())
            }
            content
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .environment(\.defaultMinListRowHeight, 0)
        .environment(\.phoneInList, true)
        .scrollContentBackground(.hidden)
        .scrollPosition($position)
        .onChange(of: scrollToTop) { withAnimation(WebMotion.reduced ? nil : .easeInOut(duration: 0.35)) { position.scrollTo(edge: .top) } }
        .onChange(of: filterShown) { _, shown in
            if shown { withAnimation(WebMotion.reduced ? nil : .easeInOut(duration: 0.3)) { position.scrollTo(edge: .top) } }
        }
        .modifier(PinnedHeader(pinned: options.pinsHeader, header: header))
        .background(surface.color.ignoresSafeArea())
    }

    private var stackBody: some View {
        barChrome(stackContent)
    }

    private var stackContent: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Color.clear.frame(height: 0).id("top")
                    // The screen's filter, opened from the bar's search capsule; it stays while it holds text.
                    if let search = options.search, filterShown || !search.wrappedValue.isEmpty {
                        PhoneSearchField(options.searchPrompt, text: search, icon: options.searchIcon, autofocus: filterShown) {
                            withAnimation(PhoneLook.reveal) { filterShown = false }
                        }
                        .transition(.move(edge: .top).combined(with: .opacity))
                    }
                    if !options.pinsHeader { header }
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 24)
            }
            .scrollContentBackground(.hidden)
            .scrollPosition($position)
            .task {
                guard let y = options.startOffset else { return }
                try? await Task.sleep(for: .seconds(2.5))
                position.scrollTo(y: y)
            }
            .onChange(of: scrollToTop) { withAnimation(WebMotion.reduced ? nil : .easeInOut(duration: 0.35)) { proxy.scrollTo("top", anchor: .top) } }
            .onChange(of: filterShown) { _, shown in
                if shown { withAnimation(WebMotion.reduced ? nil : .easeInOut(duration: 0.3)) { proxy.scrollTo("top", anchor: .top) } }
            }
        }
        .modifier(PinnedHeader(pinned: options.pinsHeader, header: header))
        .background(surface.color.ignoresSafeArea())
    }

    /// The bar every screen shares: the title (large, collapsing), the subtitle, Back, and the trailing items in the
    /// Mac's order.
    private func barChrome<V: View>(_ content: V) -> some View {
        content
            .navigationTitle(options.title)
            .navigationBarTitleDisplayMode(options.large && !options.pinsHeader ? .large : .inline)
            .modifier(PhoneScreenSubtitle(text: options.subtitle ?? options.eyebrow))
            .navigationBarBackButtonHidden(root)
            .toolbar {
                if root, Leading.self != EmptyView.self {
                    // The account button is its own picture: no system glass around it (the owner, 2026-11-19: the
                    // glass circle around the workspace's logo "looks weird"), and its badge's ring in this screen's
                    // colour.
                    if #available(iOS 26, *) {
                        ToolbarItem(placement: .topBarLeading) { leadingItem }.sharedBackgroundVisibility(.hidden)
                    } else {
                        ToolbarItem(placement: .topBarLeading) { leadingItem }
                    }
                }
                if let status = options.status {
                    ToolbarItem(placement: .principal) {
                        Text(status).font(.headline).lineLimit(1)
                    }
                }
                // The screen's actions: one glass capsule.
                if hasTrailing {
                    ToolbarItem(placement: .topBarTrailing) { HStack(spacing: 6) { trailing }.environment(\.phoneInSystemBar, true) }
                }
                // The main action (a tab's first screen: Create, or on Tasks a quick task), in Folevi's ink.
                if root, let rootCreate {
                    if #available(iOS 26, *), hasTrailing {
                        ToolbarSpacer(.fixed, placement: .topBarTrailing)
                    }
                    PhoneRootCreateItem(create: rootCreate)
                }
                // Search, last, as on the Mac.
                if searchAction != nil {
                    if #available(iOS 26, *), hasTrailing || (root && rootCreate != nil) {
                        ToolbarSpacer(.fixed, placement: .topBarTrailing)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        // (A title with the icon, shown icon-only: the bar's overflow and VoiceOver read the title.)
                        Button { searchAction?() } label: {
                            Label {
                                Text(options.search != nil ? options.searchPrompt : "Search")
                            } icon: {
                                WebIconView(options.search != nil ? options.searchIcon : .search, size: 21, strokeWidth: 1.9)
                                    .frame(width: 30, height: 30)
                                    .contentShape(Rectangle())
                            }
                            .labelStyle(.iconOnly)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("bar-search")
                    }
                }
            }
    }

    /// What the bar's search capsule does: open the screen's filter (closing it again when empty), or the app's
    /// Search. Nil: no capsule.
    private var searchAction: (@MainActor () -> Void)? {
        guard options.showsSearch else { return nil }
        if let search = options.search {
            return {
                withAnimation(PhoneLook.reveal) {
                    if filterShown, search.wrappedValue.isEmpty { filterShown = false } else { filterShown = true }
                }
            }
        }
        return openSearch
    }
    #endif

    private var hasTrailing: Bool { Trailing.self != EmptyView.self && !options.trailingEmpty }

    private var leadingItem: some View {
        leading
            .environment(\.phoneInSystemBar, true)
            .environment(\.phoneScreenSurface, surface.color)
    }

    private var webBody: some View {
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
                                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { largeHeight = $0 }
                            }
                            header
                                .offset(y: options.pinsHeader ? max(0, offset - (options.large ? largeHeight : 0)) : 0)
                                .zIndex(1)
                            content
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, safe.top + Self.barRoom)
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
                    // (Past the point where the title has gone under the bar nothing here changes any more, so the state
                    // stops there and a long scroll doesn't draw this screen again each frame. A pinned header follows
                    // the offset all the way down.)
                    .onScrollGeometryChange(for: CGFloat.self) { [pins = options.pinsHeader] geo in
                        let y = geo.contentOffset.y + geo.contentInsets.top
                        return pins ? y : min(y, at + 1)
                    } action: { _, y in offset = y }
                    .onChange(of: scrollToTop) { withAnimation(WebMotion.reduced ? nil : .easeInOut(duration: 0.35)) { proxy.scrollTo("top", anchor: .top) } }
                }
                .ignoresSafeArea()
                barFade(height: safe.top + Self.barRoom)
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

    /// The bar's room under the status bar: its 44 pt buttons 4 pt down, then 16 pt clear under them before the
    /// hairline (it read cramped at 4).
    static var barRoom: CGFloat { 64 }

    /// `.iphone-bar`: the screen's colour, solid, with a hairline at its foot.
    /// The screen's surface: the frame's grey (since the 2026-11-23 redesign every native screen, its sections the
    /// rounded opaque cards on it), with the tint mixed in. The web's drawing keeps its canvas unless grouped.
    private var surface: RGBA {
        #if os(iOS)
        let base = PhoneLook.frame.resolve(scheme)
        #else
        let base = (options.grouped ? PhoneSurface.grouped : FoleviTokens.Chrome.canvas).resolve(scheme)
        #endif
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
                // (Its buttons get their room first: Select, New folder and "…" on a folder's page are wider than half.)
                HStack(spacing: 8) { trailing }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .layoutPriority(1)
            }
            .padding(.horizontal, 16)
        }
        .frame(height: 44)
        .padding(.top, top + 4)
    }
}

#if os(iOS)
/// A header that stays under the bar (the Calendar's week strip): in a bar of its own over the scroll view, which
/// iOS 26 carries the scroll edge effect under.
private struct PinnedHeader<H: View>: ViewModifier {
    let pinned: Bool
    let header: H

    func body(content: Content) -> some View {
        if pinned {
            if #available(iOS 26, *) {
                content.safeAreaBar(edge: .top, spacing: 0) { header }
            } else {
                content.safeAreaInset(edge: .top, spacing: 0) { header.background(.bar) }
            }
        } else {
            content
        }
    }
}

/// A List section with no side margins (iOS 26): the screen's own header rows span the width.
private struct EdgeToEdgeSection: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.listSectionMargins(.horizontal, 0)
        } else {
            content
        }
    }
}

/// The line under the large title (iOS 26's navigation subtitle).
private struct PhoneScreenSubtitle: ViewModifier {
    let text: String?

    func body(content: Content) -> some View {
        if #available(iOS 26, *), let text, !text.isEmpty {
            content.navigationSubtitle(text)
        } else {
            content
        }
    }
}
#endif

public extension PhoneScreen where Header == EmptyView {
    init(_ options: PhoneScreenOptions, root: Bool = false, scrollToTop: Int = 0, back: @escaping () -> Void = {}, @ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing, @ViewBuilder content: () -> Content) {
        self.init(options, root: root, scrollToTop: scrollToTop, back: back, leading: leading, trailing: trailing, header: { EmptyView() }, content: content)
    }
}
