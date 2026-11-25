// What a page of the built-in interface may reach for "Your own server" (docs/self-hosting/CONTRACT.md §6.1), in
// a real web view (offscreen, nothing on screen) with the app's own scheme handler and policy headers:
// - the sign-in screen (account mode, no place yet) reads a home server's http /.well-known/folevi.json, as the
//   page's lookUpServer does before addServerPlace; a Folevi Cloud account's page and local mode can't;
// - a server place on a home http address reaches it: an app://folevi page fetching http from the network isn't
//   blocked as mixed content (WebKit treats app:// as a secure context, yet lets these through).
// The home server is a listener on this Mac's own network address (not loopback, which is always trusted). It
// runs only when the Mac's firewall is off, or with FOLEVI_LIVE_LAN=1, so no firewall prompt appears.
import Network
import WebKit
import XCTest
@testable import Folevi

final class ServerPageTests: XCTestCase {
    /// A tiny server on this Mac's network address answering folevi.json (with CORS, as the real server does).
    private final class HomeServer: @unchecked Sendable {
        let listener: NWListener
        private let lock = NSLock()
        private var count = 0
        var requests: Int { lock.lock(); defer { lock.unlock() }; return count }

        init(address: String) throws {
            let params = NWParameters.tcp
            params.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host(address), port: .any)
            listener = try NWListener(using: params)
            listener.newConnectionHandler = { [weak self] c in self?.serve(c) }
        }

        func start() async throws -> UInt16 {
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<UInt16, Error>) in
                var done = false
                listener.stateUpdateHandler = { [listener] state in
                    guard !done else { return }
                    switch state {
                    case .ready: done = true; cont.resume(returning: listener.port?.rawValue ?? 0)
                    case .failed(let e): done = true; cont.resume(throwing: e)
                    default: break
                    }
                }
                listener.start(queue: .global())
            }
        }

        private func serve(_ c: NWConnection) {
            c.start(queue: .global())
            c.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, _, _ in
                guard let self, let data, String(decoding: data, as: UTF8.self).hasPrefix("GET ") else { return c.cancel() }
                self.lock.lock(); self.count += 1; self.lock.unlock()
                let body = #"{"kind":"folevi-server","apiVersion":1,"name":"Home test","version":"1.6.0"}"#
                let head = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n"
                c.send(content: Data((head + body).utf8), completion: .contentProcessed { _ in c.cancel() })
            }
        }
    }

    private final class Loaded: NSObject, WKNavigationDelegate {
        var done: (() -> Void)?
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { done?() }
    }

    /// This Mac's first private IPv4 address that isn't loopback.
    private static func homeAddress() -> String? {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return nil }
        defer { freeifaddrs(list) }
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            guard let sa = p.pointee.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET), (p.pointee.ifa_flags & UInt32(IFF_UP)) != 0 else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let ip = String(cString: host)
            if !ip.hasPrefix("127."), !ip.hasPrefix("169.254."), ShellServer.isLocalHost(ip) { return ip }
        }
        return nil
    }

    private static func firewallOff() -> Bool {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/libexec/ApplicationFirewall/socketfilterfw")
        p.arguments = ["--getglobalstate"]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = Pipe()
        guard (try? p.run()) != nil else { return false }
        p.waitUntilExit()
        return String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).contains("disabled")
    }

    @MainActor
    func testWhatEachPageMayReachOfAHomeServer() async throws {
        guard ProcessInfo.processInfo.environment["FOLEVI_LIVE_LAN"] == "1" || Self.firewallOff() else { throw XCTSkip("the Mac's firewall is on: FOLEVI_LIVE_LAN=1 runs this (it listens on the network)") }
        guard let ip = Self.homeAddress() else { throw XCTSkip("no home network address") }
        let home = try HomeServer(address: ip)
        let port = try await home.start()
        defer { home.listener.cancel() }
        let origin = "http://\(ip):\(port)"

        // The app's scheme over a folder with one page.
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-page-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("<!doctype html><title>page</title>".utf8).write(to: root.appendingPathComponent("page.html"))
        let scheme = AppScheme(root: root, serviceOrigin: "https://app.folevi.com")
        var mode = "account", signIn = true
        var server: ShellServer?
        scheme.modeOf = { _ in mode }
        scheme.signInOf = { _ in signIn }
        scheme.serverOf = { _ in server }
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(scheme, forURLScheme: "app")
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 10, height: 10), configuration: config)
        let loaded = Loaded()
        view.navigationDelegate = loaded

        /// Loads the page as the view is now, then asks it to fetch the home server's folevi.json.
        func reach() async throws -> String {
            let e = expectation(description: "loaded")
            loaded.done = { e.fulfill() }
            view.load(URLRequest(url: URL(string: "app://folevi/page.html")!))
            await fulfillment(of: [e], timeout: 10)
            let r = try await view.callAsyncJavaScript("""
            try {
              const r = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(3000) });
              return r.ok ? (await r.json()).kind : "status " + r.status;
            } catch (e) { return "blocked " + e.name; }
            """, arguments: ["url": origin + "/.well-known/folevi.json"], contentWorld: .page)
            return r as? String ?? "?"
        }

        // The sign-in screen: the page's own lookUpServer reaches a home http server (policy and mixed content).
        let seen0 = home.requests
        let a = try await reach()
        XCTAssertEqual(a, "folevi-server", "the sign-in screen looks up a home server")
        XCTAssertEqual(home.requests, seen0 + 1)
        let isSecure = try await view.callAsyncJavaScript("return window.isSecureContext", contentWorld: .page) as? Bool
        XCTAssertEqual(isSecure, true, "app:// is a secure context, and the home http fetch still went through")

        // A Folevi Cloud account's page: not that server.
        signIn = false
        let seen1 = home.requests
        let b = try await reach()
        XCTAssertTrue(b.hasPrefix("blocked"), "a cloud page reached \(origin): \(b)")
        XCTAssertEqual(home.requests, seen1, "never sent")

        // Local mode: nothing outside the app.
        mode = "local"
        let c = try await reach()
        XCTAssertTrue(c.hasPrefix("blocked"))
        XCTAssertEqual(home.requests, seen1)

        // A server place on that home http address: its own server.
        mode = "account"
        guard case .success(let s) = ShellServer.check([
            "kind": "folevi-server", "apiVersion": 1, "name": "Home test", "version": "1.6.0", "minAppVersion": "1.6.0",
            "urls": ["app": origin, "convex": origin + "/convex", "convexSite": origin + "/convex-site"],
        ], origin: origin, appVersion: "1.6.0") else { return XCTFail("refused") }
        server = s
        let d = try await reach()
        XCTAssertEqual(d, "folevi-server", "a home server's place reaches it over http")
        XCTAssertEqual(home.requests, seen1 + 1)
    }

    func testTheSignInScreensPolicy() {
        let signIn = ShellPolicy.csp(mode: "account", serviceOrigin: "https://app.folevi.com", signIn: true)
        XCTAssertTrue(signIn.contains("connect-src 'self' https://app.folevi.com https://*.convex.cloud wss://*.convex.cloud https://*.convex.site https: http:"))
        // Only the sign-in screen: an account's page, local mode and the first-launch choice are as before.
        XCTAssertFalse(ShellPolicy.csp(mode: "account", serviceOrigin: "https://app.folevi.com").contains(" http:"))
        XCTAssertTrue(ShellPolicy.csp(mode: "local", serviceOrigin: "https://app.folevi.com", signIn: true).contains("connect-src 'self';"))
        XCTAssertTrue(ShellPolicy.csp(mode: "unset", serviceOrigin: "https://app.folevi.com", signIn: true).contains("connect-src 'self';"))
        // The scheme passes the view's sign-in flag on.
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-csp-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try? Data("<!doctype html>".utf8).write(to: root.appendingPathComponent("page.html"))
        let scheme = AppScheme(root: root, serviceOrigin: "https://app.folevi.com")
        let on = scheme.respond(AppRequest(url: URL(string: "app://folevi/page.html")!, mode: "account", signIn: true))
        let off = scheme.respond(AppRequest(url: URL(string: "app://folevi/page.html")!, mode: "account"))
        XCTAssertTrue(on.header("Content-Security-Policy")?.contains(" https: http:") == true)
        XCTAssertFalse(off.header("Content-Security-Policy")?.contains(" http:") == true)
    }
}
