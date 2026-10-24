// Native sheets (plan 6.2): UISheetPresentationController with the medium and large detents, a grabber and the
// sheet radius (28), for the account and places switcher, notifications, Foli AI and the sync details. Later
// packages fill them (N11 the account and notifications, N12 the Foli AI chat); the frame only presents them.
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine
import FoleviScreens

@MainActor
enum PhoneSheets {
    /// Presents `content` as a sheet from the topmost controller over `from`.
    static func present<V: View>(_ content: V, from: UIViewController, id: String, detents: [UISheetPresentationController.Detent] = [.medium(), .large()]) {
        var top = from
        while let p = top.presentedViewController { top = p }
        let host = UIHostingController(rootView: content.environment(\.font, FoleviFonts.font(.ui, size: 17)))
        host.view.backgroundColor = Chrome.canvas
        host.view.accessibilityIdentifier = id
        host.modalPresentationStyle = .pageSheet
        if let sheet = host.sheetPresentationController {
            sheet.detents = detents
            sheet.prefersGrabberVisible = true
            sheet.preferredCornerRadius = FoleviTokens.Radius.sheet
            sheet.prefersScrollingExpandsWhenScrolledToEdge = true
        }
        top.present(host, animated: true)
    }
}

/// A sheet's heading row: the title in Spectral and a close button (44 pt).
private struct SheetHeader: View {
    let title: String
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        HStack {
            Text(title).foleviFont(.title2).foregroundStyle(DS.color.heading)
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(DS.color.inkMuted)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
            .accessibilityIdentifier("sheet-close")
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .padding(.top, 14)
    }
}

// MARK: - Account and places (N11 fills in the rest)

struct AccountSheet: View {
    let phone: PhoneModel
    let switchTo: (String) -> Void
    let addAccount: () -> Void
    let signOut: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SheetHeader(title: "Account")
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let p = phone.session.value?.profile {
                        HStack(spacing: 12) {
                            Avatar(name: p.name.isEmpty ? p.email : p.name, size: 48).clipShape(Circle())
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name.isEmpty ? "Folevi" : p.name).foleviFont(.headline).foregroundStyle(DS.color.heading)
                                if !p.email.isEmpty { Text(p.email).foleviFont(.callout).foregroundStyle(DS.color.inkMuted) }
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("account-profile")
                    }
                    if let places = phone.places.value, !places.places.isEmpty {
                        Text("Places on this iPhone").foleviFont(.caption).foregroundStyle(DS.color.inkFaint).textCase(.uppercase)
                        VStack(spacing: 0) {
                            ForEach(places.places, id: \.id) { place in
                                Button { if place.id != places.current { switchTo(place.id) } } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: place.kind == .library ? "internaldrive" : "person.crop.circle")
                                            .font(.system(size: 18)).foregroundStyle(DS.color.inkMuted).frame(width: 28)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(place.name).foleviFont(.body).foregroundStyle(DS.color.heading)
                                            if let email = place.email { Text(email).foleviFont(.caption).foregroundStyle(DS.color.inkMuted) }
                                        }
                                        Spacer()
                                        if place.id == places.current { Image(systemName: "checkmark").foregroundStyle(DS.color.heading) }
                                    }
                                    .padding(.vertical, 10)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("account-place-\(place.id)")
                            }
                        }
                    }
                    Button(action: addAccount) {
                        Label("Add an account", systemImage: "plus").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(FoleviButtonStyle(.secondary, fullWidth: true))
                    .accessibilityIdentifier("account-add")
                    if let current = phone.places.value?.current, current.hasPrefix("acct:") {
                        Button(role: .destructive) { signOut(current) } label: {
                            Text("Sign out").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(FoleviButtonStyle(.secondary, fullWidth: true))
                        .accessibilityIdentifier("account-sign-out")
                    }
                    Text("Settings, workspaces and the rest of your account come to this sheet with the next update.")
                        .foleviFont(.caption).foregroundStyle(DS.color.inkFaint)
                }
                .padding(20)
            }
        }
        .background(DS.color.canvas)
    }
}

// MARK: - Notifications (N11 replaces it with the full screen)

struct NotificationsSheet: View {
    let store: ValueStore<NotificationsValue>
    let markAllRead: () -> Void
    let open: (NotificationRow) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                SheetHeader(title: "Notifications")
            }
            if let v = store.value {
                if v.rows.isEmpty {
                    EmptyState(systemImage: "bell", title: "No notifications", message: "Mentions, comments and invitations show up here.")
                        .padding(.top, 40)
                    Spacer()
                } else {
                    if v.unread > 0 {
                        Button("Mark all as read", action: markAllRead)
                            .foleviFont(.button)
                            .foregroundStyle(DS.color.heading)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .padding(.horizontal, 20)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("notifications-read-all")
                    }
                    List(v.rows, id: \.id) { row in
                        Button { open(row) } label: {
                            HStack(alignment: .top, spacing: 10) {
                                Circle().fill(row.read ? Color.clear : DS.color.ember).frame(width: 8, height: 8).padding(.top, 7)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(row.title).foleviFont(.body).foregroundStyle(DS.color.heading).lineLimit(2)
                                    if !row.body.isEmpty { Text(row.body).foleviFont(.callout).foregroundStyle(DS.color.inkMuted).lineLimit(2) }
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        .listRowBackground(DS.color.canvas)
                    }
                    .listStyle(.plain)
                }
            } else {
                ProgressView().padding(.top, 40)
                Spacer()
            }
        }
        .background(DS.color.canvas)
        .onDisappear { store.cancel() }
    }
}

// MARK: - Foli AI (N12 replaces it with the chat)

struct FoliAISheet: View {
    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: "Foli AI")
            Spacer()
            EmptyState(systemImage: "sparkle", title: "Ask Foli AI", message: "The Foli AI chat arrives here with the next update. In a note, the Foli AI button asks about that note.")
            Spacer()
        }
        .background(DS.color.canvas)
        .accessibilityIdentifier("foli-sheet")
    }
}

// MARK: - Sync details

struct SyncSheet: View {
    let phone: PhoneModel
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SheetHeader(title: "Sync")
            VStack(alignment: .leading, spacing: 14) {
                if let s = phone.sync.value {
                    HStack(spacing: 10) {
                        SyncStatusView(CardMapping.sync(s), showsLabel: true)
                        Spacer()
                    }
                    .accessibilityIdentifier("sync-state")
                    detail(s)
                    ForEach(s.spaces, id: \.space) { space in
                        if space.state != .ready {
                            HStack {
                                Text(space.state == .downloading ? "Downloading notes" : space.state == .locked ? "Locked on this device" : "Opening")
                                Spacer()
                                if let total = space.total { Text("\(space.have) of \(total)").monospacedDigit() }
                            }
                            .foleviFont(.callout).foregroundStyle(DS.color.inkMuted)
                        }
                    }
                    if s.state != .saved || s.pending > 0 {
                        Button { phone.retrySync() } label: { Text("Retry now").frame(maxWidth: .infinity) }
                            .buttonStyle(FoleviButtonStyle(.primary, fullWidth: true))
                            .accessibilityIdentifier("sync-retry")
                    }
                } else {
                    Text("Starting…").foleviFont(.body).foregroundStyle(DS.color.inkMuted)
                }
            }
            .padding(20)
            Spacer()
        }
        .background(DS.color.canvas)
    }

    @ViewBuilder private func detail(_ s: SyncStatusValue) -> some View {
        let text: String = {
            if s.authRequired { return "Sign in again to send your changes to Folevi." }
            switch s.state {
            case .saved: return s.pending == 0 ? "Everything on this iPhone is saved to Folevi." : "\(s.pending) changes are waiting to be sent."
            case .saving, .syncing: return "Sending your changes to Folevi."
            case .offline: return s.pending == 0 ? "You're offline. Changes you make are kept on this iPhone and sent when you're back online." : "You're offline. \(s.pending) \(s.pending == 1 ? "change is" : "changes are") kept on this iPhone until you're back online."
            case .conflict: return "\(s.conflicts) \(s.conflicts == 1 ? "note has" : "notes have") changes from two places. Open \(s.conflicts == 1 ? "it" : "them") to choose what to keep."
            case .error: return "Folevi couldn't send your changes. They're kept on this iPhone."
            }
        }()
        Text(text).foleviFont(.body).foregroundStyle(DS.color.ink).fixedSize(horizontal: false, vertical: true)
    }
}
