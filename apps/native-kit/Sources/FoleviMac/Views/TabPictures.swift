// Tabs as pictures (the web's TabPreview.tsx and TabOverview.tsx): a note's page drawn small from the same HTML as
// an export (the engine's note.picture), in a web view where nothing can run, take focus or be clicked; joined notes
// side by side; a view as its icon and name. The strip's hover card and the Tab Overview draw from here.
#if os(macOS)
import AppKit
import SwiftUI
import WebKit
import FoleviDesign
import FoleviEngine

/// The notes' pictures, fetched once and kept a little while (a picture shows a page's top; it needn't be live).
@MainActor @Observable
public final class TabPictureStore {
    public static let pageWidth: CGFloat = 600
    private static let fresh: TimeInterval = 30
    private(set) var html: [String: String] = [:]
    private var fetched: [String: Date] = [:]
    private var loading: Set<String> = []
    weak var frame: FrameModel?

    init() {}

    func load(_ id: String, title: String) {
        if loading.contains(id) { return }
        if let at = fetched[id], Date().timeIntervalSince(at) < Self.fresh { return }
        guard let client = frame?.client else { return }
        loading.insert(id)
        Task { [weak self] in
            let got = try? await client.command(.notePicture(id: id, title: title))
            guard let self else { return }
            self.loading.remove(id)
            if let page = got?.html {
                self.html[id] = page
                self.fetched[id] = Date()
            }
        }
    }
}

/// A web view that shows a page and nothing else: no scripts, no pointer, no focus, its own empty data store.
private final class PictureWebView: WKWebView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override var acceptsFirstResponder: Bool { false }
    override func scrollWheel(with event: NSEvent) { nextResponder?.scrollWheel(with: event) }
}

private struct PageFrame: NSViewRepresentable {
    let html: String
    let scale: CGFloat
    @Binding var loaded: Bool

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: PageFrame
        var shown: String?
        init(_ p: PageFrame) { parent = p }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { parent.loaded = true }
        // Nothing in a picture goes anywhere.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            action.navigationType == .other && action.request.url?.absoluteString == "about:blank" ? .allow : .cancel
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.suppressesIncrementalRendering = true
        let v = PictureWebView(frame: .zero, configuration: config)
        v.setValue(false, forKey: "drawsBackground")
        v.navigationDelegate = context.coordinator
        v.setAccessibilityElement(false)
        return v
    }

    func updateNSView(_ v: WKWebView, context: Context) {
        context.coordinator.parent = self
        if v.pageZoom != scale { v.pageZoom = scale }
        guard context.coordinator.shown != html else { return }
        context.coordinator.shown = html
        v.loadHTMLString(html, baseURL: nil)
    }
}

/// One note's page, small: a placeholder until the picture is drawn, which then fades in (never a blank frame).
struct MiniPage: View {
    let id: String
    let title: String
    let store: TabPictureStore
    @Environment(\.colorScheme) private var scheme
    @State private var loaded = false

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .topLeading) {
                color("color-surface-raised")
                if let html = store.html[id], g.size.width > 0 {
                    PageFrame(html: html, scale: g.size.width / TabPictureStore.pageWidth, loaded: $loaded)
                        .frame(width: g.size.width, height: g.size.width * 1.6)
                        .opacity(loaded ? 1 : 0)
                }
                if !loaded {
                    VStack(alignment: .leading, spacing: 8) {
                        bar(0.66, 16)
                        bar(1, 10)
                        bar(0.83, 10)
                    }
                    .padding(16)
                }
            }
            .clipped()
        }
        .onAppear { store.load(id, title: title) }
        .accessibilityHidden(true)
    }

    private func color(_ name: String) -> Color { WebStyles.vars[name]?.resolve(scheme).color ?? .clear }

    private func bar(_ w: CGFloat, _ h: CGFloat) -> some View {
        GeometryReader { g in
            RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny).fill(color("glass-hover")).frame(width: g.size.width * w, height: h)
        }
        .frame(height: h)
    }
}

/// A tab's picture: a note's page, joined notes side by side, or a view's icon and name on the canvas.
struct TabPicture: View {
    let tab: FrameTab?
    let model: FrameModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        if let tab, let notes = tab.panes ?? tab.route.noteId.map({ [$0] }) {
            HStack(spacing: 1) {
                ForEach(notes, id: \.self) { id in
                    MiniPage(id: id, title: model.tabs.paneTitles[id] ?? (tab.panes == nil ? model.tabs.label(tab) : "Untitled"), store: model.pictures)
                }
            }
            .background(WebStyles.vars["color-line"]?.resolve(scheme).color ?? .gray)
        } else {
            let label = tab.map { model.tabs.label($0) } ?? "Home"
            ZStack {
                (WebStyles.vars["color-canvas"]?.resolve(scheme).color ?? .clear)
                VStack(spacing: 8) {
                    WebIconView(tab.map { WebTopBar.icon(for: $0.route) } ?? .house, size: 24)
                        .frame(width: 48, height: 48)
                        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous).fill(WebStyles.vars["glass-hover"]?.resolve(scheme).color ?? .clear))
                        .foregroundStyle(WebStyles.vars["color-ink-muted"]?.resolve(scheme).color ?? .gray)
                    Text(label).webText(WebTextStyle(size: 13, leading: 18, weight: 600)).foregroundStyle(WebStyles.vars["color-heading"]?.resolve(scheme).color ?? .primary)
                }
            }
        }
    }
}

/// The strip's hover card: the picture (16:10) and the tab's name, under the tab, kept inside the window. It takes no
/// clicks. The tabs pictured lately stay drawn, hidden, so going back to one shows it already there.
public struct TabPreviewLayer: View {
    let model: FrameModel
    /// Where the top bar sits in this layer (its tabs' frames are the bar's).
    let barOrigin: CGPoint
    @Environment(\.colorScheme) private var scheme
    @State private var pictured: [String] = []

    public init(model: FrameModel, barOrigin: CGPoint) {
        self.model = model
        self.barOrigin = barOrigin
    }

    public var body: some View {
        GeometryReader { g in
            if let shown = model.preview.shown, let tab = model.tabs.tabs.first(where: { $0.id == shown.id }) {
                let left = min(max(8, barOrigin.x + shown.frame.midX - 150), g.size.width - 308)
                VStack(spacing: 0) {
                    ZStack {
                        ForEach(pictured, id: \.self) { id in
                            if let t = model.tabs.tabs.first(where: { $0.id == id }) {
                                TabPicture(tab: t, model: model).opacity(id == tab.id ? 1 : 0)
                            }
                        }
                    }
                    .aspectRatio(16 / 10, contentMode: .fit)
                    Rectangle().fill(color("color-line")).frame(height: 1)
                    Text(model.tabs.label(tab)).webText(WebTextStyle(size: 13, leading: 18, weight: 600))
                        .foregroundStyle(color("color-heading"))
                        .lineLimit(1).truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                }
                .frame(width: 300)
                .background(color("color-surface-raised"))
                .clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous).strokeBorder(color("color-line"), lineWidth: 1))
                .shadow(color: .black.opacity(0.18), radius: 18, y: 12)
                .offset(x: left, y: barOrigin.y + shown.frame.maxY + 8)
                .onAppear { picture(tab.id) }
                .onChange(of: tab.id) { picture(tab.id) }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func picture(_ id: String) {
        pictured = [id] + pictured.filter { $0 != id }.prefix(5)
    }

    private func color(_ name: String) -> Color { WebStyles.vars[name]?.resolve(scheme).color ?? .clear }
}
#endif
