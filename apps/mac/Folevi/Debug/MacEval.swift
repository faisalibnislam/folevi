// Debug builds only (compiled out of release): a way for scripts to drive the running app without Safari's Web
// Inspector, like the iOS app's SimulatorEval.swift. scripts/mac.mjs writes a request to
// <support folder>/Debug/request.json, posts the Darwin notification named in Debug/app.json, and reads
// Debug/result-<id>.json. Requests:
//
//   { id, cmd: "eval", script, window? }        runs `script` as an async function body in a window's page
//                                               (callAsyncJavaScript: it may await and return a JSON value)
//   { id, cmd: "shot", out, window? }           a PNG of the window's page (WKWebView's snapshot)
//   { id, cmd: "open", url }                    opens a folevi-dev:// link as if another app had
//   { id, cmd: "appearance", value }            "light", "dark" or "system", for screenshots of both
//   { id, cmd: "windows" }                      the windows: number, frame, address, place, key
//   { id, cmd: "newWindow", path? }             another main window
//   { id, cmd: "quit" }
//   { id, cmd: "windowShot", out, window? }     a PNG of the whole window's content at 2x: the native frame drawn by
//                                               AppKit, with the page (WKWebView's snapshot) where it shows, for the
//                                               web vs native screenshot diffs (apps/mac/scripts/screens.mjs)
//   { id, cmd: "resize", width, height, window? } the window's content size, in points
//
// Other packages add commands through MacEval.commands (WM2: "menu", WM1: "places").
#if DEBUG
import AppKit
import WebKit

@MainActor
enum MacEval {
    typealias Command = (_ request: [String: Any], _ done: @escaping ([String: Any]) -> Void) -> Void
    /// More commands by name (other packages register theirs at launch).
    static var commands: [String: Command] = [:]

    private static var notifyName: String { "com.folevi.mac.dev.eval.\(ProcessInfo.processInfo.processIdentifier)" }

    static func install() {
        let info: [String: Any] = [
            "pid": ProcessInfo.processInfo.processIdentifier, "notify": notifyName, "version": Paths.version,
            "bundleId": Bundle.main.bundleIdentifier ?? "", "supportFolder": Paths.supportFolder.path, "shellRoot": Paths.shellRoot.path,
            "serviceUrl": Paths.serviceURL.absoluteString, "startedAt": Date().timeIntervalSince1970,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: Paths.debugFolder.appendingPathComponent("app.json"), options: .atomic)
        }
        CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), nil, { _, _, _, _, _ in
            DispatchQueue.main.async { MainActor.assumeIsolated { MacEval.run() } }
        }, notifyName as CFString, nil, .deliverImmediately)
    }

    private static func run() {
        let file = Paths.debugFolder.appendingPathComponent("request.json")
        guard let data = try? Data(contentsOf: file), let req = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let id = req["id"] as? String,
              id.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil else { return }
        try? FileManager.default.removeItem(at: file)
        let out = Paths.debugFolder.appendingPathComponent("result-\(id).json")
        let done: ([String: Any]) -> Void = { answer in
            let safe = JSONSerialization.isValidJSONObject(answer) ? answer : ["value": String(describing: answer)]
            let data = (try? JSONSerialization.data(withJSONObject: safe, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
            try? data.write(to: out, options: .atomic)
        }
        handle(req, done)
    }

    private static func view(_ req: [String: Any]) -> FoleviWebView? {
        let mains = WindowManager.shared.mains
        if let i = req["window"] as? Int, mains.indices.contains(i) { return mains[i].view }
        return WindowManager.shared.frontMain?.view
    }

    /// The window's content at 2x in sRGB: AppKit draws the native views; the page, a GPU layer cacheDisplay can't
    /// read, is its own snapshot drawn where it sits (when it is showing).
    private static func windowShot(content: NSView, page: FoleviWebView, path: String, done: @escaping ([String: Any]) -> Void) {
        let size = content.bounds.size
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * 2), pixelsHigh: Int(size.height * 2), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                         colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)?.retagging(with: .sRGB) else { return done(["error": "no bitmap"]) }
        rep.size = size
        content.cacheDisplay(in: content.bounds, to: rep)
        let write = { (image: NSImage?, frame: CGRect) in
            if let image, let ctx = NSGraphicsContext(bitmapImageRep: rep) {
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = ctx
                image.draw(in: frame)
                NSGraphicsContext.restoreGraphicsState()
            }
            guard let png = rep.representation(using: .png, properties: [:]) else { return done(["error": "no png"]) }
            do {
                try png.write(to: URL(fileURLWithPath: path))
                done(["value": ["path": path, "width": rep.pixelsWide, "height": rep.pixelsHigh]])
            } catch {
                done(["error": error.localizedDescription])
            }
        }
        let visible = !page.isHidden && page.alphaValue > 0.01 && page.window != nil && !page.bounds.isEmpty && Self.showing(page, in: content)
        guard visible else { return write(nil, .zero) }
        // (Flipped to the content view's bottom-left origin, as NSImage draws.)
        let frame = page.convert(page.bounds, to: content)
        let drawn = content.isFlipped ? CGRect(x: frame.minX, y: size.height - frame.maxY, width: frame.width, height: frame.height) : frame
        page.takeSnapshot(with: nil) { image, _ in write(image, drawn) }
    }

    /// Whether the page shows (no opaque native screen covers it): every ancestor visible.
    private static func showing(_ view: NSView, in root: NSView) -> Bool {
        var v: NSView? = view
        while let cur = v, cur !== root {
            if cur.isHidden || cur.alphaValue < 0.01 { return false }
            v = cur.superview
        }
        return true
    }

    private static func handle(_ req: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
        let cmd = req["cmd"] as? String ?? ""
        switch cmd {
        case "eval":
            guard let view = view(req), let script = req["script"] as? String else { return done(["error": "no window or no script"]) }
            view.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    done(["value": JSONSerialization.isValidJSONObject(["v": value]) ? value : String(describing: value)])
                case .failure(let error):
                    done(["error": (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription])
                }
            }
        case "shot":
            guard let view = view(req), let path = req["out"] as? String else { return done(["error": "no window or no out"]) }
            view.takeSnapshot(with: nil) { image, error in
                guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else {
                    return done(["error": error?.localizedDescription ?? "no snapshot"])
                }
                do {
                    try png.write(to: URL(fileURLWithPath: path))
                    done(["value": ["path": path, "width": rep.pixelsWide, "height": rep.pixelsHigh]])
                } catch {
                    done(["error": error.localizedDescription])
                }
            }
        case "windowShot":
            guard let main = WindowManager.shared.mains.indices.contains(req["window"] as? Int ?? -1) ? WindowManager.shared.mains[req["window"] as! Int] : WindowManager.shared.frontMain,
                  let content = main.window?.contentView, let path = req["out"] as? String else { return done(["error": "no window or no out"]) }
            windowShot(content: content, page: main.view, path: path, done: done)
        case "resize":
            guard let main = WindowManager.shared.frontMain, let window = main.window, let w = req["width"] as? Double, let h = req["height"] as? Double else { return done(["error": "no window or size"]) }
            window.setContentSize(NSSize(width: w, height: h))
            window.contentView?.layoutSubtreeIfNeeded()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { done(["value": [window.contentView?.bounds.width ?? 0, window.contentView?.bounds.height ?? 0]]) }
        case "open":
            guard let raw = req["url"] as? String, let url = URL(string: raw), let app = NSApp.delegate as? AppDelegate else { return done(["error": "no url"]) }
            app.open(url)
            done(["value": true])
        case "appearance":
            // A window behind other apps doesn't run CSS transitions, so a page caught mid-fade would stay
            // half in the old theme in a screenshot: transitions are off around the switch.
            let views = WindowManager.shared.allViews
            let off = "let s = document.getElementById('__macEvalStill'); if (!s) { s = document.createElement('style'); s.id = '__macEvalStill'; s.textContent = '*, *::before, *::after { transition: none !important; animation-duration: 0s !important; }'; document.documentElement.appendChild(s); }"
            let on = "document.getElementById('__macEvalStill')?.remove()"
            views.forEach { $0.callAsyncJavaScript(off, arguments: [:], in: nil, in: .page, completionHandler: nil) }
            switch req["value"] as? String {
            case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
            case "light": NSApp.appearance = NSAppearance(named: .aqua)
            default: NSApp.appearance = nil
            }
            // The page's prefers-color-scheme follows on the next frame.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                views.forEach { $0.callAsyncJavaScript(on, arguments: [:], in: nil, in: .page, completionHandler: nil) }
                done(["value": NSApp.effectiveAppearance.name.rawValue])
            }
        case "windows":
            let list: [[String: Any]] = WindowManager.shared.mains.enumerated().map { i, m in
                let f = m.window?.frame ?? .zero
                return ["index": i, "number": m.window?.windowNumber ?? 0, "frame": [f.origin.x, f.origin.y, f.size.width, f.size.height], "url": m.view.url?.absoluteString ?? "",
                        "place": m.view.place ?? NSNull(), "key": m.window?.isKeyWindow ?? false, "visible": m.window?.isVisible ?? false, "loaded": m.view.loaded]
            }
            done(["value": list])
        case "setDefault":
            // A native screen's remembered choice (a tab, a filter) before a capture (screens.mjs `defaults`).
            guard let key = req["key"] as? String else { return done(["error": "no key"]) }
            if let value = req["value"] as? String { Paths.defaults.set(value, forKey: key) } else { Paths.defaults.removeObject(forKey: key) }
            done(["value": true])
        case "newWindow":
            WindowManager.shared.openMain(path: req["path"] as? String ?? "/")
            done(["value": WindowManager.shared.mains.count])
        case "quit":
            done(["value": true])
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { NSApp.terminate(nil) }
        default:
            if let extra = commands[cmd] { extra(req, done) } else { done(["error": "unknown command \(cmd)"]) }
        }
    }
}
#endif
