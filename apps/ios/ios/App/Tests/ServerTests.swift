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

    /// A server's addresses are one origin, its own, never Folevi Cloud's (the Mac's ServerTests has the long form).
    func testAServersAddressesAreItsOwn() async {
        let cloud = URL(string: "https://app.folevi.com")!
        let doc = { (urls: [String: Any]) -> [String: Any] in
            ["kind": "folevi-server", "apiVersion": 1, "name": "Smith family", "version": "1.0.0", "minAppVersion": "1.6.0", "urls": urls, "connect": ["serverId": "abcde12345", "hostnames": ["abcde12345.folevi.app"]]]
        }
        let attack = doc(["app": "https://app.folevi.com", "convex": "https://evil.example/convex", "convexSite": "https://evil.example/convex-site"])
        if case .failure(let p) = ShellServer.check(attack, origin: "https://evil.example", appVersion: "1.6.0", cloud: cloud) { XCTAssertEqual(p.code, "not_folevi") } else { XCTFail("Folevi Cloud's sign-in with another Convex") }
        let name = "https://abcde12345.folevi.app", lan = "http://192.168.1.20:8460"
        let genuine = doc(["app": name, "convex": name + "/convex", "convexSite": name + "/convex-site"])
        if case .failure = ShellServer.check(genuine, origin: name, appVersion: "1.6.0", cloud: cloud) { XCTFail("a genuine server") }
        // A home address typed, the public name published: that name must answer as the same server.
        if case .failure = await ShellServer.lookUp(lan, appVersion: "1.6.0", cloud: cloud, fetch: { _ in genuine }) { XCTFail("a genuine server at its home address") }
        var other = genuine
        other["connect"] = ["serverId": "zzzzz99999"]
        let r = await ShellServer.lookUp(lan, appVersion: "1.6.0", cloud: cloud, fetch: { $0 == lan ? genuine : other })
        if case .failure(let p) = r { XCTAssertEqual(p.code, "not_folevi") } else { XCTFail("someone else's server at the published address") }
    }

    /// A sign-in that comes back with the id of an account from another server is refused, and the one session
    /// older builds kept (Folevi Cloud's) is never read on a server's sign-in screen.
    func testSessionsStayWithTheServerThatIssuedThem() throws {
        let nas = try XCTUnwrap(server())
        ShellPlaces.setCurrent(nil, pending: true)
        XCTAssertNotNil(ShellPlaces.addAccount(userId: "iosCloudAna", name: "Ana", email: "ana@example.com", avatarUrl: nil))
        XCTAssertFalse(ShellAuth.belongsElsewhere("iosCloudAna"))
        let legacy = "legacy-cloud-session-0123456789abcdef" // gitleaks:allow (a made-up token)
        let before = ShellAuth.shared.token(for: nil)
        ShellAuth.shared.setToken(legacy, for: nil)
        defer { ShellAuth.shared.setToken(before, for: nil) }
        XCTAssertEqual(ShellAuth.shared.token, legacy)
        ShellPlaces.setCurrent(nil, pending: true, server: nas)
        XCTAssertTrue(ShellAuth.belongsElsewhere("iosCloudAna"))
        XCTAssertEqual(ShellAuth.shared.issuer(of: "iosCloudAna"), ShellAuth.shared.cloudService)
        XCTAssertNil(ShellAuth.shared.issuer(of: "iosSomeoneNew"))
        XCTAssertNil(ShellAuth.shared.token)
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

    /// A server place's session is a Keychain item of its own (ShellAuth's service, the item named after the place's
    /// account, as for Folevi Cloud's accounts), never in places.json or the place list the page reads, and moving
    /// to another of the server's names keeps it.
    func testAServerPlacesTokenStaysInTheKeychain() throws {
        let s = try XCTUnwrap(server())
        ShellPlaces.setCurrent(nil, pending: true, server: s)
        let a = try XCTUnwrap(ShellPlaces.addAccount(userId: "iosServerBen", name: "Ben", email: "ben@nas.example.com", avatarUrl: nil))
        let token = "fake-server-session-0123456789abcdef" // gitleaks:allow (a made-up token)
        defer { ShellAuth.shared.setToken(nil, for: a.userId) }
        ShellAuth.shared.setToken(token, for: a.userId)

        XCTAssertEqual(Keychain.getString("com.folevi.shell-auth", "session.\(a.userId)"), token)
        XCTAssertEqual(ShellAuth.shared.token(for: a.userId), token)
        XCTAssertNil(ShellAuth.shared.token(for: "iosServerSomeoneElse"))
        XCTAssertEqual(ShellAuth.shared.service(for: a.userId).absoluteString, "https://nas.example.com")

        let saved = try XCTUnwrap(String(data: JSONEncoder().encode(ShellPlaces.state), encoding: .utf8))
        XCTAssertFalse(saved.contains(token))
        let listed = try JSONSerialization.data(withJSONObject: ShellPlaces.list(libraryKind: nil, displayPath: "", configured: false))
        XCTAssertFalse(String(decoding: listed, as: UTF8.self).contains(token))

        ShellPlaces.setActiveOrigin(a.id, "https://abcde12345.folevi.app")
        XCTAssertEqual(ShellAuth.shared.token(for: a.userId), token)

        ShellAuth.shared.setToken(nil, for: a.userId)
        XCTAssertNil(Keychain.getString("com.folevi.shell-auth", "session.\(a.userId)"))
    }
}
