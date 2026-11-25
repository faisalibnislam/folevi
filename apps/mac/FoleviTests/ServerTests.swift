// Folevi Server places (shared ShellServer.swift, ShellPlaces.swift; docs/self-hosting/CONTRACT.md §6): the
// addresses Folevi accepts, version checks, what folevi.json must say, the order names are tried in, the page's
// security policy for a server place (and Folevi Cloud's unchanged), places.json from before servers, and a new
// account taking the server its sign-in went to.
import XCTest
@testable import Folevi

final class ServerTests: XCTestCase {
    override func setUp() {
        ShellPlaces.resetForTests()
    }

    override func tearDown() {
        ShellPlaces.resetForTests()
    }

    private func info(_ patch: [String: Any] = [:]) -> [String: Any] {
        var i: [String: Any] = [
            "kind": "folevi-server", "apiVersion": 1, "name": "Smith family", "version": "1.0.0", "minAppVersion": "1.6.0",
            "urls": ["app": "https://nas.example.com", "convex": "https://nas.example.com/convex", "convexSite": "https://nas.example.com/convex-site"],
            "connect": ["serverId": "abcde12345", "hostnames": ["abcde12345.folevi.app", "192-168-1-20.abcde12345.folevi.app:8443"]],
            "needsSetup": false,
        ]
        for (k, v) in patch { i[k] = v }
        return i
    }

    private func server(_ patch: [String: Any] = [:], origin: String = "https://nas.example.com", app: String = "1.6.0") -> ShellServer? {
        if case .success(let s) = ShellServer.check(info(patch), origin: origin, appVersion: app) { return s }
        return nil
    }

    private func problem(_ patch: [String: Any], app: String = "1.6.0") -> ShellServer.Problem? {
        if case .failure(let p) = ShellServer.check(info(patch), origin: "https://nas.example.com", appVersion: app) { return p }
        return nil
    }

    // MARK: addresses

    func testAddressesFoleviAccepts() {
        XCTAssertEqual(ShellServer.normalizeOrigin("https://NAS.Example.com/"), "https://nas.example.com")
        XCTAssertEqual(ShellServer.normalizeOrigin("  nas.example.com "), "https://nas.example.com", "no scheme means https")
        XCTAssertEqual(ShellServer.normalizeOrigin("https://nas.example.com:443"), "https://nas.example.com")
        XCTAssertEqual(ShellServer.normalizeOrigin("https://nas.example.com:8443"), "https://nas.example.com:8443")
        // http only on the home network.
        XCTAssertEqual(ShellServer.normalizeOrigin("http://192.168.1.20:8460"), "http://192.168.1.20:8460")
        XCTAssertEqual(ShellServer.normalizeOrigin("http://10.0.0.5"), "http://10.0.0.5")
        XCTAssertEqual(ShellServer.normalizeOrigin("http://172.20.1.1:8460"), "http://172.20.1.1:8460")
        XCTAssertEqual(ShellServer.normalizeOrigin("http://100.101.102.103:8460"), "http://100.101.102.103:8460", "Tailscale")
        XCTAssertEqual(ShellServer.normalizeOrigin("http://nas.local:8460"), "http://nas.local:8460")
        XCTAssertEqual(ShellServer.normalizeOrigin("http://nas:8460"), "http://nas:8460")
        XCTAssertEqual(ShellServer.normalizeOrigin("http://[fd12:3456::1]:8460"), "http://[fd12:3456::1]:8460")
        XCTAssertNil(ShellServer.normalizeOrigin("http://nas.example.com"), "http on the internet")
        XCTAssertNil(ShellServer.normalizeOrigin("http://8.8.8.8"))
        XCTAssertNil(ShellServer.normalizeOrigin("http://172.32.0.1"))
        XCTAssertNil(ShellServer.normalizeOrigin("http://[2001:db8::1]"))
        // Only an origin.
        for bad in ["", "ftp://nas.example.com", "https://nas.example.com/app", "https://nas.example.com/?x=1", "https://nas.example.com/#a",
                    "https://me:pw@nas.example.com", "https://nas example.com", "https://", "javascript:alert(1)", "https://nas..example.com"] {
            XCTAssertNil(ShellServer.normalizeOrigin(bad), bad)
        }
    }

    func testHomeAddresses() {
        for yes in ["localhost", "nas", "nas.local", "10.1.2.3", "127.0.0.1", "192.168.0.1", "172.16.0.1", "172.31.255.255", "169.254.1.1", "100.64.0.1", "::1", "fe80::1", "fc00::1"] {
            XCTAssertTrue(ShellServer.isLocalHost(yes), yes)
        }
        for no in ["example.com", "8.8.8.8", "172.15.0.1", "100.128.0.1", "2001:db8::1", "192.169.0.1", "1.2.3"] {
            XCTAssertFalse(ShellServer.isLocalHost(no), no)
        }
    }

    // MARK: versions

    func testVersionComparison() {
        XCTAssertEqual(ShellServer.compareVersions("1.6.0", "1.6.0"), 0)
        XCTAssertEqual(ShellServer.compareVersions("1.6", "1.6.0"), 0)
        XCTAssertEqual(ShellServer.compareVersions("1.5.73", "1.6.0"), -1)
        XCTAssertEqual(ShellServer.compareVersions("1.10.0", "1.9.9"), 1, "numbers, not text")
        XCTAssertEqual(ShellServer.compareVersions("v2.0.0", "1.99"), 1)
        XCTAssertEqual(ShellServer.compareVersions("1.6.0-beta.2", "1.6.0"), 0, "a pre-release counts as its version")
        XCTAssertEqual(ShellServer.compareVersions("", "0.0.1"), -1)
    }

    // MARK: folevi.json

    func testAServerThisAppCanUse() throws {
        let s = try XCTUnwrap(server())
        XCTAssertEqual(s.name, "Smith family")
        XCTAssertEqual(s.serverId, "abcde12345")
        XCTAssertEqual(s.urls.convex, "https://nas.example.com/convex")
        XCTAssertEqual(s.appURL?.absoluteString, "https://nas.example.com")
        let j = s.json
        XCTAssertEqual(j["origin"] as? String, "https://nas.example.com")
        XCTAssertEqual((j["urls"] as? [String: String])?["convexSite"], "https://nas.example.com/convex-site")
    }

    func testWhatIsRefusedAndWhy() {
        XCTAssertEqual(problem(["kind": "folevi-cloud"])?.code, "folevi_cloud")
        XCTAssertEqual(problem(["kind": "something"])?.code, "not_folevi")
        XCTAssertEqual(problem(["apiVersion": 2])?.code, "app_outdated", "a newer API than this app speaks")
        XCTAssertEqual(problem(["apiVersion": 0])?.code, "server_outdated")
        XCTAssertEqual(problem(["version": "0.9.0"])?.code, "server_outdated")
        XCTAssertEqual(problem([:], app: "1.5.73")?.code, "app_outdated", "below minAppVersion")
        XCTAssertNil(problem([:], app: "1.6.0"))
        XCTAssertEqual(problem(["needsSetup": true])?.code, "needs_setup")
        XCTAssertEqual(problem(["urls": ["app": "http://nas.example.com", "convex": "https://nas.example.com/convex", "convexSite": "https://nas.example.com/convex-site"]])?.code, "not_folevi", "http on the internet")
        XCTAssertEqual(problem(["urls": ["app": "https://nas.example.com"]])?.code, "not_folevi")
        XCTAssertEqual(ShellServer.Problem.serverOutdated.message, "This server is too old for this app. Ask the person who runs this server to update it.")
    }

    func testTheOrderNamesAreTriedIn() throws {
        let s = try XCTUnwrap(server())
        XCTAssertEqual(s.candidates, ["https://192-168-1-20.abcde12345.folevi.app:8443", "https://nas.example.com", "https://abcde12345.folevi.app"])
        var moved = s
        moved.active = "https://abcde12345.folevi.app"
        XCTAssertEqual(moved.activeUrls.convex, "https://abcde12345.folevi.app/convex")
        XCTAssertEqual(moved.appURL?.absoluteString, "https://abcde12345.folevi.app")
        XCTAssertEqual(moved.json["addedOrigin"] as? String, "https://nas.example.com")
        // Bad names are left out.
        let odd = try XCTUnwrap(server(["connect": ["serverId": "BAD ID", "hostnames": ["ok.folevi.app", "bad name", "x/y", 3]]]))
        XCTAssertEqual(odd.hostnames, ["ok.folevi.app"])
        XCTAssertNil(odd.serverId)
    }

    // MARK: the page's policy

    func testPolicyForAServerPlace() throws {
        let s = try XCTUnwrap(server())
        let csp = AppScheme.csp(mode: "account", serviceOrigin: "https://app.folevi.com", extraConnect: ["http://127.0.0.1:3210"], server: s)
        let connect = try XCTUnwrap(csp.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }.first { $0.hasPrefix("connect-src") })
        for origin in ["https://nas.example.com", "wss://nas.example.com", "https://abcde12345.folevi.app", "wss://abcde12345.folevi.app",
                       "https://192-168-1-20.abcde12345.folevi.app:8443", "wss://192-168-1-20.abcde12345.folevi.app:8443"] {
            XCTAssertTrue(connect.split(separator: " ").contains(Substring(origin)), "\(origin) in \(connect)")
        }
        // Folevi Cloud's hosts aren't reachable from a server's pages.
        XCTAssertFalse(connect.contains("convex.cloud"))
        XCTAssertFalse(connect.contains("app.folevi.com"))
        XCTAssertFalse(connect.contains("127.0.0.1"))
        // A home address over http reaches ws too.
        let lan = try XCTUnwrap(server(["urls": ["app": "http://192.168.1.20:8460", "convex": "http://192.168.1.20:8460/convex", "convexSite": "http://192.168.1.20:8460/convex-site"], "connect": ["hostnames": []]], origin: "http://192.168.1.20:8460"))
        XCTAssertEqual(ShellPolicy.connectSources(lan), ["http://192.168.1.20:8460", "ws://192.168.1.20:8460"])
        // Local mode reaches nothing, server or not.
        XCTAssertTrue(AppScheme.csp(mode: "local", serviceOrigin: "https://app.folevi.com", server: s).contains("connect-src 'self';"))
    }

    func testFoleviCloudPolicyIsUnchanged() {
        let cloud = AppScheme.csp(mode: "account", serviceOrigin: "https://app.folevi.com", extraConnect: ["http://127.0.0.1:3210"])
        XCTAssertTrue(cloud.contains("connect-src 'self' https://app.folevi.com https://*.convex.cloud wss://*.convex.cloud https://*.convex.site http://127.0.0.1:3210;"), cloud)
    }

    func testTheSchemeUsesTheViewsServer() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-server-scheme-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("<!doctype html><title>Folevi</title>".utf8).write(to: root.appendingPathComponent("index.html"))
        let scheme = AppScheme(root: root, serviceOrigin: "https://app.folevi.com", bodies: BridgeBodies())
        let s = try XCTUnwrap(server())
        let page = scheme.respond(AppRequest(url: URL(string: "app://folevi/documents")!, mode: "account", server: s))
        let csp = try XCTUnwrap(page.header("Content-Security-Policy"))
        XCTAssertTrue(csp.contains("https://nas.example.com"))
        XCTAssertFalse(csp.contains("convex.cloud"))
    }

    // MARK: places

    func testPlacesFromBeforeServersReadUnchanged() throws {
        let old = #"{"v":1,"current":"acct:oldUser","library":false,"accounts":[{"userId":"oldUser","name":"Ana","email":"ana@example.com","workspaces":[],"unread":0,"reminders":0,"waiting":0}]}"#
        let state = try JSONDecoder().decode(ShellPlaces.State.self, from: Data(old.utf8))
        XCTAssertEqual(state.accounts.first?.userId, "oldUser")
        XCTAssertNil(state.accounts.first?.server, "an account from before is Folevi Cloud's")
        // And a server account survives the round trip.
        var next = state
        next.accounts[0].server = try XCTUnwrap(server())
        let again = try JSONDecoder().decode(ShellPlaces.State.self, from: JSONEncoder().encode(next))
        XCTAssertEqual(again.accounts.first?.server, next.accounts[0].server)
    }

    func testANewAccountTakesTheServerItsSignInWentTo() throws {
        let s = try XCTUnwrap(server())
        XCTAssertNil(ShellPlaces.server(of: nil), "no sign-in screen yet")
        ShellPlaces.setCurrent(nil, pending: true, server: s)
        XCTAssertEqual(ShellPlaces.server(of: nil), s)
        XCTAssertEqual(ShellPlaces.actingServer, s)
        XCTAssertEqual(ShellAuth.shared.service.absoluteString, "https://nas.example.com", "sign-in goes to the server")
        let a = try XCTUnwrap(ShellPlaces.addAccount(userId: "serverAna", name: "Ana", email: "ana@nas.example.com", avatarUrl: nil))
        XCTAssertEqual(a.server, s)
        XCTAssertEqual(ShellPlaces.server(ofUser: "serverAna"), s)
        let listed = ShellPlaces.list(libraryKind: nil, displayPath: "", configured: false).first { $0["id"] as? String == a.id }
        XCTAssertEqual((listed?["server"] as? [String: Any])?["name"] as? String, "Smith family")
        // Opening it: the page's website is the server's; back on Folevi Cloud's sign-in, it's Folevi Cloud's again.
        ShellPlaces.setCurrent(a.id)
        XCTAssertNil(ShellPlaces.pendingServer)
        XCTAssertEqual(ShellAuth.shared.service(for: "serverAna").absoluteString, "https://nas.example.com")
        ShellPlaces.setCurrent(nil, pending: true)
        XCTAssertNil(ShellPlaces.actingServer)
        XCTAssertEqual(ShellAuth.shared.service, ShellAuth.shared.cloudService)
        // A Folevi Cloud account added from there has no server.
        let b = try XCTUnwrap(ShellPlaces.addAccount(userId: "cloudBen", name: "Ben", email: "ben@example.com", avatarUrl: nil))
        XCTAssertNil(b.server)
    }

    func testTheBestConnectionIsKept() throws {
        let s = try XCTUnwrap(server())
        ShellPlaces.setCurrent(nil, pending: true, server: s)
        let a = try XCTUnwrap(ShellPlaces.addAccount(userId: "serverAna", name: "Ana", email: "ana@nas.example.com", avatarUrl: nil))
        ShellPlaces.setActiveOrigin(a.id, "https://192-168-1-20.abcde12345.folevi.app:8443")
        XCTAssertEqual(ShellPlaces.server(of: a.id)?.activeOrigin, "https://192-168-1-20.abcde12345.folevi.app:8443")
        // Only one of its own names.
        ShellPlaces.setActiveOrigin(a.id, "https://elsewhere.example.com")
        XCTAssertEqual(ShellPlaces.server(of: a.id)?.activeOrigin, "https://192-168-1-20.abcde12345.folevi.app:8443")
        ShellPlaces.setActiveOrigin(a.id, nil)
        XCTAssertEqual(ShellPlaces.server(of: a.id)?.activeOrigin, "https://nas.example.com")
    }
}
