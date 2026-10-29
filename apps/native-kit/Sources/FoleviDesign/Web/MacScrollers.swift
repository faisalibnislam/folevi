// Scroll bars as the owner wants them on the Mac (2026-10-29): thin, over the content, hidden at rest and shown while
// scrolling, whatever System Settings > Appearance > Show scroll bars says ("Always", or "Automatically" with a mouse,
// gives the wide grey scrollers that take room from the content). Native scroll views follow
// NSScroller.preferredScrollerStyle, which AppKit reads from the AppleShowScrollBars default: set in the argument
// domain (this run only, never written to disk), it wins over the system's, and AppKit reads it again (and keeps it)
// when the system setting changes. The web views draw theirs from `webStyle` (WebKit's own process doesn't see it).
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

    /// The web views' scroll bars drawn the same way: a thin knob, no track, shown while the area scrolls (and under
    /// the pointer), then faded. They always keep their thin gutter, so nothing moves sideways when one shows.
    public static let webStyle = """
    (() => {
      const css = `
        ::-webkit-scrollbar { width: 8px; height: 8px; background: transparent; }
        ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
        ::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
        .fv-scrolling::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background-color: rgb(0 0 0 / 0.32); }
        :root[data-theme="dark"] .fv-scrolling::-webkit-scrollbar-thumb, :root[data-theme="dark"] ::-webkit-scrollbar-thumb:hover { background-color: rgb(255 255 255 / 0.32); }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) .fv-scrolling::-webkit-scrollbar-thumb, :root:not([data-theme="light"]) ::-webkit-scrollbar-thumb:hover { background-color: rgb(255 255 255 / 0.32); }
        }`;
      const add = () => { const s = document.createElement("style"); s.id = "folevi-mac-scrollbars"; s.textContent = css; document.head.appendChild(s); };
      if (document.head) add(); else document.addEventListener("DOMContentLoaded", add, { once: true });
      const timers = new WeakMap();
      document.addEventListener("scroll", (e) => {
        const el = e.target === document ? document.documentElement : e.target;
        if (!(el instanceof Element)) return;
        el.classList.add("fv-scrolling");
        clearTimeout(timers.get(el));
        timers.set(el, setTimeout(() => el.classList.remove("fv-scrolling"), 900));
      }, { capture: true, passive: true });
    })();
    """
}
#endif
