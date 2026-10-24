// What the screens ask the frame to do. Screens never own a navigation stack (plan 4.1, 4.4, 4.5): they emit
// routes and intents, and the iPhone, iPad and Mac frames (FoleviPhone, FoleviMac) push, present or open tabs.
// A note opens with its source card's frame so the frame can run the zoom (plan 4.2); the frame can also ask
// `CardFrames` where that card is *now* when the note zooms back.
import SwiftUI
import FoleviEngine

/// A screen or place in the app. `init?(webRoute:)` reads the web's paths (`HomeRow.route`, `navigate.request`).
public enum ScreenRoute: Hashable, Sendable {
    case home
    /// All notes, Drafts (`unsorted`), Starred, Archive, Trash, Templates.
    case notes(NotesListView)
    case folder(id: String)
    case tag(id: String)
    case allFolders
    case shared
    case changes
    case reviews
    case graph
    case search(prompt: String)
    case notifications
    /// The account and place switcher (Home's avatar).
    case places
    case note(id: String)
    /// Foli AI's chat, about a folder or a note when given.
    case foliAI(about: FoliContext?)
    /// Invite people to a team workspace (sharing, N14).
    case invite(space: SpaceRef)
    /// Move folders and notes to another place (another account or the library).
    case movePlaces(folders: [String], notes: [String])
    /// Opens a note in a new tab (iPad and Mac).
    case noteInNewTab(id: String)
    /// A web route native doesn't know (opens in the Page View with native bars).
    case web(String)

    public init(webRoute route: String) {
        let path = route.split(separator: "?").first.map(String.init) ?? route
        let parts = path.split(separator: "/").map(String.init)
        switch parts.first {
        case nil, "home": self = .home
        case "notes": self = .notes(.all)
        case "drafts", "unsorted": self = .notes(.unsorted)
        case "starred": self = .notes(.starred)
        case "archive": self = .notes(.archive)
        case "trash": self = .notes(.trash)
        case "templates": self = .notes(.templates)
        case "shared": self = .shared
        case "changes": self = .changes
        case "review", "reviews": self = .reviews
        case "graph": self = .graph
        case "folders": self = parts.count > 1 ? .folder(id: parts[1]) : .allFolders
        case "tags" where parts.count > 1: self = .tag(id: parts[1])
        case "d" where parts.count > 1: self = .note(id: parts[1])
        default: self = .web(route)
        }
    }
}

public enum FoliContext: Hashable, Sendable {
    case folder(id: String, name: String)
    case note(id: String, title: String)
}

/// The card or row a note opens from: its id and where it is on screen (global coordinates, points).
public struct CardSource: Hashable, Sendable {
    public enum Kind: Hashable, Sendable { case noteCard, noteRow, folderCard }
    public var id: String
    public var kind: Kind
    public var frame: CGRect
    public init(id: String, kind: Kind, frame: CGRect) {
        self.id = id
        self.kind = kind
        self.frame = frame
    }
}

/// Where the cards and rows on screen are, by id (not observed, so recording a frame never redraws anything).
/// The zoom asks it for the source frame when a note closes, which may have scrolled since it opened.
@MainActor
public final class CardFrames {
    public static let shared = CardFrames()
    private var frames: [String: CardSource] = [:]
    public init() {}
    public func record(_ source: CardSource) { frames[source.id] = source }
    public func forget(_ id: String) { frames[id] = nil }
    public func source(for id: String) -> CardSource? { frames[id] }
}

/// How screens talk to the frame. Every closure has a harmless default so previews and tests need no frame.
public struct ScreenNavigator: Sendable {
    /// Push or present a route; a note carries its source for the zoom.
    public var open: @MainActor @Sendable (ScreenRoute, CardSource?) -> Void
    /// Touch-down on a note card or row: the frame sends `note.prepare` so the note is drawn by touch-up.
    public var prepareNote: @MainActor @Sendable (String) -> Void

    public init(open: @escaping @MainActor @Sendable (ScreenRoute, CardSource?) -> Void = { _, _ in }, prepareNote: @escaping @MainActor @Sendable (String) -> Void = { _ in }) {
        self.open = open
        self.prepareNote = prepareNote
    }
}

/// A short message the frame shows as a toast (with Undo when there's something to undo).
public struct ScreenToast: Sendable {
    public enum Tone: Sendable { case info, success, error }
    public var message: String
    public var tone: Tone
    public var actionTitle: String?
    public var action: (@MainActor @Sendable () -> Void)?
    public init(_ message: String, tone: Tone = .info, actionTitle: String? = nil, action: (@MainActor @Sendable () -> Void)? = nil) {
        self.message = message
        self.tone = tone
        self.actionTitle = actionTitle
        self.action = action
    }
}

public enum ScreenHaptic: Sendable { case selection, success, warning, error, impactLight }

/// Toasts and haptics, drawn and played by the frame.
public struct ScreenFeedback: Sendable {
    public var toast: @MainActor @Sendable (ScreenToast) -> Void
    public var haptic: @MainActor @Sendable (ScreenHaptic) -> Void
    /// Copies text (a folder's link) to the pasteboard; the default uses the system pasteboard.
    public var copy: @MainActor @Sendable (String) -> Void

    public init(toast: @escaping @MainActor @Sendable (ScreenToast) -> Void = { _ in }, haptic: @escaping @MainActor @Sendable (ScreenHaptic) -> Void = { _ in }, copy: @escaping @MainActor @Sendable (String) -> Void = ScreenFeedback.systemCopy) {
        self.toast = toast
        self.haptic = haptic
        self.copy = copy
    }

    public static let systemCopy: @MainActor @Sendable (String) -> Void = { text in
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        #elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

public extension EnvironmentValues {
    @Entry var screenNavigator = ScreenNavigator()
    @Entry var screenFeedback = ScreenFeedback()
}

/// The public web origin, for copied links (a folder's "Copy link").
public enum FoleviLinks {
    public static let origin = "https://app.folevi.com"
    public static func folder(_ id: String) -> String { "\(origin)/folders/\(id)" }
    public static func note(_ id: String) -> String { "\(origin)/d/\(id)" }
}
