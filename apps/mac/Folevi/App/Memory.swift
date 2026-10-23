// How much memory the app keeps (docs/MAC_WEBKIT_PLAN.md "Memory"): every page is a WebKit content process of its
// own, so the pages the app keeps open are most of its footprint. This file holds what keeps that down across the
// app, and the Debug command scripts measure it with.
import AppKit
import WebKit

@MainActor
enum Memory {
    static func install() {
        #if DEBUG
        installEval()
        #endif
    }
}

#if DEBUG
extension Memory {
    /// The page's process, or its GPU or networking process (WebKit's private identifiers, Debug only).
    static func pid(_ view: WKWebView, _ key: String = "_webProcessIdentifier") -> Int {
        view.responds(to: Selector((key))) ? ((view.value(forKey: key) as? Int) ?? 0) : 0
    }

    /// WebKit's helper processes this app is responsible for (content, GPU, networking), by pid and name; empty when
    /// the app was started from a script (the script's app is then responsible for them, and for other apps it
    /// started too).
    static func helpers() -> [(pid: Int32, name: String)] {
        typealias Responsible = @convention(c) (pid_t) -> pid_t
        guard let sym = dlsym(dlopen(nil, RTLD_NOW), "responsibility_get_pid_responsible_for_pid") else { return [] }
        let responsible = unsafeBitCast(sym, to: Responsible.self)
        let me = getpid()
        guard responsible(me) == me else { return [] }
        var count = proc_listallpids(nil, 0)
        var pids = [pid_t](repeating: 0, count: Int(count) + 64)
        count = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        var out: [(Int32, String)] = []
        for pid in pids.prefix(Int(max(0, count))) where pid > 0 && pid != me {
            var buf = [CChar](repeating: 0, count: 4096)
            guard proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 else { continue }
            let path = String(cString: buf)
            guard path.contains("com.apple.WebKit."), responsible(pid) == me else { continue }
            out.append((pid, (path as NSString).lastPathComponent))
        }
        return out
    }

    /// `mac.mjs cmd memory`: every web view (its role, place, address, window and process) and every WebKit process
    /// of the app, so a script can put a footprint on each.
    static func installEval() {
        MacEval.commands["memory"] = { _, done in
            let views: [[String: Any]] = WindowManager.shared.allViews.map { v in
                [
                    "role": v.role.rawValue, "place": v.place ?? NSNull(), "url": v.url?.absoluteString ?? "", "pid": pid(v),
                    "inWindow": v.window != nil, "visible": v.window?.isVisible ?? false,
                    "panel": v.role == .quickAdd ? "quick-add" : (v.window != nil && v.window === SettingsWindow.shared.window ? "settings" : ""),
                ] as [String: Any]
            }
            var helpers = helpers().map { ["pid": Int($0.pid), "name": $0.name] as [String: Any] }
            if helpers.isEmpty, let any = WindowManager.shared.allViews.first {
                for (key, name) in [("_gpuProcessIdentifier", "com.apple.WebKit.GPU"), ("_networkProcessIdentifier", "com.apple.WebKit.Networking")] where pid(any, key) > 0 {
                    helpers.append(["pid": pid(any, key), "name": name])
                }
            }
            done(["value": ["app": Int(getpid()), "views": views, "helpers": helpers] as [String: Any]])
        }
    }
}
#endif
