import SwiftUI

/// Lightweight, observable description of a dot for the UI (the SwiftData object stays in the store).
struct DotState: Identifiable, Equatable {
    let id: UUID
    var index: Int
    var name: String?
    var colorID: DotColorID?
    var customHex: String?
    var isEmpty: Bool
    var isRichText: Bool
    var wordCount: Int
    var updatedAt: Date

    var nsColor: NSColor {
        if let customHex, let c = NSColor(hex: customHex) { return c }
        return (colorID ?? .neutral).nsColor
    }

    var color: Color { Color(nsColor: nsColor) }

    var colorName: String {
        if customHex != nil { return String(localized: "custom color") }
        return (colorID ?? .neutral).localizedName
    }

    var hasCustomName: Bool { !(name ?? "").trimmingCharacters(in: .whitespaces).isEmpty }

    var displayName: String {
        hasCustomName ? name! : "Quick note \(index + 1)"
    }

    /// "Dot 3, blue, empty" / "Groceries, dot 3, green, 12 words".
    var accessibilityLabel: String {
        let state = isEmpty ? String(localized: "empty") : String(localized: "\(wordCount) words")
        if hasCustomName {
            return "\(name!), quick note \(index + 1), \(colorName), \(state)"
        }
        return "Quick note \(index + 1), \(colorName), \(state)"
    }
}

struct Toast: Identifiable, Equatable {
    struct Action: Identifiable, Equatable {
        let id = UUID()
        var title: String
    }
    let id = UUID()
    var message: String
    var symbol: String?
    var actions: [Action] = []
    var duration: TimeInterval = 3.5
}

struct LinkRequest: Equatable {
    var range: NSRange
    var url: String
    var text: String
}

enum PanelOverlay: Equatable {
    case cheatSheet
    case rename(UUID)
    case link(LinkRequest)
    case confirmDelete(UUID)
}
