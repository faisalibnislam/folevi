// FOLEVI_DEMO=1 (Debug only): Core runs on FoleviKit's scripted demo engine (sample notes, folders, tags and
// tasks; no account, no web export), for screenshots and UI checks. Never real data.
import FoleviEngine
import FoleviEngineDemo

extension DemoEngine {
    @MainActor static let shared = DemoEngine()
}

#if DEBUG
import AppKit

/// The Debug command channel's Core commands (scripts/core.mjs): where each window is, go somewhere, the engine's
/// state, a window's picture.
@MainActor
enum DebugCommands {
    static func install() {
        MacEval.commands["state"] = { _, done in
            MainActor.assumeIsolated {
                let app = AppModel.shared
                done(["value": [
                    "engine": String(describing: app.client?.state ?? .idle),
                    "ready": app.ready,
                    "gate": app.gate?.gate ?? NSNull(),
                    "gateActions": app.gate?.actions.map { "\($0.id): \($0.label)" } ?? [],
                    "gateFields": app.gate?.fields.map(\.id) ?? [],
                    "gateTitle": app.gate?.title ?? "",
                    "place": ShellPlaces.state.current ?? NSNull(),
                    "front": app.front?.current.path ?? NSNull(),
                    "pages": PagePool.shared.all.map { ["kind": $0.kind == .engine ? "engine" : "editor", "note": $0.shownNote ?? "", "lent": $0.lentTo != nil] },
                ] as [String: Any]])
            }
        }
        MacEval.commands["notes"] = { _, done in
            MainActor.assumeIsolated {
                Task { @MainActor in
                    guard let h = try? await AppModel.shared.client?.query(Views.Home(SpaceArgs())) else { return done(["error": "no home"]) }
                    done(["value": h.recents.map { ["id": $0.id, "title": $0.title] }])
                }
            }
        }
        MacEval.commands["go"] = { req, done in
            MainActor.assumeIsolated {
                guard let path = req["path"] as? String else { return done(["error": "no path"]) }
                AppModel.shared.open(path: path, newTab: req["tab"] as? Bool == true)
                done(["value": true])
            }
        }
        MacEval.commands["gate"] = { req, done in
            MainActor.assumeIsolated {
                guard let action = req["action"] as? String else { return done(["error": "no action"]) }
                AppModel.shared.perform { _ = try await $0.command(Commands.GateAct(GateActArgs(action: action, values: req["values"] as? [String: String]))) }
                done(["value": true])
            }
        }
        MacEval.commands["palette"] = { _, done in
            MainActor.assumeIsolated {
                AppModel.shared.front?.paletteShown = true
                done(["value": true])
            }
        }
        MacEval.commands["inspector"] = { req, done in
            MainActor.assumeIsolated {
                AppModel.shared.front?.inspectorShown = req["value"] as? Bool ?? true
                if let tab = req["tab"] as? String, let t = WindowModel.InspectorTab(rawValue: tab) { AppModel.shared.front?.inspectorTab = t }
                done(["value": true])
            }
        }
        MacEval.commands["style"] = { req, done in
            MainActor.assumeIsolated {
                AppModel.shared.front?.listStyle = req["value"] as? String == "cards" ? .cards : .list
                done(["value": true])
            }
        }
        MacEval.commands["ask"] = { _, done in
            MainActor.assumeIsolated {
                AppModel.shared.front?.askShown.toggle()
                done(["value": AppModel.shared.front?.askShown ?? false])
            }
        }
        MacEval.commands["quickadd"] = { _, done in
            MainActor.assumeIsolated {
                QuickAdd.shared.show()
                done(["value": true])
            }
        }
        MacEval.commands["settings"] = { req, done in
            MainActor.assumeIsolated {
                SettingsRouter.shared.open(req["section"] as? String)
                done(["value": true])
            }
        }
        MacEval.commands["eval"] = { req, done in
            MainActor.assumeIsolated {
                guard let script = req["script"] as? String, let page = PagePool.shared.engine else { return done(["error": "no page or script"]) }
                page.view.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { r in
                    switch r {
                    case .success(let v): done(["value": JSONSerialization.isValidJSONObject(["v": v as Any]) ? (v as Any) : String(describing: v)])
                    case .failure(let e): done(["error": e.localizedDescription])
                    }
                }
            }
        }
        MacEval.commands["appearance"] = { req, done in
            MainActor.assumeIsolated {
                switch req["value"] as? String {
                case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
                case "light": NSApp.appearance = NSAppearance(named: .aqua)
                default: NSApp.appearance = nil
                }
                done(["value": true])
            }
        }
    }
}
#endif
