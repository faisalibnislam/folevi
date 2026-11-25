// Folevi Server places (docs/SELF_HOSTING_PLAN.md §4 and §8, docs/self-hosting/CONTRACT.md §6), shared by the
// iPhone and iPad app and the Mac app (apps/mac/project.yml lists this file):
// - ShellServer: what an account place keeps of its own server (a place without one is Folevi Cloud's, as
//   before): the address the person added, the addresses its /.well-known/folevi.json gave, its other names
//   (Folevi Connect's LAN and public hostnames) and the one in use now;
// - the rules for an address someone adds (https, or http only on the home network), the version check, and the
//   connect-src a page of that place may reach (ShellPolicy);
// - ServerReach: the best connection (a home name when at home, the public one away), checked at launch and on
//   every network change, without signing in again (the session belongs to the server, not to one of its names);
// - LocalServers: servers on the home network, found by Bonjour (`_folevi._tcp`), for the sign-in screen.
// Nothing here is secret.
import Foundation
import Network

struct ShellServer: Codable, Equatable {
    struct Urls: Codable, Equatable {
        var app: String
        var convex: String
        var convexSite: String
    }

    /// The address the person added (or picked from the home network), as `normalizeOrigin` writes it.
    var origin: String
    var name: String
    /// The server's own version (folevi.json `version`).
    var version: String
    /// Folevi Connect's id, when the server is linked.
    var serverId: String?
    /// The addresses folevi.json gave for `origin`.
    var urls: Urls
    /// Folevi Connect's names ("host" or "host:port", always https); `candidates` puts them in the order to try.
    var hostnames: [String] = []
    /// The origin in use now (ServerReach); nil: `origin`.
    var active: String?

    /// The API version this app speaks (CONTRACT §6 `apiVersion`).
    static let apiVersion = 1
    /// The oldest server this app works with.
    static let minServerVersion = "1.0.0"

    var activeOrigin: String { active ?? origin }

    /// The addresses for the origin in use now: each of `urls` that is on `origin` moves to the active origin (same
    /// path), as CONTRACT §2 lays them out (`<origin>`, `<origin>/convex`, `<origin>/convex-site`).
    var activeUrls: Urls { addresses(at: activeOrigin) }

    func addresses(at target: String) -> Urls {
        Urls(app: Self.move(urls.app, from: origin, to: target), convex: Self.move(urls.convex, from: origin, to: target), convexSite: Self.move(urls.convexSite, from: origin, to: target))
    }

    /// The website of this place now (sign-in and /api/auth: ShellAuth.service).
    var appURL: URL? { URL(string: activeUrls.app) }

    private static func move(_ url: String, from: String, to: String) -> String {
        guard from != to, url == from || url.hasPrefix(from + "/") else { return url }
        return to + url.dropFirst(from.count)
    }

    /// Every origin this server can be reached at, in the order to try: home names (Connect's
    /// `192-168-1-20.<id>.folevi.app`), then the address the person added, then the other names (public, relay).
    var candidates: [String] {
        let named = hostnames.compactMap { Self.normalizeOrigin("https://" + $0) }
        let home = named.filter { Self.isHomeName($0) }
        var seen = Set<String>()
        return (home + [origin] + named).filter { seen.insert($0).inserted }
    }

    /// A Connect home name: its first label is a dashed IPv4 address ("https://192-168-1-20.abc.folevi.app").
    static func isHomeName(_ origin: String) -> Bool {
        guard let host = URLComponents(string: origin)?.host else { return false }
        let first = host.split(separator: ".").first.map(String.init) ?? ""
        return first.range(of: #"^\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}$"#, options: .regularExpression) != nil && host.contains(".")
    }

    /// What the page starts with (bootstrap `shell.places.server`) and what the places list carries.
    var json: [String: Any] {
        let u = activeUrls
        return [
            "origin": activeOrigin, "addedOrigin": origin, "name": name, "version": version, "serverId": serverId.map { $0 as Any } ?? NSNull(),
            "urls": ["app": u.app, "convex": u.convex, "convexSite": u.convexSite],
        ]
    }

    // MARK: addresses

    /// An address as the person typed it, as an origin ("https://host[:port]", lower case, no default port), or nil
    /// when Folevi won't use it: https anywhere; http only for an address on this network (a private or link-local
    /// IP, a `.local` name, a name with no dots, localhost), where there is no certificate to check. No path,
    /// query, fragment or user name. "nas.example.com" is read as https.
    static func normalizeOrigin(_ raw: String) -> String? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 300, text.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return nil }
        if !text.contains("://") { text = "https://" + text }
        guard let c = URLComponents(string: text), let scheme = c.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let rawHost = c.host, !rawHost.isEmpty, c.user == nil, c.password == nil, c.query == nil, c.fragment == nil,
              c.path.isEmpty || c.path == "/" else { return nil }
        let host = rawHost.trimmingCharacters(in: CharacterSet(charactersIn: "[]")).lowercased()
        guard host.range(of: #"^[a-z0-9.:-]+$"#, options: .regularExpression) != nil, !host.hasPrefix("."), !host.hasSuffix("."), !host.contains("..") else { return nil }
        if scheme == "http" && !isLocalHost(host) { return nil }
        if let port = c.port, !(1...65535).contains(port) { return nil }
        let port = c.port.flatMap { (scheme == "https" && $0 == 443) || (scheme == "http" && $0 == 80) ? nil : $0 }
        let shown = host.contains(":") ? "[\(host)]" : host
        return "\(scheme)://\(shown)\(port.map { ":\($0)" } ?? "")"
    }

    /// Whether a host (no brackets) is on this network: localhost, a name with no dots, a `.local` name, or a
    /// private, loopback, link-local or shared (Tailscale's 100.64/10) address. Written addresses only: names are
    /// not looked up.
    static func isLocalHost(_ host: String) -> Bool {
        let h = host.lowercased()
        if h == "localhost" || h.hasSuffix(".local") || h.hasSuffix(".localhost") { return true }
        if let v4 = ipv4(h) {
            let (a, b) = (v4[0], v4[1])
            return a == 10 || a == 127 || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168) || (a == 169 && b == 254) || (a == 100 && (64...127).contains(b))
        }
        if h.contains(":") {
            var addr = in6_addr()
            guard inet_pton(AF_INET6, h, &addr) == 1 else { return false }
            let bytes = withUnsafeBytes(of: addr) { Array($0) }
            let loopback = bytes[0..<15].allSatisfy { $0 == 0 } && bytes[15] == 1
            return loopback || bytes[0] & 0xfe == 0xfc || (bytes[0] == 0xfe && bytes[1] & 0xc0 == 0x80)
        }
        // A bare name ("nas"): the home network's own (ATS's NSAllowsLocalNetworking covers it too).
        return !h.contains(".") && h.range(of: #"^[a-z0-9-]+$"#, options: .regularExpression) != nil && ipv4(h) == nil
    }

    private static func ipv4(_ h: String) -> [Int]? {
        let parts = h.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        let n = parts.compactMap { p -> Int? in p.count <= 3 && p.allSatisfy(\.isNumber) ? Int(p) : nil }
        return n.count == 4 && n.allSatisfy { (0...255).contains($0) } ? n : nil
    }

    /// A URL folevi.json gives (urls.app and the rest): http(s) under the same rules as an added address, any path.
    static func allowedURL(_ raw: String) -> Bool {
        guard raw.count <= 500, let c = URLComponents(string: raw), let scheme = c.scheme?.lowercased(), let host = c.host, c.user == nil, c.password == nil, c.query == nil, c.fragment == nil else { return false }
        var origin = URLComponents()
        origin.scheme = scheme
        origin.host = host
        origin.port = c.port
        return origin.string.flatMap(normalizeOrigin) != nil
    }

    // MARK: versions

    /// -1, 0 or 1 as `a` is older than, the same as, or newer than `b`. Dotted numbers; anything after "-" (a
    /// pre-release) and a leading "v" are ignored, missing parts count as 0 ("1.6" == "1.6.0").
    static func compareVersions(_ a: String, _ b: String) -> Int {
        func parts(_ s: String) -> [Int] {
            let core = s.trimmingCharacters(in: .whitespaces).split(separator: "-").first.map(String.init) ?? ""
            return core.split(separator: ".").map { Int($0.filter(\.isNumber)) ?? 0 }
        }
        let x = parts(a), y = parts(b)
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p < q ? -1 : 1 }
        }
        return 0
    }

    // MARK: folevi.json

    /// Why a server can't be added; `code` is what the page reads, `message` its words for people.
    struct Problem: Error, Equatable {
        let code: String
        let message: String

        static let badAddress = Problem(code: "bad_address", message: "That isn't an address Folevi can use. Use https, or http only for an address on your home network.")
        static let unreachable = Problem(code: "unreachable", message: "Folevi couldn't reach that server. Check the address and that the server is running.")
        static let notFolevi = Problem(code: "not_folevi", message: "That address isn't a Folevi server.")
        static let isCloud = Problem(code: "folevi_cloud", message: "That's Folevi Cloud. Sign in with Folevi Cloud instead.")
        static let serverOutdated = Problem(code: "server_outdated", message: "This server is too old for this app. Ask the person who runs this server to update it.")
        static let appOutdated = Problem(code: "app_outdated", message: "This server needs a newer Folevi. Update Folevi, then try again.")
        static let needsSetup = Problem(code: "needs_setup", message: "This server isn't set up yet. Open its address in a browser to finish setting it up.")
    }

    /// The server folevi.json describes, checked against this app (CONTRACT §6): a Folevi server, an API version
    /// this app speaks, set up, new enough for this app and this app new enough for it, and addresses Folevi uses.
    static func check(_ info: [String: Any], origin: String, appVersion: String) -> Result<ShellServer, Problem> {
        guard let kind = info["kind"] as? String else { return .failure(.notFolevi) }
        if kind == "folevi-cloud" { return .failure(.isCloud) }
        guard kind == "folevi-server" else { return .failure(.notFolevi) }
        let api = (info["apiVersion"] as? NSNumber)?.intValue ?? 0
        if api > apiVersion { return .failure(.appOutdated) }
        if api < apiVersion { return .failure(.serverOutdated) }
        if info["needsSetup"] as? Bool == true { return .failure(.needsSetup) }
        let version = (info["version"] as? String) ?? "0"
        if compareVersions(version, minServerVersion) < 0 { return .failure(.serverOutdated) }
        if let min = info["minAppVersion"] as? String, compareVersions(appVersion, min) < 0 { return .failure(.appOutdated) }
        guard let u = info["urls"] as? [String: Any], let app = u["app"] as? String, let convex = u["convex"] as? String, let site = u["convexSite"] as? String,
              [app, convex, site].allSatisfy(allowedURL) else { return .failure(.notFolevi) }
        let connect = info["connect"] as? [String: Any]
        let hostnames = ((connect?["hostnames"] as? [Any]) ?? []).compactMap { $0 as? String }
            .map { $0.lowercased() }
            .filter { $0.range(of: #"^[a-z0-9.-]{1,253}(:[0-9]{1,5})?$"#, options: .regularExpression) != nil && normalizeOrigin("https://" + $0) != nil }
        let serverId = (connect?["serverId"] as? String).flatMap { $0.range(of: #"^[a-z0-9]{1,32}$"#, options: .regularExpression) != nil ? $0 : nil }
        let name = ((info["name"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let trim = { (s: String) in s.hasSuffix("/") ? String(s.dropLast()) : s }
        return .success(ShellServer(origin: origin, name: String((name.isEmpty ? "Folevi Server" : name).prefix(120)), version: String(version.prefix(40)), serverId: serverId,
                                    urls: Urls(app: trim(app), convex: trim(convex), convexSite: trim(site)), hostnames: Array(hostnames.prefix(10)), active: nil))
    }

    /// GETs `<origin>/.well-known/folevi.json` (no cookies, no redirects, 64 KB at most).
    static func fetchInfo(_ origin: String, timeout: TimeInterval = 10) async throws -> [String: Any] {
        guard let url = URL(string: origin + "/.well-known/folevi.json") else { throw Problem.badAddress }
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: timeout)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count <= 64 * 1024,
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { throw Problem.notFolevi }
        return json
    }

    /// Checks an address someone added: the server it names, ready to become a place.
    static func lookUp(_ raw: String, appVersion: String) async -> Result<ShellServer, Problem> {
        guard let origin = normalizeOrigin(raw) else { return .failure(.badAddress) }
        let info: [String: Any]
        do {
            info = try await fetchInfo(origin)
        } catch let p as Problem {
            return .failure(p)
        } catch {
            return .failure(.unreachable)
        }
        return check(info, origin: origin, appVersion: appVersion)
    }

    static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.urlCache = nil
        c.timeoutIntervalForRequest = 10
        c.waitsForConnectivity = false
        return URLSession(configuration: c, delegate: NoRedirects(), delegateQueue: nil)
    }()

    /// This app's version (CFBundleShortVersionString).
    static var appVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0" }
}

// MARK: - the page's security policy

/// The Content-Security-Policy header for the built-in interface's pages (the Mac's AppScheme, and on iPhone and
/// iPad for a server place's pages). It narrows the export's own meta policy (both apply).
enum ShellPolicy {
    /// What a page of a server place may connect to: every origin of the server's addresses, at each of its names,
    /// over http(s) and the matching ws(s).
    static func connectSources(_ server: ShellServer) -> [String] {
        var out: [String] = []
        var seen = Set<String>()
        for origin in server.candidates {
            let u = server.addresses(at: origin)
            for raw in [u.app, u.convex, u.convexSite] {
                guard let c = URLComponents(string: raw), let scheme = c.scheme?.lowercased(), let host = c.host else { continue }
                let port = c.port.map { ":\($0)" } ?? ""
                let h = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
                let ws = scheme == "https" ? "wss" : "ws"
                for s in ["\(scheme)://\(h)\(port)", "\(ws)://\(h)\(port)"] where seen.insert(s).inserted { out.append(s) }
            }
        }
        return out
    }

    /// Local mode and the first-launch choice reach nothing but the app itself; a Folevi Cloud account adds
    /// Folevi's website and Convex (`serviceOrigin`, `*.convex.cloud`, `*.convex.site`, plus `extraConnect`); a
    /// server place's account (`server`) reaches that server's origins only.
    static func csp(mode: String, serviceOrigin: String, extraConnect: [String] = [], server: ShellServer? = nil) -> String {
        let account = mode == "account"
        var connect = ["'self'"]
        if account {
            if let server {
                connect += connectSources(server)
            } else {
                connect += [serviceOrigin, "https://*.convex.cloud", "wss://*.convex.cloud", "https://*.convex.site"] + extraConnect
            }
        }
        var seen = Set<String>()
        connect = connect.filter { seen.insert($0).inserted }
        return [
            "default-src 'self'",
            // Next's inline bootstrap scripts carry no nonce in a static export.
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "media-src 'self' blob:\(account ? " https:" : "")",
            "font-src 'self'",
            "connect-src \(connect.joined(separator: " "))",
            "frame-src https:",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ].joined(separator: "; ")
    }
}

// MARK: - the best connection

/// Picks, for each server place with several names, the first that answers (home names first), at launch and on
/// every network change (NWPathMonitor). The place's pages load again on the new name; the session stays, since
/// the server, not the name, holds it.
final class ServerReach {
    static let shared = ServerReach()

    /// A place's origin changed (on the main queue): its pages load again.
    var onChange: ((String) -> Void)?

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.folevi.server-reach")
    private var started = false
    /// A check is running; `again`: the network changed meanwhile, so one more after it.
    private var checking = false
    private var again = false

    /// Starts watching the network (the first answer comes at once: the launch check).
    func start() {
        queue.async {
            guard !self.started else { return }
            self.started = true
            self.monitor.pathUpdateHandler = { [weak self] path in
                guard path.status == .satisfied else { return }
                self?.changed()
            }
            self.monitor.start(queue: self.queue)
        }
    }

    /// On `queue`.
    private func changed() {
        if checking {
            again = true
            return
        }
        checking = true
        Task {
            await self.checkAll()
            self.queue.async {
                self.checking = false
                if self.again {
                    self.again = false
                    self.changed()
                }
            }
        }
    }

    /// Every server place with more than one name: the first that answers becomes its active origin.
    func checkAll() async {
        for account in ShellPlaces.state.accounts {
            guard let server = account.server, server.candidates.count > 1 else { continue }
            guard let best = await Self.best(server), best != server.activeOrigin else { continue }
            ShellPlaces.setActiveOrigin(account.id, best == server.origin ? nil : best)
            let id = account.id
            await MainActor.run { self.onChange?(id) }
        }
    }

    /// The first candidate (in `candidates` order) whose folevi.json answers as this server; all are tried at once.
    static func best(_ server: ShellServer) async -> String? {
        let list = server.candidates
        let ok: [String: Bool] = await withTaskGroup(of: (String, Bool).self) { group in
            for origin in list { group.addTask { (origin, await answers(origin, as: server)) } }
            var out: [String: Bool] = [:]
            for await (origin, yes) in group { out[origin] = yes }
            return out
        }
        return list.first { ok[$0] == true }
    }

    private static func answers(_ origin: String, as server: ShellServer) async -> Bool {
        guard let info = try? await ShellServer.fetchInfo(origin, timeout: 4), info["kind"] as? String == "folevi-server" else { return false }
        // Linked servers say who they are: another server answering on a home address isn't this one.
        guard let id = server.serverId else { return true }
        return (info["connect"] as? [String: Any])?["serverId"] as? String == id
    }
}

// MARK: - servers on the home network

/// Folevi servers on this network (Bonjour `_folevi._tcp`, CONTRACT §6.1), for the sign-in screen's "found on
/// your home network". Browsing starts with the first question and stops a minute after the last.
final class LocalServers {
    static let shared = LocalServers()
    static let type = "_folevi._tcp"

    private let queue = DispatchQueue(label: "com.folevi.local-servers")
    private var browser: NWBrowser?
    private var results: [NWBrowser.Result] = []
    /// Resolved addresses of services without a `url` in their TXT record, by service name.
    private var resolved: [String: String] = [:]
    private var generation = 0

    /// What's been found within `wait` seconds of asking: [{ name, origin, serverId, version }].
    func list(wait: TimeInterval = 2) async -> [[String: Any]] {
        let fresh: Bool = queue.sync {
            generation += 1
            let mine = generation
            queue.asyncAfter(deadline: .now() + 60) { if self.generation == mine { self.stop() } }
            if browser != nil { return false }
            let b = NWBrowser(for: .bonjourWithTXTRecord(type: Self.type, domain: nil), using: .tcp)
            b.browseResultsChangedHandler = { [weak self] results, _ in self?.results = Array(results) }
            b.stateUpdateHandler = { [weak self] state in
                if case .failed = state { self?.stop() }
            }
            browser = b
            b.start(queue: queue)
            return true
        }
        if fresh { try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }
        let found: [NWBrowser.Result] = queue.sync { results }
        var out: [[String: Any]] = []
        var seen = Set<String>()
        for r in found {
            guard case .service(let service, _, _, _) = r.endpoint else { continue }
            var txt: [String: String] = [:]
            if case .bonjour(let record) = r.metadata { txt = record.dictionary }
            var origin = txt["url"].flatMap(ShellServer.normalizeOrigin)
            if origin == nil { origin = await resolve(r.endpoint, service) }
            guard let origin, seen.insert(origin).inserted else { continue }
            out.append([
                "name": String((txt["name"] ?? service).prefix(120)), "origin": origin,
                "serverId": txt["id"].map { $0 as Any } ?? NSNull(), "version": txt["v"].map { $0 as Any } ?? NSNull(),
            ])
        }
        return out
    }

    /// On `queue`.
    private func stop() {
        browser?.cancel()
        browser = nil
        results = []
    }

    /// A service without a `url`: its address and port, as "http://<address>:<port>" (a home address, so http is
    /// allowed), found by connecting once. Nil after 3 seconds.
    private func resolve(_ endpoint: NWEndpoint, _ service: String) async -> String? {
        if let known = queue.sync(execute: { resolved[service] }) { return known }
        let origin: String? = await withCheckedContinuation { cont in
            let connection = NWConnection(to: endpoint, using: .tcp)
            var done = false
            let finish = { (value: String?) in
                guard !done else { return }
                done = true
                connection.stateUpdateHandler = nil
                connection.cancel()
                cont.resume(returning: value)
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    guard case .hostPort(let host, let port)? = connection.currentPath?.remoteEndpoint else { return finish(nil) }
                    let address: String
                    switch host {
                    case .ipv4(let a): address = "\(a)"
                    case .ipv6(let a): address = "[\("\(a)".split(separator: "%").first.map(String.init) ?? "\(a)")]"
                    case .name(let n, _): address = n
                    @unknown default: return finish(nil)
                    }
                    finish(ShellServer.normalizeOrigin("http://\(address):\(port.rawValue)"))
                case .failed, .cancelled:
                    finish(nil)
                default:
                    break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 3) { finish(nil) }
        }
        if let origin { queue.async { self.resolved[service] = origin } }
        return origin
    }
}
