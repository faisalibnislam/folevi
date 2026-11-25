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
        // Folevi Cloud (no server): the narrowing header that restores the export's old limits.
        let cloud = try XCTUnwrap(scheme.respond(url: URL(string: "capacitor://localhost/documents")!, method: "GET").headers["Content-Security-Policy"])
        XCTAssertEqual(cloud, ShellPolicy.cloudNarrowing)
        XCTAssertFalse(cloud.contains("http:"))
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

    /// A places.json as the app wrote it before servers, every field set: Folevi Cloud accounts read the same and
    /// are written back the same (no `server` key appears), so sign-in and switching work as before.
    func testACurrentPlacesFileRoundTripsUnchanged() throws {
        let file = #"{"v":1,"current":"acct:userA","library":true,"quickAdd":"library","lastAdded":"acct:userB","accounts":[{"userId":"userA","profileId":"prof1","name":"Ana","email":"ana@example.com","avatarUrl":"https://example.com/a.png","workspaces":[{"id":"w1","name":"Home","logoUrl":"https://example.com/w.png"},{"id":"w2","name":"Work"}],"unread":3,"reminders":2,"waiting":1},{"userId":"userB","name":"Ben","email":"ben@example.com","workspaces":[],"unread":0,"reminders":0,"waiting":0}]}"#
        let state = try JSONDecoder().decode(ShellPlaces.State.self, from: Data(file.utf8))
        XCTAssertEqual(state.current, "acct:userA")
        XCTAssertEqual(state.accounts.map(\.userId), ["userA", "userB"])
        XCTAssertTrue(state.accounts.allSatisfy { $0.server == nil }, "accounts from before are Folevi Cloud's")
        let written = try JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as! NSDictionary
        let original = try JSONSerialization.jsonObject(with: Data(file.utf8)) as! NSDictionary
        XCTAssertEqual(written, original, "written back exactly as read")
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
