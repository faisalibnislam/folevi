// Folevi's notes in Spotlight on the Mac: every note of each place, archived ones too, found by any word of their
// text (the owner, 5 November 2026), with their title, the start of their text and where they are. Locked and
// end-to-end encrypted notes never go in. The page of each place hands them over (foleviDesktop.indexSpotlight, in
// both modes: the Mac has no REST token of its own to fetch them with): it asks what Spotlight holds
// (spotlightState: each note's stamp), sends only the notes whose stamp changed, at most 50 at a time, and then the
// ids of every note of the place (`keep`), so notes gone from it come out. Choosing a result opens the note in the
// place it's from. Each place keeps its own domain, so forgetting a place removes just its notes; a FOLEVI_USER_DATA
// run keeps its own, apart from the Debug app's. Settings' "Show notes in Spotlight" off takes them all out.
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
        /// Its whole text, what Spotlight finds it by (empty in the light copies kept for Shortcuts).
        let text: String
        let location: String
        let starred: Bool
        let archived: Bool
        /// Milliseconds since 1970.
        let updatedAt: Double
        /// What the page made it from: one whose stamp changed is sent again.
        let stamp: String

        init(id: String, title: String, excerpt: String, text: String = "", location: String, starred: Bool, archived: Bool = false, updatedAt: Double, stamp: String = "") {
            self.id = id
            self.title = title
            self.excerpt = excerpt
            self.text = text
            self.location = location
            self.starred = starred
            self.archived = archived
            self.updatedAt = updatedAt
            self.stamp = stamp
        }

        /// From the page: { id, title, excerpt, text, location, starred, archived, updatedAt, stamp }, checked.
        init?(_ d: [String: Any]) {
            guard let id = d["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil else { return nil }
            self.id = id
            title = String((d["title"] as? String ?? "").prefix(300))
            excerpt = String((d["excerpt"] as? String ?? "").prefix(300))
            text = String((d["text"] as? String ?? "").prefix(50_000))
            location = String((d["location"] as? String ?? "").prefix(200))
            starred = d["starred"] as? Bool ?? false
            archived = d["archived"] as? Bool ?? false
            updatedAt = (d["updatedAt"] as? NSNumber)?.doubleValue ?? 0
            stamp = String((d["stamp"] as? String ?? "").prefix(600))
        }

        /// What's kept of it between launches (Shortcuts' Open Note picks from these).
        var record: [String: Any] { ["s": stamp, "t": title, "l": location, "b": starred, "u": updatedAt] }

        init?(id: String, record: Any) {
            guard let r = record as? [String: Any] else { return nil }
            self.init(id: id, title: r["t"] as? String ?? "", excerpt: "", location: r["l"] as? String ?? "", starred: r["b"] as? Bool ?? false, updatedAt: (r["u"] as? NSNumber)?.doubleValue ?? 0, stamp: r["s"] as? String ?? "")
        }
    }

    static let domain = "com.folevi.notes"

    /// What opens a note from another place (WM1's places switch to it); by default the front window goes there.
    var openInPlace: ((_ place: String, _ path: String) -> Void)?

    private let index = CSSearchableIndex.default()

    /// The notes Spotlight holds for each place, newest first (Shortcuts' Open Note picks from them).
    var notes: [String: [Note]] {
        Dictionary(uniqueKeysWithValues: indexedPlaces.map { place in
            (place, records(place).compactMap { Note(id: $0.key, record: $0.value) }.sorted { $0.updatedAt > $1.updatedAt })
        })
    }

    /// Settings' "Show notes in Spotlight".
    var enabled: Bool { DesktopSettings.current.spotlight }

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

    /// What Spotlight holds for a place: each note's record (a note from before stamps reads as stale).
    private func records(_ place: String) -> [String: Any] {
        Paths.defaults.dictionary(forKey: indexedKey(place)) ?? [:]
    }

    /// For the page (spotlightState): whether the setting is on, and the stamp of each note held for the place.
    func state(place: String) -> [String: Any] {
        guard enabled else { return ["enabled": false, "known": [String: String]()] }
        var known: [String: String] = [:]
        for (id, r) in records(place) { known[id] = (r as? [String: Any])?["s"] as? String ?? "" }
        return ["enabled": true, "known": known]
    }

    /// These notes of the place go into Spotlight; with `keep` (every note of the place), the others it holds come out.
    func update(place: String, with list: [Note], keep: Set<String>?) async {
        guard enabled else { return }
        var held = records(place)
        let items = list.map { Self.item($0, place: place) }
        let gone = keep.map { keep in held.keys.filter { !keep.contains($0) } } ?? []
        do {
            if !items.isEmpty { try await index.indexSearchableItems(items) }
            if !gone.isEmpty { try await index.deleteSearchableItems(withIdentifiers: gone.map { Self.identifier(place: place, id: $0) }) }
            for note in list { held[note.id] = note.record }
            for id in gone { held[id] = nil }
            Paths.defaults.set(held, forKey: indexedKey(place))
        } catch {
            // Spotlight isn't there right now: the page hands them over again on its next look.
        }
    }

    /// A place signed out or forgotten (WM1): its notes leave Spotlight.
    func forget(place: String) async {
        try? await index.deleteSearchableItems(withDomainIdentifiers: [Self.domain(place)])
        Paths.defaults.removeObject(forKey: indexedKey(place))
    }

    /// "Show notes in Spotlight" turned off: every place's notes leave Spotlight.
    func forgetAll() async {
        for place in indexedPlaces { await forget(place: place) }
    }

    static func item(_ note: Note, place: String) -> CSSearchableItem {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.text)
        let title = note.title.isEmpty ? "Untitled" : note.title
        attributes.title = title
        attributes.displayName = title
        attributes.contentDescription = note.excerpt
        attributes.textContent = note.text
        attributes.containerTitle = note.location
        attributes.containerDisplayName = note.location
        attributes.keywords = [note.location] + (note.starred ? ["bookmarked"] : []) + (note.archived ? ["archived"] : [])
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
        notes.mapValues { $0.map { ["id": $0.id, "title": $0.title, "location": $0.location, "starred": $0.starred, "stamp": $0.stamp] } }
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
