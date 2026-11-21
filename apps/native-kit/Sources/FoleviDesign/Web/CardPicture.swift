import Observation
import SwiftUI

/// Cards drawn once into a picture and shown as that picture until they change (the performance pass of
/// 21 November 2026). SwiftUI draws a screen's cards again on every frame it moves, blurs and all: a frosted folder
/// card has a dozen (its shadow, its notes' shadows, twice, and the frost), and a long Folders grid missed nearly
/// every frame while it scrolled (Mac, 120 Hz: 323 to 356 of about 360 frames in a 3 s scroll). A picture costs
/// what a plain image costs (24 to 29 missed, as a grey rectangle in its place).
///
/// Kept by what the card shows, its size, the display's scale and the colour scheme; at most `limit` bytes, the
/// least recently drawn going first, and let go on a memory warning (`relieve`). Anything observable the drawing
/// read (a style image that came later, WebKit's line breaks) forgets the picture when it changes, and the view draws
/// it again.
@MainActor
public final class CardPictures {
    public static let shared = CardPictures()

    /// `FOLEVI_CARD_PICTURES=0`: every card is drawn live, as before (to measure one against the other).
    public static var enabled = ProcessInfo.processInfo.environment["FOLEVI_CARD_PICTURES"] != "0"

    #if os(macOS)
    static let limit = 96 << 20
    #else
    static let limit = 48 << 20
    #endif

    /// A view's picture, and where between two device pixels it's drawn.
    final class Picture {
        let image: CGImage
        let phase: CGSize
        init(_ image: CGImage, phase: CGSize) {
            self.image = image
            self.phase = phase
        }
    }

    /// One picture per view (its key, size, scale and scheme): drawn again at a new place, it replaces the old.
    private let pictures = NSCache<NSString, Picture>()
    /// How many pictures have been drawn (tests).
    public private(set) var drawn = 0

    init() {
        pictures.totalCostLimit = Self.limit
    }

    /// The picture kept for `key`, wherever it was drawn.
    func kept(_ key: String) -> Picture? {
        pictures.object(forKey: key as NSString)
    }

    /// Bumped when a picture is forgotten because something it showed changed: views read it, so they draw again.
    @Observable final class Changes {
        var count = 0
    }
    let changes = Changes()

    /// The picture for `key` drawn at `phase`: the kept one if it's drawn there, else `draw`'s, kept instead.
    func picture(_ key: String, at phase: CGSize, draw: () -> CGImage?) -> Picture? {
        if let kept = kept(key), kept.phase == phase { return kept }
        let image = withObservationTracking(draw) {
            Task { @MainActor in CardPictures.shared.forget(key) }
        }
        guard let image else { return nil }
        drawn += 1
        let picture = Picture(image, phase: phase)
        pictures.setObject(picture, forKey: key as NSString, cost: image.bytesPerRow * image.height)
        return picture
    }

    /// Views waiting to be drawn again where they came to rest, one a frame, so a scroll that stops doesn't draw every
    /// card on screen in one frame.
    private var redraws: [() -> Void] = []
    private var redrawing = false

    func redraw(_ work: @escaping () -> Void) {
        redraws.append(work)
        guard !redrawing else { return }
        redrawing = true
        Task { @MainActor in
            while !redraws.isEmpty {
                redraws.removeFirst()()
                try? await Task.sleep(for: .milliseconds(16))
            }
            redrawing = false
        }
    }

    /// Something the picture for `key` showed has changed: it goes, and the views showing it draw it again.
    func forget(_ key: String) {
        pictures.removeObject(forKey: key as NSString)
        changes.count += 1
    }

    /// Memory is short: every picture goes (what shows draws its own again).
    public func relieve() {
        pictures.removeAllObjects()
    }
}

/// A view drawn once, at its size, into a picture (`CardPictures`), and shown as that picture: the same pixels, none
/// of the drawing on each frame. `key` names everything the content shows other than its size, the display's
/// scale and the colour scheme (those are added here); `margin` is the room round the size the content draws in (a
/// shadow), cut off past it.
struct CardPicture<Content: View>: View {
    let key: String
    let margin: EdgeInsets
    let content: (CGSize) -> Content

    init(key: String, margin: EdgeInsets = EdgeInsets(), @ViewBuilder content: @escaping (CGSize) -> Content) {
        self.key = key
        self.margin = margin
        self.content = content
    }

    /// The whole environment goes into the picture's drawing, so it draws as it would here.
    @Environment(\.self) private var environment
    @Environment(\.displayScale) private var scale
    @Environment(\.colorScheme) private var scheme
    /// Where its picture is drawn between two device pixels (x and y, in pixels, to a sixteenth): where the view
    /// sits, so the picture lands on whole pixels and is never filtered (a card at a fractional place in a grid came
    /// out a shade soft, its light words a shade heavier on dark). A view that comes and goes (a lazy grid's) shows
    /// the picture it had at once, wherever that was drawn; one that moves takes its picture with it, and is drawn
    /// again where it comes to rest (after 200 ms still, one view a frame: CardPictures.redraw).
    @State private var drawnAt: CGSize?
    /// Where the view sits now, how often it has moved and whether a wait for it to rest is on: kept out of
    /// SwiftUI's state, since they change on every frame of a scroll and nothing drawn reads them (as state they
    /// cost a long grid twice the missed frames).
    @MainActor final class Motion {
        var phase = CGSize.zero
        var moves = 0
        var waiting = false
        var placing = false
    }
    @State private var motion = Motion()

    private func pictureKey(_ size: CGSize) -> String { "\(key)|\(size.width)x\(size.height)|\(scale)|\(scheme)" }

    var body: some View {
        // (Read so the view draws again when a picture is forgotten.)
        let _ = CardPictures.shared.changes.count
        GeometryReader { geo in
            let size = geo.size
            let name = pictureKey(size)
            if size.width > 0, size.height > 0, let at = drawnAt ?? CardPictures.shared.kept(name)?.phase,
               let picture = CardPictures.shared.picture(name, at: at, draw: { draw(size, shift: CGSize(width: at.width / scale, height: at.height / scale)) }) {
                Image(decorative: picture.image, scale: scale)
                    .offset(x: -margin.leading - picture.phase.width / scale, y: -margin.top - picture.phase.height / scale)
            } else {
                content(size).frame(width: size.width, height: size.height)
            }
        }
        .onGeometryChange(for: CGRect.self) { proxy in
            let origin = proxy.frame(in: .global).origin
            func part(_ v: CGFloat) -> CGFloat {
                let p = v * scale
                return ((p - p.rounded(.down)) * 16).rounded() / 16
            }
            return CGRect(origin: CGPoint(x: part(origin.x), y: part(origin.y)), size: proxy.size)
        } action: { place in
            let now = CGSize(width: place.minX, height: place.minY)
            let motion = motion
            motion.phase = now
            motion.moves += 1
            if drawnAt == nil {
                // Placed the next moment, once laid out: the first report can come before layout, at a made-up
                // place, and a single pass (an ImageRenderer picture of a screen, a snapshot) ends first and draws
                // the view live, as it always did.
                guard !motion.placing else { return }
                motion.placing = true
                let size = place.size
                Task { @MainActor in
                    motion.placing = false
                    drawnAt = CardPictures.shared.kept(pictureKey(size))?.phase ?? motion.phase
                }
                return
            }
            guard now != drawnAt, !motion.waiting else { return }
            // One wait at a time, however many frames it moves: a moment with no move, then its turn to be drawn.
            motion.waiting = true
            Task { @MainActor in
                var seen = -1
                while seen != motion.moves {
                    seen = motion.moves
                    try? await Task.sleep(for: .milliseconds(200))
                }
                CardPictures.shared.redraw {
                    motion.waiting = false
                    // (Moved again while it waited for its turn: the next rest draws it.)
                    if motion.moves == seen, drawnAt != motion.phase { drawnAt = motion.phase }
                }
            }
        }
    }

    private func draw(_ size: CGSize, shift: CGSize) -> CGImage? {
        let renderer = ImageRenderer(content: content(size)
            .frame(width: size.width, height: size.height)
            .padding(EdgeInsets(top: margin.top + shift.height, leading: margin.leading + shift.width, bottom: margin.bottom, trailing: margin.trailing))
            .environment(\.self, environment))
        renderer.scale = scale
        return renderer.cgImage
    }
}
