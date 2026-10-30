// The avatar's sheet (apps/web/src/components/iphone/AccountSheet.tsx): places first (each account with its
// workspaces under it, the library "On this iPhone"), then Settings, Sign in to another account, Move or copy notes
// and Help, then Sign out. This draws it from plain rows; the frame fills them from the places it knows (I2).
import SwiftUI

/// A place's picture: an avatar or a workspace's logo (its picture, or its initial on the heading colour), the
/// library's device on a quiet tile, or the + of "New workspace…".
public enum PhonePlaceMark: Sendable, Equatable {
    case avatar(name: String, url: URL?)
    case workspace(name: String, url: URL?)
    case library(WebIcon)
    case newWorkspace
}

/// One row of the account sheet's Places.
public struct PhonePlaceRow: Identifiable, Sendable {
    public var id: String
    public var mark: PhonePlaceMark
    public var label: String
    public var description: String?
    public var detail: String?
    /// Where you are (true), another place (false), or an action (nil: no check column).
    public var checked: Bool?
    /// A workspace under the account above it.
    public var sub: Bool
    public var badge: Int
    public var dot: Bool

    public init(id: String, mark: PhonePlaceMark, label: String, description: String? = nil, detail: String? = nil, checked: Bool? = false, sub: Bool = false, badge: Int = 0, dot: Bool = false) {
        self.id = id
        self.mark = mark
        self.label = label
        self.description = description
        self.detail = detail
        self.checked = checked
        self.sub = sub
        self.badge = badge
        self.dot = dot
    }
}

/// What the sheet does when a row is picked.
public enum PhoneAccountAction: Sendable, Equatable {
    case place(String)
    case settings
    case signInAnother
    case movePlaces
    case help
    case signOut
}

/// The account sheet's content (inside a PhoneSheetPanel titled "Account").
public struct PhoneAccountSheetContent: View {
    let places: [PhonePlaceRow]
    let severalPlaces: Bool
    let otherPlaces: Bool
    let signOutLabel: String
    let pick: (PhoneAccountAction) -> Void
    @Environment(\.colorScheme) private var scheme

    public init(places: [PhonePlaceRow], severalPlaces: Bool, otherPlaces: Bool, signOutLabel: String, pick: @escaping (PhoneAccountAction) -> Void) {
        self.places = places
        self.severalPlaces = severalPlaces
        self.otherPlaces = otherPlaces
        self.signOutLabel = signOutLabel
        self.pick = pick
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            PhoneGroupedSection("Places") {
                ForEach(places) { p in
                    PhonePlaceRowView(row: p) { pick(.place(p.id)) }
                }
            }
            .phoneSheetBlock()
            PhoneGroupedSection {
                PhoneAccountActionRow("Settings", icon: .settings) { pick(.settings) }
                if severalPlaces {
                    PhoneAccountActionRow("Sign in to another account…", icon: .logIn) { pick(.signInAnother) }
                }
                if otherPlaces {
                    PhoneAccountActionRow("Move or copy notes…", icon: .arrowRightLeft) { pick(.movePlaces) }
                }
                PhoneAccountActionRow("Help", icon: .circleQuestionMark) { pick(.help) }
            }
            .phoneSheetBlock()
            PhoneGroupedSection {
                PhoneAccountActionRow(signOutLabel, icon: .logOut, danger: true) { pick(.signOut) }
            }
            .phoneSheetBlock()
        }
        .padding(.top, 8)
        .padding(.bottom, 24)
    }
}

/// An action row of the account sheet: 44 tall, its icon on a tile, the label in Body.
struct PhoneAccountActionRow: View {
    let label: String
    let icon: WebIcon
    let danger: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    init(_ label: String, icon: WebIcon, danger: Bool = false, action: @escaping () -> Void) {
        self.label = label
        self.icon = icon
        self.danger = danger
        self.action = action
    }

    var body: some View {
        let red = FoleviTokens.Chrome.destructive.resolve(scheme).color
        Button(action: action) {
            HStack(spacing: 12) {
                PhoneRowIcon(icon, tone: danger ? red.opacity(0.14) : nil, ink: danger ? red : nil)
                Text(label)
                    .webText(PhoneType.body())
                    .lineLimit(1)
                    .foregroundStyle(danger ? red : FoleviTokens.Chrome.ink.resolve(scheme).color)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.leading, 16)
            .padding(.trailing, 16)
            .frame(minHeight: 44)
        }
        .buttonStyle(PhoneRowPressStyle())
        .phoneSeparatorInset(58)
    }
}

/// A place's row: about 60 tall for an account or the library (its 36 pt picture, the name over the email), 44 for
/// a workspace under its account (64 in); one check column at the end marks where you are.
public struct PhonePlaceRowView: View {
    let row: PhonePlaceRow
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(row: PhonePlaceRow, action: @escaping () -> Void) {
        self.row = row
        self.action = action
    }

    private var place: Bool { !row.sub && row.checked != nil }

    public var body: some View {
        let muted = FoleviTokens.Chrome.inkMuted.resolve(scheme).color
        Button(action: action) {
            HStack(spacing: 12) {
                PhonePlaceMarkView(mark: row.mark, size: place ? 36 : 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.label)
                        .webText(PhoneType.body(weight: place ? FoleviTokens.FontWeight.medium : nil))
                        .lineLimit(1)
                        .foregroundStyle((place ? FoleviTokens.Chrome.heading : FoleviTokens.Chrome.ink).resolve(scheme).color)
                    if let d = row.description {
                        MiddleCutText(text: d, style: PhoneType.subheadline(leading: 18))
                            .foregroundStyle(muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let detail = row.detail {
                    Text(detail).webText(PhoneType.subheadline(leading: 20)).lineLimit(1).foregroundStyle(muted)
                }
                if row.badge > 0 {
                    Text(row.badge > 99 ? "99+" : "\(row.badge)")
                        .webText(WebTextStyle(size: WebTypeRole.caption1.metrics.size, leading: WebTypeRole.caption1.metrics.size, weight: FoleviTokens.FontWeight.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 20, minHeight: 20)
                        .background(FoleviTokens.Chrome.coral.resolve(scheme).color, in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular))
                        .accessibilityHidden(true)
                } else if row.dot {
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.tiny, style: .circular)
                        .fill(FoleviTokens.Chrome.coral.resolve(scheme).color)
                        .frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                }
                if let checked = row.checked {
                    Group {
                        if checked {
                            WebIconView(.check, size: 20, strokeWidth: 2.4)
                                .foregroundStyle(FoleviTokens.Chrome.heading.resolve(scheme).color)
                        }
                    }
                    .frame(width: 20)
                    .accessibilityHidden(true)
                }
            }
            .padding(.leading, row.sub ? 64 : 16)
            .padding(.trailing, 16)
            .padding(.vertical, place ? 8 : 0)
            .frame(minHeight: place ? 60 : 44)
        }
        .buttonStyle(PhoneRowPressStyle())
        .accessibilityAddTraits(row.checked == true ? .isSelected : [])
        .phoneSeparatorInset(row.sub ? 100 : place ? 64 : 58)
    }
}

/// A place's picture (WorkspaceMenu.tsx's Mark): the picture, or the initial in the canvas colour on the heading
/// colour at 46% of the size, round for a person, the chip radius for a workspace.
public struct PhonePlaceMarkView: View {
    let mark: PhonePlaceMark
    let size: CGFloat
    @Environment(\.colorScheme) private var scheme

    public init(mark: PhonePlaceMark, size: CGFloat) {
        self.mark = mark
        self.size = size
    }

    public var body: some View {
        Group {
            switch mark {
            case .avatar(let name, let url):
                picture(name: name, url: url).clipShape(Circle())
            case .workspace(let name, let url):
                picture(name: name, url: url).clipShape(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .circular))
            case .library(let icon):
                WebIconView(icon, size: 20)
                    .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                    .frame(width: 36, height: 36)
                    .background(FoleviTokens.Chrome.ink.resolve(scheme).color.opacity(0.07), in: RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .circular))
            case .newWorkspace:
                WebIconView(.plus, size: 18)
                    .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                    .frame(width: 24, height: 24)
            }
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func picture(name: String, url: URL?) -> some View {
        let letter = String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
        let initial = Text(letter.isEmpty ? "·" : letter)
            .webText(WebTextStyle(size: (size * 0.46).rounded(), leading: size, weight: FoleviTokens.FontWeight.semibold))
            .foregroundStyle(FoleviTokens.Chrome.canvas.resolve(scheme).color)
            .frame(width: size, height: size)
            .background(FoleviTokens.Chrome.heading.resolve(scheme).color)
        if let url {
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFill()
                } else {
                    initial
                }
            }
            .frame(width: size, height: size)
        } else {
            initial
        }
    }
}

/// An email cut in the middle when it doesn't fit: the start shrinks, "@domain" stays.
struct MiddleCutText: View {
    let text: String
    let style: WebTextStyle

    var body: some View {
        let at = text.lastIndex(of: "@").map { text.distance(from: text.startIndex, to: $0) } ?? -1
        let split = at > 0 && text.count - at <= 20 ? at : max(0, text.count - 10)
        let i = text.index(text.startIndex, offsetBy: split)
        HStack(spacing: 0) {
            Text(text[..<i]).webText(style).lineLimit(1).truncationMode(.tail)
            Text(text[i...]).webText(style).lineLimit(1).fixedSize()
        }
    }
}
