// A scripted engine for the screens' tests: answers hello, serves value views from the web's contract fixtures
// (apps/web/src/lib/engine/fixtures), serves `notes.list` windows from a generated library of any size, and
// records commands (answering them with a handler the test sets).
import Foundation
import Testing
@testable import FoleviEngine
@testable import FoleviScreens

enum Fixtures {
    static let dir = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appendingPathComponent("../../../../web/src/lib/engine/fixtures")
        .standardized

    static func json(_ name: String) -> JSONValue {
        let url = dir.appendingPathComponent(name)
        guard let data = try? Data(contentsOf: url), let v = try? JSONDecoder().decode(JSONValue.self, from: data) else {
            fatalError("missing fixture \(url.path)")
        }
        return v
    }

    /// A view fixture's `value`.
    static func value(_ name: String) -> JSONValue { json(name)["value"]! }

    static func decode<T: Decodable>(_ type: T.Type, _ name: String) -> T { try! value(name).decode(T.self) }

    /// The first row of the initial list fixture, as a template for generated libraries.
    static var rowTemplate: [String: JSONValue] {
        guard case .object(let diff)? = json("list.notes.initial.json")["updates"].flatMap({ if case .array(let a) = $0 { a.first } else { nil } })?["diff"],
              case .object(let upsert)? = diff["upsert"], case .object(let row)? = upsert.values.first else { fatalError("no row template") }
        return row
    }
}

let sampleTitles = ["Kyoto in November", "Q4 planning", "Reading list", "Sourdough notes", "Weekly review", "Garden plan", "Interview questions", "Trip budget", "Product ideas", "Book club: The Overstory", "Morning pages", "Design crit notes", "Moving checklist", "Recipes to try", "Running log", "Gift ideas"]
let sampleThemes = ["art-03", "none", "art-27", "art-12", "none", "art-41", "art-08", "none", "art-19", "art-33"]
let sampleFolders: [(String, String, String?)?] = [("fld_trips", "Trips", "moss"), ("fld_work", "Work", nil), ("fld_reading", "Reading", "plum"), nil, ("fld_home", "Home", "amber")]

/// A generated library of `count` notes, newest first.
func makeRows(_ count: Int, now: Double = 1_792_832_400_000) -> [JSONValue] {
    let template = Fixtures.rowTemplate
    return (0..<count).map { i in
        var row = template
        let id = String(format: "n%05d", i)
        row["id"] = .string(id)
        let title = i < sampleTitles.count ? sampleTitles[i] : "\(sampleTitles[i % sampleTitles.count]) \(i / sampleTitles.count + 1)"
        row["title"] = .string(title)
        row["excerpt"] = .string("\(title). The first lines of the note, as the card shows them.")
        row["preview"] = .array([
            .object(["t": .string("paragraph"), "x": .string("\(title). The first lines of the note, as the card shows them.")]),
            .object(["t": .string("todo"), "x": .string("Next step"), "c": .bool(i % 3 == 0)]),
        ])
        let theme = sampleThemes[i % sampleThemes.count]
        row["cover"] = theme == "none" ? .object(["kind": .string("none")]) : .object(["kind": .string("theme"), "value": .string(theme)])
        row["starred"] = .bool(i % 7 == 0)
        row["updatedAt"] = .number(now - Double(i) * 3_600_000)
        row["createdAt"] = .number(now - Double(i) * 3_600_000 - 86_400_000 * 3)
        if let f = sampleFolders[i % sampleFolders.count] {
            row["folder"] = .object(["id": .string(f.0), "name": .string(f.1), "color": f.2.map(JSONValue.string) ?? .null])
        } else {
            row["folder"] = .null
        }
        row["tags"] = .array([])
        row["sync"] = .string(i == 2 ? "waiting" : "saved")
        row["h"] = .string(fnv1a("\(id)\(title)\(i % 7 == 0)"))
        return .object(row)
    }
}

@MainActor
final class FakeEngine {
    var values: [String: JSONValue] = [:]
    var rows: [JSONValue]
    /// Answers commands by name; the default says every note was done.
    var onCommand: (String, JSONValue) throws -> JSONValue
    private(set) var commands: [(name: String, args: JSONValue)] = []
    private(set) var watches: [String: JSONValue] = [:]
    private(set) var windows: [ListWindow] = []
    private var revs: [String: Int] = [:]
    lazy var transport = ScriptedTransport { m in try await self.respond(m) } // strong: the engine lives as long as its clients (a test-only cycle)

    init(rows: Int = 25) {
        self.rows = makeRows(rows)
        self.onCommand = { _, args in
            .object(["done": args["ids"] ?? .array([]), "skipped": .number(0), "queued": .bool(false)])
        }
        values["home"] = Fixtures.value("view.home.json")
        values["session"] = Fixtures.value("view.session.json")
        values["places.list"] = Fixtures.value("view.places.list.json")
        values["sync.status"] = Fixtures.value("view.sync.status.json")
        values["folders.tree"] = Fixtures.value("view.folders.tree.json")
    }

    func client() -> EngineClient {
        let c = EngineClient(transport: transport, place: "acct:u1", app: AppInfo(platform: .ios, version: "1.1.00", build: "1", protocol: EngineContract.protocolVersion))
        c.start()
        return c
    }

    func commands(named name: String) -> [JSONValue] { commands.filter { $0.name == name }.map(\.args) }

    func respond(_ m: JSONValue) async throws -> JSONValue {
        switch m["kind"]?.string ?? "" {
        case "hello":
            // The contract's own hello reply (it follows the contract as revisions add fields), made current.
            guard case .array(let replies)? = Fixtures.json("envelope.hello.json")["fromEngine"], case .object(var value)? = replies.first?["value"] else {
                fatalError("no hello fixture")
            }
            value["protocol"] = .number(Double(EngineContract.protocolVersion))
            value["revision"] = .number(Double(EngineContract.revision))
            value["schemaHash"] = .string(EngineContract.schemaHash)
            value["ready"] = .bool(true)
            value["place"] = .string("acct:u1")
            return .object(value)
        case "watch":
            let sub = m["sub"]?.string ?? ""
            let name = m["name"]?.string ?? ""
            watches[sub] = m
            revs[sub] = 0
            if name == "notes.list" {
                let win = ListWindow(start: Int(m["window"]?["start"]?.number ?? 0), count: Int(m["window"]?["count"]?.number ?? 200))
                windows.append(win)
                Task { @MainActor in self.pushWindow(sub, win) }
            } else if let value = values[name] {
                Task { @MainActor in self.pushValue(sub, value) }
            } else {
                throw EngineFailure.engine(EngineError(code: "unknown_view", message: "No view \(name)."))
            }
            return .object(["sub": .string(sub)])
        case "unwatch":
            watches[m["sub"]?.string ?? ""] = nil
            return .object(["ok": .bool(true)])
        case "window":
            let sub = m["sub"]?.string ?? ""
            let win = ListWindow(start: Int(m["window"]?["start"]?.number ?? 0), count: Int(m["window"]?["count"]?.number ?? 200))
            windows.append(win)
            Task { @MainActor in self.pushWindow(sub, win) }
            return .object(["ok": .bool(true)])
        case "command":
            let name = m["name"]?.string ?? ""
            let args = m["args"] ?? .object([:])
            commands.append((name, args))
            return try onCommand(name, args)
        default:
            throw EngineFailure.engine(EngineError(code: "unknown_view", message: "No such thing."))
        }
    }

    func pushValue(_ sub: String, _ value: JSONValue) {
        let rev = (revs[sub] ?? 0) + 1
        revs[sub] = rev
        transport.push(.array([.object(["kind": .string("update"), "sub": .string(sub), "rev": .number(Double(rev)), "value": value])]))
    }

    /// Sends a changed value to every live subscription of a view.
    func update(view name: String, _ value: JSONValue) {
        values[name] = value
        for (sub, m) in watches where m["name"]?.string == name { pushValue(sub, value) }
    }

    /// Main-thread time spent building and encoding windows (test overhead, not the app's).
    var pushMillis: [Double] = []

    func pushWindow(_ sub: String, _ win: ListWindow) {
        let t0 = CFAbsoluteTimeGetCurrent()
        defer { pushMillis.append((CFAbsoluteTimeGetCurrent() - t0) * 1000) }
        guard watches[sub] != nil else { return }
        let rev = (revs[sub] ?? 0) + 1
        revs[sub] = rev
        let start = max(0, min(win.start, rows.count))
        let end = min(rows.count, start + win.count)
        let slice = Array(rows[start..<end])
        var upsert: [String: JSONValue] = [:]
        for r in slice { upsert[r["id"]!.string!] = r }
        let diff: JSONValue = .object([
            "reset": .bool(true), "total": .number(Double(rows.count)), "complete": .bool(true), "start": .number(Double(start)),
            "order": .array(slice.map { $0["id"]! }), "upsert": .object(upsert),
        ])
        transport.push(.array([.object(["kind": .string("update"), "sub": .string(sub), "rev": .number(Double(rev)), "diff": diff])]))
    }
}

/// Waits (up to 15 seconds: the rendering suites share the main actor) for the main actor to make a condition true.
@MainActor
func eventually(_ what: String = "condition", timeout: Duration = .seconds(15), _ condition: () -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async {
    let clock = ContinuousClock()
    let deadline = clock.now + timeout
    while !condition() {
        if clock.now > deadline {
            Issue.record("timed out waiting for \(what)", sourceLocation: sourceLocation)
            return
        }
        try? await Task.sleep(for: .milliseconds(5))
    }
}

/// Collects toasts and haptics instead of drawing them.
@MainActor
final class FeedbackLog {
    var toasts: [ScreenToast] = []
    var haptics: [ScreenHaptic] = []
    var copied: [String] = []
    var feedback: ScreenFeedback {
        ScreenFeedback(toast: { [weak self] in self?.toasts.append($0) }, haptic: { [weak self] in self?.haptics.append($0) }, copy: { [weak self] in self?.copied.append($0) })
    }
}
