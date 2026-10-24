// Native to page (docs/MAC_WEBKIT_PLAN.md §4.3): an event reaches one view's page through
// window.__foleviEmit(plugin, event, data), which mac-bridge.js defined at document start; the page listens with
// listen(plugin, event, cb) (library changes, cloud status, places changed, Foli AI chunks, menu commands).
import AppKit
import WebKit

final class ViewEvents: BridgeEvents {
    weak var view: WKWebView?

    init(view: WKWebView? = nil) {
        self.view = view
    }

    func emit(_ plugin: String, _ event: String, _ data: [String: Any]) {
        let send = { [weak self] in
            guard let view = self?.view else { return }
            // Plain data only: what JSON can carry reaches the page as it is.
            let payload: Any = JSONSerialization.isValidJSONObject(data) ? data : [:]
            view.callAsyncJavaScript("window.__foleviEmit && window.__foleviEmit(plugin, event, data)", arguments: ["plugin": plugin, "event": event, "data": payload], in: nil, in: .page, completionHandler: nil)
        }
        if Thread.isMainThread { send() } else { DispatchQueue.main.async(execute: send) }
    }
}

/// Events to more than one view.
enum Events {
    /// Every open view, or those whose place passes `filter` (WindowManager keeps the list).
    @MainActor
    static func broadcast(_ plugin: String, _ event: String, _ data: [String: Any], where filter: (String?) -> Bool = { _ in true }) {
        for view in WindowManager.shared.allViews where filter(view.place) { view.events.emit(plugin, event, data) }
    }

    /// A command for the page (foleviDesktop.onCommand): { type: "navigate", path }, { type: "new-note" }, ...
    @MainActor
    static func command(_ command: [String: Any], to view: FoleviWebView) {
        // A window with the native frame does what it can itself (Frame/NativeFrame.swift).
        if NativeFrame.handle(command, to: view) { return }
        view.events.emit("FoleviDesktop", "command", command)
    }
}
