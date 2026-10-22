// The bridge's checks (MessageRouter.swift), the empty routers' answers, the bootstrap and bridge script, the
// build identity (Paths.swift) and links (Links.swift, the cases of apps/desktop/src/urls.ts).
import WebKit
import XCTest
@testable import Folevi

final class RouterTests: XCTestCase {
    private final class Sink: BridgeEvents {
        var events: [(String, String, [String: Any])] = []
        func emit(_ plugin: String, _ event: String, _ data: [String: Any]) { events.append((plugin, event, data)) }
    }

    private func accept(_ body: Any, main: Bool = true, scheme: String = "app", host: String = "folevi", port: Int = 0, bodies: BridgeBodies = BridgeBodies()) -> Result<MessageRouter.Call, MessageRouter.Refusal> {
        MessageRouter.accept(isMainFrame: main, scheme: scheme, host: host, port: port, body: body, bodies: bodies)
    }

    func testOnlyTheAppsOwnMainFrame() {
        let call: [String: Any] = ["plugin": "FoleviShell", "method": "libInfo", "options": ["a": 1]]
        guard case .success(let c) = accept(call) else { return XCTFail("refused its own page") }
        XCTAssertEqual(c.plugin, "FoleviShell")
        XCTAssertEqual(c.method, "libInfo")
        XCTAssertEqual(c.options["a"] as? Int, 1)
        XCTAssertEqual(refusal(accept(call, main: false)), .notAllowed, "an embed's frame")
        XCTAssertEqual(refusal(accept(call, scheme: "https", host: "evil.example")), .notAllowed)
        XCTAssertEqual(refusal(accept(call, host: "other")), .notAllowed)
        XCTAssertEqual(refusal(accept(call, port: 8080)), .notAllowed)
    }

    func testMalformedCalls() {
        XCTAssertEqual(refusal(accept("ping")), .malformed)
        XCTAssertEqual(refusal(accept(["plugin": "FoleviShell"])), .malformed)
        XCTAssertEqual(refusal(accept(["plugin": "FoleviShell", "method": "lib.info"])), .malformed)
        XCTAssertEqual(refusal(accept(["plugin": "FoleviShell", "method": String(repeating: "a", count: 81)])), .malformed)
        // Options that aren't an object count as none.
        guard case .success(let c) = accept(["plugin": "FoleviShell", "method": "libInfo", "options": [1, 2]]) else { return XCTFail() }
        XCTAssertTrue(c.options.isEmpty)
    }

    func testBodiesPostedAhead() {
        let bodies = BridgeBodies()
        XCTAssertTrue(bodies.putCall("c2abcdefgh", Data(#"{"path":"notes/a.md","bytes":"AAAA"}"#.utf8)))
        guard case .success(let c) = accept(["plugin": "FoleviShell", "method": "libWrite", "bodyId": "c2abcdefgh"], bodies: bodies) else { return XCTFail() }
        XCTAssertEqual(c.options["path"] as? String, "notes/a.md")
        XCTAssertEqual(refusal(accept(["plugin": "FoleviShell", "method": "libWrite", "bodyId": "c2abcdefgh"], bodies: bodies)), .missingBody, "taken once")
        XCTAssertFalse(bodies.putCall("x", Data()), "ids are long enough not to guess")
    }

    func testEnvelopes() {
        let bodies = BridgeBodies()
        let small = MessageRouter.envelope(["value": "hi"], bodies: bodies)
        XCTAssertEqual(small["ok"] as? Bool, true)
        XCTAssertEqual((small["value"] as? [String: Any])?["value"] as? String, "hi")
        let big = MessageRouter.envelope(["bytes": String(repeating: "A", count: BridgeBodies.limit + 10)], bodies: bodies)
        let id = try? XCTUnwrap(big["bodyId"] as? String)
        XCTAssertNotNil(id.flatMap { bodies.takeReply($0) }, "a big answer waits for its GET")
        let bad = MessageRouter.envelope(["date": Date()], bodies: bodies)
        XCTAssertEqual(bad["ok"] as? Bool, false)
        let err = MessageRouter.envelope(BridgeError(code: "not_found", message: "Gone", path: "notes/a.md"))
        XCTAssertEqual(err["ok"] as? Bool, false)
        XCTAssertEqual((err["error"] as? [String: Any])?["code"] as? String, "not_found")
        XCTAssertEqual((err["error"] as? [String: Any])?["path"] as? String, "notes/a.md")
    }

    @MainActor
    func testEmptyRoutersSayUnavailable() async throws {
        let sink = Sink()
        let router = MessageRouter(context: BridgeContext(place: { "library" }, window: { nil }, events: sink))
        do {
            _ = try await router.route(MessageRouter.Call(plugin: "FoleviShell", method: "libNope", options: [:]))
            XCTFail("ShellRouter doesn't know that method")
        } catch let e as BridgeError {
            XCTAssertEqual(e.code, "unavailable")
        }
        do {
            _ = try await router.route(MessageRouter.Call(plugin: "FoleviDesktop", method: "desktopNope", options: [:]))
            XCTFail("DesktopRouter doesn't know that method")
        } catch let e as BridgeError {
            XCTAssertEqual(e.code, "unavailable")
        }
        let pong = try await router.route(MessageRouter.Call(plugin: "FoleviHost", method: "ping", options: ["echo": "x"]))
        XCTAssertEqual(pong["pong"] as? Bool, true)
        XCTAssertEqual(pong["echo"] as? String, "x")
        do {
            _ = try await router.route(MessageRouter.Call(plugin: "Nope", method: "x", options: [:]))
            XCTFail()
        } catch let e as BridgeError {
            XCTAssertEqual(e.code, "unavailable")
        }
    }

    @MainActor
    func testDesktopExtensionPoint() async throws {
        DesktopRouter.extraHandlers["testEcho"] = { _, o in ["value": o["v"] ?? NSNull()] }
        defer { DesktopRouter.extraHandlers["testEcho"] = nil }
        let router = DesktopRouter(context: BridgeContext(place: { nil }, window: { nil }, events: Sink()))
        let r = try await router.handle("testEcho", ["v": 3])
        XCTAssertEqual(r["value"] as? Int, 3)
    }

    @MainActor
    func testBridgeScript() throws {
        let script = try XCTUnwrap(WebViewFactory.bridgeScript(Bootstrap(mode: "local", place: "library", background: true, start: "/tasks")))
        XCTAssertFalse(script.contains("__FOLEVI_BOOT__"))
        XCTAssertFalse(script.contains("/*__FOLEVI_SHELL_BRIDGE__*/"))
        XCTAssertTrue(script.contains("var foleviShellBridge = function (SHELL, host)"), "the shared half is inside")
        XCTAssertTrue(script.contains("\"mode\":\"local\""))
        XCTAssertTrue(script.contains("\"background\":true"))
        XCTAssertTrue(WebViewFactory.userAgentSuffix.contains("Safari/605.1.15 FoleviDesktop/\(Paths.version)"))
    }

    func testDebugIdentity() {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "com.folevi.mac.dev")
        XCTAssertEqual(Paths.urlScheme, "folevi-dev")
        XCTAssertTrue(Paths.supportFolder.path.hasSuffix("Folevi Dev") || Paths.userDataOverride != nil, Paths.supportFolder.path)
        XCTAssertFalse(Paths.supportFolder.path.hasSuffix("Application Support/Folevi"), "never the installed app's folder")
        XCTAssertTrue(Paths.keychainService("com.folevi.e2ee").hasPrefix("com.folevi.dev."))
        XCTAssertNotEqual(Platform.keychainService("com.folevi.shell-auth"), "com.folevi.shell-auth")
        XCTAssertEqual(Platform.deviceLabel, "Mac")
        XCTAssertFalse(Platform.deviceName.isEmpty)
        XCTAssertEqual(Paths.version, "2.0.0")
    }

    func testDeepLinks() {
        let s = "folevi-dev"
        XCTAssertEqual(Links.parseDeepLink("folevi-dev://d/01jabcdefghjkmnpqrstvwxyz0", scheme: s), .open(path: "/d/01JABCDEFGHJKMNPQRSTVWXYZ0"))
        XCTAssertEqual(Links.parseDeepLink("folevi-dev://d/01JABCDEFGHJKMNPQRSTVWXYZ0#block-abc123", scheme: s), .open(path: "/d/01JABCDEFGHJKMNPQRSTVWXYZ0#block-abc123"))
        XCTAssertEqual(Links.parseDeepLink("folevi-dev:///d/01JABCDEFGHJKMNPQRSTVWXYZ0#bad!hash", scheme: s), .open(path: "/d/01JABCDEFGHJKMNPQRSTVWXYZ0"))
        XCTAssertEqual(Links.parseDeepLink("folevi-dev://d/inbox-abc123", scheme: s), .open(path: "/d/inbox-abc123"))
        XCTAssertEqual(Links.parseDeepLink("folevi-dev://tasks/today", scheme: s), .open(path: "/tasks/today"))
        XCTAssertEqual(Links.parseDeepLink("folevi-dev://new", scheme: s), .newNote)
        XCTAssertEqual(Links.parseDeepLink("folevi-dev://quick-add", scheme: s), .quickAdd)
        XCTAssertEqual(Links.parseDeepLink("folevi-dev://", scheme: s), .open(path: "/documents"))
        XCTAssertNil(Links.parseDeepLink("folevi-dev://d/notanid", scheme: s))
        XCTAssertNil(Links.parseDeepLink("folevi-dev://d/01JABCDEFGHJKMNPQRSTVWXYZ0/x", scheme: s))
        XCTAssertNil(Links.parseDeepLink("folevi-dev://admin", scheme: s))
        XCTAssertNil(Links.parseDeepLink("folevi-dev://tasks/a/b/c", scheme: s))
        XCTAssertNil(Links.parseDeepLink("folevi-dev://tasks/%2e%2e", scheme: s))
        XCTAssertNil(Links.parseDeepLink("folevi://new", scheme: s), "a release link isn't this build's")
        XCTAssertNil(Links.parseDeepLink("folevi-dev://d/" + String(repeating: "A", count: 700), scheme: s))
    }

    func testLinkTargets() {
        let site = URL(string: "https://app.folevi.com")!
        XCTAssertEqual(Links.target(URL(string: "app://folevi/tasks?x=1#y")!, service: site), .app(path: "/tasks?x=1#y"))
        XCTAssertEqual(Links.target(URL(string: "https://app.folevi.com/d/01JABCDEFGHJKMNPQRSTVWXYZ0")!, service: site), .app(path: "/d/01JABCDEFGHJKMNPQRSTVWXYZ0"))
        XCTAssertEqual(Links.target(URL(string: "https://app.folevi.com/pricing")!, service: site), .browser)
        XCTAssertEqual(Links.target(URL(string: "https://example.com/")!, service: site), .browser)
        XCTAssertEqual(Links.target(URL(string: "mailto:a@b.c")!, service: site), .browser)
        XCTAssertEqual(Links.target(URL(string: "file:///etc/passwd")!, service: site), .ignore)
        XCTAssertEqual(Links.target(URL(string: "javascript:alert(1)")!, service: site), .ignore)
        XCTAssertEqual(Links.appURL("//evil.example/x").absoluteString, "app://folevi/")
        XCTAssertEqual(Links.appURL("/d/X").absoluteString, "app://folevi/d/X")
    }

    /// FOLEVI_OFFLINE=1 (read at launch): the refusing protocol takes every web request and nothing of the app's
    /// own. (The swap that puts it first in every session's configuration was checked in a plain process, a real
    /// data task failing with -1009; it isn't installed here, in the test host XCTest itself uses.)
    func testOfflineRefusesTheNetworkOnly() {
        for raw in ["https://app.folevi.com/", "http://app.localhost:3002/", "wss://x.convex.cloud/", "ws://127.0.0.1:3210/"] {
            XCTAssertTrue(RefuseNetwork.canInit(with: URLRequest(url: URL(string: raw)!)), raw)
        }
        XCTAssertFalse(RefuseNetwork.canInit(with: URLRequest(url: URL(string: "app://folevi/")!)))
        XCTAssertFalse(RefuseNetwork.canInit(with: URLRequest(url: URL(fileURLWithPath: "/tmp/x"))))
    }

    private func refusal(_ r: Result<MessageRouter.Call, MessageRouter.Refusal>) -> MessageRouter.Refusal? {
        if case .failure(let e) = r { return e }
        return nil
    }
}
