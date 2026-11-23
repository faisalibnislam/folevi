// Debug builds only: a command channel scripts use to drive and check a running Folevi Core (scripts/core.mjs).
// A request is a JSON file in the support folder's Debug/requests/ ({ id, cmd, ...args }); the answer is written to
// Debug/answers/<id>.json. The shared Places.swift registers its commands here; Core adds its own (routes, the
// engine's state, screenshots of a window).
import AppKit

enum MacEval {
    typealias Done = ([String: Any]) -> Void
    typealias Command = ([String: Any], @escaping Done) -> Void

    nonisolated(unsafe) static var commands: [String: Command] = [:]

    #if DEBUG
    private nonisolated(unsafe) static var timer: Timer?

    static var requests: URL { Paths.debugFolder.appendingPathComponent("requests", isDirectory: true) }
    static var answers: URL { Paths.debugFolder.appendingPathComponent("answers", isDirectory: true) }

    /// Starts watching for requests (a light poll: Debug only).
    @MainActor
    static func start() {
        guard timer == nil else { return }
        let fm = FileManager.default
        try? fm.createDirectory(at: requests, withIntermediateDirectories: true)
        try? fm.createDirectory(at: answers, withIntermediateDirectories: true)
        try? String(ProcessInfo.processInfo.processIdentifier).write(to: Paths.debugFolder.appendingPathComponent("pid"), atomically: true, encoding: .utf8)
        timer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { _ in
            MainActor.assumeIsolated { poll() }
        }
    }

    @MainActor
    private static func poll() {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: requests, includingPropertiesForKeys: nil) else { return }
        for file in files where file.pathExtension == "json" {
            guard let data = try? Data(contentsOf: file) else { continue }
            try? fm.removeItem(at: file)
            guard let req = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let id = req["id"] as? String, let cmd = req["cmd"] as? String else { continue }
            let answer: Done = { value in
                let body: [String: Any] = JSONSerialization.isValidJSONObject(value) ? value : ["value": String(describing: value)]
                if let out = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) {
                    try? out.write(to: answers.appendingPathComponent("\(id).json"), options: .atomic)
                }
            }
            guard let run = commands[cmd] else {
                answer(["error": "unknown command \(cmd)", "known": commands.keys.sorted()])
                continue
            }
            run(req, answer)
        }
    }
    #endif
}
