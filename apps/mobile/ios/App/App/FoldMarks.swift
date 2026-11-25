// iPhone Duo partly open: tells the page where the fold crosses it, so nothing interactive sits in the crease and the
// sidebar keeps to its side (Apple's "Designing for iPhone Duo"). The page reads the same marks the native iPhone
// Duo app set (apps/ios RebuildIPad.swift `fold`): `<html data-fold>` ("horizontal" for a fold across) with
// `--fold-start` and `--fold-end` in CSS px (apps/web lib/platform.ts `fold()`). Flat, closed, on any other device,
// and before iOS 27.1, the marks are taken off.
import UIKit
import WebKit

@MainActor
final class FoldMarks {
    private weak var webView: WKWebView?
    /// The script last sent, so an unchanged fold sends nothing.
    private var sent: String?
    private var loading: NSKeyValueObservation?

    init(webView: WKWebView) {
        self.webView = webView
        if #available(iOS 27.1, *) {
            // Called with the first state and on every hinge change; the fold's reserved region follows the hinge a
            // moment later, so it's read again once things settle.
            webView.addInteraction(UIHingeInteraction { [weak self] _, _ in self?.refreshSoon() })
        }
        // A page load starts without the marks: send them again once it has loaded.
        loading = webView.observe(\.isLoading, options: [.new]) { [weak self] view, _ in
            guard !view.isLoading else { return }
            Task { @MainActor in
                self?.sent = nil
                self?.refreshSoon()
            }
        }
    }

    /// Reads the fold now and again shortly after (layout and the reserved region settle after a hinge move).
    func refreshSoon() {
        refresh()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in self?.refresh() }
    }

    func refresh() {
        guard let webView else { return }
        let script = Self.script(for: Self.fold(in: webView))
        guard script != sent else { return }
        sent = script
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    struct Fold: Equatable {
        var horizontal: Bool
        var start: CGFloat
        var end: CGFloat
    }

    /// The active fold crossing the web view, in its own coordinates (its points are the page's CSS px), or nil.
    static func fold(in view: UIView) -> Fold? {
        guard #available(iOS 27.1, *) else { return nil }
        let size = view.bounds.size
        for region in view.reservedRegions(kind: .division) where region.isActive {
            let f = region.frame
            guard f.maxX > 0, f.minX < size.width, f.maxY > 0, f.minY < size.height else { continue }
            if f.height >= f.width {
                return Fold(horizontal: false, start: max(0, f.minX), end: min(size.width, f.maxX))
            }
            return Fold(horizontal: true, start: max(0, f.minY), end: min(size.height, f.maxY))
        }
        return nil
    }

    static func script(for fold: Fold?) -> String {
        guard let fold else {
            return "(function(){var r=document.documentElement;r.removeAttribute('data-fold');r.style.removeProperty('--fold-start');r.style.removeProperty('--fold-end')})()"
        }
        let kind = fold.horizontal ? "horizontal" : ""
        return "(function(){var r=document.documentElement;r.setAttribute('data-fold','\(kind)');r.style.setProperty('--fold-start','\(Int(fold.start.rounded(.down)))px');r.style.setProperty('--fold-end','\(Int(fold.end.rounded(.up)))px')})()"
    }
}
