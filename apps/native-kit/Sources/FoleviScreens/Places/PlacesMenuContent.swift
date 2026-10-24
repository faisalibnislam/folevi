// The account and place switcher's content (the account menu redesign, Slack and Notion style; web
// iphone/AccountSheet.tsx). The frames own the container: a sheet from Home's avatar on iPhone, a popover from the
// sidebar's account button on iPad and Mac. Places first, each account with its workspaces under it and one check
// column at the end; then New workspace, Settings, Sign in to another account, Move or copy notes, Help; then Sign
// out, which warns about changes that haven't synced.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct PlacesMenuContent: View {
    @Bindable var model: PlacesModel
    let phone: Bool
    private let send = IntentSender()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: PlacesModel, phone: Bool = true) {
        self.model = model
        self.phone = phone
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: phone ? 22 : 12) {
                group(title: "Places") {
                    ForEach(Array(model.items.enumerated()), id: \.element.id) { i, item in
                        if i > 0 { RowDivider(leadingInset: item.nested ? 58 : 62) }
                        placeRow(item)
                    }
                    if model.canCreateWorkspace {
                        RowDivider(leadingInset: 58)
                        actionRow("plus", "New workspace…", nested: true, id: "places-new-workspace") { send(.dismiss); send(.newWorkspace) }
                    }
                }
                group(title: nil) {
                    actionRow("gearshape", "Settings", id: "places-settings") { send(.dismiss); send(.openSettings(section: nil)) }
                    if model.offersAnotherAccount && !model.isLocal {
                        RowDivider(leadingInset: 50)
                        actionRow("person.crop.circle.badge.plus", "Sign in to another account…", id: "places-sign-in") { send(.dismiss); send(.signInAnotherAccount) }
                    }
                    if model.offersMove {
                        RowDivider(leadingInset: 50)
                        actionRow("arrow.left.arrow.right", "Move or copy notes…", id: "places-move") { send(.dismiss); send(.moveOrCopy) }
                    }
                    RowDivider(leadingInset: 50)
                    actionRow("questionmark.circle", "Help", id: "places-help") { send(.dismiss); send(.help) }
                }
                group(title: nil) {
                    Button { model.confirmingSignOut = true } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "rectangle.portrait.and.arrow.right").font(.system(size: 15, weight: .medium)).foregroundStyle(Folevi.color.destructive)
                                .frame(width: 28, height: 28)
                                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.small).fill(Folevi.color.destructiveSoft))
                            Text(model.signOutTitle).foleviFont(.body).foregroundStyle(Folevi.color.destructive).lineLimit(1)
                            Spacer(minLength: 0)
                            if model.unsynced > 0 {
                                Text("\(model.unsynced) not synced").foleviFont(.footnote).foregroundStyle(Folevi.color.warning)
                            }
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 48)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("places-sign-out")
                }
            }
            .padding(.horizontal, phone ? 16 : 10)
            .padding(.vertical, phone ? 12 : 10)
        }
        .background(phone ? Folevi.color.canvas : Color.clear)
        .confirmationDialog(model.signOutTitle + "?", isPresented: $model.confirmingSignOut, titleVisibility: .visible) {
            Button(model.signOutAction, role: .destructive) {
                send(.dismiss)
                send(.signOut(place: model.places.value?.current ?? model.client.place))
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(model.signOutMessage)
        }
        .onChange(of: model.session.value?.space) { _, _ in model.settle() }
        .accessibilityIdentifier("places-content")
    }

    private func group<C: View>(title: String?, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title { Text(title).foleviFont(.caps).foregroundStyle(Folevi.color.inkFaint).padding(.leading, 12) }
            VStack(spacing: 0) { content() }
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).fill(phone ? Folevi.color.surface : Folevi.color.ink.opacity(0.03)))
                .overlay(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).strokeBorder(Folevi.color.line, lineWidth: phone ? 0 : 1))
        }
    }

    private func placeRow(_ item: PlaceItem) -> some View {
        Button {
            Task {
                if let intent = await model.choose(item) {
                    if case .dismiss = intent {
                        try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 180))
                        send(.dismiss)
                    } else {
                        send(intent)
                    }
                }
            }
        } label: {
            HStack(spacing: 12) {
                mark(item).padding(.leading, item.nested ? 8 : 0)
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.title).foleviFont(item.nested ? .body : .bodyStrong).foregroundStyle(Folevi.color.ink).lineLimit(1)
                    if let sub = item.subtitle { Text(sub).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).lineLimit(1).truncationMode(.middle) }
                }
                Spacer(minLength: 6)
                if item.unread > 0 { Badge(count: item.unread) }
                if item.dot { SignalDot() }
                if let d = item.detail { Text(d).foleviFont(.footnote).foregroundStyle(Folevi.color.inkFaint) }
                Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Folevi.color.heading)
                    .opacity(item.checked ? 1 : 0)
                    .frame(width: 18)
                    .animation(reduceMotion ? nil : .folevi(), value: item.checked)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: item.nested ? 44 : 60)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel([item.title, item.subtitle, item.detail].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(item.checked ? [.isSelected, .isButton] : .isButton)
        .accessibilityIdentifier("place-\(item.id)")
    }

    @ViewBuilder private func mark(_ item: PlaceItem) -> some View {
        switch item.kind {
        case .personal, .otherAccount(_, nil):
            Avatar(name: item.avatarName.isEmpty ? "Folevi" : item.avatarName, size: 36)
        case .workspace, .otherAccount:
            Text(String(item.title.prefix(1)).uppercased())
                .foleviFont(.footnote).fontWeight(.semibold)
                .foregroundStyle(Folevi.color.canvas)
                .frame(width: 26, height: 26)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous).fill(Folevi.color.heading.opacity(0.85)))
        case .library:
            Image(systemName: "internaldrive").font(.system(size: 17)).foregroundStyle(Folevi.color.inkMuted)
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous).fill(Folevi.color.ink.opacity(0.07)))
        }
    }

    private func actionRow(_ symbol: String, _ title: String, nested: Bool = false, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol).font(.system(size: 15, weight: .medium)).foregroundStyle(Folevi.color.inkMuted)
                    .frame(width: 28, height: 28)
                    .padding(.leading, nested ? 8 : 0)
                Text(title).foleviFont(.body).foregroundStyle(Folevi.color.ink).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 46)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }
}
