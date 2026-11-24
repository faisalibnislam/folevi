// app://folevi (AppScheme.swift): the same cases as the Electron Mac app's shell.test.ts drives against Electron's
// protocol.ts handler, on a small export in a temporary folder.
import XCTest
@testable import Folevi

final class SchemeTests: XCTestCase {
    private var root: URL!
    private var scheme: AppScheme!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-scheme-\(UUID().uuidString)", isDirectory: true)
        let fm = FileManager.default
        try fm.createDirectory(at: root.appendingPathComponent("_next/static/chunks"), withIntermediateDirectories: true)
        try fm.createDirectory(at: root.appendingPathComponent("settings"), withIntermediateDirectories: true)
        try Data("<!doctype html><title>Folevi</title>".utf8).write(to: root.appendingPathComponent("index.html"))
        try Data("<!doctype html><title>Settings</title>".utf8).write(to: root.appendingPathComponent("settings.html"))
        try Data("console.log(1)".utf8).write(to: root.appendingPathComponent("_next/static/chunks/app.js"))
        try Data("0123456789".utf8).write(to: root.appendingPathComponent("digits.txt"))
        // A symlink out of the export must not serve what it points at.
        let outside = fm.temporaryDirectory.appendingPathComponent("folevi-outside-\(UUID().uuidString).txt")
        try Data("secret".utf8).write(to: outside)
        try fm.createSymbolicLink(at: root.appendingPathComponent("escape.txt"), withDestinationURL: outside)
        scheme = AppScheme(root: root, serviceOrigin: "https://app.folevi.com", extraConnect: ["http://127.0.0.1:3210"], bodies: BridgeBodies())
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func get(_ path: String, method: String = "GET", mode: String = "local", headers: [String: String] = [:], body: Data? = nil) -> AppResponse {
        scheme.respond(AppRequest(url: URL(string: "app://folevi\(path)")!, method: method, headers: headers, body: body, mode: mode))
    }

    private func text(_ r: AppResponse) -> String { String(decoding: r.body, as: UTF8.self) }

    func testServesIndexAndFiles() {
        let r = get("/")
        XCTAssertEqual(r.status, 200)
        XCTAssertEqual(r.header("Content-Type"), "text/html; charset=utf-8")
        XCTAssertTrue(text(r).contains("<title>Folevi</title>"))
        let js = get("/_next/static/chunks/app.js")
        XCTAssertEqual(js.status, 200)
        XCTAssertEqual(js.header("Content-Type"), "text/javascript; charset=utf-8")
        XCTAssertEqual(js.header("Cache-Control"), "public, max-age=31536000, immutable")
        XCTAssertEqual(js.header("X-Content-Type-Options"), "nosniff")
    }

    func testSpaFallbackAndMissingAssets() {
        // An app path that isn't a file: index.html, and the client router takes it.
        let page = get("/d/01JABCDEFGHJKMNPQRSTVWXYZ0")
        XCTAssertEqual(page.status, 200)
        XCTAssertTrue(text(page).contains("<title>Folevi</title>"))
        XCTAssertEqual(get("/settings/").status, 200)
        // Missing scripts and the website's server routes stay missing.
        XCTAssertEqual(get("/_next/static/chunks/missing.js").status, 404)
        XCTAssertEqual(get("/api/auth/session").status, 404)
        XCTAssertEqual(get("/missing.png").status, 404)
    }

    func testRefusesPathsOutOfTheExport() {
        XCTAssertEqual(get("/..%2F..%2Fetc%2Fpasswd").status, 400)
        XCTAssertEqual(get("/a/%2e%2e/b").status, 400)
        XCTAssertEqual(get("/a%5Cb").status, 400)
        XCTAssertEqual(get("/a%00b").status, 400)
        XCTAssertEqual(get("/a//b").status, 400)
        // The symlink pointing outside isn't served (and a file-looking path doesn't fall back to the page).
        let escape = get("/escape.txt")
        XCTAssertEqual(escape.status, 404)
        XCTAssertFalse(text(escape).contains("secret"))
        XCTAssertNil(AppScheme.safeSegments("relative"))
        XCTAssertEqual(AppScheme.safeSegments("/"), [])
        XCTAssertEqual(AppScheme.safeSegments("/a/b%20c/"), ["a", "b c"])
    }

    func testOtherHostsAndMethods() {
        XCTAssertEqual(scheme.respond(AppRequest(url: URL(string: "app://other/")!)).status, 404)
        XCTAssertEqual(scheme.respond(AppRequest(url: URL(string: "app://folevi:8080/")!)).status, 404)
        XCTAssertEqual(get("/", method: "POST").status, 405)
        let head = get("/digits.txt", method: "HEAD")
        XCTAssertEqual(head.status, 200)
        XCTAssertEqual(head.header("Content-Length"), "10")
        XCTAssertTrue(head.body.isEmpty)
    }

    func testPolicyByMode() {
        let local = get("/", mode: "local").header("Content-Security-Policy") ?? ""
        XCTAssertTrue(local.contains("connect-src 'self';"), local)
        XCTAssertFalse(local.contains("convex"))
        let unset = get("/", mode: "unset").header("Content-Security-Policy") ?? ""
        XCTAssertTrue(unset.contains("connect-src 'self';"))
        let account = get("/", mode: "account").header("Content-Security-Policy") ?? ""
        XCTAssertTrue(account.contains("connect-src 'self' https://app.folevi.com https://*.convex.cloud wss://*.convex.cloud https://*.convex.site http://127.0.0.1:3210;"), account)
        XCTAssertTrue(account.contains("media-src 'self' blob: https:"))
        XCTAssertTrue(local.contains("object-src 'none'"))
        // Only pages carry the policy.
        XCTAssertNil(get("/digits.txt").header("Content-Security-Policy"))
    }

    func testRanges() {
        let part = get("/digits.txt", headers: ["Range": "bytes=2-4"])
        XCTAssertEqual(part.status, 206)
        XCTAssertEqual(text(part), "234")
        XCTAssertEqual(part.header("Content-Range"), "bytes 2-4/10")
        XCTAssertEqual(text(get("/digits.txt", headers: ["range": "bytes=-3"])), "789")
        XCTAssertEqual(text(get("/digits.txt", headers: ["Range": "bytes=7-"])), "789")
        XCTAssertEqual(get("/digits.txt", headers: ["Range": "bytes=20-"]).status, 416)
        // Several ranges aren't served: the whole file.
        XCTAssertEqual(get("/digits.txt", headers: ["Range": "bytes=0-1,3-4"]).status, 200)
        XCTAssertEqual(AppScheme.parseRange("bytes=0-99", size: 10), .bytes(0, 9))
        XCTAssertEqual(AppScheme.parseRange("bytes=-0", size: 10), .unsatisfiable)
        XCTAssertEqual(AppScheme.parseRange(nil, size: 10), .whole)
    }

    func testLibraryFiles() {
        let sha = String(repeating: "ab", count: 32)
        XCTAssertEqual(get("/_files/\(sha)").status, 404, "no library yet")
        XCTAssertEqual(get("/_files/not-a-sha").status, 400)
        XCTAssertEqual(get("/_files/\(sha)/more").status, 404)
        final class Fake: LibraryFiles {
            let bytes = Data("hello world".utf8)
            func stat(_ sha256: String) -> LibraryFileInfo? { LibraryFileInfo(size: bytes.count, mime: "text/html") }
            func read(_ sha256: String, _ start: Int, _ end: Int) throws -> Data { bytes.subdata(in: start..<(end + 1)) }
        }
        scheme.files = Fake()
        let whole = get("/_files/\(sha)?type=image/svg%2Bxml")
        XCTAssertEqual(whole.status, 200)
        XCTAssertEqual(text(whole), "hello world")
        // HTML or SVG never goes out as itself: bytes, sandboxed.
        XCTAssertEqual(whole.header("Content-Type"), "application/octet-stream")
        XCTAssertEqual(whole.header("Content-Security-Policy"), AppScheme.filesCsp)
        XCTAssertEqual(whole.header("X-Content-Type-Options"), "nosniff")
        let part = get("/_files/\(sha)", headers: ["Range": "bytes=6-"])
        XCTAssertEqual(part.status, 206)
        XCTAssertEqual(text(part), "world")
        XCTAssertEqual(part.header("Content-Range"), "bytes 6-10/11")
        XCTAssertEqual(AppScheme.safeFileType("image/png; charset=x"), "image/png")
        XCTAssertEqual(AppScheme.safeFileType(nil, "audio/mpeg"), "audio/mpeg")
        XCTAssertEqual(AppScheme.safeFileType("text/html", "image/svg+xml"), "application/octet-stream")
    }

    func testBridgeBodies() {
        let id = "c1abcdefgh"
        let posted = get("/_bridge/\(id)", method: "POST", body: Data(#"{"path":"a"}"#.utf8))
        XCTAssertEqual(posted.status, 200)
        XCTAssertEqual(scheme.bodies.takeCall(id), Data(#"{"path":"a"}"#.utf8))
        XCTAssertNil(scheme.bodies.takeCall(id), "a body is taken once")
        XCTAssertEqual(get("/_bridge/bad!id", method: "POST").status, 400)
        let reply = scheme.bodies.putReply(Data(#"{"big":true}"#.utf8))
        XCTAssertEqual(text(get("/_bridge/\(reply)")), #"{"big":true}"#)
        XCTAssertEqual(get("/_bridge/\(reply)").status, 404, "an answer is read once")
    }

    func testOwnPages() {
        let offline = get("/_folevi-offline?url=app%3A%2F%2Ffolevi%2Fdocuments")
        XCTAssertEqual(offline.status, 200)
        XCTAssertTrue(text(offline).contains("Try again"))
    }

    func testMissingExport() {
        let empty = AppScheme(root: root.appendingPathComponent("nothing"), serviceOrigin: "https://app.folevi.com")
        XCTAssertEqual(empty.respond(AppRequest(url: URL(string: "app://folevi/")!)).status, 503)
    }
}
