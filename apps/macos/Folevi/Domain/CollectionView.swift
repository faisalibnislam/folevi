import Foundation

/// A collection as `collections:get` returns it (convex/collections.ts), with the web's pure view logic
/// (components/views/collectionView.ts): filters, sorts and the board's columns.
public struct CollectionSnapshot: Decodable, Sendable, Equatable {
    public struct Option: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        public var color: String

        public init(id: String, name: String, color: String) {
            self.id = id
            self.name = name
            self.color = color
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            name = try c.decode(String.self, forKey: .name)
            color = (try? c.decodeIfPresent(String.self, forKey: .color)) ?? "muted"
        }
    }

    public struct Property: Decodable, Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        /// text, number, checkbox, date, select, multiSelect, url, person, relation
        public var type: String
        public var options: [Option]

        public init(id: String, name: String, type: String, options: [Option] = []) {
            self.id = id
            self.name = name
            self.type = type
            self.options = options
        }

        enum CodingKeys: String, CodingKey { case id, name, type, options }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            name = try c.decode(String.self, forKey: .name)
            type = try c.decode(String.self, forKey: .type)
            options = (try? c.decodeIfPresent([Option].self, forKey: .options)) ?? []
        }
    }

    public struct Filter: Codable, Sendable, Hashable {
        public var propertyId: String
        public var op: String
        public var value: JSONValue?

        public init(propertyId: String, op: String, value: JSONValue? = nil) {
            self.propertyId = propertyId
            self.op = op
            self.value = value
        }
    }

    public struct Sort: Codable, Sendable, Hashable {
        public var propertyId: String
        public var direction: String

        public init(propertyId: String, direction: String) {
            self.propertyId = propertyId
            self.direction = direction
        }
    }

    public struct ViewConfig: Codable, Sendable, Hashable {
        public var filters: [Filter]
        public var sorts: [Sort]
        public var groupBy: String?
        public var visibleProperties: [String]
        /// none, cover, content
        public var cardPreview: String
        /// small, medium, large
        public var cardSize: String

        public init(filters: [Filter] = [], sorts: [Sort] = [], groupBy: String? = nil, visibleProperties: [String] = [],
                    cardPreview: String = "cover", cardSize: String = "medium") {
            self.filters = filters
            self.sorts = sorts
            self.groupBy = groupBy
            self.visibleProperties = visibleProperties
            self.cardPreview = cardPreview
            self.cardSize = cardSize
        }

        enum CodingKeys: String, CodingKey { case filters, sorts, groupBy, visibleProperties, cardPreview, cardSize }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            filters = (try? c.decodeIfPresent([Filter].self, forKey: .filters)) ?? []
            sorts = (try? c.decodeIfPresent([Sort].self, forKey: .sorts)) ?? []
            groupBy = try? c.decodeIfPresent(String.self, forKey: .groupBy)
            visibleProperties = (try? c.decodeIfPresent([String].self, forKey: .visibleProperties)) ?? []
            cardPreview = (try? c.decodeIfPresent(String.self, forKey: .cardPreview)) ?? "cover"
            cardSize = (try? c.decodeIfPresent(String.self, forKey: .cardSize)) ?? "medium"
        }

        /// The mutation argument (Convex values can't carry undefined: absent keys stay absent).
        public var json: JSONValue { (try? JSONValue(encoding: self)) ?? .object([:]) }
    }

    public struct View: Decodable, Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        /// table, board, gallery
        public var type: String
        public var config: ViewConfig

        public init(id: String, name: String, type: String, config: ViewConfig) {
            self.id = id
            self.name = name
            self.type = type
            self.config = config
        }
    }

    public struct Row: Decodable, Sendable, Hashable, Identifiable {
        public var id: String
        public var documentId: String
        public var title: String
        public var icon: String?
        public var cover: DocumentCover?
        public var excerpt: String?
        public var rank: String?
        public var values: [String: JSONValue]

        public init(id: String, documentId: String, title: String, icon: String? = nil, cover: DocumentCover? = nil,
                    excerpt: String? = nil, rank: String? = nil, values: [String: JSONValue] = [:]) {
            self.id = id
            self.documentId = documentId
            self.title = title
            self.icon = icon
            self.cover = cover
            self.excerpt = excerpt
            self.rank = rank
            self.values = values
        }

        enum CodingKeys: String, CodingKey { case id, documentId, title, icon, cover, excerpt, rank, values }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            documentId = try c.decode(String.self, forKey: .documentId)
            title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
            icon = try? c.decodeIfPresent(String.self, forKey: .icon)
            cover = try? c.decodeIfPresent(DocumentCover.self, forKey: .cover)
            excerpt = try? c.decodeIfPresent(String.self, forKey: .excerpt)
            rank = try? c.decodeIfPresent(String.self, forKey: .rank)
            values = (try? c.decodeIfPresent([String: JSONValue].self, forKey: .values)) ?? [:]
        }
    }

    public struct Person: Decodable, Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
    }

    public var id: String
    public var name: String
    public var canEdit: Bool
    public var people: [Person]
    public var properties: [Property]
    public var views: [View]
    public var rows: [Row]

    public init(id: String, name: String, canEdit: Bool = true, people: [Person] = [], properties: [Property], views: [View], rows: [Row]) {
        self.id = id
        self.name = name
        self.canEdit = canEdit
        self.people = people
        self.properties = properties
        self.views = views
        self.rows = rows
    }

    enum CodingKeys: String, CodingKey { case id, name, canEdit, people, properties, views, rows }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        canEdit = (try? c.decodeIfPresent(Bool.self, forKey: .canEdit)) ?? false
        people = (try? c.decodeIfPresent([Person].self, forKey: .people)) ?? []
        properties = (try? c.decodeIfPresent([Property].self, forKey: .properties)) ?? []
        views = (try? c.decodeIfPresent([View].self, forKey: .views)) ?? []
        rows = (try? c.decodeIfPresent([Row].self, forKey: .rows)) ?? []
    }

    /// The view to show: the remembered one, the block's, or the first.
    public func view(preferred: String?, fallback: String?) -> View? {
        views.first { $0.id == preferred } ?? views.first { $0.id == fallback } ?? views.first
    }

    /// The board's columns: the group property's options, then "No <name>".
    public func boardColumns(for view: View) -> (property: Property, columns: [(id: String?, name: String, color: String)])? {
        guard let group = properties.first(where: { $0.id == view.config.groupBy && $0.type == "select" }) else { return nil }
        var cols: [(id: String?, name: String, color: String)] = group.options.map { ($0.id, $0.name, $0.color) }
        cols.append((nil, "No " + group.name.lowercased(), "muted"))
        return (group, cols)
    }
}

/// The web's collectionView.ts: which rows a view shows, in which order.
public enum CollectionLogic {
    public static let titleId = "title"

    public static func isEmpty(_ v: JSONValue?) -> Bool {
        guard let v else { return true }
        switch v {
        case .null: return true
        case .string(let s): return s.isEmpty
        case .array(let a): return a.isEmpty
        default: return false
        }
    }

    /// Select filters store an option id; older views stored the option's name.
    static func resolveOption(_ prop: CollectionSnapshot.Property?, _ value: JSONValue?) -> JSONValue? {
        guard let prop, prop.type == "select" || prop.type == "multiSelect", let s = value?.stringValue else { return value }
        if prop.options.contains(where: { $0.id == s }) { return value }
        let wanted = s.trimmingCharacters(in: .whitespaces).lowercased()
        return prop.options.first { $0.name.lowercased() == wanted }.map { .string($0.id) } ?? value
    }

    public static func matches(_ row: CollectionSnapshot.Row, _ f: CollectionSnapshot.Filter, _ props: [CollectionSnapshot.Property]) -> Bool {
        let isTitle = f.propertyId == titleId
        let prop = props.first { $0.id == f.propertyId }
        guard isTitle || prop != nil else { return true } // a filter on a deleted property is ignored
        let type = isTitle ? "title" : prop!.type
        let v: JSONValue? = isTitle ? .string(row.title) : row.values[f.propertyId]
        let empty = isEmpty(v) || (type == "relation" && v?.doubleValue == 0)
        switch f.op {
        case "isEmpty": return empty
        case "isNotEmpty": return !empty
        case "checked": return v?.boolValue == true
        case "unchecked": return v?.boolValue != true
        default: break
        }
        let wanted = resolveOption(prop, f.value)
        if isEmpty(wanted) { return true }
        switch type {
        case "select", "person":
            return f.op == "isNot" ? v != wanted : f.op == "is" ? v == wanted : true
        case "multiSelect":
            let has = v?.arrayValue?.contains { $0 == wanted } ?? false
            return f.op == "isNot" ? !has : f.op == "is" ? has : true
        case "number":
            let n = v?.doubleValue
            guard let t = wanted?.doubleValue ?? wanted?.stringValue.flatMap(Double.init), t.isFinite else { return true }
            if f.op == "isNot" { return n != t }
            guard let n, !empty else { return false }
            return f.op == "is" ? n == t : f.op == "gt" ? n > t : f.op == "lt" ? n < t : true
        case "date":
            let t = wanted?.stringValue ?? ""
            if f.op == "isNot" { return v?.stringValue != t }
            guard let s = v?.stringValue, !empty else { return false }
            return f.op == "is" ? s == t : f.op == "gt" ? s > t : f.op == "lt" ? s < t : true
        case "relation":
            return true
        default:
            let s = (v?.stringValue ?? "").lowercased()
            let t = (wanted?.stringValue ?? wanted.map { $0.canonicalString } ?? "").lowercased()
            return f.op == "contains" ? s.contains(t) : f.op == "is" ? s == t : f.op == "isNot" ? s != t : true
        }
    }

    public static func apply(_ rows: [CollectionSnapshot.Row], _ config: CollectionSnapshot.ViewConfig, _ props: [CollectionSnapshot.Property]) -> [CollectionSnapshot.Row] {
        var out = rows.filter { r in config.filters.allSatisfy { matches(r, $0, props) } }
        guard !config.sorts.isEmpty else { return out }
        out = out.enumerated().sorted { a, b in
            for s in config.sorts {
                let c = compare(value(a.element, s.propertyId), value(b.element, s.propertyId))
                if c != 0 { return s.direction == "asc" ? c < 0 : c > 0 }
            }
            return a.offset < b.offset
        }.map(\.element)
        return out
    }

    private static func value(_ row: CollectionSnapshot.Row, _ id: String) -> JSONValue? {
        id == titleId ? .string(row.title) : row.values[id]
    }

    /// Missing values sort last; numbers numerically; everything else as text.
    private static func compare(_ a: JSONValue?, _ b: JSONValue?) -> Int {
        if a == b { return 0 }
        guard let a else { return 1 }
        guard let b else { return -1 }
        if let x = a.doubleValue, let y = b.doubleValue, case .number = a, case .number = b { return x < y ? -1 : x > y ? 1 : 0 }
        let sa = a.stringValue ?? a.canonicalString, sb = b.stringValue ?? b.canonicalString
        switch sa.localizedCompare(sb) {
        case .orderedAscending: return -1
        case .orderedDescending: return 1
        case .orderedSame: return 0
        }
    }

    /// The rows in a board column (`nil` = no value).
    public static func rows(_ rows: [CollectionSnapshot.Row], inColumn column: String?, groupBy: String) -> [CollectionSnapshot.Row] {
        rows.filter { ($0.values[groupBy]?.stringValue) == column }
    }
}
