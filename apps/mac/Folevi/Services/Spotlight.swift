// Folevi's notes in Spotlight on the Mac (as the iPhone and iPad app's SpotlightIndex.swift does): the recent and
// starred ones of each place, with their title, the start of their text and where they are. The page of each place
// hands them over whenever they change (foleviDesktop.indexSpotlight, in both modes: the Mac has no REST token of
// its own to fetch them with), and only notes that changed since are written again. Choosing a result opens the
// note in the place it's from. Each place keeps its own domain, so forgetting a place removes just its notes; a
// FOLEVI_USER_DATA run keeps its own, apart from the Debug app's.
import AppKit
import CoreSpotlight
import UniformTypeIdentifiers

@MainActor
final class Spotlight {
    static let shared = Spotlight()

    struct Note: Equatable {
        let id: String
        let title: String
        let excerpt: String
        let location: String
        let starred: Bool
        /// Milliseconds since 1970.
        let updatedAt: Double

        init(id: String, title: String, excerpt: String, location: String, starred: Bool, updatedAt: Double) {
            self.id = id
            self.title = title
            self.excerpt = excerpt
            self.location = location
            self.starred = starred
            self.updatedAt = updatedAt
        }

        /// From the page: { id, title, excerpt, location, starred, updatedAt }, checked.
        init?(_ d: [String: Any]) {
            guard let id = d["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil else { return nil }
            self.id = id
            title = String((d["title"] as? String ?? "").prefix(300))
            excerpt = String((d["excerpt"] as? String ?? "").prefix(300))
            location = String((d["location"] as? String ?? "").prefix(200))
            starred = d["starred"] as? Bool ?? false
            updatedAt = (d["updatedAt"] as? NSNumber)?.doubleValue ?? 0
        }

        /// What decides whether Spotlight's copy is out of date.
        var version: String { "\(Int64(updatedAt))\(starred ? "*" : "")|\(title)|\(location)|\(excerpt.count)" }
    }

    static let domain = "com.folevi.notes"

    /// What opens a note from another place (WM1's places switch to it); by default the front window goes there.
    var openInPlace: ((_ place: String, _ path: String) -> Void)?

    private let index = CSSearchableIndex.default()
    /// The notes each place last handed over (Shortcuts' Open Note picks from them too).
    private(set) var notes: [String: [Note]] = [:]

    func install() {
        // A note from another place opens in that place (WM1 switches every window to it).
        openInPlace = { place, path in
            if ShellPlaces.has(place) { Places.shared.switchTo(place, path: path) } else { WindowManager.shared.showMain(path: path) }
        }
        // A place signed out of or forgotten takes its notes out of Spotlight (looked at on every switch and launch).
        NotificationCenter.default.addObserver(forName: Places.switched, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { Task { await Spotlight.shared.prune() } }
        }
        AppDelegate.beforeFirstWindow.append {
            await Spotlight.shared.prune()
            return true
        }
    }

    /// The places Spotlight holds notes for (from what was indexed).
    private var indexedPlaces: [String] {
        Paths.defaults.dictionaryRepresentation().keys.filter { $0.hasPrefix("spotlight.indexed.") }.map { String($0.dropFirst("spotlight.indexed.".count)) }
    }

    /// Forgets the notes of places this Mac no longer has.
    func prune() async {
        for place in indexedPlaces where place != "default" && !ShellPlaces.has(place) { await forget(place: place) }
    }

    /// The domain of one place's notes.
    nonisolated static func domain(_ place: String) -> String {
        "\(domain).\(Paths.runTag.map { "\($0)." } ?? "")\(place)"
    }

    /// A result's identifier: the place and the note.
    nonisolated static func identifier(place: String, id: String) -> String { "\(place)\u{1F}\(id)" }

    nonisolated static func parse(_ identifier: String) -> (place: String, id: String)? {
        let parts = identifier.split(separator: "\u{1F}", maxSplits: 1).map(String.init)
        guard parts.count == 2, !parts[1].isEmpty else { return nil }
        return (parts[0], parts[1])
    }

    private func indexedKey(_ place: String) -> String { "spotlight.indexed.\(place)" }

    /// Spotlight holds exactly these notes of the place afterwards (only the changed ones are written).
    func replace(place: String, with list: [Note]) async {
        notes[place] = list
        var known = Paths.defaults.dictionary(forKey: indexedKey(place)) as? [String: String] ?? [:]
        let wanted = Dictionary(list.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var items: [CSSearchableItem] = []
        for note in wanted.values where known[note.id] != note.version {
            items.append(Self.item(note, place: place))
            known[note.id] = note.version
        }
        let gone = known.keys.filter { wanted[$0] == nil }
        do {
            if !items.isEmpty { try await index.indexSearchableItems(items) }
            if !gone.isEmpty { try await index.deleteSearchableItems(withIdentifiers: gone.map { Self.identifier(place: place, id: $0) }) }
            for id in gone { known[id] = nil }
            Paths.defaults.set(known, forKey: indexedKey(place))
        } catch {
            // Spotlight isn't there right now: the page hands them over again after its next change.
        }
    }

    /// A place signed out or forgotten (WM1): its notes leave Spotlight.
    func forget(place: String) async {
        notes[place] = nil
        try? await index.deleteSearchableItems(withDomainIdentifiers: [Self.domain(place)])
        Paths.defaults.removeObject(forKey: indexedKey(place))
    }

    static func item(_ note: Note, place: String) -> CSSearchableItem {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.text)
        let title = note.title.isEmpty ? "Untitled" : note.title
        attributes.title = title
        attributes.displayName = title
        attributes.contentDescription = note.excerpt
        attributes.containerTitle = note.location
        attributes.containerDisplayName = note.location
        attributes.keywords = [note.location] + (note.starred ? ["starred"] : [])
        if note.updatedAt > 0 { attributes.contentModificationDate = Date(timeIntervalSince1970: note.updatedAt / 1000) }
        let item = CSSearchableItem(uniqueIdentifier: identifier(place: place, id: note.id), domainIdentifier: domain(place), attributeSet: attributes)
        item.expirationDate = .distantFuture
        return item
    }

    /// Opens the note a Spotlight result stands for. False when the identifier isn't one of ours.
    @discardableResult
    func open(identifier: String) -> Bool {
        guard let (place, id) = Self.parse(identifier), id.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil else { return false }
        let path = "/d/\(id)"
        let current = WindowManager.shared.currentPlace() ?? "default"
        if place != current, let openInPlace {
            openInPlace(place, path)
        } else {
            WindowManager.shared.showMain(path: path)
        }
        return true
    }

    #if DEBUG
    func indexedForTests() -> [String: Any] {
        notes.mapValues { $0.map { ["id": $0.id, "title": $0.title, "location": $0.location, "starred": $0.starred] } }
    }
    #endif
}

// A Spotlight result chosen (or a Handoff of a note): the system hands it over as a user activity.
extension AppDelegate {
    func application(_ application: NSApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([any NSUserActivityRestoring]) -> Void) -> Bool {
        guard userActivity.activityType == CSSearchableItemActionType, let id = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String else { return false }
        return Spotlight.shared.open(identifier: id)
    }
}
