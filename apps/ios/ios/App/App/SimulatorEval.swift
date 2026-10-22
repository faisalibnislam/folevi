// Debug builds in the Simulator only (compiled out of everything else): a way for scripts on the Mac to run
// JavaScript in the web view, for checking the app without Safari's Web Inspector. Write the script to the
// app's tmp/eval.js, post the notification, read tmp/eval-result.json (scripts/simulator.mjs eval does all three):
//
//   xcrun simctl spawn booted notifyutil -p com.folevi.ios.eval
//
// The script runs as an async function body (callAsyncJavaScript), so it can `await` and `return` a value.
// Two more things the Simulator can't do from a script: a first line `//open folevi://...` opens that link as
// if another app had (no "Open in Folevi?" prompt), and focusing a text field from a script raises the
// keyboard (WebKit's input delegate, which only these builds set).
#if DEBUG && targetEnvironment(simulator)
import Capacitor
import Foundation
import UIKit
import WebKit

enum SimulatorEval {
    private static weak var webView: WKWebView?
    private static var observing = false

    static func install(on webView: WKWebView) {
        self.webView = webView
        let setter = NSSelectorFromString("_setInputDelegate:")
        if webView.responds(to: setter) { webView.perform(setter, with: inputDelegate) }
        // One listener per run: a new screen (a mode or place switch) only changes which web view it runs in.
        guard !observing else { return }
        observing = true
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterAddObserver(center, nil, { _, _, _, _, _ in
            DispatchQueue.main.async { SimulatorEval.run() }
        }, "com.folevi.ios.eval" as CFString, nil, .deliverImmediately)
    }

    private static func run() {
        let tmp = FileManager.default.temporaryDirectory
        let out = tmp.appendingPathComponent("eval-result.json")
        try? FileManager.default.removeItem(at: out)
        guard let webView, let script = try? String(contentsOf: tmp.appendingPathComponent("eval.js"), encoding: .utf8) else { return }
        if script.hasPrefix("//open "), let url = URL(string: String(script.dropFirst(7)).trimmingCharacters(in: .whitespacesAndNewlines)) {
            let opened = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
            try? JSONSerialization.data(withJSONObject: ["value": opened]).write(to: out)
            return
        }
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            var answer: [String: Any] = [:]
            switch result {
            case .success(let value):
                answer["value"] = JSONSerialization.isValidJSONObject(["v": value]) ? value : String(describing: value)
            case .failure(let error):
                answer["error"] = error.localizedDescription
            }
            let data = (try? JSONSerialization.data(withJSONObject: answer, options: [.fragmentsAllowed])) ?? Data("{}".utf8)
            try? data.write(to: out)
        }
    }

    private static let inputDelegate = FocusDelegate()
}

/// Lets a focus() from a script start typing (WebKit only does that for a tap otherwise).
private final class FocusDelegate: NSObject {
    @objc(_webView:focusShouldStartInputSession:)
    func webView(_ webView: WKWebView, focusShouldStartInputSession info: AnyObject) -> Bool { true }
}
#endif
