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
    @Environment(\.colorScheme) private var scheme

    /// The details (the owner, 2026-11-20: the title, the words and the last sync didn't line up): the state's
    /// mark in its colour with its name and one sentence, centred; then the facts as a grouped list, label left and
    /// value right; then the one button there is, only when there's something to do.
    var body: some View {
        let s = phone.sync.value
        let state = RebuildSync.debugState ?? s?.state ?? .saved
        let pending = RebuildSync.debugState == nil ? (s?.pending ?? 0) : 3
        PhoneSheetPanel(close: close, scrolls: false) {
            VStack(spacing: 22) {
                VStack(spacing: 12) {
                    RebuildSyncIcon(state: state, size: 28)
                        .foregroundStyle(RebuildSync.tone(state))
                        .frame(width: 64, height: 64)
                        .background(Circle().fill(RebuildSync.tone(state).opacity(scheme == .dark ? 0.2 : 0.12)))
                        .accessibilityHidden(true)
                    Text(RebuildSync.title(state))
                        .font(.system(.title2, weight: .semibold))
                        .foregroundStyle(DS.color.heading)
                        .accessibilityIdentifier("sync-state")
                    Text(RebuildSync.describe(s, state: state, pending: pending))
                        .font(.system(.body))
                        .foregroundStyle(DS.color.inkMuted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
                let rows = facts(s, state: state, pending: pending)
                if !rows.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(rows.indices, id: \.self) { i in
                            if i > 0 { Divider().padding(.leading, 16) }
                            HStack {
                                Text(rows[i].label).foregroundStyle(DS.color.ink)
                                Spacer(minLength: 12)
                                Text(rows[i].value).foregroundStyle(DS.color.inkMuted).monospacedDigit().multilineTextAlignment(.trailing)
                            }
                            .font(.system(.callout))
                            .padding(.horizontal, 16)
                            .frame(minHeight: 46)
                        }
                    }
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DS.color.ink.opacity(scheme == .dark ? 0.07 : 0.04)))
                }
                if state != .saved {
                    let offline = state == .offline
                    Button { phone.retrySync() } label: {
                        Label { Text(offline ? "Sync when online" : "Retry now") } icon: { WebIconView(.refreshCw, size: 17, strokeWidth: 2) }
                            .font(.system(.body, weight: .semibold))
                            .foregroundStyle(DS.color.canvas)
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(Capsule().fill(DS.color.heading))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(offline && s?.online != true)
                    .opacity(offline && s?.online != true ? 0.4 : 1)
                    .accessibilityIdentifier("sync-retry")
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
        .accessibilityIdentifier("sync-sheet")
    }

    /// What's known, as label and value: when it last synced, what's waiting, what's still downloading.
    private func facts(_ s: SyncStatusValue?, state: SyncState, pending: Int) -> [(label: String, value: String)] {
        var rows: [(label: String, value: String)] = []
        if let last = RebuildSync.lastSynced(phone) {
            rows.append(("Last synced", last.formatted(.relative(presentation: .named)).capitalizedFirst))
        } else if state == .offline {
            rows.append(("Last synced", "Not yet on this iPhone"))
        }
        if pending > 0 { rows.append(("Waiting to sync", pending == 1 ? "1 change" : "\(pending) changes")) }
        if state == .conflict, let c = s?.conflicts, c > 0 { rows.append(("Edited in two places", c == 1 ? "1 note" : "\(c) notes")) }
        for space in s?.spaces ?? [] where space.state != .ready {
            switch space.state {
            case .downloading: rows.append(("Downloading notes", space.total.map { "\(space.have) of \($0)" } ?? "\(space.have)"))
            case .locked: rows.append(("Library", "Locked on this iPhone"))
            default: rows.append(("Library", "Opening"))
            }
        }
        return rows
    }
}

private extension String {
    /// "3 seconds ago" as "3 seconds ago", "yesterday" as "Yesterday".
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

/// The words, in the web's (SyncStatusTouch.tsx TITLES, describe, label).
@MainActor
enum RebuildSync {
    /// FOLEVI_REBUILD_SYNC=1: Home's signed-in pill (the status and the bell) without an account, for
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
        describe(s, state: s?.state ?? .saved, pending: s?.pending ?? 0)
    }

    static func describe(_ s: SyncStatusValue?, state: SyncState, pending n: Int) -> String {
        guard s != nil || debugState != nil else { return "Starting…" }
        switch state {
        case .saved: return "Every change is saved to Folevi."
        case .saving, .syncing: return n == 1 ? "Sending 1 change." : "Sending \(n) changes."
        case .offline:
            return n > 0
                ? "\(n == 1 ? "1 change is" : "\(n) changes are") saved on this iPhone. \(n == 1 ? "It syncs" : "They sync") when you’re back online."
                : "You’re offline. What you write is saved on this iPhone and syncs when you’re back online."
        case .conflict:
            let conflicts = s?.conflicts ?? 1
            return conflicts == 1
                ? "A change was also edited somewhere else. Open the note to choose which to keep."
                : "\(conflicts) changes were also edited somewhere else. Open the notes to choose which to keep."
        case .error:
            return s?.authRequired == true
                ? "Folevi needs you signed in again to send your changes. They’re kept on this iPhone."
                : "Some changes weren’t accepted by the server. They’re kept on this iPhone: try again, or open the note."
        }
    }

    /// The state's colour: green synced, blue sending, grey offline, orange edited in two places, red not saved.
    static func tone(_ state: SyncState) -> Color {
        switch state {
        case .saved: .green
        case .saving, .syncing: .blue
        case .offline: .secondary
        case .conflict: .orange
        case .error: .red
        }
    }

    /// FOLEVI_REBUILD_SYNC_STATE=offline|syncing|conflict|error: the details as in that state, for checking each one
    /// headlessly. Debug builds only.
    static var debugState: SyncState? {
        #if DEBUG
        switch ProcessInfo.processInfo.environment["FOLEVI_REBUILD_SYNC_STATE"] {
        case "offline": .offline
        case "syncing": .syncing
        case "conflict": .conflict
        case "error": .error
        default: nil
        }
        #else
        nil
        #endif
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
