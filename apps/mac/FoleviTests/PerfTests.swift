// Headless timings of the shell's hot paths (docs/perf/apple-results.md): the app:// handler, the bridge script
// every web view gets, and the content rules a library window needs. XCTest's `measure {}` only: nothing here
// opens a window, and the rule lists go to a store in a temporary folder, never the app's own.
import XCTest
import WebKit
@testable import Folevi

@MainActor
final class PerfTests: XCTestCase {
    private var root: URL!
    private var scheme: AppScheme!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-perf-\(UUID().uuidString)", isDirectory: true)
        let fm = FileManager.default
        try fm.createDirectory(at: root.appendingPathComponent("_next/static/chunks"), withIntermediateDirectories: true)
        try Data(("<!doctype html><title>Folevi</title>" + String(repeating: "<div></div>", count: 4000)).utf8).write(to: root.appendingPathComponent("index.html"))
        // A chunk the size of the web app's larger ones (about 300 KB).
        try Data(String(repeating: "console.log(1);", count: 20_000).utf8).write(to: root.appendingPathComponent("_next/static/chunks/app.js"))
        scheme = AppScheme(root: root, serviceOrigin: "https://app.folevi.com", extraConnect: [], bodies: BridgeBodies())
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func get(_ path: String) -> AppResponse {
        scheme.respond(AppRequest(url: URL(string: "app://folevi\(path)")!, method: "GET", headers: [:], body: nil, mode: "local"))
    }

    /// 100 requests a round: a hashed chunk, the page itself and an app path (the SPA fallback).
    func testSchemeRespond() {
        XCTAssertEqual(get("/_next/static/chunks/app.js").status, 200)
        measure {
            for _ in 0..<34 {
                _ = get("/_next/static/chunks/app.js")
                _ = get("/")
                _ = get("/notes/abc")
            }
        }
    }

    /// What every web view did before the cache: the bridge files read from the bundle and put together, then the
    /// bootstrap written in, 50 views a round.
    func testBridgeScriptUncached() {
        let boot = Bootstrap(mode: "local", place: "library")
        measure {
            for _ in 0..<50 {
                let data = try? JSONSerialization.data(withJSONObject: boot.json)
                _ = WebViewFactory.assembleTemplate()?.replacingOccurrences(of: "\"__FOLEVI_BOOT__\"", with: String(decoding: data ?? Data(), as: UTF8.self))
            }
        }
    }

    /// The script every web view gets at document start, 50 views a round (the bundle read once).
    func testBridgeScript() {
        let boot = Bootstrap(mode: "local", place: "library")
        XCTAssertNotNil(WebViewFactory.bridgeScript(boot))
        measure {
            for _ in 0..<50 { _ = WebViewFactory.bridgeScript(boot) }
        }
    }

    /// The bridge script is the same text whether it was assembled now or came from the cache, bootstrap aside.
    func testBridgeScriptKeepsTheBootstrap() throws {
        let a = try XCTUnwrap(WebViewFactory.bridgeScript(Bootstrap(mode: "local", place: "library")))
        let b = try XCTUnwrap(WebViewFactory.bridgeScript(Bootstrap(mode: "account", place: "acct:u1")))
        XCTAssertFalse(a.contains("__FOLEVI_BOOT__"))
        XCTAssertFalse(a.contains("/*__FOLEVI_SHELL_BRIDGE__*/"))
        XCTAssertTrue(a.contains(#""current":"library""#))
        XCTAssertTrue(b.contains(#""current":"acct:u1""#))
        XCTAssertNotEqual(a, b)
    }

    private func store() throws -> (WKContentRuleListStore, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-rules-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return (try XCTUnwrap(WKContentRuleListStore(url: dir)), dir)
    }

    private func wait(_ work: @escaping @MainActor () async -> Void) {
        let done = expectation(description: "done")
        Task { @MainActor in
            await work()
            done.fulfill()
        }
        wait(for: [done], timeout: 30)
    }

    /// Compiling the library's rules, as every launch did.
    func testRulesCompile() throws {
        let (store, dir) = try store()
        defer { try? FileManager.default.removeItem(at: dir) }
        let json = Places.localRulesJSON(serviceHost: "app.folevi.com")
        var n = 0
        measure {
            n += 1
            let id = "perf-\(n)"
            wait { _ = try? await store.compileContentRuleList(forIdentifier: id, encodedContentRuleList: json) }
        }
    }

    /// Looking the compiled list up (what a launch does now once it was compiled before).
    func testRulesLookup() throws {
        let (store, dir) = try store()
        defer { try? FileManager.default.removeItem(at: dir) }
        let json = Places.localRulesJSON(serviceHost: "app.folevi.com")
        wait { _ = await WebViewFactory.ruleList("folevi-library", json: json, store: store) }
        measure {
            wait { _ = await WebViewFactory.ruleList("folevi-library", json: json, store: store) }
        }
    }

    /// The lookup compiles once per rule text, and a changed text replaces the older list.
    func testRuleListCompilesOncePerText() throws {
        let (store, dir) = try store()
        defer { try? FileManager.default.removeItem(at: dir) }
        let a = Places.localRulesJSON(serviceHost: "a.example.com")
        let b = Places.localRulesJSON(serviceHost: "b.example.com")
        wait {
            let first = await WebViewFactory.ruleList("folevi-library", json: a, store: store)
            XCTAssertNotNil(first)
            let again = await WebViewFactory.ruleList("folevi-library", json: a, store: store)
            XCTAssertEqual(first?.identifier, again?.identifier)
            let other = await WebViewFactory.ruleList("folevi-library", json: b, store: store)
            XCTAssertNotNil(other)
            XCTAssertNotEqual(first?.identifier, other?.identifier)
            let ids = await store.availableIdentifiers() ?? []
            XCTAssertEqual(ids, [other!.identifier])
        }
    }
}
