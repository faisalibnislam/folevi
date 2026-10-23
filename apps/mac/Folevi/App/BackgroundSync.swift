// The places no window shows, kept in sync without a page each (docs/MAC_WEBKIT_PLAN.md §6.6 and "Memory"). Electron,
// and this app at first, kept a hidden page per such place all day: a WebKit content process of 60 to 100 MB each.
// Now a place's page (its runner, /place-sync) only runs while there's work, then goes:
//
// - right away when a place leaves the windows (a switch: what was queued there goes up now), when an account is
//   added, when the library's folder changes (another device wrote; its reminders get scheduled), and when an
//   account has new notifications (see below);
// - every `interval` (10 minutes) otherwise, one place at a time, so each catches up;
// - for at least `minAwake` and until its page says nothing is waiting (PlaceSync's describe), at most `maxAwake`
//   (or `maxAwakeWaiting` while something still is), then the page is let go.
//
// Notifications stay prompt without a page: every `pollInterval` (a minute) each account in the background asks
// Folevi for its unread count (one small Convex query over HTTPS, with that account's own token); a new one wakes the
// account's page, which shows it as it always has (PlaceSync: labelled with the account, never twice). The count
// also keeps the place's dot and the Dock badge right. Reminders in the library are the system's
// (UNUserNotificationCenter): they fire with no page and with Folevi quit.
import AppKit
import WebKit

/// When a place's runner wakes and when it goes, apart from the pages and timers (FoleviTests' BackgroundSyncTests).
struct BackgroundPlan {
    var interval: TimeInterval = 600
    var minAwake: TimeInterval = 15
    var maxAwake: TimeInterval = 120
    var maxAwakeWaiting: TimeInterval = 600
    /// At most this many runners at once for the regular catch-up (a wake with a reason doesn't wait).
    var regularAtOnce = 1

    struct Awake: Equatable {
        var since: Date
        /// What the page said is waiting last (nil before it said anything).
        var waiting: Int?
        /// Kept awake until then at least (a script measuring the page, `hold`).
        var holdUntil: Date?
    }

    enum Verdict: Equatable { case keep, release }

    /// Whether an awake runner has done its work.
    func verdict(_ a: Awake, now: Date) -> Verdict {
        if let hold = a.holdUntil, now < hold { return .keep }
        let up = now.timeIntervalSince(a.since)
        if up < minAwake { return .keep }
        switch a.waiting {
        case 0?: return .release
        case nil: return up >= maxAwake ? .release : .keep
        case _?: return up >= maxAwakeWaiting ? .release : .keep
        }
    }

    /// The places due a regular catch-up now, oldest first, within the regular budget.
    func due(wanted: [String], lastSync: [String: Date], awake: Set<String>, now: Date) -> [String] {
        let room = max(0, regularAtOnce - awake.count)
        guard room > 0 else { return [] }
        return wanted
            .filter { !awake.contains($0) && now.timeIntervalSince(lastSync[$0] ?? .distantPast) >= interval }
            .sorted { (lastSync[$0] ?? .distantPast) < (lastSync[$1] ?? .distantPast) }
            .prefix(room)
            .map { $0 }
    }

    /// Whether an unread count from the poll means something new arrived (a first count never does: what was
    /// there at launch was already there).
    static func isNew(previous: Int?, now: Int) -> Bool {
        guard let previous else { return false }
        return now > previous
    }
}

@MainActor
final class BackgroundSync {
    static let shared = BackgroundSync()

    private static let env = ProcessInfo.processInfo.environment
    private static func seconds(_ key: String, _ fallback: TimeInterval) -> TimeInterval {
        env[key].flatMap(TimeInterval.init).map { max(1, $0) } ?? fallback
    }

    /// FOLEVI_BACKGROUND_INTERVAL, _MIN_AWAKE, _MAX_AWAKE, _MAX_WAITING, _POLL (seconds) shorten the timings for test runs.
    var plan = BackgroundPlan(
        interval: seconds("FOLEVI_BACKGROUND_INTERVAL", 600),
        minAwake: seconds("FOLEVI_BACKGROUND_MIN_AWAKE", 15),
        maxAwake: seconds("FOLEVI_BACKGROUND_MAX_AWAKE", 120),
        maxAwakeWaiting: seconds("FOLEVI_BACKGROUND_MAX_WAITING", 600)
    )
    var pollInterval = seconds("FOLEVI_BACKGROUND_POLL", 60)
    /// How long a page that's done stays before it goes (its last writes settle).
    let linger: TimeInterval = 3

    /// The places that want a runner now (every one no main window shows).
    private(set) var wanted: [String] = []
    private(set) var awake: [String: BackgroundPlan.Awake] = [:]
    private var lastSync: [String: Date] = [:]
    private var lastUnread: [String: Int] = [:]
    private var tokens: [String: (jwt: String, until: Date)] = [:]
    private var tick: Timer?
    private var poll: Timer?
    private var polling = false
    private var libraryWake: DispatchWorkItem?
    /// Why each place woke last, and when (`mac.mjs cmd places`).
    private(set) var log: [[String: Any]] = []

    // MARK: what the app tells it

    /// The places that want a runner (Places.ensureRunners): one that's new to the list wakes now (it just left the
    /// windows, or was just added); one that left goes.
    func setWanted(_ places: [String]) {
        let before = Set(wanted)
        wanted = places
        for id in awake.keys where !places.contains(id) { release(id, why: "open") }
        for id in places where !before.contains(id) { wake(id, why: "background") }
        lastSync = lastSync.filter { places.contains($0.key) }
        lastUnread = lastUnread.filter { places.contains($0.key) }
        start()
    }

    /// A place's page said what's waiting there (its describe).
    func reported(_ place: String?, waiting: Int?) {
        guard let place, var a = awake[place] else { return }
        a.waiting = waiting ?? a.waiting ?? 0
        awake[place] = a
    }

    /// The library's folder changed (another device wrote): its page catches up, once the burst settles.
    func libraryChanged() {
        guard wanted.contains(ShellPlaces.library) else { return }
        libraryWake?.cancel()
        let work = DispatchWorkItem { MainActor.assumeIsolated { BackgroundSync.shared.wake(ShellPlaces.library, why: "folder") } }
        libraryWake = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: work)
    }

    /// Starts a place's runner now (if it's in the background and not already running); `hold` keeps it at least
    /// that long.
    func wake(_ place: String, why: String, hold: TimeInterval? = nil) {
        guard wanted.contains(place) else { return }
        let now = Date()
        if var a = awake[place] {
            // A page that's up already gets the change itself (its own writes to the folder land here too).
            if let hold { a.holdUntil = now.addingTimeInterval(hold) }
            awake[place] = a
            return
        }
        guard Places.shared.startRunner(place) else { return }
        awake[place] = BackgroundPlan.Awake(since: now, waiting: nil, holdUntil: hold.map { now.addingTimeInterval($0) })
        lastSync[place] = now
        note(place, why)
    }

    private func release(_ place: String, why: String) {
        guard awake.removeValue(forKey: place) != nil else { return }
        lastSync[place] = Date()
        Places.shared.stopRunner(place)
        note(place, "released: \(why)")
    }

    private func note(_ place: String, _ what: String) {
        log.append(["place": place, "what": what, "at": Date().timeIntervalSince1970])
        if log.count > 50 { log.removeFirst(log.count - 50) }
    }

    // MARK: timers

    private func start() {
        if tick == nil {
            let t = Timer(timeInterval: 2, repeats: true) { _ in MainActor.assumeIsolated { BackgroundSync.shared.step() } }
            t.tolerance = 1
            RunLoop.main.add(t, forMode: .common)
            tick = t
        }
        if poll == nil {
            let t = Timer(timeInterval: pollInterval, repeats: true) { _ in MainActor.assumeIsolated { BackgroundSync.shared.pollUnread() } }
            t.tolerance = min(10, pollInterval / 4)
            RunLoop.main.add(t, forMode: .common)
            poll = t
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { MainActor.assumeIsolated { BackgroundSync.shared.pollUnread() } }
        }
    }

    private var releasing: Set<String> = []

    private func step() {
        let now = Date()
        for (place, a) in awake where plan.verdict(a, now: now) == .release && !releasing.contains(place) {
            releasing.insert(place)
            DispatchQueue.main.asyncAfter(deadline: .now() + linger) {
                MainActor.assumeIsolated {
                    let s = BackgroundSync.shared
                    s.releasing.remove(place)
                    // Still done (no new work came in the meantime).
                    if let a = s.awake[place], s.plan.verdict(a, now: Date()) == .release { s.release(place, why: a.waiting == 0 ? "done" : "time") }
                }
            }
        }
        for place in plan.due(wanted: wanted, lastSync: lastSync, awake: Set(awake.keys), now: now) { wake(place, why: "catch up") }
    }

    // MARK: notifications without a page

    /// Every account in the background, asleep: its unread count from Folevi. A new one wakes its page.
    func pollUnread() {
        guard !polling, !Paths.offline, let convex = Self.convexURL else { return }
        let accounts = wanted.filter { ShellPlaces.userIdOf($0) != nil }
        guard !accounts.isEmpty else { return }
        polling = true
        Task { @MainActor in
            defer { self.polling = false }
            for place in accounts {
                guard let user = ShellPlaces.userIdOf(place), let count = await self.unread(user: user, place: place, convex: convex) else { continue }
                let previous = self.lastUnread[place]
                self.lastUnread[place] = count
                ShellPlaces.describe(place, ["unread": count])
                if BackgroundPlan.isNew(previous: previous, now: count), self.awake[place] == nil { self.wake(place, why: "notification") }
            }
        }
    }

    /// The Convex deployment the built-in interface talks to (shell/build.json).
    static var convexURL: URL? {
        (Paths.shellBuild?["convexUrl"] as? String).flatMap(URL.init(string:)).flatMap { ["https", "http"].contains($0.scheme ?? "") ? $0 : nil }
    }

    private func unread(user: String, place: String, convex: URL) async -> Int? {
        guard let jwt = await token(user: user, place: place) else { return nil }
        var req = URLRequest(url: convex.appendingPathComponent("api/query"))
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["path": "notifications:unreadCount", "args": [String: Any](), "format": "json"])
        guard let (data, res) = try? await URLSession.shared.data(for: req), let http = res as? HTTPURLResponse else { return nil }
        if http.statusCode == 401 || http.statusCode == 403 { tokens[place] = nil }
        guard (200..<300).contains(http.statusCode), let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], json["status"] as? String == "success",
              let n = json["value"] as? NSNumber else { return nil }
        return max(0, n.intValue)
    }

    /// The account's Convex token, kept until a minute before it runs out.
    private func token(user: String, place: String) async -> String? {
        if let t = tokens[place], t.until > Date() { return t.jwt }
        guard let jwt = try? await ShellAuth.shared.convexToken(for: user) else { return nil }
        tokens[place] = (jwt, Self.expiry(jwt).map { $0.addingTimeInterval(-60) } ?? Date().addingTimeInterval(300))
        return jwt
    }

    /// A JWT's `exp`.
    nonisolated static func expiry(_ jwt: String) -> Date? {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var s = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        guard let data = Data(base64Encoded: s), let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let exp = json["exp"] as? NSNumber else { return nil }
        return Date(timeIntervalSince1970: exp.doubleValue)
    }

    /// What `mac.mjs cmd places` shows of it.
    var debugState: [String: Any] {
        let now = Date()
        return [
            "wanted": wanted,
            "awake": awake.mapValues { ["for": now.timeIntervalSince($0.since), "waiting": $0.waiting ?? NSNull()] as [String: Any] },
            "lastSync": lastSync.mapValues { now.timeIntervalSince($0) },
            "unread": lastUnread,
            "log": log,
            "plan": ["interval": plan.interval, "minAwake": plan.minAwake, "maxAwake": plan.maxAwake, "poll": pollInterval],
        ]
    }
}
