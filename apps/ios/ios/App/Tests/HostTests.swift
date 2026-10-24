// The app's own web view host (Native/Host, docs/NATIVE_APP_PLAN.md N1): who may call the bridge, the reply
// envelopes, big bodies, what capacitor://localhost serves (Capacitor's routing, kept so the page and its storage
// behave as before), the build's host settings, and the call API the plugins read.
import WebKit
import XCTest
@testable import App

final class HostTests: XCTestCase {
    // MARK: the bridge

    func testOnlyTheAppsOwnMainFrameMayCall() {
        let bodies = BridgeBodies()
        let body: [String: Any] = ["plugin": "FoleviNative", "method": "device", "options": ["a": 1]]
        guard case .success(let call) = MessageRouter.accept(isMainFrame: true, origin: "capacitor://localhost", appOrigin: "capacitor://localhost", body: body, bodies: bodies) else { return XCTFail("refused the app's page") }
        XCTAssertEqual(call.plugin, "FoleviNative")
        XCTAssertEqual(call.method, "device")
        XCTAssertEqual(call.options["a"] as? Int, 1)
        XCTAssertEqual(refusal(MessageRouter.accept(isMainFrame: false, origin: "capacitor://localhost", appOrigin: "capacitor://localhost", body: body, bodies: bodies)), .notAllowed)
        XCTAssertEqual(refusal(MessageRouter.accept(isMainFrame: true, origin: "https://example.com", appOrigin: "capacitor://localhost", body: body, bodies: bodies)), .notAllowed)
        XCTAssertEqual(refusal(MessageRouter.accept(isMainFrame: true, origin: "capacitor://localhost", appOrigin: "", body: body, bodies: bodies)), .notAllowed)
    }

    func testMalformedCallsAreRefused() {
        let bodies = BridgeBodies()
        for body: Any in [["plugin": "FoleviNative"], ["plugin": "FoleviNative", "method": "no-dashes"], ["plugin": "FoleviNative", "method": "x:"], "text", ["plugin": 1, "method": "a"]] {
            XCTAssertEqual(refusal(MessageRouter.accept(isMainFrame: true, origin: "capacitor://localhost", appOrigin: "capacitor://localhost", body: body, bodies: bodies)), .malformed, "\(body)")
        }
    }

    func testBigOptionsComeThroughTheirBody() throws {
        let bodies = BridgeBodies()
        let id = "abcdefgh12345678"
        XCTAssertTrue(bodies.putCall(id, try JSONSerialization.data(withJSONObject: ["text": "hello"])))
        let body: [String: Any] = ["plugin": "FoleviNative", "method": "copyText", "bodyId": id]
        guard case .success(let call) = MessageRouter.accept(isMainFrame: true, origin: "capacitor://localhost", appOrigin: "capacitor://localhost", body: body, bodies: bodies) else { return XCTFail("refused") }
        XCTAssertEqual(call.options["text"] as? String, "hello")
        // Taken once.
        XCTAssertEqual(refusal(MessageRouter.accept(isMainFrame: true, origin: "capacitor://localhost", appOrigin: "capacitor://localhost", body: body, bodies: bodies)), .missingBody)
        XCTAssertFalse(bodies.putCall("bad id!", Data()))
    }

    func testEnvelopes() {
        let bodies = BridgeBodies()
        let small = MessageRouter.envelope(["value": 1], bodies: bodies)
        XCTAssertEqual(small["ok"] as? Bool, true)
        XCTAssertEqual((small["value"] as? [String: Any])?["value"] as? Int, 1)
        let big = MessageRouter.envelope(["text": String(repeating: "x", count: BridgeBodies.limit + 10)], bodies: bodies)
        let id = big["bodyId"] as? String
        XCTAssertNotNil(id)
        XCTAssertNotNil(id.flatMap(bodies.takeReply))
        XCTAssertNil(id.flatMap(bodies.takeReply))
        let failure = MessageRouter.envelope(BridgeError(code: "not_found", message: "Gone", data: ["path": "a/b"]))
        XCTAssertEqual(failure["ok"] as? Bool, false)
        let error = failure["error"] as? [String: Any]
        XCTAssertEqual(error?["code"] as? String, "not_found")
        XCTAssertEqual(error?["message"] as? String, "Gone")
        XCTAssertEqual((error?["data"] as? [String: Any])?["path"] as? String, "a/b")
        // No code: the page sees none (as Capacitor's reject without one).
        XCTAssertNil((MessageRouter.envelope(BridgeError(code: nil, message: "No"))["error"] as? [String: Any])?["code"])
    }

    func testCallReadsOptionsAndAnswersOnce() {
        var answers: [Result<[String: Any], BridgeError>] = []
        let call = BridgeCall(method: "x", options: ["s": "a", "b": true, "i": 3, "d": 2.5, "arr": [1, 2], "o": ["k": "v"], "bad": NSNumber(value: 2.5)]) { answers.append($0) }
        XCTAssertEqual(call.getString("s"), "a")
        XCTAssertEqual(call.getBool("b"), true)
        XCTAssertEqual(call.getInt("i"), 3)
        XCTAssertNil(call.getInt("bad"))
        XCTAssertNil(call.getInt("b"))
        XCTAssertEqual(call.getDouble("d"), 2.5)
        XCTAssertEqual(call.getArray("arr")?.count, 2)
        XCTAssertEqual(call.getObject("o")?["k"] as? String, "v")
        XCTAssertNil(call.getString("missing"))
        call.reject("No", "denied")
        call.resolve(["late": true])
        XCTAssertEqual(answers.count, 1)
        if case .failure(let e) = answers[0] { XCTAssertEqual(e.code, "denied") } else { XCTFail("not a refusal") }
    }

    // MARK: capacitor://localhost

    private func export() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("host-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("_next/static", isDirectory: true), withIntermediateDirectories: true)
        try Data("<html>index</html>".utf8).write(to: root.appendingPathComponent("index.html"))
        try Data("console.log(1)".utf8).write(to: root.appendingPathComponent("_next/static/app.js"))
        try Data((0..<100).map { UInt8($0) }).write(to: root.appendingPathComponent("clip.mp4"))
        return root
    }

    func testRoutingAsCapacitorDid() throws {
        let root = try export()
        let scheme = AppScheme(root: root)
        let index = scheme.respond(url: URL(string: "capacitor://localhost/documents")!, method: "GET")
        XCTAssertEqual(index.status, 200)
        XCTAssertEqual(String(data: index.body, encoding: .utf8), "<html>index</html>")
        XCTAssertEqual(index.headers["Content-Type"], "text/html")
        XCTAssertEqual(index.headers["Cache-Control"], "no-cache")
        XCTAssertEqual(scheme.respond(url: URL(string: "capacitor://localhost/")!, method: "GET").status, 200)
        XCTAssertEqual(scheme.respond(url: URL(string: "capacitor://localhost/d/01ABC/x")!, method: "GET").status, 200)
        let js = scheme.respond(url: URL(string: "capacitor://localhost/_next/static/app.js")!, method: "GET")
        XCTAssertEqual(js.status, 200)
        XCTAssertTrue(js.headers["Content-Type"]?.contains("javascript") == true)
        // A missing file is a failed load (not index.html), as before.
        XCTAssertNil(scheme.respond(url: URL(string: "capacitor://localhost/_next/static/missing.js")!, method: "GET").status)
        // Nothing outside the export, nothing from another host.
        XCTAssertNil(scheme.respond(url: URL(string: "capacitor://localhost/../../etc/passwd.txt")!, method: "GET").status)
        XCTAssertNil(scheme.respond(url: URL(string: "capacitor://evil/index.html")!, method: "GET").status)
    }

    func testRangesForMedia() throws {
        let scheme = AppScheme(root: try export())
        let part = scheme.respond(url: URL(string: "capacitor://localhost/clip.mp4")!, method: "GET", range: "bytes=10-19")
        XCTAssertEqual(part.status, 206)
        XCTAssertEqual(part.body, Data((10..<20).map { UInt8($0) }))
        XCTAssertEqual(part.headers["Content-Range"], "bytes 10-19/100")
        XCTAssertEqual(AppScheme.parseRange("bytes=-10", size: 100)?.start, 90)
        XCTAssertEqual(AppScheme.parseRange("bytes=95-", size: 100)?.end, 99)
        XCTAssertNil(AppScheme.parseRange("bytes=200-", size: 100))
        XCTAssertNil(AppScheme.parseRange("items=1-2", size: 100))
    }

    func testBridgeBodiesRoute() throws {
        let bodies = BridgeBodies()
        let scheme = AppScheme(root: try export(), bodies: bodies)
        let posted = scheme.respond(url: URL(string: "capacitor://localhost/_bridge/abcdefgh1234")!, method: "POST", body: Data("{\"a\":1}".utf8))
        XCTAssertEqual(posted.status, 200)
        XCTAssertEqual(bodies.takeCall("abcdefgh1234"), Data("{\"a\":1}".utf8))
        let id = bodies.putReply(Data("{}".utf8))
        XCTAssertEqual(scheme.respond(url: URL(string: "capacitor://localhost/_bridge/\(id)")!, method: "GET").status, 200)
        XCTAssertEqual(scheme.respond(url: URL(string: "capacitor://localhost/_bridge/\(id)")!, method: "GET").status, 404)
        // A development server's page may use it, with CORS for that origin only.
        scheme.bridgeOrigin = "http://localhost:3003"
        let cors = scheme.respond(url: URL(string: "capacitor://localhost/_bridge/abcdefgh5678")!, method: "OPTIONS")
        XCTAssertEqual(cors.headers["Access-Control-Allow-Origin"], "http://localhost:3003")
    }

    // MARK: folevi-host.json

    func testHostConfig() {
        let bundled = HostConfig.parse(["mode": "bundled", "serverUrl": "https://example.com", "serviceUrl": "http://app.localhost:3002"])
        XCTAssertEqual(bundled.serverURL.absoluteString, "capacitor://localhost")
        XCTAssertEqual(bundled.startURL.absoluteString, "capacitor://localhost/")
        XCTAssertEqual(bundled.serviceURL.absoluteString, "http://app.localhost:3002")
        XCTAssertTrue(bundled.bundled)
        XCTAssertNil(bundled.errorURL)
        let site = HostConfig.parse(["mode": "website", "serverUrl": "https://app.folevi.com/documents", "errorPath": "offline.html"])
        XCTAssertEqual(site.serverURL.absoluteString, "https://app.folevi.com")
        XCTAssertEqual(site.startURL.absoluteString, "https://app.folevi.com/documents")
        XCTAssertEqual(site.errorURL?.absoluteString, "capacitor://localhost/offline.html")
        XCTAssertFalse(site.bundled)
        let dev = HostConfig.parse(["mode": "shellDev", "serverUrl": "http://localhost:3003"])
        XCTAssertEqual(dev.serverURL.absoluteString, "http://localhost:3003")
        XCTAssertTrue(dev.bundled)
        // Nothing usable: the release default.
        let none = HostConfig.parse([:])
        XCTAssertEqual(none.mode, .bundled)
        XCTAssertEqual(none.serviceURL.absoluteString, "https://app.folevi.com")
        XCTAssertEqual(HostConfig.parse(["mode": "website", "serverUrl": "javascript:alert(1)"]).serverURL.absoluteString, "capacitor://localhost")
    }

    func testQuickTypeBarAloneIsNoKeyboard() {
        XCTAssertTrue(KeyboardHost.ignoredOnPad(55, screenHeight: 1376))
        XCTAssertFalse(KeyboardHost.ignoredOnPad(400, screenHeight: 1376))
        XCTAssertFalse(KeyboardHost.ignoredOnPad(0, screenHeight: 1376))
    }

    // MARK: the running app

    @MainActor
    func testTheAppsPageIsOnTheSameOriginAndStore() {
        let host = WebHost.current
        XCTAssertNotNil(host)
        guard let host else { return }
        XCTAssertEqual(host.appOrigin, "capacitor://localhost")
        XCTAssertTrue(host.pageView.configuration.websiteDataStore === WKWebsiteDataStore.default())
        XCTAssertTrue(host.pageView.configuration.limitsNavigationsToAppBoundDomains)
        XCTAssertTrue(host.pageView.configuration.applicationNameForUserAgent?.hasSuffix("FoleviiOS/1.0") == true)
        XCTAssertNotNil(host.pageView.configuration.urlSchemeHandler(forURLScheme: "capacitor"))
        XCTAssertNotNil(host.pageView.configuration.urlSchemeHandler(forURLScheme: "folevi-file"))
        XCTAssertNotNil(host.plugins["FoleviNative"])
        XCTAssertNotNil(host.plugins["StatusBar"])
    }

    private func refusal(_ r: Result<MessageRouter.Call, MessageRouter.Refusal>) -> MessageRouter.Refusal? {
        if case .failure(let f) = r { return f }
        return nil
    }
}
