// Notifications on the iPhone, the bell's medium sheet as the web draws it (apps/web/src/components/app/
// NotificationsButton.tsx NotificationPanel, `phone`): All or Unread, Mark all read and Settings, then Today,
// Yesterday and Earlier; each row the person's avatar with what kind it is in a badge, the sentence (who did what
// where), when, and any invitation's buttons. Rows swipe (Read or Unread, Remove) and hold their menu. From
// FoleviScreens' NotificationsModel.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

public struct PhoneNotificationsContent: View {
    @Bindable var model: NotificationsModel
    let open: (ScreenIntent) -> Void
    let settings: () -> Void
    let rowMenu: (NotificationRow, CGRect) -> Void
    @State private var swipes = PhoneSwipeState()
    @Environment(\.colorScheme) private var scheme

    public init(model: NotificationsModel, open: @escaping (ScreenIntent) -> Void, settings: @escaping () -> Void, rowMenu: @escaping (NotificationRow, CGRect) -> Void) {
        self.model = model
        self.open = open
        self.settings = settings
        self.rowMenu = rowMenu
    }

    private var groups: [(label: String, rows: [NotificationRow])] {
        let cal = Calendar.current
        let today = cal.startOfDay(for: ScreenClock.now()).timeIntervalSince1970 * 1000
        let day = 86_400_000.0
        let rows = model.rows
        return [
            ("Today", rows.filter { $0.at >= today }),
            ("Yesterday", rows.filter { $0.at < today && $0.at >= today - day }),
            ("Earlier", rows.filter { $0.at < today - day }),
        ].filter { !$0.1.isEmpty }
    }

    public var body: some View {
        let unread = model.unread
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                PhoneSegmented([("all", "All"), ("unread", unread > 0 ? "Unread · \(unread > 99 ? "99+" : String(unread))" : "Unread")], selection: Binding(get: { model.filter.rawValue }, set: { model.filter = NotificationsFilter(rawValue: $0) ?? .all }), accessibility: "Show")
                    .frame(width: 164)
                Spacer(minLength: 0)
                // Mark all read: a 44 pt text button, readable while there's something to mark.
                Button { Task { await model.markAllRead() } } label: {
                    HStack(spacing: 6) {
                        WebIconView(.check, size: 18)
                        Text("Mark all read").webText(WebTextStyle(size: 15, leading: 20, weight: 500)).lineLimit(1)
                    }
                    .foregroundStyle((unread > 0 ? FoleviTokens.Chrome.heading : FoleviTokens.Chrome.inkMuted).resolve(scheme).color)
                    .padding(.horizontal, 14)
                    .frame(height: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PhoneRowPressStyle())
                .disabled(unread == 0)
                .opacity(unread == 0 ? 0.5 : 1)
                PhoneSheetButton("Notification settings", action: settings) { WebIconView(.settings, size: 20) }
            }
            .padding(.leading, 16)
            .padding(.trailing, 8)
            .padding(.bottom, 8)
            FoleviTokens.Chrome.line.resolve(scheme).opacity(0.7).color.frame(height: 1)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if model.isLoading {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 24)
                    } else if groups.isEmpty {
                        PhoneScreenEmpty(icon: .bellOff, title: model.filter == .unread && !(model.rows.isEmpty) ? "No unread notifications" : "You’re all caught up", message: "Comments, replies, @mentions and pages shared with you show up here.")
                    } else {
                        ForEach(groups, id: \.label) { g in
                            Text(g.label.uppercased())
                                .webText(WebTextStyle(size: 12, leading: 16, weight: 600, letterSpacing: 0.48))
                                .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
                                .padding(.horizontal, 20)
                                .padding(.top, 16)
                                .padding(.bottom, 6)
                                .accessibilityAddTraits(.isHeader)
                            ForEach(g.rows, id: \.id) { n in row(n) }
                        }
                    }
                }
                .padding(.bottom, 8)
            }
            .background(FoleviTokens.Chrome.canvas.resolve(scheme).color)
        }
        .onAppear { model.setVisible(true) }
        .onDisappear { model.setVisible(false) }
    }

    private func row(_ raw: NotificationRow) -> some View {
        let n = model.row(raw)
        let toggle = PhoneSwipeAction(n.read ? "Unread" : "Read", icon: n.read ? .circleDot : .check, tone: RGBA(0x5b, 0x6a, 0xd0)) { Task { await model.toggleRead(raw) } }
        let remove = PhoneSwipeAction("Remove", icon: .trash, tone: RGBA(0xd6, 0x45, 0x3d), danger: true) { Task { await model.remove(raw) } }
        return PhoneSwipeRow(id: n.id, leading: [toggle], trailing: [remove], state: swipes) {
            PhoneNotificationRow(row: n, invite: model.inviteKind(raw) != nil, accept: {
                Task { if let i = await model.accept(raw) { open(i) } }
            }, decline: { Task { await model.decline(raw) } })
            .background(FoleviTokens.Chrome.canvas.resolve(scheme).color)
            .modifier(PhoneRowTap(onTap: { Task { if let i = await model.tap(raw) { open(i) } } }, onLongPress: { rowMenu(raw, $0) }))
        }
    }
}

/// A tap and a long press with the row's frame (as PhonePressable, for content that isn't a ViewBuilder closure).
struct PhoneRowTap: ViewModifier {
    let onTap: () -> Void
    let onLongPress: (CGRect) -> Void
    @State private var frame: CGRect = .zero
    @State private var pressed = false
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content
            .overlay { if pressed { (WebStyles.vars["liquid-press"]?.resolve(scheme).color ?? Color.black.opacity(0.06)).allowsHitTesting(false) } }
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
            .onTapGesture(perform: onTap)
            .onLongPressGesture(minimumDuration: 0.45) { onLongPress(frame) } onPressingChanged: { pressed = $0 }
            .accessibilityAction(named: "More actions") { onLongPress(frame) }
    }
}

/// One notification: the avatar (36, with what kind it is in a 16 pt badge) or a bell tile, the sentence in
/// Subheadline (unread in the ink, read muted), when, and an invitation's Accept and Decline.
struct PhoneNotificationRow: View {
    let row: NotificationRow
    let invite: Bool
    let accept: () -> Void
    let decline: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let muted = FoleviTokens.Chrome.inkMuted.resolve(scheme)
        let heading = FoleviTokens.Chrome.heading.resolve(scheme)
        HStack(alignment: .top, spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                if let name = row.actorName {
                    PhoneAvatar(name: name, url: row.actorAvatarUrl, size: 36)
                    WebIconView(Self.kindIcon(row.kind), size: 9.5, strokeWidth: 2.4)
                        .foregroundStyle(muted.color)
                        .frame(width: 16, height: 16)
                        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(FoleviTokens.Chrome.surfaceRaised.resolve(scheme).color))
                        .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).stroke(FoleviTokens.Chrome.surfaceRaised.resolve(scheme).color, lineWidth: 1.5))
                        .offset(x: 4, y: 2)
                } else {
                    WebIconView(.bell, size: 17).foregroundStyle(muted.color)
                        .frame(width: 36, height: 36)
                        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip).fill(FoleviTokens.Chrome.surfaceSunken.resolve(scheme).color))
                }
            }
            .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(sentence(heading: heading)).webText(WebTextStyle(size: 15, leading: 20))
                    .foregroundStyle((row.read ? muted : FoleviTokens.Chrome.ink.resolve(scheme)).color)
                if !row.body.isEmpty {
                    Text(row.body).webText(WebTextStyle(size: 15, leading: 20)).lineLimit(2).foregroundStyle(muted.color)
                }
                Text(Self.relative(row.at)).webText(WebTextStyle(size: 13, leading: 18)).foregroundStyle(FoleviTokens.Chrome.inkFaint.resolve(scheme).color)
                if invite {
                    HStack(spacing: 8) {
                        WebButton("Accept", variant: .primary, size: .sm, action: accept)
                        WebButton("Decline", variant: .secondary, size: .sm, action: decline)
                    }
                    .padding(.top, 6)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !row.read {
                Circle().fill(RGBA(0x5b, 0x6a, 0xd0).color).frame(width: 8, height: 8).padding(.top, 8).accessibilityLabel("Unread")
            }
        }
        .padding(.vertical, 12)
        .padding(.leading, 20)
        .padding(.trailing, 36)
        .contentShape(Rectangle())
    }

    /// Who did what where, the person in semibold and the note in medium (Sentence).
    private func sentence(heading: RGBA) -> AttributedString {
        guard let who = row.actorName, let note = row.noteTitle, !note.isEmpty else { return AttributedString(row.title) }
        var w = AttributedString(who)
        w.font = Font(WebTextStyle(size: 15, leading: 20, weight: 600).ctFont)
        w.foregroundColor = heading.color
        var d = AttributedString(note)
        d.font = Font(WebTextStyle(size: 15, leading: 20, weight: 500).ctFont)
        d.foregroundColor = heading.color
        let verb: String
        switch row.kind {
        case "comment": verb = row.count > 1 ? " left \(row.count) comments on " : " commented on "
        case "reply": verb = row.count > 1 ? " replied \(row.count) times in " : " replied in "
        case "mention": verb = " mentioned you in "
        case "share": return w + AttributedString(" shared ") + d + AttributedString(" with you")
        default: return AttributedString(row.title)
        }
        return w + AttributedString(verb) + d
    }

    static func kindIcon(_ kind: String) -> WebIcon {
        switch kind {
        case "comment", "reply": .messageSquare
        case "mention": .atSign
        case "share": .share2
        case "invite": .userPlus
        case "share_change": .keyRound
        default: .fileText
        }
    }

    static func relative(_ ms: Double) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .full
        return f.localizedString(for: Date(timeIntervalSince1970: ms / 1000), relativeTo: ScreenClock.now())
    }
}
#endif
