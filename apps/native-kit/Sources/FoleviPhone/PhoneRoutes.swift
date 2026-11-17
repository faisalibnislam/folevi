// What a screen's route (ScreenRoute: a link in a note, Foli AI's answer, Home's rows) opens in the phone's frame,
// in the web's own paths (apps/web/src/lib/app/router.tsx), so a native screen and the web agree on where it goes.
import Foundation
import FoleviScreens

public extension FrameRoute {
    /// Where a screen's route goes in the phone's frame (the iPhone, and the iPad's phone layout): Reviews is
    /// `/review`; Foli DNA keeps `?note=` and `?view=`. Nil for what isn't a screen of the stack (a sheet or dialog
    /// the frame opens itself: places, notifications, Foli AI, moving, sharing, inviting).
    init?(phone route: ScreenRoute) {
        switch route {
        case .home: self = .home
        case .folder(let id): self = .folder(id)
        case .tag(let id): self = .tag(id)
        case .notes(let v): self = .notes(v)
        case .shared: self = .shared
        case .changes: self = .changes
        case .allFolders: self = .web("/folders")
        case .reviews: self = .web("/review")
        case .graph: self = .web("/graph")
        case .search(let text): self = .search(text)
        case .web(let path): self = FrameRoute(path: path)
        case .note(let id), .noteInNewTab(let id): self = .note(id)
        case .notifications, .places, .foliAI, .invite, .movePlaces, .shareFolder: return nil
        }
    }

    /// `/inbox` (folevi://inbox from widgets and Shortcuts, any link to the Inbox) opens the person's Inbox page, as
    /// on the web (RouteView.tsx OpenInbox, the engine's `inbox.open`); `/tasks/inbox` stays Tasks' Inbox view.
    static func opensInboxPage(_ path: String) -> Bool {
        let head = path.split(separator: "?").first.map(String.init) ?? path
        return head.split(separator: "/").map(String.init) == ["inbox"]
    }
}
