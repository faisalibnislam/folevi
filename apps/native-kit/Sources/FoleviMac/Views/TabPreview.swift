// A tab's picture under the pointer (the web's TabStrip.tsx preview and TabPreview.tsx): 300 ms after the pointer
// first rests on a tab, then at once while it moves along the strip from tab to tab, with nothing hidden in between
// (no flicker); gone when the pointer leaves the strip, a tab is pressed or dragged, or it reaches the open tab.
// The picture is the page drawn small (the note's top, as an export draws it) and the tab's name, nothing else.
#if os(macOS) || os(iOS)
import SwiftUI
import FoleviDesign

/// Which tab's picture shows, and where (the strip's hover drives it; the frame draws it over the content).
@MainActor @Observable
public final class TabPreviewState {
    public static let rest: Duration = .milliseconds(300)
    /// The tab pictured, and its frame in the window (top-left points).
    public private(set) var shown: (id: String, frame: CGRect)?
    /// Whether a picture has shown since the pointer came onto the strip (from then on each tab's shows at once).
    private var previewing = false
    private var pending: Task<Void, Never>?

    public init() {}

    public var shownID: String? { shown?.id }

    /// The pointer came onto a tab (`active`: the open one, which shows none).
    public func enter(_ id: String, frame: CGRect, active: Bool) {
        pending?.cancel()
        if active {
            shown = nil
            return
        }
        if previewing {
            shown = (id, frame)
            return
        }
        pending = Task { [weak self] in
            try? await Task.sleep(for: Self.rest)
            guard let self, !Task.isCancelled else { return }
            self.previewing = true
            self.shown = (id, frame)
        }
    }

    /// The pointer left a tab: only a picture that hasn't shown yet stops (the next tab's replaces this one).
    public func leaveTab() { pending?.cancel() }

    /// Gone: the pointer left the strip, or a tab was pressed, dragged or opened.
    public func hide() {
        pending?.cancel()
        previewing = false
        shown = nil
    }
}

/// The strip's hover for one tab, reporting to the frame's preview.
struct TabPreviewHover: ViewModifier {
    let id: String
    let active: Bool
    let model: FrameModel

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .global) }) { frame = $0 }
            .onHover { inside in
                if inside { model.preview.enter(id, frame: frame, active: active) } else { model.preview.leaveTab() }
            }
            .simultaneousGesture(TapGesture().onEnded { model.preview.hide() })
            .onChange(of: active) { if active { model.preview.hide() } }
    }

    @State private var frame: CGRect = .zero
}
#endif
