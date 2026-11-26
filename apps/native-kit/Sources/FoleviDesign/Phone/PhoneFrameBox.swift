// Where a button or row is on screen, kept for the menu it opens. A box, not `@State` of the rect itself: a frame in
// global space changes on every scroll frame, and writing it as state drew the view (or, for a parent's dictionary of
// rows, the whole list) again each frame. Read it in the action, when the menu opens.
import CoreGraphics

/// One view's frame.
public final class PhoneFrameBox {
    public var rect: CGRect = .zero
    public init() {}
}

/// Several views' frames, by key (a list's rows).
public final class PhoneFrameBoxes {
    private var rects: [String: CGRect] = [:]
    public init() {}

    public subscript(key: String) -> CGRect? {
        get { rects[key] }
        set { rects[key] = newValue }
    }
}
