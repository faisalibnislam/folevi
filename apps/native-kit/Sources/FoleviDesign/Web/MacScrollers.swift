// Scroll bars as the owner wants them on the Mac (2026-10-29): thin, over the content, hidden at rest and shown while
// scrolling, whatever System Settings > Appearance > Show scroll bars says ("Always", or "Automatically" with a mouse,
// gives the wide grey scrollers that take room from the content). Native scroll views follow
// NSScroller.preferredScrollerStyle, which AppKit reads from the AppleShowScrollBars default: set in the argument
// domain (this run only, never written to disk), it wins over the system's, and AppKit reads it again (and keeps it)
// when the system setting changes. The web views draw theirs from the web app's own CSS (apps/web globals.css and
// lib/scrollActivity.ts), as on the website (WebKit's own process doesn't see this default).
#if canImport(AppKit)
import AppKit

public enum MacScrollers {
    /// Before the first scroll view (AppKit reads the default once at launch and on each change).
    public static func useOverlay() {
        let defaults = UserDefaults.standard
        var args = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
        guard args["AppleShowScrollBars"] as? String != "WhenScrolling" else { return }
        args["AppleShowScrollBars"] = "WhenScrolling"
        defaults.removeVolatileDomain(forName: UserDefaults.argumentDomain)
        defaults.setVolatileDomain(args, forName: UserDefaults.argumentDomain)
    }
}
#endif
