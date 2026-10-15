// Debug builds in the Simulator only (compiled out of everything else): a way for scripts on the Mac to run
// JavaScript in the web view, for checking the app without Safari's Web Inspector. Write the script to the
// app's tmp/eval.js, post the notification, read tmp/eval-result.json (scripts/simulator.mjs eval does all three):
//
//   xcrun simctl spawn booted notifyutil -p com.folevi.ios.eval
//
// The script runs as an async function body (callAsyncJavaScript), so it can `await` and `return` a value.
#if DEBUG && targetEnvironment(simulator)
import Foundation
import WebKit

enum SimulatorEval {
    private static weak var webView: WKWebView?

    static func install(on webView: WKWebView) {
        self.webView = webView
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
}
#endif
