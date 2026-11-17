// The Tags page (the web's views/OrganizeIndex.tsx TagsIndex): the place's tags with how many pages each has,
// searched by name (a leading # ignored) and sorted by Name, Most used or Newest, the sort kept as the web keeps it
// (`folevi:tags-sort`; the Mac's own page keeps "folevi.tags-sort" too). From the engine's `tags.index` view.
import Foundation
import Observation
import FoleviEngine

@MainActor
@Observable
public final class TagsIndexModel {
    public enum Sort: String, CaseIterable, Sendable {
        case name, count, created
        public var label: String {
            switch self {
            case .name: "Name"
            case .count: "Most used"
            case .created: "Newest"
            }
        }
    }

    public static let sortKey = "folevi.tags-sort"

    /// (Kept: a store doesn't keep its client alive.)
    public let client: EngineClient
    public let tags: ValueStore<TagsIndexValue>
    public var query = ""
    public var sort: Sort {
        didSet { defaults.set(sort.rawValue, forKey: Self.sortKey) }
    }
    @ObservationIgnored private let defaults: UserDefaults

    public init(client: EngineClient, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.client = client
        tags = client.watch(.tagsIndex())
        sort = defaults.string(forKey: Self.sortKey).flatMap(Sort.init(rawValue:)) ?? .name
    }

    public var isLoading: Bool { tags.value == nil && tags.error == nil }

    /// What the search asks for: trimmed, without a leading #, lowercased.
    public var needle: String {
        var q = query.trimmingCharacters(in: .whitespaces)
        if q.hasPrefix("#") { q.removeFirst() }
        return q.lowercased()
    }

    /// The tags the search matches, in the chosen order.
    public var shown: [TagIndexRow] { Self.arrange(tags.value?.tags ?? [], needle: needle, sort: sort) }

    public static func arrange(_ rows: [TagIndexRow], needle: String, sort: Sort) -> [TagIndexRow] {
        rows.filter { needle.isEmpty || $0.name.lowercased().contains(needle) }.sorted { a, b in
            switch sort {
            case .count: a.documentCount != b.documentCount ? a.documentCount > b.documentCount : a.name.localizedCompare(b.name) == .orderedAscending
            case .created: a.createdAt > b.createdAt
            case .name: a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
        }
    }
}
