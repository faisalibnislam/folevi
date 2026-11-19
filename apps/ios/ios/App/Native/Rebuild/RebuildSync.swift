// Sync status on iPhone (the owner, 2026-11-19: the cloud indicator was missing): the web's touch status
// (components/iphone/SyncStatusTouch.tsx) drawn natively. A button in Home's top right pill beside the bell, for a
// library in the cloud, and its details in a sheet. Calm by design: synced is a quiet cloud (a check for a moment
// right after syncing), sending a turning circle, offline a crossed-out cloud with how many changes are on this
// iPhone, changes that need a look a red dot. Never a banner.
import SwiftUI
import FoleviDesign
import FoleviEngine

/// The status button for Home's pill (before the bell).
struct RebuildSyncButton: View {
    let phone: PhoneModel
    let action: () -> Void
    @State private var justSynced = false
    @Environment(\.colorScheme) private var scheme

    private var status: SyncStatusValue? { phone.sync.value }

    var body: some View {
        let state = status?.state ?? .saved
        let pending = status?.pending ?? 0
        WebPillButton(RebuildSync.label(status), action: action) {
            RebuildSyncIcon(state: state, justSynced: justSynced)
                .overlay(alignment: .topTrailing) { badge(state, pending) }
        }
        .accessibilityIdentifier("sync-status-touch")
        .accessibilityValue(RebuildSync.title(state))
        .onChange(of: state) { was, now in
            guard now == .saved, was != .saved else { return }
            RebuildSync.rememberSynced(phone)
            // A check for a moment after changes land, then the quiet cloud again.
            withAnimation(.snappy(duration: 0.25)) { justSynced = true }
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(2.5))
                withAnimation(.snappy(duration: 0.25)) { justSynced = false }
            }
        }
    }

    @ViewBuilder private func badge(_ state: SyncState, _ pending: Int) -> some View {
        let canvas = FoleviTokens.Chrome.canvas.resolve(scheme).color
        if state == .error || state == .conflict {
            Circle().fill(FoleviTokens.Chrome.coral.resolve(scheme).color)
                .frame(width: 10, height: 10)
                .overlay(Circle().stroke(canvas, lineWidth: 2))
                .offset(x: 3, y: -3)
        } else if state == .offline, pending > 0 {
            Text(pending > 99 ? "99+" : "\(pending)")
                .font(.system(size: 11, weight: .bold)).monospacedDigit()
                .foregroundStyle(canvas)
                .padding(.horizontal, 4)
                .frame(minWidth: 18, minHeight: 18)
                .background(Capsule().fill(FoleviTokens.Chrome.heading.resolve(scheme).color))
                .offset(x: 9, y: -7)
        }
    }
}

/// The status's icon (the web's StatusIcon): lucide's cloud, cloud-off, triangle-alert, git-merge, a turning
/// loader-circle while sending, and a check for a moment after syncing.
struct RebuildSyncIcon: View {
    let state: SyncState
    var justSynced = false
    var size: CGFloat = 21

    var body: some View {
        switch state {
        case .offline: WebIconView(.cloudOff, size: size, strokeWidth: 1.9)
        case .error: WebIconView(.triangleAlert, size: size, strokeWidth: 1.9)
        case .conflict: WebIconView(.gitMerge, size: size, strokeWidth: 1.9)
        case .saving, .syncing: RebuildSyncSpinner(size: size)
        case .saved:
            if justSynced {
                WebIconView(.check, size: size, strokeWidth: 2.1).transition(.scale(scale: 0.6).combined(with: .opacity))
            } else {
                WebIconView(.cloud, size: size, strokeWidth: 1.9).transition(.opacity)
            }
        }
    }
}

/// loader-circle turning (`animate-spin`; still under Reduce Motion).
private struct RebuildSyncSpinner: View {
    let size: CGFloat
    @State private var turning = false

    var body: some View {
        WebIconView(.loaderCircle, size: size, strokeWidth: 1.9)
            .rotationEffect(.degrees(turning ? 360 : 0))
            .onAppear {
                guard !WebMotion.reduced else { return }
                withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) { turning = true }
            }
    }
}

/// The details (the web's SyncSheet): what the state means, when it last synced, notes still downloading, and Retry.
struct RebuildSyncSheet: View {
    let phone: PhoneModel
    let close: () -> Void

    var body: some View {
        let s = phone.sync.value
        PhoneSheetPanel(title: RebuildSync.title(s?.state ?? .saved), description: RebuildSync.describe(s), close: close, scrolls: false) {
            VStack(alignment: .leading, spacing: 20) {
                if let last = RebuildSync.lastSynced(phone) {
                    Text("Last synced \(last.formatted(.relative(presentation: .named))).")
                        .foleviFont(.callout).foregroundStyle(DS.color.inkMuted)
                } else if s?.online == false {
                    Text("Not synced yet on this iPhone.")
                        .foleviFont(.callout).foregroundStyle(DS.color.inkMuted)
                }
                ForEach(s?.spaces.filter { $0.state != .ready } ?? [], id: \.space) { space in
                    HStack {
                        Text(space.state == .downloading ? "Downloading notes" : space.state == .locked ? "Locked on this iPhone" : "Opening")
                        Spacer()
                        if let total = space.total { Text("\(space.have) of \(total)").monospacedDigit() }
                    }
                    .foleviFont(.callout).foregroundStyle(DS.color.inkMuted)
                }
                if let s, s.state != .saved {
                    WebButton(s.state == .offline ? "Sync when online" : "Retry now", icon: .refreshCw, iconSize: 17, variant: .primary) {
                        phone.retrySync()
                    }
                    .frame(maxWidth: .infinity)
                    .disabled(s.state == .offline && !s.online)
                    .accessibilityIdentifier("sync-retry")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .accessibilityIdentifier("sync-sheet")
    }
}

/// The words, in the web's (SyncStatusTouch.tsx TITLES, describe, label).
@MainActor
enum RebuildSync {
    /// FOLEVI_REBUILD_SYNC=1: the status on Home without an account (a local library has nothing to sync), for
    /// checking it headlessly. Debug builds only.
    static var debugShown: Bool {
        #if DEBUG
        ProcessInfo.processInfo.environment["FOLEVI_REBUILD_SYNC"] == "1"
        #else
        false
        #endif
    }

    static func title(_ state: SyncState) -> String {
        switch state {
        case .saved: "Synced"
        case .saving, .syncing: "Syncing"
        case .offline: "Waiting to sync"
        case .conflict: "Edited in two places"
        case .error: "Not saved"
        }
    }

    static func label(_ s: SyncStatusValue?) -> String {
        let pending = s?.pending ?? 0
        let changes = pending == 0 ? "" : pending == 1 ? ", 1 change on this iPhone" : ", \(pending) changes on this iPhone"
        return "Sync status: \(title(s?.state ?? .saved))\(changes)"
    }

    static func describe(_ s: SyncStatusValue?) -> String {
        guard let s else { return "Starting…" }
        let n = s.pending
        switch s.state {
        case .saved: return "Every change is saved to Folevi."
        case .saving, .syncing: return n == 1 ? "Sending 1 change." : "Sending \(n) changes."
        case .offline:
            return n > 0
                ? "\(n == 1 ? "1 change is" : "\(n) changes are") saved on this iPhone. \(n == 1 ? "It syncs" : "They sync") when you’re back online."
                : "You’re offline. What you write is saved on this iPhone and syncs when you’re back online."
        case .conflict:
            return s.conflicts == 1
                ? "A change was also edited somewhere else. Open the note to choose which to keep."
                : "\(s.conflicts) changes were also edited somewhere else. Open the notes to choose which to keep."
        case .error:
            return s.authRequired
                ? "Folevi needs you signed in again to send your changes. They’re kept on this iPhone."
                : "Some changes weren’t accepted by the server. They’re kept on this iPhone: try again, or open the note."
        }
    }

    /// When everything last reached the server, kept per account on this iPhone.
    private static func key(_ phone: PhoneModel) -> String { "folevi.lastSynced.\(phone.session.value?.profile.id ?? "")" }

    static func rememberSynced(_ phone: PhoneModel) {
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: key(phone))
    }

    static func lastSynced(_ phone: PhoneModel) -> Date? {
        let t = UserDefaults.standard.double(forKey: key(phone))
        return t > 0 ? Date(timeIntervalSince1970: t) : nil
    }
}
