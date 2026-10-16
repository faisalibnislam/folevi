// Folevi's notes in Spotlight: the recent and starred ones (title, an excerpt, and where it is: the folder
// path or the place), indexed from the REST API when the app comes and goes. A note's details are fetched
// only when it changed since it was last indexed. Tapping a result opens the note (DeepLinkRouter, through
// CSSearchableItemActionType). Signing out removes them all.
import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

actor SpotlightIndex {
    static let shared = SpotlightIndex(index: CSSearchableIndex.default(), defaults: Folevi.defaults)

    static let domain = "com.folevi.notes"
    /// How many recent and starred notes are kept in Spotlight.
    static let recentCount = 30
    static let starredCount = 30

    private let index: CSSearchableIndex
    private let defaults: UserDefaults
    private let indexedKey = "spotlightIndexed"

    init(index: CSSearchableIndex, defaults: UserDefaults) {
        self.index = index
        self.defaults = defaults
    }

    /// Note id to the updatedAt it was indexed at.
    private var indexed: [String: String] {
        get { defaults.dictionary(forKey: indexedKey) as? [String: String] ?? [:] }
        set { defaults.set(newValue, forKey: indexedKey) }
    }

    /// Indexes the recent and starred notes, and drops ones that are neither any more.
    func update(api: FoleviAPI) async {
        guard let recent = try? await api.recentNotes(limit: Self.recentCount) else { return }
        let starred = (try? await api.starredNotes(limit: Self.starredCount)) ?? []
        var wanted: [String: (note: NoteSummary, starred: Bool)] = [:]
        for note in recent { wanted[note.id] = (note, false) }
        for note in starred { wanted[note.id] = (note, true) }

        var known = indexed
        var items: [CSSearchableItem] = []
        for (id, entry) in wanted where known[id] != entry.note.updatedAt + (entry.starred ? "*" : "") {
            // A note that can't be read now is left as it was (indexed again next time).
            guard let detail = try? await api.note(id) else { continue }
            items.append(Self.item(detail, starred: entry.starred))
            known[id] = entry.note.updatedAt + (entry.starred ? "*" : "")
        }
        let gone = known.keys.filter { wanted[$0] == nil }
        do {
            if !items.isEmpty { try await index.indexSearchableItems(items) }
            if !gone.isEmpty { try await index.deleteSearchableItems(withIdentifiers: Array(gone)) }
            for id in gone { known[id] = nil }
            indexed = known
        } catch {
            // Spotlight isn't available right now: tried again next time.
        }
    }

    func removeAll() async {
        try? await index.deleteAllSearchableItems()
        indexed = [:]
    }

    /// What Spotlight shows for a note: its title, the start of its text, and where it is.
    static func item(_ note: NoteDetail, starred: Bool) -> CSSearchableItem {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.text)
        attributes.title = note.title
        attributes.displayName = note.title
        attributes.contentDescription = excerpt(note.markdown)
        let location = note.folder?.path ?? note.place.name
        attributes.containerTitle = location
        attributes.containerDisplayName = location
        attributes.keywords = [note.place.name, note.folder?.name].compactMap { $0 } + (starred ? ["starred"] : [])
        attributes.contentModificationDate = DayFormat.instant(note.updatedAt)
        let item = CSSearchableItem(uniqueIdentifier: note.id, domainIdentifier: domain, attributeSet: attributes)
        item.expirationDate = .distantFuture
        return item
    }

    /// The note's first lines as plain text (Markdown marks taken out), about 300 characters.
    static func excerpt(_ markdown: String) -> String {
        var lines: [String] = []
        for raw in markdown.split(separator: "\n") {
            var line = raw.trimmingCharacters(in: .whitespaces)
            line = line.replacingOccurrences(of: #"^(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>\s*)"#, with: "", options: .regularExpression)
            line = line.replacingOccurrences(of: #"!\[[^\]]*\]\([^)]*\)"#, with: "", options: .regularExpression)
            line = line.replacingOccurrences(of: #"\[([^\]]*)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
            line = line.replacingOccurrences(of: #"[*_`~]{1,3}"#, with: "", options: .regularExpression)
            line = line.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("|") || line.hasPrefix("```") || line == "---" { continue }
            lines.append(line)
            if lines.joined(separator: " ").count > 300 { break }
        }
        let text = lines.joined(separator: " ")
        return text.count > 300 ? String(text.prefix(299)).trimmingCharacters(in: .whitespaces) + "…" : text
    }
}
