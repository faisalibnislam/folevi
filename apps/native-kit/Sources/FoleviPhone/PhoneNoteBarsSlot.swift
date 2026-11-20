// A note's bottom bars drawn by the frame, not by the note's page (the owner, 2026-11-20: Folevi's own note bars,
// but they slid in and out with the page while the tab bar snapped away and back). The note screen says what its
// bars show and what a tap does; the frame draws them where the tab bar is, so the tab bar and the note's bars
// trade places there, in one glass fade, while the page slides or zooms on its own.
#if os(iOS)
import SwiftUI
import FoleviDesign

@MainActor @Observable
public final class PhoneNoteBarsSlot {
    public static let shared = PhoneNoteBarsSlot()

    /// What a note's bars show.
    public struct Bars: Equatable {
        public var noteId: String
        public var open: PhoneNoteTool?
        public var canEdit: Bool
        public var aiOn: Bool
        public var page: PhoneNotePage?
        /// False while something takes their place (the keyboard's bar, a panel, Focus Mode).
        public var shown: Bool

        public init(noteId: String, open: PhoneNoteTool?, canEdit: Bool, aiOn: Bool, page: PhoneNotePage?, shown: Bool) {
            self.noteId = noteId
            self.open = open
            self.canEdit = canEdit
            self.aiOn = aiOn
            self.page = page
            self.shown = shown
        }
    }

    public private(set) var bars: Bars?
    /// What a tap on a tool does (the note on show's).
    @ObservationIgnored public private(set) var pick: (PhoneNoteTool) -> Void = { _ in }

    public func set(_ bars: Bars, pick: @escaping (PhoneNoteTool) -> Void) {
        self.pick = pick
        if self.bars != bars { self.bars = bars }
    }

    /// The note has gone (a note pushed over it says its own).
    public func clear(_ noteId: String) {
        if bars?.noteId == noteId { bars = nil }
    }
}

public extension EnvironmentValues {
    /// The frame draws this note's bottom bars (a note on a tab's stack). False for the note beside its list on
    /// iPhone Duo, whose bars stay in its column.
    @Entry var phoneNoteBarsInFrame = false
}

/// The frame's layer for the note's bars: over the tab bar's place, while the note on show is the tab's top.
struct PhoneNoteBarsLayer: View {
    let model: PhoneFrameModel
    let slot = PhoneNoteBarsSlot.shared

    var body: some View {
        let bars = slot.bars
        let shown = bars.map { $0.shown && model.top == .note($0.noteId) && !model.searching } ?? false
        GeometryReader { geo in
            VStack {
                Spacer(minLength: 0)
                if shown, let bars {
                    PhoneNoteToolBars(open: bars.open, canEdit: bars.canEdit, aiOn: bars.aiOn) { slot.pick($0) }
                        .notePageAppearance(bars.page)
                        .padding(.leading, geo.safeAreaInsets.leading)
                        .padding(.trailing, geo.safeAreaInsets.trailing)
                        .padding(.bottom, max(10, geo.safeAreaInsets.bottom - 10))
                        // (Liquid Glass coming and going where the tab bar was: a fade with a touch of scale.)
                        .transition(WebMotion.reduced ? .opacity : .opacity.combined(with: .scale(scale: 0.94, anchor: .bottom)))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .ignoresSafeArea(.container, edges: .bottom)
        }
        .animation(WebMotion.reduced ? nil : .smooth(duration: 0.32), value: shown)
        .animation(WebMotion.reduced ? nil : .smooth(duration: 0.2), value: bars?.open)
    }
}
#endif
