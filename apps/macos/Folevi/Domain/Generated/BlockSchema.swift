// Generated from packages/editor-schema/spec/folevi-blocks.v1.json by scripts/generate.mjs — do not edit.
import Foundation

public let foleviSchemaVersion = 1

public enum HeadingLevel: Int, Codable, Sendable, Hashable, CaseIterable {
    case level1 = 1
    case level2 = 2
    case level3 = 3

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decodeFlexibleInt()
        guard let value = HeadingLevel(rawValue: raw) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid HeadingLevel \(raw)"))
        }
        self = value
    }
}

public enum CalloutTone: String, Codable, Sendable, Hashable, CaseIterable {
    case note
    case info
    case success
    case warning
    case danger
}

public enum TextColor: String, Codable, Sendable, Hashable, CaseIterable {
    case muted
    case accent
    case moss
    case marigold
    case plum
    case coral
}

public enum HighlightColor: String, Codable, Sendable, Hashable, CaseIterable {
    case yellow
    case green
    case blue
    case pink
}

public enum TaskPriority: String, Codable, Sendable, Hashable, CaseIterable {
    case `none`
    case low
    case medium
    case high
}

public enum PageDisplay: String, Codable, Sendable, Hashable, CaseIterable {
    case `link`
    case card
}

public enum DocumentFont: String, Codable, Sendable, Hashable, CaseIterable {
    case sans
    case serif
    case mono
    case rounded
}

public enum DocumentWidth: String, Codable, Sendable, Hashable, CaseIterable {
    case narrow
    case `default`
    case wide
}

public enum DocumentBackground: String, Codable, Sendable, Hashable, CaseIterable {
    case paper
    case `plain`
    case tinted
    case grid
}

public enum DocumentAccent: String, Codable, Sendable, Hashable, CaseIterable {
    case accent
    case moss
    case marigold
    case plum
    case coral
}

public enum CardStyle: String, Codable, Sendable, Hashable, CaseIterable {
    case folio
    case `plain`
    case tinted
    case outline
}

public enum CoverKind: String, Codable, Sendable, Hashable, CaseIterable {
    case `none`
    case color
    case gradient
    case image
    case art
}

public enum DocumentKind: String, Codable, Sendable, Hashable, CaseIterable {
    case document
    case daily
    case template
    case collectionRow
}

public enum DocumentSheet: String, Codable, Sendable, Hashable, CaseIterable {
    case white
    case paper
    case ivory
    case mist
    case sage
    case blush
    case night
}

public enum DocumentText: String, Codable, Sendable, Hashable, CaseIterable {
    case ink
    case slate
    case navy
    case forest
    case plum
    case brown
    case white
}

public enum SeparatorStyle: String, Codable, Sendable, Hashable, CaseIterable {
    case line
    case dots
    case doodle
}

public enum BlockTextStyle: String, Codable, Sendable, Hashable, CaseIterable {
    case strong
    case caption
}

public enum BlockDecoration: String, Codable, Sendable, Hashable, CaseIterable {
    case focus
    case block
}

public enum BlockColor: String, Codable, Sendable, Hashable, CaseIterable {
    case black
    case slate
    case gray
    case navy
    case blue
    case sky
    case green
    case purple
    case red
    case orange
    case brown
}

public enum BlockAlign: String, Codable, Sendable, Hashable, CaseIterable {
    case left
    case center
    case right
    case justify
}

public enum BlockFont: String, Codable, Sendable, Hashable, CaseIterable {
    case system
    case serif
    case mono
    case rounded
}

public enum BlockGroup: String, Codable, Sendable, Hashable, CaseIterable {
    case `page`
    case card
}

public enum DividerStyle: String, Codable, Sendable, Hashable, CaseIterable {
    case extralight
    case light
    case regular
    case strong
}

public enum Mark: Codable, Sendable, Hashable {
    case bold
    case italic
    case underline
    case `strike`
    case `code`
    case `link`(href: String)
    case color(value: TextColor)
    case highlight(value: HighlightColor)

    enum CodingKeys: String, CodingKey { case type, href, value }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let tag = try c.decode(String.self, forKey: .type)
        switch tag {
        case "bold": self = .bold
        case "italic": self = .italic
        case "underline": self = .underline
        case "strike": self = .strike
        case "code": self = .code
        case "link":
            let href = try c.decode(String.self, forKey: .href)
            self = .link(href: href)
        case "color":
            let value = try c.decode(TextColor.self, forKey: .value)
            self = .color(value: value)
        case "highlight":
            let value = try c.decode(HighlightColor.self, forKey: .value)
            self = .highlight(value: value)
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "Unknown Mark \(tag)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .bold:
            try c.encode("bold", forKey: .type)
        case .italic:
            try c.encode("italic", forKey: .type)
        case .underline:
            try c.encode("underline", forKey: .type)
        case .strike:
            try c.encode("strike", forKey: .type)
        case .code:
            try c.encode("code", forKey: .type)
        case .link(let href):
            try c.encode("link", forKey: .type)
            try c.encode(href, forKey: .href)
        case .color(let value):
            try c.encode("color", forKey: .type)
            try c.encode(value, forKey: .value)
        case .highlight(let value):
            try c.encode("highlight", forKey: .type)
            try c.encode(value, forKey: .value)
        }
    }
}

public enum InlineNode: Codable, Sendable, Hashable {
    case `text`(text: String, marks: [Mark]?)
    case mention(userId: String, label: String)
    case `date`(date: String)
    case pageLink(documentId: String, label: String)

    enum CodingKeys: String, CodingKey { case type, text, marks, userId, label, date, documentId }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let tag = try c.decode(String.self, forKey: .type)
        switch tag {
        case "text":
            let text = try c.decode(String.self, forKey: .text)
            let marks = try c.decodeIfPresent([Mark].self, forKey: .marks)
            self = .text(text: text, marks: marks)
        case "mention":
            let userId = try c.decode(String.self, forKey: .userId)
            let label = try c.decode(String.self, forKey: .label)
            self = .mention(userId: userId, label: label)
        case "date":
            let date = try c.decode(String.self, forKey: .date)
            self = .date(date: date)
        case "pageLink":
            let documentId = try c.decode(String.self, forKey: .documentId)
            let label = try c.decode(String.self, forKey: .label)
            self = .pageLink(documentId: documentId, label: label)
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "Unknown InlineNode \(tag)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .text(let text, let marks):
            try c.encode("text", forKey: .type)
            try c.encode(text, forKey: .text)
            try c.encodeIfPresent(marks, forKey: .marks)
        case .mention(let userId, let label):
            try c.encode("mention", forKey: .type)
            try c.encode(userId, forKey: .userId)
            try c.encode(label, forKey: .label)
        case .date(let date):
            try c.encode("date", forKey: .type)
            try c.encode(date, forKey: .date)
        case .pageLink(let documentId, let label):
            try c.encode("pageLink", forKey: .type)
            try c.encode(documentId, forKey: .documentId)
            try c.encode(label, forKey: .label)
        }
    }
}

public struct DocumentStyle: Codable, Sendable, Hashable {
    public var font: DocumentFont
    public var width: DocumentWidth
    public var background: DocumentBackground
    public var accent: DocumentAccent
    public var card: CardStyle
    public var backdrop: String?
    public var sheet: DocumentSheet?
    public var text: DocumentText?
    public var separator: SeparatorStyle?

    public init(font: DocumentFont, width: DocumentWidth, background: DocumentBackground, accent: DocumentAccent, card: CardStyle, backdrop: String? = nil, sheet: DocumentSheet? = nil, text: DocumentText? = nil, separator: SeparatorStyle? = nil) {
        self.font = font
        self.width = width
        self.background = background
        self.accent = accent
        self.card = card
        self.backdrop = backdrop
        self.sheet = sheet
        self.text = text
        self.separator = separator
    }

    enum CodingKeys: String, CodingKey { case font, width, background, accent, card, backdrop, sheet, text, separator }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.font = try c.decode(DocumentFont.self, forKey: .font)
        self.width = try c.decode(DocumentWidth.self, forKey: .width)
        self.background = try c.decode(DocumentBackground.self, forKey: .background)
        self.accent = try c.decode(DocumentAccent.self, forKey: .accent)
        self.card = try c.decode(CardStyle.self, forKey: .card)
        self.backdrop = try c.decodeIfPresent(String.self, forKey: .backdrop)
        self.sheet = try c.decodeIfPresent(DocumentSheet.self, forKey: .sheet)
        self.text = try c.decodeIfPresent(DocumentText.self, forKey: .text)
        self.separator = try c.decodeIfPresent(SeparatorStyle.self, forKey: .separator)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(font, forKey: .font)
        try c.encode(width, forKey: .width)
        try c.encode(background, forKey: .background)
        try c.encode(accent, forKey: .accent)
        try c.encode(card, forKey: .card)
        try c.encodeIfPresent(backdrop, forKey: .backdrop)
        try c.encodeIfPresent(sheet, forKey: .sheet)
        try c.encodeIfPresent(text, forKey: .text)
        try c.encodeIfPresent(separator, forKey: .separator)
    }
}

public struct DocumentCover: Codable, Sendable, Hashable {
    public var kind: CoverKind
    public var value: String?

    public init(kind: CoverKind, value: String? = nil) {
        self.kind = kind
        self.value = value
    }

    enum CodingKeys: String, CodingKey { case kind, value }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.kind = try c.decode(CoverKind.self, forKey: .kind)
        self.value = try c.decodeIfPresent(String.self, forKey: .value)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kind, forKey: .kind)
        try c.encodeIfPresent(value, forKey: .value)
    }
}

public struct ParagraphProps: Codable, Sendable, Hashable {
    public var textStyle: BlockTextStyle?
    public var decoration: BlockDecoration?
    public var color: BlockColor?
    public var align: BlockAlign?
    public var font: BlockFont?
    public var group: BlockGroup?

    public init(textStyle: BlockTextStyle? = nil, decoration: BlockDecoration? = nil, color: BlockColor? = nil, align: BlockAlign? = nil, font: BlockFont? = nil, group: BlockGroup? = nil) {
        self.textStyle = textStyle
        self.decoration = decoration
        self.color = color
        self.align = align
        self.font = font
        self.group = group
    }

    enum CodingKeys: String, CodingKey { case textStyle, decoration, color, align, font, group }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.textStyle = try c.decodeIfPresent(BlockTextStyle.self, forKey: .textStyle)
        self.decoration = try c.decodeIfPresent(BlockDecoration.self, forKey: .decoration)
        self.color = try c.decodeIfPresent(BlockColor.self, forKey: .color)
        self.align = try c.decodeIfPresent(BlockAlign.self, forKey: .align)
        self.font = try c.decodeIfPresent(BlockFont.self, forKey: .font)
        self.group = try c.decodeIfPresent(BlockGroup.self, forKey: .group)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(textStyle, forKey: .textStyle)
        try c.encodeIfPresent(decoration, forKey: .decoration)
        try c.encodeIfPresent(color, forKey: .color)
        try c.encodeIfPresent(align, forKey: .align)
        try c.encodeIfPresent(font, forKey: .font)
        try c.encodeIfPresent(group, forKey: .group)
    }
}

public struct HeadingProps: Codable, Sendable, Hashable {
    public var level: HeadingLevel
    public var decoration: BlockDecoration?
    public var color: BlockColor?
    public var align: BlockAlign?
    public var font: BlockFont?
    public var group: BlockGroup?

    public init(level: HeadingLevel, decoration: BlockDecoration? = nil, color: BlockColor? = nil, align: BlockAlign? = nil, font: BlockFont? = nil, group: BlockGroup? = nil) {
        self.level = level
        self.decoration = decoration
        self.color = color
        self.align = align
        self.font = font
        self.group = group
    }

    enum CodingKeys: String, CodingKey { case level, decoration, color, align, font, group }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.level = try c.decode(HeadingLevel.self, forKey: .level)
        self.decoration = try c.decodeIfPresent(BlockDecoration.self, forKey: .decoration)
        self.color = try c.decodeIfPresent(BlockColor.self, forKey: .color)
        self.align = try c.decodeIfPresent(BlockAlign.self, forKey: .align)
        self.font = try c.decodeIfPresent(BlockFont.self, forKey: .font)
        self.group = try c.decodeIfPresent(BlockGroup.self, forKey: .group)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(level, forKey: .level)
        try c.encodeIfPresent(decoration, forKey: .decoration)
        try c.encodeIfPresent(color, forKey: .color)
        try c.encodeIfPresent(align, forKey: .align)
        try c.encodeIfPresent(font, forKey: .font)
        try c.encodeIfPresent(group, forKey: .group)
    }
}

public struct BulletedProps: Codable, Sendable, Hashable {
    public var decoration: BlockDecoration?
    public var color: BlockColor?
    public var align: BlockAlign?
    public var font: BlockFont?
    public var group: BlockGroup?

    public init(decoration: BlockDecoration? = nil, color: BlockColor? = nil, align: BlockAlign? = nil, font: BlockFont? = nil, group: BlockGroup? = nil) {
        self.decoration = decoration
        self.color = color
        self.align = align
        self.font = font
        self.group = group
    }

    enum CodingKeys: String, CodingKey { case decoration, color, align, font, group }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.decoration = try c.decodeIfPresent(BlockDecoration.self, forKey: .decoration)
        self.color = try c.decodeIfPresent(BlockColor.self, forKey: .color)
        self.align = try c.decodeIfPresent(BlockAlign.self, forKey: .align)
        self.font = try c.decodeIfPresent(BlockFont.self, forKey: .font)
        self.group = try c.decodeIfPresent(BlockGroup.self, forKey: .group)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(decoration, forKey: .decoration)
        try c.encodeIfPresent(color, forKey: .color)
        try c.encodeIfPresent(align, forKey: .align)
        try c.encodeIfPresent(font, forKey: .font)
        try c.encodeIfPresent(group, forKey: .group)
    }
}

public struct NumberedProps: Codable, Sendable, Hashable {
    public var decoration: BlockDecoration?
    public var color: BlockColor?
    public var align: BlockAlign?
    public var font: BlockFont?
    public var group: BlockGroup?

    public init(decoration: BlockDecoration? = nil, color: BlockColor? = nil, align: BlockAlign? = nil, font: BlockFont? = nil, group: BlockGroup? = nil) {
        self.decoration = decoration
        self.color = color
        self.align = align
        self.font = font
        self.group = group
    }

    enum CodingKeys: String, CodingKey { case decoration, color, align, font, group }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.decoration = try c.decodeIfPresent(BlockDecoration.self, forKey: .decoration)
        self.color = try c.decodeIfPresent(BlockColor.self, forKey: .color)
        self.align = try c.decodeIfPresent(BlockAlign.self, forKey: .align)
        self.font = try c.decodeIfPresent(BlockFont.self, forKey: .font)
        self.group = try c.decodeIfPresent(BlockGroup.self, forKey: .group)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(decoration, forKey: .decoration)
        try c.encodeIfPresent(color, forKey: .color)
        try c.encodeIfPresent(align, forKey: .align)
        try c.encodeIfPresent(font, forKey: .font)
        try c.encodeIfPresent(group, forKey: .group)
    }
}

public struct TodoProps: Codable, Sendable, Hashable {
    public var checked: Bool
    public var canceled: Bool?
    public var dueDate: String?
    public var dueTime: String?
    public var priority: TaskPriority?
    public var assigneeId: String?
    public var reminderAt: Double?
    public var completedAt: Double?
    public var decoration: BlockDecoration?
    public var color: BlockColor?
    public var align: BlockAlign?
    public var font: BlockFont?
    public var group: BlockGroup?

    public init(checked: Bool, canceled: Bool? = nil, dueDate: String? = nil, dueTime: String? = nil, priority: TaskPriority? = nil, assigneeId: String? = nil, reminderAt: Double? = nil, completedAt: Double? = nil, decoration: BlockDecoration? = nil, color: BlockColor? = nil, align: BlockAlign? = nil, font: BlockFont? = nil, group: BlockGroup? = nil) {
        self.checked = checked
        self.canceled = canceled
        self.dueDate = dueDate
        self.dueTime = dueTime
        self.priority = priority
        self.assigneeId = assigneeId
        self.reminderAt = reminderAt
        self.completedAt = completedAt
        self.decoration = decoration
        self.color = color
        self.align = align
        self.font = font
        self.group = group
    }

    enum CodingKeys: String, CodingKey { case checked, canceled, dueDate, dueTime, priority, assigneeId, reminderAt, completedAt, decoration, color, align, font, group }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.checked = try c.decode(Bool.self, forKey: .checked)
        self.canceled = try c.decodeIfPresent(Bool.self, forKey: .canceled)
        self.dueDate = try c.decodeIfPresent(String.self, forKey: .dueDate)
        self.dueTime = try c.decodeIfPresent(String.self, forKey: .dueTime)
        self.priority = try c.decodeIfPresent(TaskPriority.self, forKey: .priority)
        self.assigneeId = try c.decodeIfPresent(String.self, forKey: .assigneeId)
        self.reminderAt = try c.decodeIfPresent(Double.self, forKey: .reminderAt)
        self.completedAt = try c.decodeIfPresent(Double.self, forKey: .completedAt)
        self.decoration = try c.decodeIfPresent(BlockDecoration.self, forKey: .decoration)
        self.color = try c.decodeIfPresent(BlockColor.self, forKey: .color)
        self.align = try c.decodeIfPresent(BlockAlign.self, forKey: .align)
        self.font = try c.decodeIfPresent(BlockFont.self, forKey: .font)
        self.group = try c.decodeIfPresent(BlockGroup.self, forKey: .group)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(checked, forKey: .checked)
        try c.encodeIfPresent(canceled, forKey: .canceled)
        try c.encodeIfPresent(dueDate, forKey: .dueDate)
        try c.encodeIfPresent(dueTime, forKey: .dueTime)
        try c.encodeIfPresent(priority, forKey: .priority)
        try c.encodeIfPresent(assigneeId, forKey: .assigneeId)
        try c.encodeIfPresent(reminderAt, forKey: .reminderAt)
        try c.encodeIfPresent(completedAt, forKey: .completedAt)
        try c.encodeIfPresent(decoration, forKey: .decoration)
        try c.encodeIfPresent(color, forKey: .color)
        try c.encodeIfPresent(align, forKey: .align)
        try c.encodeIfPresent(font, forKey: .font)
        try c.encodeIfPresent(group, forKey: .group)
    }
}

public struct ToggleProps: Codable, Sendable, Hashable {
    public var collapsed: Bool
    public var decoration: BlockDecoration?
    public var color: BlockColor?
    public var align: BlockAlign?
    public var font: BlockFont?
    public var group: BlockGroup?

    public init(collapsed: Bool, decoration: BlockDecoration? = nil, color: BlockColor? = nil, align: BlockAlign? = nil, font: BlockFont? = nil, group: BlockGroup? = nil) {
        self.collapsed = collapsed
        self.decoration = decoration
        self.color = color
        self.align = align
        self.font = font
        self.group = group
    }

    enum CodingKeys: String, CodingKey { case collapsed, decoration, color, align, font, group }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.collapsed = try c.decode(Bool.self, forKey: .collapsed)
        self.decoration = try c.decodeIfPresent(BlockDecoration.self, forKey: .decoration)
        self.color = try c.decodeIfPresent(BlockColor.self, forKey: .color)
        self.align = try c.decodeIfPresent(BlockAlign.self, forKey: .align)
        self.font = try c.decodeIfPresent(BlockFont.self, forKey: .font)
        self.group = try c.decodeIfPresent(BlockGroup.self, forKey: .group)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(collapsed, forKey: .collapsed)
        try c.encodeIfPresent(decoration, forKey: .decoration)
        try c.encodeIfPresent(color, forKey: .color)
        try c.encodeIfPresent(align, forKey: .align)
        try c.encodeIfPresent(font, forKey: .font)
        try c.encodeIfPresent(group, forKey: .group)
    }
}

public struct QuoteProps: Codable, Sendable, Hashable {
    public var decoration: BlockDecoration?
    public var color: BlockColor?
    public var align: BlockAlign?
    public var font: BlockFont?
    public var group: BlockGroup?

    public init(decoration: BlockDecoration? = nil, color: BlockColor? = nil, align: BlockAlign? = nil, font: BlockFont? = nil, group: BlockGroup? = nil) {
        self.decoration = decoration
        self.color = color
        self.align = align
        self.font = font
        self.group = group
    }

    enum CodingKeys: String, CodingKey { case decoration, color, align, font, group }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.decoration = try c.decodeIfPresent(BlockDecoration.self, forKey: .decoration)
        self.color = try c.decodeIfPresent(BlockColor.self, forKey: .color)
        self.align = try c.decodeIfPresent(BlockAlign.self, forKey: .align)
        self.font = try c.decodeIfPresent(BlockFont.self, forKey: .font)
        self.group = try c.decodeIfPresent(BlockGroup.self, forKey: .group)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(decoration, forKey: .decoration)
        try c.encodeIfPresent(color, forKey: .color)
        try c.encodeIfPresent(align, forKey: .align)
        try c.encodeIfPresent(font, forKey: .font)
        try c.encodeIfPresent(group, forKey: .group)
    }
}

public struct CalloutProps: Codable, Sendable, Hashable {
    public var tone: CalloutTone
    public var icon: String?

    public init(tone: CalloutTone, icon: String? = nil) {
        self.tone = tone
        self.icon = icon
    }

    enum CodingKeys: String, CodingKey { case tone, icon }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.tone = try c.decode(CalloutTone.self, forKey: .tone)
        self.icon = try c.decodeIfPresent(String.self, forKey: .icon)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(tone, forKey: .tone)
        try c.encodeIfPresent(icon, forKey: .icon)
    }
}

public struct DividerProps: Codable, Sendable, Hashable {
    public var style: DividerStyle?

    public init(style: DividerStyle? = nil) {
        self.style = style
    }

    enum CodingKeys: String, CodingKey { case style }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.style = try c.decodeIfPresent(DividerStyle.self, forKey: .style)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(style, forKey: .style)
    }
}

public struct PageBreakProps: Codable, Sendable, Hashable {
    public init() {}
}

public struct CodeProps: Codable, Sendable, Hashable {
    public var language: String
    public var code: String

    public init(language: String, code: String) {
        self.language = language
        self.code = code
    }

    enum CodingKeys: String, CodingKey { case language, code }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.language = try c.decode(String.self, forKey: .language)
        self.code = try c.decode(String.self, forKey: .code)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(language, forKey: .language)
        try c.encode(code, forKey: .code)
    }
}

public struct ImageProps: Codable, Sendable, Hashable {
    public var fileId: String?
    public var url: String?
    public var alt: String
    public var caption: String
    public var width: Double?
    public var naturalWidth: Double?
    public var naturalHeight: Double?

    public init(fileId: String? = nil, url: String? = nil, alt: String, caption: String, width: Double? = nil, naturalWidth: Double? = nil, naturalHeight: Double? = nil) {
        self.fileId = fileId
        self.url = url
        self.alt = alt
        self.caption = caption
        self.width = width
        self.naturalWidth = naturalWidth
        self.naturalHeight = naturalHeight
    }

    enum CodingKeys: String, CodingKey { case fileId, url, alt, caption, width, naturalWidth, naturalHeight }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.fileId = try c.decodeIfPresent(String.self, forKey: .fileId)
        self.url = try c.decodeIfPresent(String.self, forKey: .url)
        self.alt = try c.decode(String.self, forKey: .alt)
        self.caption = try c.decode(String.self, forKey: .caption)
        self.width = try c.decodeIfPresent(Double.self, forKey: .width)
        self.naturalWidth = try c.decodeIfPresent(Double.self, forKey: .naturalWidth)
        self.naturalHeight = try c.decodeIfPresent(Double.self, forKey: .naturalHeight)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(fileId, forKey: .fileId)
        try c.encodeIfPresent(url, forKey: .url)
        try c.encode(alt, forKey: .alt)
        try c.encode(caption, forKey: .caption)
        try c.encodeIfPresent(width, forKey: .width)
        try c.encodeIfPresent(naturalWidth, forKey: .naturalWidth)
        try c.encodeIfPresent(naturalHeight, forKey: .naturalHeight)
    }
}

public struct FileProps: Codable, Sendable, Hashable {
    public var fileId: String
    public var name: String
    public var size: Double
    public var mimeType: String

    public init(fileId: String, name: String, size: Double, mimeType: String) {
        self.fileId = fileId
        self.name = name
        self.size = size
        self.mimeType = mimeType
    }

    enum CodingKeys: String, CodingKey { case fileId, name, size, mimeType }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.fileId = try c.decode(String.self, forKey: .fileId)
        self.name = try c.decode(String.self, forKey: .name)
        self.size = try c.decode(Double.self, forKey: .size)
        self.mimeType = try c.decode(String.self, forKey: .mimeType)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(fileId, forKey: .fileId)
        try c.encode(name, forKey: .name)
        try c.encode(size, forKey: .size)
        try c.encode(mimeType, forKey: .mimeType)
    }
}

public struct TableProps: Codable, Sendable, Hashable {
    public var rows: [[[InlineNode]]]
    public var headerRow: Bool

    public init(rows: [[[InlineNode]]], headerRow: Bool) {
        self.rows = rows
        self.headerRow = headerRow
    }

    enum CodingKeys: String, CodingKey { case rows, headerRow }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.rows = try c.decode([[[InlineNode]]].self, forKey: .rows)
        self.headerRow = try c.decode(Bool.self, forKey: .headerRow)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(rows, forKey: .rows)
        try c.encode(headerRow, forKey: .headerRow)
    }
}

public struct PageProps: Codable, Sendable, Hashable {
    public var documentId: String
    public var display: PageDisplay
    public var titleCache: String?
    public var iconCache: String?

    public init(documentId: String, display: PageDisplay, titleCache: String? = nil, iconCache: String? = nil) {
        self.documentId = documentId
        self.display = display
        self.titleCache = titleCache
        self.iconCache = iconCache
    }

    enum CodingKeys: String, CodingKey { case documentId, display, titleCache, iconCache }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.documentId = try c.decode(String.self, forKey: .documentId)
        self.display = try c.decode(PageDisplay.self, forKey: .display)
        self.titleCache = try c.decodeIfPresent(String.self, forKey: .titleCache)
        self.iconCache = try c.decodeIfPresent(String.self, forKey: .iconCache)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(documentId, forKey: .documentId)
        try c.encode(display, forKey: .display)
        try c.encodeIfPresent(titleCache, forKey: .titleCache)
        try c.encodeIfPresent(iconCache, forKey: .iconCache)
    }
}

public struct BookmarkProps: Codable, Sendable, Hashable {
    public var url: String
    public var title: String?
    public var description: String?
    public var siteName: String?

    public init(url: String, title: String? = nil, description: String? = nil, siteName: String? = nil) {
        self.url = url
        self.title = title
        self.description = description
        self.siteName = siteName
    }

    enum CodingKeys: String, CodingKey { case url, title, description, siteName }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.url = try c.decode(String.self, forKey: .url)
        self.title = try c.decodeIfPresent(String.self, forKey: .title)
        self.description = try c.decodeIfPresent(String.self, forKey: .description)
        self.siteName = try c.decodeIfPresent(String.self, forKey: .siteName)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(url, forKey: .url)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encodeIfPresent(description, forKey: .description)
        try c.encodeIfPresent(siteName, forKey: .siteName)
    }
}

public struct CollectionProps: Codable, Sendable, Hashable {
    public var collectionId: String
    public var viewId: String?

    public init(collectionId: String, viewId: String? = nil) {
        self.collectionId = collectionId
        self.viewId = viewId
    }

    enum CodingKeys: String, CodingKey { case collectionId, viewId }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.collectionId = try c.decode(String.self, forKey: .collectionId)
        self.viewId = try c.decodeIfPresent(String.self, forKey: .viewId)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(collectionId, forKey: .collectionId)
        try c.encodeIfPresent(viewId, forKey: .viewId)
    }
}

public struct FormulaProps: Codable, Sendable, Hashable {
    public var latex: String

    public init(latex: String) {
        self.latex = latex
    }

    enum CodingKeys: String, CodingKey { case latex }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.latex = try c.decode(String.self, forKey: .latex)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(latex, forKey: .latex)
    }
}

public struct WhiteboardProps: Codable, Sendable, Hashable {
    public var data: String
    public var height: Double

    public init(data: String, height: Double) {
        self.data = data
        self.height = height
    }

    enum CodingKeys: String, CodingKey { case data, height }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.data = try c.decode(String.self, forKey: .data)
        self.height = try c.decode(Double.self, forKey: .height)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(data, forKey: .data)
        try c.encode(height, forKey: .height)
    }
}

/// Typed block content. Unknown types (written by a newer client) are preserved verbatim.
public enum BlockContent: Sendable, Hashable {
    case paragraph(ParagraphProps)
    case heading(HeadingProps)
    case bulleted(BulletedProps)
    case numbered(NumberedProps)
    case todo(TodoProps)
    case toggle(ToggleProps)
    case quote(QuoteProps)
    case callout(CalloutProps)
    case divider(DividerProps)
    case pageBreak(PageBreakProps)
    case `code`(CodeProps)
    case image(ImageProps)
    case `file`(FileProps)
    case table(TableProps)
    case `page`(PageProps)
    case bookmark(BookmarkProps)
    case collection(CollectionProps)
    case formula(FormulaProps)
    case whiteboard(WhiteboardProps)
    case unknown(type: String, props: JSONValue)

    public static let knownTypes: Set<String> = ["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote", "callout", "divider", "pageBreak", "code", "image", "file", "table", "page", "bookmark", "collection", "formula", "whiteboard"]
    public static let textTypes: Set<String> = ["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote", "callout"]

    public var typeName: String {
        switch self {
        case .paragraph: return "paragraph"
        case .heading: return "heading"
        case .bulleted: return "bulleted"
        case .numbered: return "numbered"
        case .todo: return "todo"
        case .toggle: return "toggle"
        case .quote: return "quote"
        case .callout: return "callout"
        case .divider: return "divider"
        case .pageBreak: return "pageBreak"
        case .code: return "code"
        case .image: return "image"
        case .file: return "file"
        case .table: return "table"
        case .page: return "page"
        case .bookmark: return "bookmark"
        case .collection: return "collection"
        case .formula: return "formula"
        case .whiteboard: return "whiteboard"
        case .unknown(let type, _): return type
        }
    }

    public var carriesText: Bool { Self.textTypes.contains(typeName) }

    public static func decode(type: String, props: JSONValue) throws -> BlockContent {
        switch type {
        case "paragraph": return .paragraph(try props.decode(ParagraphProps.self))
        case "heading": return .heading(try props.decode(HeadingProps.self))
        case "bulleted": return .bulleted(try props.decode(BulletedProps.self))
        case "numbered": return .numbered(try props.decode(NumberedProps.self))
        case "todo": return .todo(try props.decode(TodoProps.self))
        case "toggle": return .toggle(try props.decode(ToggleProps.self))
        case "quote": return .quote(try props.decode(QuoteProps.self))
        case "callout": return .callout(try props.decode(CalloutProps.self))
        case "divider": return .divider(try props.decode(DividerProps.self))
        case "pageBreak": return .pageBreak(try props.decode(PageBreakProps.self))
        case "code": return .code(try props.decode(CodeProps.self))
        case "image": return .image(try props.decode(ImageProps.self))
        case "file": return .file(try props.decode(FileProps.self))
        case "table": return .table(try props.decode(TableProps.self))
        case "page": return .page(try props.decode(PageProps.self))
        case "bookmark": return .bookmark(try props.decode(BookmarkProps.self))
        case "collection": return .collection(try props.decode(CollectionProps.self))
        case "formula": return .formula(try props.decode(FormulaProps.self))
        case "whiteboard": return .whiteboard(try props.decode(WhiteboardProps.self))
        default: return .unknown(type: type, props: props)
        }
    }

    public func encodedProps() throws -> JSONValue {
        switch self {
        case .paragraph(let p): return try JSONValue(encoding: p)
        case .heading(let p): return try JSONValue(encoding: p)
        case .bulleted(let p): return try JSONValue(encoding: p)
        case .numbered(let p): return try JSONValue(encoding: p)
        case .todo(let p): return try JSONValue(encoding: p)
        case .toggle(let p): return try JSONValue(encoding: p)
        case .quote(let p): return try JSONValue(encoding: p)
        case .callout(let p): return try JSONValue(encoding: p)
        case .divider(let p): return try JSONValue(encoding: p)
        case .pageBreak(let p): return try JSONValue(encoding: p)
        case .code(let p): return try JSONValue(encoding: p)
        case .image(let p): return try JSONValue(encoding: p)
        case .file(let p): return try JSONValue(encoding: p)
        case .table(let p): return try JSONValue(encoding: p)
        case .page(let p): return try JSONValue(encoding: p)
        case .bookmark(let p): return try JSONValue(encoding: p)
        case .collection(let p): return try JSONValue(encoding: p)
        case .formula(let p): return try JSONValue(encoding: p)
        case .whiteboard(let p): return try JSONValue(encoding: p)
        case .unknown(_, let props): return props
        }
    }
}

public enum FoleviLimits {
    public static let maxTextLength = 20000
    public static let maxCodeLength = 100000
    public static let maxDepth = 8
    public static let maxTableRows = 200
    public static let maxTableColumns = 20
    public static let maxBlocksPerDocument = 5000
    public static let maxRankLength = 128
    public static let maxFormulaLength = 10000
    public static let maxWhiteboardDataLength = 200000
    public static let minWhiteboardHeight = 120
    public static let maxWhiteboardHeight = 2400
}

public let foleviCodeLanguages: [String] = ["plaintext", "bash", "c", "cpp", "csharp", "css", "diff", "go", "graphql", "html", "java", "javascript", "json", "kotlin", "latex", "markdown", "mermaid", "php", "python", "ruby", "rust", "sql", "swift", "toml", "typescript", "xml", "yaml"]
