// Folevi's notes in Spotlight: the recent and starred ones (title, an excerpt, and where it is: the folder
// path or the place), indexed from the REST API when the app comes and goes (in local mode, handed over by
// the page instead: replace(with:)). A note's details are fetched
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

    /// A note as the page lists it in local mode (no REST API there): its text is the library's excerpt.
    struct LocalNote: Equatable {
        let id: String
        let title: String
        let excerpt: String
        /// Its folder, or where the library is.
        let location: String
        let starred: Bool
        /// Milliseconds since 1970.
        let updatedAt: Double
    }

    /// Local mode: Spotlight holds exactly these notes (the page's recent and starred ones); only the ones
    /// that changed since they were last indexed are written again.
    func replace(with notes: [LocalNote]) async {
        var known = indexed
        let wanted = Dictionary(notes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var items: [CSSearchableItem] = []
        for note in wanted.values {
            let version = "local:\(Int64(note.updatedAt))" + (note.starred ? "*" : "")
            guard known[note.id] != version else { continue }
            items.append(Self.item(note))
            known[note.id] = version
        }
        let gone = known.keys.filter { wanted[$0] == nil }
        do {
            if !items.isEmpty { try await index.indexSearchableItems(items) }
            if !gone.isEmpty { try await index.deleteSearchableItems(withIdentifiers: Array(gone)) }
            for id in gone { known[id] = nil }
            indexed = known
        } catch {
            // Spotlight isn't available right now: the page hands them over again after its next change.
        }
    }

    static func item(_ note: LocalNote) -> CSSearchableItem {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.text)
        let title = note.title.isEmpty ? "Untitled" : note.title
        attributes.title = title
        attributes.displayName = title
        attributes.contentDescription = String(note.excerpt.prefix(300))
        attributes.containerTitle = note.location
        attributes.containerDisplayName = note.location
        attributes.keywords = [note.location] + (note.starred ? ["starred"] : [])
        attributes.contentModificationDate = Date(timeIntervalSince1970: note.updatedAt / 1000)
        let item = CSSearchableItem(uniqueIdentifier: note.id, domainIdentifier: domain, attributeSet: attributes)
        item.expirationDate = .distantFuture
        return item
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
