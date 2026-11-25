// Folevi Server places on iPhone and iPad (shared Native/Shell/ShellServer.swift; the Mac's FoleviTests/ServerTests
// covers the same code at length): the addresses Folevi accepts, version checks, the policy a server place's page
// gets from capacitor://localhost (Folevi Cloud's pages get none, as before), and a new account taking the server
// its sign-in went to. Places are put back after each test.
import XCTest
@testable import App

final class ServerTests: XCTestCase {
    private var saved: ShellPlaces.TestSnapshot?

    override func setUp() {
        saved = ShellPlaces.snapshotForTests()
        ShellPlaces.resetForTests()
    }

    override func tearDown() {
        if let saved { ShellPlaces.restoreForTests(saved) }
    }

    private func server() -> ShellServer? {
        let info: [String: Any] = [
            "kind": "folevi-server", "apiVersion": 1, "name": "Smith family", "version": "1.0.0", "minAppVersion": "1.6.0",
            "urls": ["app": "https://nas.example.com", "convex": "https://nas.example.com/convex", "convexSite": "https://nas.example.com/convex-site"],
            "connect": ["serverId": "abcde12345", "hostnames": ["abcde12345.folevi.app"]],
        ]
        if case .success(let s) = ShellServer.check(info, origin: "https://nas.example.com", appVersion: "1.6.0") { return s }
        return nil
    }

    func testAddressesAndVersions() {
        XCTAssertEqual(ShellServer.normalizeOrigin("nas.example.com"), "https://nas.example.com")
        XCTAssertEqual(ShellServer.normalizeOrigin("http://192.168.1.20:8460"), "http://192.168.1.20:8460")
        XCTAssertNil(ShellServer.normalizeOrigin("http://nas.example.com"))
        XCTAssertNil(ShellServer.normalizeOrigin("https://nas.example.com/path"))
        XCTAssertEqual(ShellServer.compareVersions("1.5.73", "1.6.0"), -1)
        XCTAssertEqual(ShellServer.compareVersions("1.10", "1.9.9"), 1)
        XCTAssertEqual(ShellServer.compareVersions("1.6.0", "1.6"), 0)
        if case .success = ShellServer.check(["kind": "folevi-server", "apiVersion": 1, "version": "1.0.0", "minAppVersion": "9.0.0"], origin: "https://nas.example.com", appVersion: "1.6.0") { XCTFail("app too old") }
    }

    func testAServerPlacesPageGetsItsOwnPolicy() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-server-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("<html>index</html>".utf8).write(to: root.appendingPathComponent("index.html"))
        let scheme = AppScheme(root: root)
        // Folevi Cloud (no server): no header, the export's meta policy alone.
        XCTAssertNil(scheme.respond(url: URL(string: "capacitor://localhost/documents")!, method: "GET").headers["Content-Security-Policy"])
        let s = try XCTUnwrap(server())
        ShellPlaces.setCurrent(nil, pending: true, server: s)
        let csp = try XCTUnwrap(scheme.respond(url: URL(string: "capacitor://localhost/documents")!, method: "GET").headers["Content-Security-Policy"])
        XCTAssertTrue(csp.contains("https://nas.example.com wss://nas.example.com"), csp)
        XCTAssertTrue(csp.contains("https://abcde12345.folevi.app"), csp)
        XCTAssertFalse(csp.contains("convex.cloud"))
        // Only pages carry it.
        try Data("x".utf8).write(to: root.appendingPathComponent("a.txt"))
        XCTAssertNil(scheme.respond(url: URL(string: "capacitor://localhost/a.txt")!, method: "GET").headers["Content-Security-Policy"])
    }

    func testANewAccountTakesTheServerItsSignInWentTo() throws {
        let s = try XCTUnwrap(server())
        ShellPlaces.setCurrent(nil, pending: true, server: s)
        XCTAssertEqual(ShellAuth.shared.service.absoluteString, "https://nas.example.com")
        let a = try XCTUnwrap(ShellPlaces.addAccount(userId: "iosServerAna", name: "Ana", email: "ana@nas.example.com", avatarUrl: nil))
        XCTAssertEqual(a.server, s)
        // The share sheet and widgets save through Folevi Cloud's API: a server's accounts aren't offered there.
        XCTAssertFalse(SaveTargets.load().contains { $0.id == a.id })
    }
}
