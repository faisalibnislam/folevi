// The menu bar note panel's own settings (from Notlet's AppSettings): its size, pin, window mode, the note it shows
// and where new notes go, per place. Kept in the defaults the Mac app hands in (Folevi Dev has its own).
import AppKit
import Observation

@MainActor
@Observable
public final class MenuBarNoteSettings {
    public enum PanelSize: String, CaseIterable, Identifiable, Sendable {
        case small, medium, large, gigantic
        public var id: String { rawValue }
        public var size: CGSize {
            switch self {
            case .small: CGSize(width: 340, height: 380)
            case .medium: CGSize(width: 400, height: 500)
            case .large: CGSize(width: 500, height: 640)
            case .gigantic: CGSize(width: 660, height: 840)
            }
        }
        var title: String {
            switch self {
            case .small: "Small"
            case .medium: "Medium"
            case .large: "Large"
            case .gigantic: "Extra large"
            }
        }
    }

    enum ScreenshotFormat: String, CaseIterable, Identifiable { case automatic, png, jpeg; var id: String { rawValue } }

    static let minimumPanelSize = CGSize(width: 320, height: 260)

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var isLoading = true

    enum Key {
        static let prefix = "folevi.menubarnote."
        static let panelWidth = prefix + "panelWidth", panelHeight = prefix + "panelHeight"
        static let panelPinned = prefix + "pinned", panelDetached = prefix + "detached", pinnedOrigin = prefix + "pinnedOrigin"
        static let notes = prefix + "notes", destination = prefix + "destination"
        static let screenshotSound = prefix + "screenshotSound"
    }

    var animatePopover = true
    var screenshotFormat: ScreenshotFormat = .automatic
    var screenshotDownscale = true
    var screenshotSound = true { didSet { save(screenshotSound, Key.screenshotSound) } }
    var panelSize = PanelSize.medium.size {
        didSet {
            guard !isLoading else { return }
            defaults.set(Double(panelSize.width), forKey: Key.panelWidth)
            defaults.set(Double(panelSize.height), forKey: Key.panelHeight)
        }
    }
    public var isPinned = false { didSet { save(isPinned, Key.panelPinned) } }
    public var isDetached = false { didSet { save(isDetached, Key.panelDetached) } }
    /// The note the panel shows, per place (nil: the empty page that starts a new one).
    var notes: [String: String] = [:] { didSet { guard !isLoading else { return }; defaults.set(notes, forKey: Key.notes) } }
    var pinnedOrigin: CGPoint? {
        didSet {
            guard !isLoading else { return }
            if let p = pinnedOrigin { defaults.set([Double(p.x), Double(p.y)], forKey: Key.pinnedOrigin) } else { defaults.removeObject(forKey: Key.pinnedOrigin) }
        }
    }
    /// Where "Save to note" puts a dot, remembered per place (`NoteDestination`).
    var destinations: [String: NoteDestination] = [:] {
        didSet {
            guard !isLoading, let data = try? JSONEncoder().encode(destinations) else { return }
            defaults.set(data, forKey: Key.destination)
        }
    }

    public init(defaults: UserDefaults) {
        self.defaults = defaults
        let d = defaults
        if d.object(forKey: Key.screenshotSound) != nil { screenshotSound = d.bool(forKey: Key.screenshotSound) }
        let w = d.double(forKey: Key.panelWidth), h = d.double(forKey: Key.panelHeight)
        if w > 0, h > 0 { panelSize = CGSize(width: max(Self.minimumPanelSize.width, w), height: max(Self.minimumPanelSize.height, h)) }
        isPinned = d.bool(forKey: Key.panelPinned)
        isDetached = d.bool(forKey: Key.panelDetached)
        notes = (d.dictionary(forKey: Key.notes) as? [String: String]) ?? [:]
        if let p = d.array(forKey: Key.pinnedOrigin) as? [Double], p.count == 2 { pinnedOrigin = CGPoint(x: p[0], y: p[1]) }
        if let data = d.data(forKey: Key.destination), let saved = try? JSONDecoder().decode([String: NoteDestination].self, from: data) { destinations = saved }
        isLoading = false
    }

    private func save(_ value: Any, _ key: String) {
        guard !isLoading else { return }
        defaults.set(value, forKey: key)
    }

    /// The panel follows the Mac's appearance, as Folevi's other panels do.
    var nsAppearance: NSAppearance? { nil }
}
