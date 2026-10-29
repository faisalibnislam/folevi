// Every web view of the app is made here (docs/MAC_WEBKIT_PLAN.md §3): the app:// scheme, the data store of this
// build (Paths), the bridge script at document start with what the page starts with, the "folevi" message handler
// bound to this view, content rules (FOLEVI_OFFLINE; WM1 adds local mode's), the user agent, and the preferences
// the owner chose (Writing Tools off in notes, decision M5).
import AppKit
import FoleviDesign
import WebKit

/// What a view is for: a main window's page, a place's hidden runner (WM1), Quick Add's panel (WM2).
enum ViewRole: String {
    case main, runner, quickAdd
}

/// A web view that knows its place and role, and lets the title bar take clicks in drag areas (WM2).
final class FoleviWebView: WKWebView {
    /// The place the view is bound to ("library", "acct:<user id>"), nil before places. Set by the host only.
    var place: String?
    let role: ViewRole
    let events = ViewEvents()
    /// Set once the first page finished loading (links and commands wait for it).
    var loaded = false
    /// The window's Page View inside the native frame (N8): the page is in native chrome mode and the app draws
    /// the window's chrome, so the page's title bar reports (button spots, drag areas, title) don't apply.
    let nativeFrame: Bool

    /// WM2 (TitleBar.swift): a mouse down the window takes (a drag area of the page's top bar). True when taken.
    var mouseDownHook: ((FoleviWebView, NSEvent) -> Bool)?

    init(frame: NSRect, configuration: WKWebViewConfiguration, place: String?, role: ViewRole, nativeFrame: Bool = false) {
        self.place = place
        self.role = role
        self.nativeFrame = nativeFrame
        super.init(frame: frame, configuration: configuration)
        events.view = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    override func mouseDown(with event: NSEvent) {
        if mouseDownHook?(self, event) == true { return }
        super.mouseDown(with: event)
    }
}

/// What the page starts with, written into the bridge script (Electron read it with sendSync).
struct Bootstrap {
    var mode: String
    var place: String?
    /// A hidden runner keeping a place in sync (no window).
    var background = false
    /// Where to open after a switch to another place (shell-bridge.js's SHELL.start).
    var start: String?

    var json: [String: Any] {
        [
            "version": Paths.version,
            "build": Paths.build,
            "debug": Paths.isDebug,
            "desktop": Array(DesktopRouter.features).sorted(),
            "shell": [
                "mode": mode,
                "deviceName": Platform.deviceName,
                "places": ["current": place.map { $0 as Any } ?? NSNull(), "background": background] as [String: Any],
                "start": start.map { $0 as Any } ?? NSNull(),
            ] as [String: Any],
        ]
    }
}

@MainActor
enum WebViewFactory {
    /// The app:// handler every view shares (made at launch).
    static var scheme: AppScheme = AppScheme(root: Paths.shellRoot, serviceOrigin: origin(Paths.serviceURL), extraConnect: Paths.extraConnect)

    /// More page-side scripts (resource names without ".js"), placed inside mac-bridge.js's function in this
    /// order: other packages register theirs at launch, before the first view (WM2's drag regions, for one).
    static var extraScripts: [String] = []

    /// Content rule lists every view gets (FOLEVI_OFFLINE's); WM1 adds per-place ones through `rulesFor`.
    static var rules: [WKContentRuleList] = []
    static var rulesFor: ((String?, ViewRole) -> [WKContentRuleList])?

    /// More settings for a view's configuration by its place and role, before the view is made (WM1: runners and
    /// the library's windows keep running behind other windows, `inactiveSchedulingPolicy`).
    static var configure: [(WKWebViewConfiguration, String?, ViewRole) -> Void] = []

    static func origin(_ url: URL) -> String {
        guard let scheme = url.scheme, let host = url.host else { return url.absoluteString }
        return "\(scheme)://\(host)\(url.port.map { ":\($0)" } ?? "")"
    }

    static func make(place: String?, role: ViewRole, bootstrap: Bootstrap, frame: NSRect = .zero, nativeFrame: Bool = false, window: @escaping () -> NSWindow?) -> FoleviWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = Paths.dataStore
        config.setURLSchemeHandler(scheme, forURLScheme: AppScheme.scheme)
        config.applicationNameForUserAgent = userAgentSuffix
        config.preferences.isElementFullscreenEnabled = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.preferences.isFraudulentWebsiteWarningEnabled = false
        config.mediaTypesRequiringUserActionForPlayback = []
        // Decision M5: Apple's Writing Tools stay out of notes (Foli AI covers writing help).
        config.writingToolsBehavior = .none
        for step in configure { step(config, place, role) }
        let ucc = WKUserContentController()
        if let source = bridgeScript(bootstrap) {
            ucc.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        // The Mac's scroll bars (thin, hidden at rest) in every frame, as the native ones (FoleviDesign MacScrollers).
        if !AppDelegate.systemScrollers {
            ucc.addUserScript(WKUserScript(source: MacScrollers.webStyle, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        }
        for list in rules + (rulesFor?(place, role) ?? []) { ucc.add(list) }
        config.userContentController = ucc

        let view = FoleviWebView(frame: frame, configuration: config, place: place, role: role, nativeFrame: nativeFrame)
        let router = MessageRouter(context: BridgeContext(
            place: { [weak view] in view?.place },
            window: { [weak view] in view?.window ?? window() },
            events: view.events
        ))
        ucc.addScriptMessageHandler(router, contentWorld: .page, name: MessageRouter.name)
        view.allowsBackForwardNavigationGestures = false
        view.allowsMagnification = false
        view.underPageBackgroundColor = NSColor(name: nil) { a in
            a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(red: 0x10 / 255, green: 0x10 / 255, blue: 0x11 / 255, alpha: 1) : .white
        }
        #if DEBUG
        view.isInspectable = true
        #endif
        Navigation.shared.attach(view)
        WindowManager.shared.register(view)
        return view
    }

    /// "Version/<Safari's> Safari/605.1.15 FoleviDesktop/<version>": the page's browserLabel() and session names
    /// read "Folevi for Mac", and sites that look for Safari see it.
    static var userAgentSuffix: String {
        "Version/\(safariVersion) Safari/605.1.15 FoleviDesktop/\(Paths.version)"
    }

    private static let safariVersion: String = {
        if let info = NSDictionary(contentsOfFile: "/Applications/Safari.app/Contents/Info.plist"), let v = info["CFBundleShortVersionString"] as? String, !v.isEmpty { return v }
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return "\(os.majorVersion).\(os.minorVersion)"
    }()

    // MARK: the bridge script

    private static func resource(_ name: String) -> String? {
        Bundle.main.url(forResource: name, withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) }
    }

    /// mac-bridge.js with the bootstrap and the shared files inside its function.
    static func bridgeScript(_ bootstrap: Bootstrap) -> String? {
        guard let template = resource("mac-bridge"), let shell = resource("shell-bridge") else { return nil }
        let kit = resource("folevi-cloud") ?? ""
        let extras = extraScripts.compactMap { resource($0) }.joined(separator: "\n")
        guard let data = try? JSONSerialization.data(withJSONObject: bootstrap.json), let boot = String(data: data, encoding: .utf8) else { return nil }
        return template
            .replacingOccurrences(of: "/*__FOLEVI_CLOUD_KIT__*/", with: kit)
            .replacingOccurrences(of: "/*__FOLEVI_SHELL_BRIDGE__*/", with: shell)
            .replacingOccurrences(of: "/*__FOLEVI_EXTRAS__*/", with: extras)
            .replacingOccurrences(of: "\"__FOLEVI_BOOT__\"", with: boot)
    }

    // MARK: content rules

    /// Compiles the rule lists every view needs before the first one opens (FOLEVI_OFFLINE's).
    static func prepareRules() async {
        guard Paths.offline else { return }
        let json = #"[{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}},{"trigger":{"url-filter":"^wss?://"},"action":{"type":"block"}}]"#
        if let list = try? await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "folevi-offline", encodedContentRuleList: json) {
            rules.append(list)
        }
    }
}
