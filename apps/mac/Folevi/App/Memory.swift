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
        WebViewFactory.extraScripts.append("memory-probe")
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

    /// `mac.mjs cmd quickAddType {"text"}`: opens Quick Add and types `text` into the panel at once, as someone who
    /// starts typing the moment it shows; answers with what its field holds once the page is ready.
    static func typeIntoQuickAdd(_ text: String, _ done: @escaping ([String: Any]) -> Void) {
        let q = QuickAddPanel.shared
        q.show()
        let wasReady = q.ready
        guard let panel = q.panel else { return done(["error": "no panel"]) }
        for ch in text {
            for type in [NSEvent.EventType.keyDown, .keyUp] {
                if let e = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: panel.windowNumber, context: nil, characters: String(ch), charactersIgnoringModifiers: String(ch), isARepeat: false, keyCode: 0) {
                    panel.sendEvent(e)
                }
            }
        }
        func check(_ tries: Int) {
            guard q.ready, let view = q.view else {
                return tries > 0 ? DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { MainActor.assumeIsolated { check(tries - 1) } } : done(["error": "not ready"])
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                view.callAsyncJavaScript("return document.getElementById('qa-title').value", arguments: [:], in: nil, in: .page) { r in
                    if case .success(let v) = r { done(["value": ["field": v as? String ?? "", "wasReady": wasReady]]) } else { done(["error": "no field"]) }
                }
            }
        }
        check(200)
    }

    /// `mac.mjs cmd memory`: every web view (its role, place, address, window and process) and every WebKit process
    /// of the app, so a script can put a footprint on each.
    static func installEval() {
        MacEval.commands["quickAddType"] = { req, done in typeIntoQuickAdd(req["text"] as? String ?? "", done) }
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
            done(["value": [
                "app": Int(getpid()), "views": views, "helpers": helpers,
                "quickAddShownAt": QuickAddPanel.shared.shownAt.map { $0.timeIntervalSince1970 * 1000 } ?? NSNull(),
            ] as [String: Any]])
        }
    }
}
#endif
