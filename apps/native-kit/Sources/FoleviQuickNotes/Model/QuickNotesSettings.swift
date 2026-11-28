// The quick notes panel's own settings (Notlet's AppSettings, cut down to what the panel uses), kept in the defaults
// the Mac app hands in (its build's own: Folevi Dev never shares them with the installed app).
import AppKit
import FoleviDesign
import Observation

@MainActor
@Observable
public final class QuickNotesSettings {
    enum FontChoice: String, CaseIterable, Identifiable {
        /// Instrument Sans, the face of Folevi's notes and interface.
        case folevi
        case system, rounded, serif, mono, custom
        var id: String { rawValue }
    }

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
        static let prefix = "folevi.quicknotes."
        static let panelWidth = prefix + "panelWidth", panelHeight = prefix + "panelHeight"
        static let panelPinned = prefix + "pinned", panelDetached = prefix + "detached", pinnedOrigin = prefix + "pinnedOrigin"
        static let activeDotID = prefix + "activeDot", destination = prefix + "destination"
        static let defaultRichText = prefix + "defaultRichText", smartBullets = prefix + "smartBullets"
        static let fontSize = prefix + "fontSize", showFooter = prefix + "showFooter", showDotNames = prefix + "showDotNames"
        static let screenshotSound = prefix + "screenshotSound"
    }

    var animatePopover = true
    var showFooter = true { didSet { save(showFooter, Key.showFooter) } }
    var footerAutoHide = true
    var showDotNames = false { didSet { save(showDotNames, Key.showDotNames) } }
    var fontChoice: FontChoice = .folevi
    var customFontName = ""
    var fontSize: Double = 15 { didSet { save(fontSize, Key.fontSize) } }
    var lineHeight: Double = 1.4
    var defaultRichText = true { didSet { save(defaultRichText, Key.defaultRichText) } }
    var smartBullets = true { didSet { save(smartBullets, Key.smartBullets) } }
    var bulletGlyph = "•"
    var dividerStyle: DividerStyle = .thin
    var autoDetectLinks = true
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
    var activeDotID: UUID? { didSet { guard !isLoading else { return }; defaults.set(activeDotID?.uuidString, forKey: Key.activeDotID) } }
    var pinnedOrigin: CGPoint? {
        didSet {
            guard !isLoading else { return }
            if let p = pinnedOrigin { defaults.set([Double(p.x), Double(p.y)], forKey: Key.pinnedOrigin) } else { defaults.removeObject(forKey: Key.pinnedOrigin) }
        }
    }
    /// Where "Save to note" puts a dot, remembered per place (`QuickNoteDestination`).
    var destinations: [String: QuickNoteDestination] = [:] {
        didSet {
            guard !isLoading, let data = try? JSONEncoder().encode(destinations) else { return }
            defaults.set(data, forKey: Key.destination)
        }
    }

    public init(defaults: UserDefaults) {
        self.defaults = defaults
        let d = defaults
        if d.object(forKey: Key.showFooter) != nil { showFooter = d.bool(forKey: Key.showFooter) }
        if d.object(forKey: Key.showDotNames) != nil { showDotNames = d.bool(forKey: Key.showDotNames) }
        if d.object(forKey: Key.defaultRichText) != nil { defaultRichText = d.bool(forKey: Key.defaultRichText) }
        if d.object(forKey: Key.smartBullets) != nil { smartBullets = d.bool(forKey: Key.smartBullets) }
        if d.object(forKey: Key.screenshotSound) != nil { screenshotSound = d.bool(forKey: Key.screenshotSound) }
        if d.object(forKey: Key.fontSize) != nil { fontSize = min(36, max(9, d.double(forKey: Key.fontSize))) }
        let w = d.double(forKey: Key.panelWidth), h = d.double(forKey: Key.panelHeight)
        if w > 0, h > 0 { panelSize = CGSize(width: max(Self.minimumPanelSize.width, w), height: max(Self.minimumPanelSize.height, h)) }
        isPinned = d.bool(forKey: Key.panelPinned)
        isDetached = d.bool(forKey: Key.panelDetached)
        activeDotID = d.string(forKey: Key.activeDotID).flatMap(UUID.init(uuidString:))
        if let p = d.array(forKey: Key.pinnedOrigin) as? [Double], p.count == 2 { pinnedOrigin = CGPoint(x: p[0], y: p[1]) }
        if let data = d.data(forKey: Key.destination), let saved = try? JSONDecoder().decode([String: QuickNoteDestination].self, from: data) { destinations = saved }
        isLoading = false
    }

    private func save(_ value: Any, _ key: String) {
        guard !isLoading else { return }
        defaults.set(value, forKey: key)
    }

    var editorFont: NSFont { Typography.baseFont(choice: fontChoice, customName: customFontName, size: fontSize) }

    var textStyle: TextStyle {
        TextStyle(fontChoice: fontChoice, customFontName: customFontName, fontSize: fontSize, lineHeightMultiple: lineHeight, bulletGlyph: bulletGlyph)
    }

    /// The panel follows the Mac's appearance, as Folevi's other panels do.
    var nsAppearance: NSAppearance? { nil }
}
