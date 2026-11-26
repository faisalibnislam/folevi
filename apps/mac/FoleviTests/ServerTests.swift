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

    // MARK: a server's addresses are its own

    /// What a server could publish to have the app sign in at Folevi Cloud and then talk to the server with what
    /// Folevi Cloud issued: Folevi Cloud's website for sign-in, its own address for the data.
    private static let attack: [String: Any] = ["app": "https://app.folevi.com", "convex": "https://evil.example/convex", "convexSite": "https://evil.example/convex-site"]

    func testAServersAddressesAreOneOriginAndNeverFoleviClouds() throws {
        let cloud = URL(string: "https://app.folevi.com")!
        let refused = { (urls: [String: Any], origin: String) -> String? in
            if case .failure(let p) = ShellServer.check(self.info(["urls": urls]), origin: origin, appVersion: "1.6.0", cloud: cloud) { return p.code }
            return nil
        }
        XCTAssertEqual(refused(Self.attack, "https://evil.example"), "not_folevi", "Folevi Cloud's sign-in with the server's own Convex")
        XCTAssertEqual(refused(["app": "https://evil.example", "convex": "https://other.example/convex", "convexSite": "https://evil.example/convex-site"], "https://evil.example"), "not_folevi", "two origins")
        XCTAssertEqual(refused(["app": "https://evil.example", "convex": "https://evil.example/convex", "convexSite": "https://evil.example:8443/convex-site"], "https://evil.example"), "not_folevi", "another port is another origin")
        for host in ["app.folevi.com", "folevi.com", "x.folevi.com", "happy-otter-123.convex.cloud", "happy-otter-123.convex.site"] {
            XCTAssertEqual(refused(["app": "https://\(host)", "convex": "https://\(host)/convex", "convexSite": "https://\(host)/convex-site"], "https://evil.example"), "not_folevi", host)
        }
        // This build's own website, whatever it is called (a development build's).
        if case .success = ShellServer.check(info(["urls": ["app": "https://dev.example", "convex": "https://dev.example/convex", "convexSite": "https://dev.example/convex-site"]]), origin: "https://evil.example", appVersion: "1.6.0", cloud: URL(string: "https://dev.example")!) { XCTFail("this build's website") }
        // A genuine server: one origin, its own (a Folevi Connect name is under folevi.app, not Folevi Cloud).
        XCTAssertNil(refused(["app": "https://nas.example.com", "convex": "https://nas.example.com/convex", "convexSite": "https://nas.example.com/convex-site"], "https://nas.example.com"))
        XCTAssertNil(refused(["app": "https://abcde12345.folevi.app", "convex": "https://abcde12345.folevi.app/convex", "convexSite": "https://abcde12345.folevi.app/convex-site"], "http://192.168.1.20:8460"))
        XCTAssertNil(refused(["app": "http://192.168.1.20:8460", "convex": "http://192.168.1.20:8460/convex", "convexSite": "http://192.168.1.20:8460/convex-site"], "http://192.168.1.20:8460"))
        // Folevi Cloud's names are left out of a server's other names too.
        let named = try XCTUnwrap(server(["connect": ["serverId": "abcde12345", "hostnames": ["abcde12345.folevi.app", "app.folevi.com", "x.convex.cloud"]]]))
        XCTAssertEqual(named.hostnames, ["abcde12345.folevi.app"])
        XCTAssertEqual(named.publishedOrigin, "https://nas.example.com")
    }

    func testAServerPublishedAtAnotherAddressMustBeItselfThere() async {
        let cloud = URL(string: "https://app.folevi.com")!
        let lan = "http://192.168.1.20:8460", name = "https://abcde12345.folevi.app"
        let genuine = info(["urls": ["app": name, "convex": name + "/convex", "convexSite": name + "/convex-site"]])
        var asked: [String] = []
        let look = { (answers: [String: [String: Any]]) async -> Result<ShellServer, ShellServer.Problem> in
            await ShellServer.lookUp(lan, appVersion: "1.6.0", cloud: cloud) { origin in
                asked.append(origin)
                guard let a = answers[origin] else { throw URLError(.cannotConnectToHost) }
                return a
            }
        }
        // A home address typed, the server's public name published: the same server answers there.
        guard case .success(let s) = await look([lan: genuine, name: genuine]) else { return XCTFail("a genuine server was refused") }
        XCTAssertEqual(s.origin, lan)
        XCTAssertEqual(s.publishedOrigin, name)
        XCTAssertEqual(asked, [lan, name])
        // The published address is someone else's server (another Folevi Connect id), Folevi Cloud, not a Folevi
        // server, or a server that gives other addresses: refused.
        var other = genuine
        other["connect"] = ["serverId": "zzzzz99999", "hostnames": []]
        var cloudDoc = genuine
        cloudDoc["kind"] = "folevi-cloud"
        var elsewhere = genuine
        elsewhere["urls"] = ["app": "https://evil.example", "convex": "https://evil.example/convex", "convexSite": "https://evil.example/convex-site"]
        for (why, there) in [("another server", other), ("Folevi Cloud", cloudDoc), ("not Folevi", ["hello": "world"]), ("other addresses", elsewhere)] {
            if case .failure(let p) = await look([lan: genuine, name: there]) { XCTAssertEqual(p.code, "not_folevi", why) } else { XCTFail(why) }
        }
        if case .failure(let p) = await look([lan: genuine]) { XCTAssertEqual(p.code, "unreachable") } else { XCTFail("the published address didn't answer") }
        // The attack never gets as far as a second question.
        asked = []
        if case .failure(let p) = await look([lan: info(["urls": Self.attack])]) { XCTAssertEqual(p.code, "not_folevi") } else { XCTFail("the attack was accepted") }
        XCTAssertEqual(asked, [lan])
        // The address typed is the published one: asked once.
        asked = []
        let same = info(["urls": ["app": lan, "convex": lan + "/convex", "convexSite": lan + "/convex-site"]])
        if case .failure = await look([lan: same]) { XCTFail("a server on the address typed") }
        XCTAssertEqual(asked, [lan])
    }

    // MARK: sessions stay with the server that issued them

    /// Sessions are kept by user id, and a server says what its user ids are: a sign-in that comes back with the id
    /// of an account from another server is refused, and the session a sign-in replaces ends where it was issued.
    func testASignInThatComesBackAsAnotherServersAccountIsRefused() throws {
        let nas = try XCTUnwrap(server())
        let cloud = ShellAuth.shared.cloudService.absoluteString
        // A Folevi Cloud account here.
        ShellPlaces.setCurrent(nil, pending: true)
        XCTAssertNotNil(ShellPlaces.addAccount(userId: "cloudAna", name: "Ana", email: "ana@example.com", avatarUrl: nil))
        XCTAssertFalse(ShellAuth.belongsElsewhere("cloudAna"), "Folevi Cloud again: the same person signing in again")
        XCTAssertEqual(ShellAuth.shared.issuer(of: "cloudAna")?.absoluteString, cloud)
        // A server's sign-in that answers with that id.
        ShellPlaces.setCurrent(nil, pending: true, server: nas)
        XCTAssertTrue(ShellAuth.belongsElsewhere("cloudAna"))
        XCTAssertEqual(ShellAuth.shared.issuer(of: "cloudAna")?.absoluteString, cloud, "its old session would end at Folevi Cloud, not at the server")
        XCTAssertFalse(ShellAuth.belongsElsewhere("someoneNew"))
        XCTAssertNil(ShellAuth.shared.issuer(of: "someoneNew"), "a session nobody can place is sent nowhere")
        // The other way round: an account on the server, then Folevi Cloud's sign-in comes back with its id.
        XCTAssertNotNil(ShellPlaces.addAccount(userId: "nasBen", name: "Ben", email: "ben@nas.example.com", avatarUrl: nil))
        XCTAssertFalse(ShellAuth.belongsElsewhere("nasBen"))
        ShellPlaces.setCurrent(nil, pending: true)
        XCTAssertTrue(ShellAuth.belongsElsewhere("nasBen"))
        XCTAssertEqual(ShellAuth.shared.issuer(of: "nasBen")?.absoluteString, "https://nas.example.com")
        // The same server added again by its home address is still that server; another server is not.
        var home = nas
        home.origin = "http://192.168.1.20:8460"
        ShellPlaces.setCurrent(nil, pending: true, server: home)
        XCTAssertFalse(ShellAuth.belongsElsewhere("nasBen"))
        let other = try XCTUnwrap(server(["urls": ["app": "https://other.example", "convex": "https://other.example/convex", "convexSite": "https://other.example/convex-site"], "connect": ["serverId": "zzzzz99999", "hostnames": []]], origin: "https://other.example"))
        ShellPlaces.setCurrent(nil, pending: true, server: other)
        XCTAssertTrue(ShellAuth.belongsElsewhere("nasBen"))
        XCTAssertTrue(ShellServer.same(nil, nil))
        XCTAssertFalse(ShellServer.same(nas, nil))
    }

    /// The one session older builds kept was Folevi Cloud's: a server's sign-in screen neither reads it nor
    /// replaces it.
    func testTheOldSingleSessionNeverGoesToAServer() throws {
        let nas = try XCTUnwrap(server())
        let legacy = "legacy-cloud-session-0123456789abcdef" // gitleaks:allow (a made-up token)
        ShellAuth.shared.setToken(legacy, for: nil)
        defer { ShellAuth.shared.setToken(nil, for: nil) }
        ShellPlaces.setCurrent(nil, pending: true)
        XCTAssertEqual(ShellAuth.shared.token, legacy, "Folevi Cloud's sign-in screen")
        ShellPlaces.setCurrent(nil, pending: true, server: nas)
        XCTAssertNil(ShellAuth.shared.token, "a server's sign-in screen")
        ShellAuth.shared.token = "a-server-session-0123456789abcdef" // gitleaks:allow (a made-up token)
        XCTAssertEqual(ShellAuth.shared.token(for: nil), legacy, "not replaced by a server's")
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
