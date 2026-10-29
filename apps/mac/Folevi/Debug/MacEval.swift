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
import CoreImage
import FoleviMac
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

    /// The window's content at 2x in sRGB, drawn by the app itself (no screen capture: capturing other windows goes
    /// through WindowServer's privacy checks, and many captures at once hung WindowServer, docs/MAC_SCREEN_PLAYBOOK.md).
    /// AppKit draws the native views; the page, a GPU layer cacheDisplay can't read, is its own snapshot drawn where
    /// it sits; then whatever lies above the page (the glass bar over a note) is drawn again over it, in view order.
    static func windowShot(content: NSView, page: FoleviWebView, path: String, done: @escaping ([String: Any]) -> Void) {
        // The glass bar blurs what's under it live (a layer background filter), which caching the views doesn't draw:
        // the shot is taken without the bar, the same filters are applied to what's under it, then the bar on top.
        let glasses = Self.descendants(content).compactMap { $0 as? GlassBackdrop }.filter { !$0.isHidden && $0.window != nil }
        let bars = glasses.flatMap { g in (g.superview?.subviews ?? []).drop { $0 !== g }.dropFirst().filter { !$0.isHidden && $0.frame.intersects(g.frame) } }
        // Each bar as drawn now, before it's taken out of the shot.
        let drawnBars: [(NSView, NSBitmapImageRep)] = bars.compactMap { bar in
            guard let over = bitmap(bar.bounds.size) else { return nil }
            bar.cacheDisplay(in: bar.bounds, to: over)
            return (bar, over)
        }
        bars.forEach { $0.alphaValue = 0 }
        compose(content: content, page: page) { rep in
            bars.forEach { $0.alphaValue = 1 }
            guard var rep else { return done(["error": "no bitmap"]) }
            let size = content.bounds.size
            // A new picture: the shot, what's under each bar blurred, then the bars.
            if !glasses.isEmpty, let whole = rep.cgImage, let out = bitmap(size), let ctx = NSGraphicsContext(bitmapImageRep: out) {
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = ctx
                ctx.cgContext.draw(whole, in: CGRect(origin: .zero, size: size))
                for g in glasses {
                    let r = g.convert(g.bounds, to: content)
                    let drawn = content.isFlipped ? CGRect(x: r.minX, y: size.height - r.maxY, width: r.width, height: r.height) : r
                    // In the bitmap's pixels (2x), from the top.
                    let px = CGRect(x: r.minX * 2, y: (content.isFlipped ? r.minY : size.height - r.maxY) * 2, width: r.width * 2, height: r.height * 2)
                    var image = CIImage(cgImage: whole).clampedToExtent()
                    for f in GlassBackdrop.filters() {
                        if f.name == "CIGaussianBlur" { f.setValue(60, forKey: kCIInputRadiusKey) }
                        f.setValue(image, forKey: kCIInputImageKey)
                        image = f.outputImage ?? image
                    }
                    let flippedPx = CGRect(x: px.minX, y: CGFloat(whole.height) - px.maxY, width: px.width, height: px.height)
                    guard let blurred = CIContext().createCGImage(image, from: flippedPx) else { continue }
                    NSBezierPath(roundedRect: drawn, xRadius: g.layer?.cornerRadius ?? 0, yRadius: g.layer?.cornerRadius ?? 0).addClip()
                    NSImage(cgImage: blurred, size: drawn.size).draw(in: drawn)
                    NSGraphicsContext.restoreGraphicsState()
                    NSGraphicsContext.saveGraphicsState()
                    NSGraphicsContext.current = ctx
                }
                for (bar, over) in drawnBars {
                    let r = bar.convert(bar.bounds, to: content)
                    let drawn = content.isFlipped ? CGRect(x: r.minX, y: size.height - r.maxY, width: r.width, height: r.height) : r
                    over.draw(in: drawn, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: false, hints: nil)
                }
                ctx.flushGraphics()
                NSGraphicsContext.restoreGraphicsState()
                rep = out
            }
            guard let png = rep.representation(using: .png, properties: [:]) else { return done(["error": "no png"]) }
            do {
                try png.write(to: URL(fileURLWithPath: path))
                done(["value": ["path": path, "width": rep.pixelsWide, "height": rep.pixelsHigh]])
            } catch {
                done(["error": error.localizedDescription])
            }
        }
    }

    private static func descendants(_ view: NSView) -> [NSView] {
        view.subviews + view.subviews.flatMap { descendants($0) }
    }

    /// The window's content at 2x: the views as AppKit draws them, the page (WKWebView's snapshot) where it shows.
    private static func compose(content: NSView, page: FoleviWebView, done: @escaping (NSBitmapImageRep?) -> Void) {
        let size = content.bounds.size
        guard let rep = bitmap(size) else { return done(nil) }
        content.cacheDisplay(in: content.bounds, to: rep)
        let write = { (image: NSImage?, frame: CGRect) in
            if let image, let ctx = NSGraphicsContext(bitmapImageRep: rep) {
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = ctx
                image.draw(in: frame)
                // What sits above the page and overlaps it, again on top.
                for view in Self.above(page, in: content) where !view.isHidden && view.alphaValue > 0.01 {
                    let r = view.convert(view.bounds, to: content)
                    guard r.intersects(frame), let over = bitmap(view.bounds.size) else { continue }
                    view.cacheDisplay(in: view.bounds, to: over)
                    let drawn = content.isFlipped ? CGRect(x: r.minX, y: size.height - r.maxY, width: r.width, height: r.height) : r
                    over.draw(in: drawn, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: false, hints: nil)
                }
                NSGraphicsContext.restoreGraphicsState()
            }
            done(rep)
        }
        let visible = !page.isHidden && page.alphaValue > 0.01 && page.window != nil && !page.bounds.isEmpty && Self.showing(page, in: content)
        guard visible else { return write(nil, .zero) }
        // (Flipped to the content view's bottom-left origin, as NSImage draws.)
        let frame = page.convert(page.bounds, to: content)
        let drawn = content.isFlipped ? CGRect(x: frame.minX, y: size.height - frame.maxY, width: frame.width, height: frame.height) : frame
        page.takeSnapshot(with: nil) { image, _ in write(image, drawn) }
    }

    private static func bitmap(_ size: CGSize) -> NSBitmapImageRep? {
        guard size.width >= 1, size.height >= 1, let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * 2), pixelsHigh: Int(size.height * 2), bitsPerSample: 8, samplesPerPixel: 4,
                                                                                 hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)?.retagging(with: .sRGB) else { return nil }
        rep.size = size
        return rep
    }

    /// The views drawn after `view` (above it) along its ancestors up to `root`: later siblings at each level.
    private static func above(_ view: NSView, in root: NSView) -> [NSView] {
        var out: [NSView] = []
        var child = view
        while let parent = child.superview, child !== root {
            if let i = parent.subviews.firstIndex(of: child) { out.append(contentsOf: parent.subviews[(i + 1)...]) }
            if parent === root { break }
            child = parent
        }
        return out
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
        case "settingsShot":
            // The Settings window (⌘,) at a section, drawn with its title bar and toolbar, and its size.
            guard let path = req["out"] as? String else { return done(["error": "no out"]) }
            SettingsWindow.shared.show(section: req["section"] as? String)
            DispatchQueue.main.asyncAfter(deadline: .now() + (req["settle"] as? Double ?? 1.5)) {
                guard let window = SettingsWindow.shared.window, let frameView = window.contentView?.superview, let rep = bitmap(frameView.bounds.size) else { return done(["error": "no settings window"]) }
                frameView.cacheDisplay(in: frameView.bounds, to: rep)
                do {
                    try rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
                    done(["value": ["path": path, "width": window.frame.width, "height": window.frame.height, "content": window.contentView?.frame.height ?? 0]])
                } catch {
                    done(["error": error.localizedDescription])
                }
            }
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
