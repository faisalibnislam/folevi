// Every main window comes back where it was (docs/MAC_POLISH_PLAN.md §3.5): its frame and the page it showed,
// front to back, in windows.json in the support folder (the tabs are the page's own, kept per account). No
// AppKit state restoration (and so no "reopen windows?" alert after a forced quit). Closing the last window
// hides it instead, so its page keeps syncing and Quick Add and the menu bar icon keep working; the Dock icon or
// ⌘N brings it back.
import AppKit

@MainActor
enum WindowRestore {
    struct Saved: Codable, Equatable {
        /// x, y, width, height (screen coordinates, from the bottom left).
        var frame: [Double]
        var path: String
        var hidden: Bool?
    }

    struct Saves: Codable, Equatable {
        var v = 1
        var windows: [Saved]
    }

    static var file: URL { Paths.supportFolder.appendingPathComponent("windows.json") }

    static func load(from url: URL? = nil) -> [Saved] {
        guard let data = try? Data(contentsOf: url ?? file), let s = try? JSONDecoder().decode(Saves.self, from: data), s.v == 1 else { return [] }
        return s.windows.filter { $0.frame.count == 4 && $0.frame.allSatisfy(\.isFinite) && $0.frame[2] >= 200 && $0.frame[3] >= 200 }.prefix(20).map { $0 }
    }

    /// The page a window showed, as a path to open again (Folevi's own pages only; never Quick Add's or a
    /// runner's). Pure (ChromeTests).
    nonisolated static func restorablePath(_ url: URL?) -> String {
        guard let url, url.scheme == "app", url.host == "folevi" else { return "/" }
        var path = url.path(percentEncoded: true)
        if path.isEmpty { path = "/" }
        for head in ["/quick-add", "/place-sync", "/_"] where path.hasPrefix(head) { return "/" }
        if let q = url.query(percentEncoded: true), !q.isEmpty { path += "?" + q }
        if let f = url.fragment(percentEncoded: true), !f.isEmpty { path += "#" + f }
        return path.count > 500 ? "/" : path
    }

    /// The windows as they are now, front to back. Hidden ones only when none is showing.
    static func snapshot() -> [Saved] {
        let mains = WindowManager.shared.mains
        let order = NSApp.orderedWindows
        let sorted = mains.sorted { a, b in
            (order.firstIndex { $0 === a.window } ?? Int.max) < (order.firstIndex { $0 === b.window } ?? Int.max)
        }
        let visible = sorted.filter { $0.window?.isVisible == true || $0.window?.isMiniaturized == true }
        let keep = visible.isEmpty ? Array(sorted.prefix(1)) : visible
        return keep.compactMap { c in
            guard let w = c.window else { return nil }
            let f = w.styleMask.contains(.fullScreen) ? (lastFrames[ObjectIdentifier(w)] ?? w.frame) : w.frame
            return Saved(frame: [f.origin.x, f.origin.y, f.width, f.height], path: restorablePath(c.view.url), hidden: visible.isEmpty ? true : nil)
        }
    }

    /// Frames before full screen (a window saved in full screen comes back at its normal size).
    private static var lastFrames: [ObjectIdentifier: NSRect] = [:]

    static func save() {
        pending?.cancel()
        pending = nil
        guard !restoring else { return }
        let saves = Saves(windows: snapshot())
        guard !saves.windows.isEmpty, let data = try? JSONEncoder().encode(saves) else { return }
        try? data.write(to: file, options: .atomic)
    }

    private static var pending: DispatchWorkItem?
    private static var restoring = false

    /// Something about the windows changed: saved a moment later.
    static func changed() {
        pending?.cancel()
        let work = DispatchWorkItem { MainActor.assumeIsolated { WindowRestore.save() } }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
    }

    static func install() {
        let nc = NotificationCenter.default
        for name in [NSWindow.didMoveNotification, NSWindow.didEndLiveResizeNotification, NSWindow.didResizeNotification, NSWindow.didMiniaturizeNotification, NSWindow.didDeminiaturizeNotification] {
            nc.addObserver(forName: name, object: nil, queue: .main) { n in
                MainActor.assumeIsolated {
                    guard let w = n.object as? NSWindow, WindowManager.shared.mains.contains(where: { $0.window === w }) else { return }
                    if !w.styleMask.contains(.fullScreen) { WindowRestore.lastFrames[ObjectIdentifier(w)] = w.frame }
                    WindowRestore.changed()
                }
            }
        }
        nc.addObserver(forName: NSWindow.willCloseNotification, object: nil, queue: .main) { n in
            MainActor.assumeIsolated {
                guard let w = n.object as? NSWindow else { return }
                WindowRestore.lastFrames.removeValue(forKey: ObjectIdentifier(w))
                TitleBar.spots.removeValue(forKey: ObjectIdentifier(w))
                for view in WindowManager.shared.allViews where view.window === w {
                    Chrome.states.removeValue(forKey: ObjectIdentifier(view))
                    TitleBar.forget(view)
                    TextMenu.forget(view)
                }
                // After WindowManager forgot it.
                DispatchQueue.main.async { WindowRestore.changed() }
            }
        }
        nc.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { WindowRestore.save() }
        }
    }

    /// The first windows at launch: those saved, back to front so the front one ends up in front, each on a
    /// screen that's still there; else one window where Electron's was (after the migration), or 920 × 640 on the
    /// very first launch (polish §2.1).
    static func openFirstWindows() {
        let saved = load()
        guard !saved.isEmpty else {
            let first = WindowManager.shared.openMain()
            // Moved from the Electron app (WM3): its window's place and size.
            if let old = ElectronMigration.firstWindowFrame(ElectronMigration.forThisApp().record), let w = first.window {
                w.setFrame(onScreen(old), display: false)
            } else if ShellMode.current == "unset", let w = first.window, w.frame.size == NSSize(width: 1280, height: 820) {
                w.setContentSize(NSSize(width: 920, height: 640))
                w.center()
            }
            return
        }
        restoring = true
        defer {
            restoring = false
            changed()
        }
        for s in saved.reversed() {
            let controller = WindowManager.shared.openMain(path: s.path)
            guard let w = controller.window else { continue }
            w.setFrame(onScreen(NSRect(x: s.frame[0], y: s.frame[1], width: s.frame[2], height: s.frame[3])), display: false)
            lastFrames[ObjectIdentifier(w)] = w.frame
        }
    }

    /// A frame moved onto the nearest screen when its screen is gone (or it's mostly off every screen).
    static func onScreen(_ frame: NSRect) -> NSRect {
        let screens = NSScreen.screens.map(\.visibleFrame)
        return fit(frame, screens: screens)
    }

    nonisolated static func fit(_ frame: NSRect, screens: [NSRect]) -> NSRect {
        guard let best = screens.max(by: { $0.intersection(frame).area < $1.intersection(frame).area }) else { return frame }
        if best.intersection(frame).area >= frame.area * 0.5 { return frame }
        var f = frame
        f.size.width = min(f.width, best.width)
        f.size.height = min(f.height, best.height)
        f.origin.x = best.midX - f.width / 2
        f.origin.y = best.midY - f.height / 2
        return f
    }

    /// The last main window showing hides instead of closing (Electron's main window did the same).
    static func shouldClose(_ controller: MainWindowController) -> Bool {
        let showing = WindowManager.shared.mains.filter { $0.window?.isVisible == true }
        guard showing.count == 1, showing.first === controller, let w = controller.window else { return true }
        save()
        w.orderOut(nil)
        return false
    }
}

private extension NSRect {
    var area: CGFloat { isNull ? 0 : width * height }
}
