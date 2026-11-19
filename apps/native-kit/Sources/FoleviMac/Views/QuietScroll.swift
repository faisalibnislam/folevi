// A list that doesn't answer the pointer while it moves (2026-11-19, the Mac performance pass).
//
// While a list scrolls under a pointer that rests on it, SwiftUI asks on every frame what is under the pointer now,
// and that question walks every row and card the list has built so far, with each one's shapes, hovers, gestures
// and helper views. On All notes (2,000 notes) that was about a third of the main thread's work per frame, and it
// grew the further the list had been scrolled: 150 frames missed in a three second scroll with the pointer over
// the window, 57 to 100 with the rows out of the question. Rows don't need the pointer while they move (Finder and
// Safari show no hover during a scroll either), so the list's content takes none until it has rested for a moment.
// A press ends that at once, so a click on a row right after a scroll still lands on it.
import SwiftUI
#if os(macOS)
import AppKit
#endif

/// A `ScrollView` whose content takes no pointer while it scrolls (macOS; a plain `ScrollView` on the iPad, where a
/// touch on a moving list already only stops it).
struct QuietScrollView<Content: View>: View {
    private let axes: Axis.Set
    private let content: Content

    init(_ axes: Axis.Set = .vertical, @ViewBuilder content: () -> Content) {
        self.axes = axes
        self.content = content()
    }

    var body: some View {
        ScrollView(axes) { content.modifier(QuietWhileScrolling()) }
    }
}

/// On a scroll view's content (one root view).
struct QuietWhileScrolling: ViewModifier {
    #if os(macOS)
    @State private var scrolling = false
    /// `FOLEVI_SCROLL_HOVER=1`: rows answer the pointer while they scroll, as before (measuring one against the other
    /// in the same build and with the pointer in the same place: apps/mac/scripts/perf-scroll.mjs).
    static let off = ProcessInfo.processInfo.environment["FOLEVI_SCROLL_HOVER"] == "1"

    func body(content: Content) -> some View {
        content
            .allowsHitTesting(!scrolling || Self.off)
            .background(ScrollWatch(scrolling: $scrolling))
    }
    #else
    func body(content: Content) -> some View { content }
    #endif
}

#if os(macOS)
/// Says when the scroll view it lies in is moving: from the first change of its clip view's bounds (a wheel, a
/// trackpad's momentum, a key, a scroll made in code) until `rest` has passed without one.
final class ScrollWatchView: NSView {
    /// How long after the last movement the list counts as at rest.
    static let rest: TimeInterval = 0.12

    var changed: ((Bool) -> Void)?
    private(set) var scrolling = false
    private weak var clip: NSClipView?
    private var last: CFTimeInterval = 0
    private var timer: Timer?
    private var monitor: Any?

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        attach()
    }

    override func viewDidMoveToSuperview() {
        super.viewDidMoveToSuperview()
        attach()
    }

    private func attach() {
        let found = window == nil ? nil : enclosingScrollView?.contentView
        guard found !== clip else { return }
        if let clip { NotificationCenter.default.removeObserver(self, name: NSView.boundsDidChangeNotification, object: clip) }
        clip = found
        guard let found else { return end() }
        found.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(self, selector: #selector(moved), name: NSView.boundsDidChangeNotification, object: found)
    }

    @objc private func moved() {
        last = CACurrentMediaTime()
        // (Not while a press is being handled: see `pressed`.)
        if !scrolling, last >= awakeUntil { begin() }
    }

    /// After a press the rows stay awake this long even if the list is still moving, so the press, sent on a
    /// moment later, and its release both reach the row (the list had gone quiet again before the press arrived).
    static let awakeAfterPress: TimeInterval = 0.4
    private var awakeUntil: CFTimeInterval = 0

    /// (Tests call these two in place of a real scroll and the wait.)
    func begin() {
        guard !scrolling else { return }
        scrolling = true
        // (After this pass: the bounds can change inside SwiftUI's own layout, where state must not.)
        DispatchQueue.main.async { [weak self] in
            guard let self, self.scrolling else { return }
            self.changed?(true)
        }
        let t = Timer(timeInterval: Self.rest / 2, repeats: true) { [weak self] timer in
            // (The view gone without being taken down: the timer ends itself.)
            guard let self else { return timer.invalidate() }
            MainActor.assumeIsolated {
                if CACurrentMediaTime() - self.last >= Self.rest { self.end() }
            }
        }
        t.tolerance = Self.rest / 4
        RunLoop.main.add(t, forMode: .common)
        timer = t
        // A press in this window while the list still counts as moving: the rows answer again first, and the press
        // is sent on a moment later (once SwiftUI has taken the change in), so it lands on what is under it.
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] event in
            // (A local monitor runs on the main thread; the event never leaves it.)
            nonisolated(unsafe) let event = event
            nonisolated(unsafe) var out: NSEvent? = event
            MainActor.assumeIsolated { if let self { out = self.pressed(event) } }
            return out
        }
    }

    /// How long a press waits for the rows to answer again.
    static let pressDelay: TimeInterval = 0.02

    /// A press while the list counts as moving: nil when it is held back to be sent again (see `begin`).
    func pressed(_ event: NSEvent, resend: @escaping @MainActor (NSEvent) -> Void = { NSApp.postEvent($0, atStart: true) }) -> NSEvent? {
        guard scrolling, event.window === window else { return event }
        end()
        awakeUntil = CACurrentMediaTime() + Self.awakeAfterPress
        nonisolated(unsafe) let held = event
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.pressDelay) { MainActor.assumeIsolated { resend(held) } }
        return nil
    }

    func end() {
        timer?.invalidate()
        timer = nil
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        guard scrolling else { return }
        scrolling = false
        changed?(false)
    }
}

private struct ScrollWatch: NSViewRepresentable {
    @Binding var scrolling: Bool

    func makeNSView(context: Context) -> ScrollWatchView {
        let v = ScrollWatchView()
        v.changed = { on in if scrolling != on { scrolling = on } }
        return v
    }

    func updateNSView(_ v: ScrollWatchView, context: Context) {
        v.changed = { on in if scrolling != on { scrolling = on } }
    }

    static func dismantleNSView(_ v: ScrollWatchView, coordinator: ()) { v.end() }
}
#endif
