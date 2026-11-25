// "Your own server" on the Mac, end to end (docs/self-hosting/CONTRACT.md §6.1): servers found on the home network
// (Bonjour `_folevi._tcp`), the version gate, the best connection (ServerReach) on a network change, each server
// place's session in the Keychain (never on disk), and the whole sign-in against a running Folevi Server.
//
// The live tests use the local test server (`http://localhost:8460`, FOLEVI_SERVER_URL to change it) and its test
// accounts (`~/FoleviServerTest/test-accounts.env`, FOLEVI_SERVER_ACCOUNTS to change it); without them they skip.
// They do what the sign-in sheet does once someone has typed their password, without a sheet: nothing opens on
// screen. The browse for `_folevi._tcp` can ask for Local Network access, so it runs only with FOLEVI_LIVE_BONJOUR=1.
// Passwords and tokens are never printed.
import Network
import Security
import XCTest
@testable import Folevi

final class ServerFlowTests: XCTestCase {
    private static let env = ProcessInfo.processInfo.environment
    private static let serverURL = env["FOLEVI_SERVER_URL"] ?? "http://localhost:8460"

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

    private func server(_ patch: [String: Any] = [:]) throws -> ShellServer {
        guard case .success(let s) = ShellServer.check(info(patch), origin: "https://nas.example.com", appVersion: "1.6.0") else { throw XCTSkip("not a server") }
        return s
    }

    // MARK: servers on the home network

    func testWhatBonjourAdvertisesBecomesAnEntry() throws {
        // A TXT `url` wins over the resolved address.
        let e = try XCTUnwrap(LocalServers.entry(service: "folevi-nas", txt: ["id": "abcde12345", "name": "Smith family", "v": "1.6.2", "url": "https://abcde12345.folevi.app"], resolved: "http://192.168.1.20:8460"))
        XCTAssertEqual(e["origin"] as? String, "https://abcde12345.folevi.app")
        XCTAssertEqual(e["name"] as? String, "Smith family")
        XCTAssertEqual(e["serverId"] as? String, "abcde12345")
        XCTAssertEqual(e["version"] as? String, "1.6.2")
        // No `url` (no certificate yet): http on the address it resolved to; no name: the service's.
        let bare = try XCTUnwrap(LocalServers.entry(service: "folevi-nas", txt: [:], resolved: "http://192.168.1.20:8460"))
        XCTAssertEqual(bare["origin"] as? String, "http://192.168.1.20:8460")
        XCTAssertEqual(bare["name"] as? String, "folevi-nas")
        XCTAssertTrue(bare["serverId"] is NSNull)
        XCTAssertTrue(bare["version"] is NSNull)
        // A `url` Folevi won't use (http off the home network) falls back to the resolved address.
        let http = try XCTUnwrap(LocalServers.entry(service: "x", txt: ["url": "http://notes.example.com"], resolved: "http://10.0.0.5:8460"))
        XCTAssertEqual(http["origin"] as? String, "http://10.0.0.5:8460")
        // Neither: not listed. Junk in the TXT record isn't passed on.
        XCTAssertNil(LocalServers.entry(service: "x", txt: ["url": "ftp://nas"], resolved: nil))
        let junk = try XCTUnwrap(LocalServers.entry(service: "x", txt: ["id": "<script>", "v": String(repeating: "9", count: 80), "name": "  "], resolved: "http://nas.local:8460"))
        XCTAssertTrue(junk["serverId"] is NSNull)
        XCTAssertTrue(junk["version"] is NSNull)
        XCTAssertEqual(junk["name"] as? String, "x")
        XCTAssertEqual(LocalServers.type, "_folevi._tcp")
    }

    /// A real browse: this test advertises a `_folevi._tcp` service itself and finds it (FOLEVI_LIVE_BONJOUR=1).
    func testAServerAdvertisedOnThisNetworkIsFound() async throws {
        guard Self.env["FOLEVI_LIVE_BONJOUR"] == "1" else { throw XCTSkip("FOLEVI_LIVE_BONJOUR=1 runs the browse (it can ask for Local Network access)") }
        let name = "folevi-test-\(UUID().uuidString.prefix(8))"
        let listener = try NWListener(using: .tcp)
        listener.service = NWListener.Service(name: name, type: LocalServers.type, txtRecord: NWTXTRecord(["name": "Bonjour test", "v": "1.6.0", "url": "http://localhost:8460"]))
        listener.newConnectionHandler = { $0.cancel() }
        listener.start(queue: .global())
        defer { listener.cancel() }
        var found: [[String: Any]] = []
        for _ in 0..<5 {
            found = await LocalServers().list(wait: 3).filter { $0["name"] as? String == "Bonjour test" }
            if !found.isEmpty { break }
        }
        XCTAssertEqual(found.first?["origin"] as? String, "http://localhost:8460")
        XCTAssertEqual(found.first?["version"] as? String, "1.6.0")
    }

    // MARK: the version gate

    func testTheVersionGate() throws {
        // Below the server's minAppVersion: "update the app"; at it or above: fine.
        XCTAssertEqual(problem(app: "1.5.73"), .appOutdated)
        XCTAssertNil(problem(app: "1.6.0"))
        XCTAssertNil(problem(app: "1.10.0"), "versions compare as numbers")
        // A server older than this app works with, or one speaking an API this app doesn't know.
        XCTAssertEqual(problem(["version": "0.9.0"]), .serverOutdated)
        XCTAssertEqual(problem(["apiVersion": 2]), .appOutdated)
        XCTAssertEqual(problem(["apiVersion": 0]), .serverOutdated)
        XCTAssertEqual(ShellServer.Problem.appOutdated.code, "app_outdated")
        XCTAssertTrue(ShellServer.Problem.serverOutdated.message.contains("Ask the person who runs this server to update it"))
    }

    private func problem(_ patch: [String: Any] = [:], app: String = "1.6.0") -> ShellServer.Problem? {
        if case .failure(let p) = ShellServer.check(info(patch), origin: "https://nas.example.com", appVersion: app) { return p }
        return nil
    }

    func testTheTestServerAndThisBuildsVersion() async throws {
        try await requireServer()
        // This build as it is: below the server's minAppVersion it's "update the app" (the bridge's answer).
        let asBuilt = await ShellServer.lookUp(Self.serverURL, appVersion: Paths.version)
        let info = try await ShellServer.fetchInfo(Self.serverURL)
        let min = try XCTUnwrap(info["minAppVersion"] as? String)
        if ShellServer.compareVersions(Paths.version, min) < 0 {
            guard case .failure(let p) = asBuilt else { return XCTFail("\(Paths.version) is below \(min)") }
            XCTAssertEqual(p, .appOutdated)
        } else {
            guard case .success = asBuilt else { return XCTFail("\(Paths.version) should be accepted") }
        }
        // At the server's minimum, as a 1.6.0 build: a server place to add.
        guard case .success(let s) = await ShellServer.lookUp(Self.serverURL, appVersion: min) else { return XCTFail("refused at \(min)") }
        XCTAssertEqual(s.origin, ShellServer.normalizeOrigin(Self.serverURL))
        XCTAssertEqual(s.activeUrls.app, s.origin)
        XCTAssertEqual(s.activeUrls.convex, s.origin + "/convex")
        // Nothing there, and not an address Folevi uses.
        if case .failure(let p) = await ShellServer.lookUp("http://127.0.0.1:9", appVersion: min) { XCTAssertEqual(p, .unreachable) } else { XCTFail() }
        if case .failure(let p) = await ShellServer.lookUp("http://notes.example.com", appVersion: min) { XCTAssertEqual(p, .badAddress) } else { XCTFail() }
    }

    // MARK: the best connection

    /// What each name answers, for ServerReach's probe.
    private final class FakeNetwork: @unchecked Sendable {
        private let lock = NSLock()
        private var answers: [String: [String: Any]] = [:]
        private(set) var asked: [String] = []
        func set(_ origin: String, _ info: [String: Any]?) {
            lock.lock(); defer { lock.unlock() }
            answers[origin] = info
        }
        func probe(_ origin: String) -> [String: Any]? {
            lock.lock(); defer { lock.unlock() }
            asked.append(origin)
            return answers[origin]
        }
    }

    func testTheBestConnectionPrefersHome() async throws {
        let s = try server()
        let home = "https://192-168-1-20.abcde12345.folevi.app:8443", added = "https://nas.example.com", away = "https://abcde12345.folevi.app"
        XCTAssertEqual(s.candidates, [home, added, away])
        let net = FakeNetwork()
        let probe: (String) async -> [String: Any]? = { net.probe($0) }
        // Everything answers: home first.
        for o in [home, added, away] { net.set(o, info()) }
        let atHome = await ServerReach.best(s, probe: probe)
        XCTAssertEqual(atHome, home)
        // Away from home: the added address, then the public name.
        net.set(home, nil)
        let away1 = await ServerReach.best(s, probe: probe)
        XCTAssertEqual(away1, added)
        net.set(added, nil)
        let away2 = await ServerReach.best(s, probe: probe)
        XCTAssertEqual(away2, away)
        // Another server answering on the home address isn't this one; nothing answering: no change.
        net.set(home, info(["connect": ["serverId": "zzzzz99999", "hostnames": []]]))
        let other = await ServerReach.best(s, probe: probe)
        XCTAssertEqual(other, away)
        net.set(away, nil)
        let none = await ServerReach.best(s, probe: probe)
        XCTAssertNil(none)
        XCTAssertFalse(ServerReach.answers(["kind": "folevi-cloud"], as: s))
    }

    func testANetworkChangeMovesThePlaceWithoutSigningOut() async throws {
        let s = try server()
        let home = "https://192-168-1-20.abcde12345.folevi.app:8443"
        ShellPlaces.setCurrent(nil, pending: true, server: s)
        let a = try XCTUnwrap(ShellPlaces.addAccount(userId: "reachAna", name: "Ana", email: "ana@nas.example.com", avatarUrl: nil))
        let token = "reach-test-token-0123456789abcdef" // gitleaks:allow
        ShellAuth.shared.setToken(token, for: "reachAna")
        defer { ShellAuth.shared.setToken(nil, for: "reachAna") }

        let net = FakeNetwork()
        for o in s.candidates { net.set(o, info()) }
        let reach = ServerReach()
        reach.probe = { net.probe($0) }
        var moved: [String] = []
        let first = expectation(description: "moved home")
        reach.onChange = { moved.append($0); first.fulfill() }
        // The launch check: at home.
        reach.networkChanged()
        await fulfillment(of: [first], timeout: 5)
        XCTAssertEqual(moved, [a.id])
        XCTAssertEqual(ShellPlaces.server(of: a.id)?.activeOrigin, home)
        XCTAssertEqual(ShellPlaces.server(of: a.id)?.activeUrls.convex, home + "/convex", "its addresses move with it")
        XCTAssertTrue(ShellPolicy.connectSources(try XCTUnwrap(ShellPlaces.server(of: a.id))).contains("wss://192-168-1-20.abcde12345.folevi.app:8443"))

        // Leaving home: the home name stops answering; the next network change goes back to the added address.
        net.set(home, nil)
        let second = expectation(description: "moved away")
        reach.onChange = { moved.append($0); second.fulfill() }
        reach.networkChanged()
        await fulfillment(of: [second], timeout: 5)
        XCTAssertEqual(ShellPlaces.server(of: a.id)?.activeOrigin, "https://nas.example.com")
        XCTAssertNil(ShellPlaces.server(of: a.id)?.active, "back on the added address")
        // Still signed in: the session is the server's, not one name's.
        XCTAssertEqual(ShellAuth.shared.token(for: "reachAna"), token)
        XCTAssertEqual(ShellPlaces.state.accounts.count, 1)

        // Nothing better: no reload.
        let none = expectation(description: "no change")
        none.isInverted = true
        reach.onChange = { _ in none.fulfill() }
        reach.networkChanged()
        await fulfillment(of: [none], timeout: 1.5)
    }

    func testTheBestConnectionOverTheRealNetwork() async throws {
        try await requireServer()
        let info = try await ShellServer.fetchInfo(Self.serverURL)
        let origin = try XCTUnwrap(ShellServer.normalizeOrigin(Self.serverURL))
        guard case .success(var s) = ShellServer.check(info, origin: origin, appVersion: "1.6.0") else { return XCTFail("refused") }
        // A home name that doesn't exist ahead of the address that works.
        s.hostnames = ["127-0-0-1.nothere.invalid"]
        XCTAssertEqual(s.candidates.first, "https://127-0-0-1.nothere.invalid")
        let best = await ServerReach.best(s)
        XCTAssertEqual(best, origin)
    }

    // MARK: the Keychain

    func testEachServerPlacesSessionIsInTheKeychainOnly() throws {
        let s = try server()
        ShellPlaces.setCurrent(nil, pending: true, server: s)
        let a = try XCTUnwrap(ShellPlaces.addAccount(userId: "keyAna", name: "Ana", email: "ana@nas.example.com", avatarUrl: nil))
        let b = try XCTUnwrap(ShellPlaces.addAccount(userId: "keyBen", name: "Ben", email: "ben@nas.example.com", avatarUrl: nil))
        let ta = "server-place-token-a-0123456789abcdef" // gitleaks:allow
        let tb = "server-place-token-b-0123456789abcdef" // gitleaks:allow
        ShellAuth.shared.setToken(ta, for: a.userId)
        ShellAuth.shared.setToken(tb, for: b.userId)
        defer {
            ShellAuth.shared.setToken(nil, for: a.userId)
            ShellAuth.shared.setToken(nil, for: b.userId)
        }
        // One item per place (place `acct:<user>`, item `session.<user>`), in this run's own Keychain service.
        XCTAssertEqual(a.id, "acct:keyAna")
        XCTAssertEqual(ShellAuth.shared.token(for: a.userId), ta)
        XCTAssertEqual(ShellAuth.shared.token(for: b.userId), tb)
        let service = Paths.keychainService("com.folevi.shell-auth")
        XCTAssertTrue(service.hasPrefix("com.folevi.dev."), "never the installed app's items")
        if Paths.runTag != nil { XCTAssertNotEqual(service, "com.folevi.dev.shell-auth", "a test run's own items") }
        var out: AnyObject?
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "session.keyAna", kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        XCTAssertEqual(SecItemCopyMatching(q as CFDictionary, &out), errSecSuccess)
        let attrs = try XCTUnwrap(out as? [String: Any])
        // The Mac's login keychain (not the data protection keychain) keeps no accessibility class; when there is
        // one, it's this device's only.
        if let accessible = attrs[kSecAttrAccessible as String] as? String {
            XCTAssertEqual(accessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String, "this Mac only")
        }
        XCTAssertNotEqual(attrs[kSecAttrSynchronizable as String] as? Bool, true, "never synced")
        // Never on disk: not in places.json or anything else in the run's folder, nor in the settings.
        try assertNotOnDisk([ta, tb])
        // Signing one place out takes only its own item.
        ShellAuth.shared.setToken(nil, for: a.userId)
        XCTAssertNil(ShellAuth.shared.token(for: a.userId))
        XCTAssertEqual(ShellAuth.shared.token(for: b.userId), tb)
    }

    private func assertNotOnDisk(_ secrets: [String], file: StaticString = #filePath, line: UInt = #line) throws {
        let folder = Paths.supportFolder
        let files = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.isRegularFileKey])?.compactMap { $0 as? URL } ?? []
        var checked = 0
        for url in files where (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
            guard let data = try? Data(contentsOf: url), data.count < 50_000_000 else { continue }
            checked += 1
            for s in secrets where data.range(of: Data(s.utf8)) != nil { XCTFail("a session token is in \(url.lastPathComponent)", file: file, line: line) }
        }
        XCTAssertGreaterThan(checked, 0, "places.json at least", file: file, line: line)
        let defaults = Paths.defaults.dictionaryRepresentation().description
        for s in secrets where defaults.contains(s) { XCTFail("a session token is in the settings", file: file, line: line) }
    }

    // MARK: against the test server

    private func requireServer() async throws {
        guard (try? await ShellServer.fetchInfo(Self.serverURL, timeout: 3))?["kind"] as? String == "folevi-server" else {
            throw XCTSkip("no Folevi Server at \(Self.serverURL)")
        }
    }

    /// The test accounts file (KEY=value lines). Never printed.
    private func account(_ who: String) throws -> (email: String, password: String) {
        let path = Self.env["FOLEVI_SERVER_ACCOUNTS"] ?? (NSHomeDirectory() as NSString).appendingPathComponent("FoleviServerTest/test-accounts.env")
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { throw XCTSkip("no test accounts file") }
        var values: [String: String] = [:]
        for line in text.split(whereSeparator: \.isNewline) {
            let parts = line.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard parts.count == 2, !parts[0].hasPrefix("#") else { continue }
            values[parts[0].replacingOccurrences(of: "export ", with: "")] = parts[1].trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        }
        guard let email = values["\(who)_EMAIL"], let password = values["\(who)_PASSWORD"], !password.isEmpty else { throw XCTSkip("no \(who) account in the test accounts file") }
        return (email, password)
    }

    /// The website half of the sign-in sheet once the password is typed: sign in on the server's own page (its
    /// session cookie stays in this session), then /connect's approval for this app's PKCE request: the code the
    /// sheet's folevi://auth/callback carries.
    private func approveInTheSheet(_ origin: String, email: String, password: String, challenge: String) async throws -> String {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = HTTPCookieStorage()
        config.httpCookieAcceptPolicy = .always
        let web = URLSession(configuration: config)
        defer { web.invalidateAndCancel() }
        // The website's session: its cookie, and the same session as a bearer (an http address's cookie is Secure,
        // which a browser sends to localhost but URLSession doesn't).
        var website: String?
        func post(_ path: String, _ body: [String: Any]) async throws -> (Int, [String: Any]) {
            var req = URLRequest(url: try XCTUnwrap(URL(string: origin + path)))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.setValue(origin, forHTTPHeaderField: "Origin")
            if let website { req.setValue("Bearer \(website)", forHTTPHeaderField: "Authorization") }
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, res) = try await web.data(for: req)
            let http = res as? HTTPURLResponse
            if website == nil { website = http?.value(forHTTPHeaderField: "set-auth-token") }
            return (http?.statusCode ?? 0, (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:])
        }
        let (signedIn, _) = try await post("/api/auth/sign-in/email", ["email": email, "password": password, "rememberMe": false])
        XCTAssertEqual(signedIn, 200, "the server's sign-in")
        XCTAssertNotNil(website, "the server's session")
        let (status, json) = try await post("/api/auth/native/authorize", ["client_id": ShellAuth.clientId, "redirect_uri": ShellAuth.redirectURI, "code_challenge": challenge, "code_challenge_method": "S256"])
        XCTAssertEqual(status, 200, "the app's approval")
        let code = try XCTUnwrap(json["code"] as? String)
        // Ends the website's own session (the app's is its own, from the code).
        _ = try? await post("/api/auth/sign-out", [:])
        return code
    }

    func testSignInToTheTestServerEndToEnd() async throws {
        try await requireServer()
        let owner = try account("OWNER")
        // 1. "Your own server": the address is checked (as a 1.6.0 build) and every window opens its sign-in screen
        //    (Places.addServer: account mode, no account yet, bound to the server).
        guard case .success(let s) = await ShellServer.lookUp(Self.serverURL, appVersion: "1.6.0") else { return XCTFail("refused") }
        ShellPlaces.setCurrent(nil, pending: true, server: s)
        XCTAssertEqual(ShellPlaces.server(of: nil), s)
        XCTAssertEqual(ShellAuth.shared.service.absoluteString, s.origin, "sign-in goes to the server")
        // Its pages may reach the server, and not Folevi Cloud's Convex.
        let csp = ShellPolicy.csp(mode: "account", serviceOrigin: "https://app.folevi.com", server: s)
        XCTAssertTrue(csp.contains("connect-src 'self' \(s.origin)"))
        XCTAssertTrue(csp.contains(s.origin.replacingOccurrences(of: "http://", with: "ws://")))
        XCTAssertFalse(csp.contains("convex.cloud"))

        // 2. Its sign-in screen: the sheet starts on the server's /connect, which sends a signed-out visitor to sign in.
        let pkce = ShellAuth.pkcePair()
        let start = try XCTUnwrap(ShellAuth.signInStart(service: ShellAuth.shared.service, provider: nil, challenge: pkce.challenge, state: "teststate"))
        XCTAssertEqual(ShellAuth.origin(of: start), s.origin)
        XCTAssertEqual(start.path, "/connect")
        let noRedirects = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
        defer { noRedirects.invalidateAndCancel() }
        let (_, first) = try await noRedirects.data(from: start)
        let location = try XCTUnwrap((first as? HTTPURLResponse)?.value(forHTTPHeaderField: "Location"))
        XCTAssertTrue(location.hasPrefix("/signin?returnTo="), "the server's sign-in screen")
        let (page, signInPage) = try await URLSession(configuration: .ephemeral).data(from: try XCTUnwrap(URL(string: s.origin + location)))
        XCTAssertEqual((signInPage as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertTrue(String(decoding: page, as: UTF8.self).contains("password"), "a password sign-in")

        // 3. Signing in: the sheet's approval, then the app's own exchange, Keychain and places (authSignIn's path).
        let code = try await approveInTheSheet(s.origin, email: owner.email, password: owner.password, challenge: pkce.challenge)
        let token = await ShellAuth.shared.exchange(code: code, verifier: pkce.verifier)
        let access = try XCTUnwrap(token, "the server's /api/auth/native/token")
        let user = await ShellAuth.shared.userOf(access)
        let u = try XCTUnwrap(user)
        XCTAssertEqual(u.email, owner.email)
        ShellAuth.shared.setToken(access, for: u.userId)
        let place = try XCTUnwrap(ShellPlaces.addAccount(userId: u.userId, name: u.name, email: u.email, avatarUrl: u.avatarUrl))
        defer { Task { await ShellAuth.shared.signOut(userId: u.userId) } }
        XCTAssertEqual(place.server, s, "a place on that server")
        ShellPlaces.setCurrent(place.id)

        // The session works for the data: a Convex token from the server, at the server's address.
        XCTAssertEqual(ShellAuth.shared.service(for: u.userId).absoluteString, s.origin)
        let jwt = try await ShellAuth.shared.convexToken(for: u.userId)
        XCTAssertNotNil(jwt, "the server's /api/auth/convex/token")
        XCTAssertEqual(ShellAuth.shared.token(for: u.userId), access, "in the Keychain, under its place")
        try assertNotOnDisk([access] + [jwt].compactMap { $0 })

        // 4. The place switcher: the server's place next to a Folevi Cloud account and the library on this Mac.
        ShellPlaces.setLibrary(true)
        let cloud = try XCTUnwrap(ShellPlaces.addAccount(userId: "cloudBen", name: "Ben", email: "ben@example.com", avatarUrl: nil, server: .some(nil)))
        XCTAssertNil(cloud.server)
        let listed = ShellPlaces.list(libraryKind: nil, displayPath: "~/Documents/Folevi", configured: true)
        XCTAssertEqual(listed.compactMap { $0["kind"] as? String }.sorted(), ["account", "account", "library"])
        let onServer = try XCTUnwrap(listed.first { $0["id"] as? String == place.id })
        let info = try XCTUnwrap(onServer["server"] as? [String: Any])
        XCTAssertEqual(info["name"] as? String, s.name)
        XCTAssertEqual(info["origin"] as? String, s.origin)
        XCTAssertEqual((info["urls"] as? [String: Any])?["convex"] as? String, s.origin + "/convex")
        XCTAssertTrue(try XCTUnwrap(listed.first { $0["id"] as? String == cloud.id })["server"] is NSNull, "Folevi Cloud's")
        XCTAssertNotNil(listed.first { $0["kind"] as? String == "library" })

        // 5. Signing out of the server's place ends its session there and takes its Keychain item.
        await ShellAuth.shared.signOut(userId: u.userId)
        XCTAssertNil(ShellAuth.shared.token(for: u.userId))
        let after = await ShellAuth.shared.userOf(access)
        XCTAssertNil(after, "the server ended the session")
    }

    /// The native email form (ShellAuth.signIn(email:password:)) against the server: the member's session lands
    /// in its own Keychain item; a wrong password is refused with the web's words.
    func testEmailSignInToTheTestServer() async throws {
        try await requireServer()
        let member = try account("MEMBER")
        guard case .success(let s) = await ShellServer.lookUp(Self.serverURL, appVersion: "1.6.0") else { return XCTFail("refused") }
        ShellPlaces.setCurrent(nil, pending: true, server: s)
        let wrong = await ShellAuth.shared.signIn(email: member.email, password: "not-the-password-0") // gitleaks:allow
        XCTAssertEqual(wrong, .failed("The email or password is incorrect."))
        let outcome = await ShellAuth.shared.signIn(email: member.email, password: member.password)
        guard case .signedIn(let userId, _, let email, _) = outcome else { return XCTFail("not signed in") }
        XCTAssertEqual(email, member.email)
        let token = try XCTUnwrap(ShellAuth.shared.token(for: userId))
        let place = try XCTUnwrap(ShellPlaces.addAccount(userId: userId, name: "", email: email, avatarUrl: nil))
        XCTAssertEqual(place.server?.origin, s.origin)
        try assertNotOnDisk([token])
        await ShellAuth.shared.signOut(userId: userId)
        XCTAssertNil(ShellAuth.shared.token(for: userId))
    }
}
