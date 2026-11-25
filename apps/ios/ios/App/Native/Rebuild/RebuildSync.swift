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
                // (The web's tone: red when something needs a look, muted when saved, the heading otherwise.)
                .foregroundStyle(state == .error || state == .conflict ? DS.color.destructive : state == .saved ? DS.color.inkMuted : DS.color.heading)
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
    var strokeWidth: CGFloat = 1.9
    @State private var turning = false

    var body: some View {
        WebIconView(.loaderCircle, size: size, strokeWidth: strokeWidth)
            .rotationEffect(.degrees(turning ? 360 : 0))
            .onAppear {
                guard !WebMotion.reduced else { return }
                withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) { turning = true }
            }
    }
}

/// The details (the web's SyncSheet, redesigned 2026-11-25): the status as a hero (its mark on a tinted disc, the
/// state's name and one sentence), the facts on one card (Last synced, kept current while open; what's waiting on
/// this iPhone; the connection; where it's saved), anything still downloading, then Try again now when it helps.
/// iOS's own sheet (fitted detent, its grabber) with Close as a glass button in the header.
struct RebuildSyncSheet: View {
    let phone: PhoneModel
    let close: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let s = phone.sync.value
        let state = RebuildSync.debugState ?? s?.state ?? .saved
        let pending = RebuildSync.debugState == nil ? (s?.pending ?? 0) : (state == .saved ? 0 : 3)
        let online = RebuildSync.debugState == .offline ? false : (s?.online ?? true)
        let local = phone.session.value?.mode == .local
        let tone = RebuildSync.tone(state)
        PhoneSheetPanel(close: close) {
            VStack(spacing: 24) {
                VStack(spacing: 12) {
                    RebuildSyncHeroIcon(state: state)
                        .foregroundStyle(tone.icon)
                        .frame(width: 64, height: 64)
                        .background(Circle().fill(tone.disc))
                        .accessibilityHidden(true)
                    VStack(spacing: 4) {
                        Text(RebuildSync.title(state))
                            .webText(.role(.title2, weight: FoleviTokens.FontWeight.semibold))
                            .foregroundStyle(DS.color.heading)
                            .accessibilityAddTraits(.isHeader)
                            .accessibilityIdentifier("sync-state")
                        Text(RebuildSync.describe(s, state: state, pending: pending, local: local))
                            .webText(.role(.body))
                            .foregroundStyle(DS.color.inkMuted)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 300)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity)
                // "1 min ago", kept current while the sheet is open (the web's useAge: every 15 seconds).
                TimelineView(.periodic(from: .now, by: 15)) { context in
                    RebuildSyncFacts(rows: facts(s, state: state, pending: pending, online: online, local: local, now: context.date))
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Sync details")
                if state != .saved {
                    let offline = state == .offline
                    Button { phone.retrySync() } label: {
                        Label { Text(offline ? "Syncs when you\u{2019}re online" : "Try again now") } icon: { WebIconView(.refreshCw, size: 17, strokeWidth: 2) }
                            .webText(.role(.headline, weight: FoleviTokens.FontWeight.semibold))
                            .foregroundStyle(DS.color.canvas)
                            .frame(maxWidth: .infinity)
                            .frame(height: 38)
                    }
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .tint(DS.color.heading)
                    .disabled(offline && !online)
                    .accessibilityIdentifier("sync-retry")
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
        .accessibilityIdentifier("sync-sheet")
        .accessibilityValue(state.rawValue)
    }

    /// The facts, as the web's: Last synced, Waiting on this device, Connection, Saved to (Library in local mode),
    /// then what the engine says is still downloading or locked.
    private func facts(_ s: SyncStatusValue?, state: SyncState, pending: Int, online: Bool, local: Bool, now: Date) -> [RebuildSyncFacts.Row] {
        var rows: [RebuildSyncFacts.Row] = []
        let last = RebuildSync.lastSynced(phone).map { RebuildSync.age($0, now: max(now, $0)) }
        rows.append(.init(label: "Last synced", value: last ?? (state == .saved ? "Up to date" : "Not yet on this iPhone")))
        rows.append(.init(label: "Waiting on this iPhone", value: pending == 0 ? "Nothing" : pending == 1 ? "1 change" : "\(pending) changes", strong: pending > 0))
        rows.append(.init(label: "Connection", value: online ? "Online" : "Offline"))
        rows.append(.init(label: local ? "Library" : "Saved to", value: local ? "On your devices" : "Folevi"))
        for space in s?.spaces ?? [] where space.state != .ready {
            switch space.state {
            case .downloading: rows.append(.init(label: "Downloading notes", value: space.total.map { "\(space.have) of \($0)" } ?? "\(space.have)"))
            case .locked: rows.append(.init(label: "Library", value: "Locked on this iPhone"))
            default: rows.append(.init(label: "Library", value: "Opening"))
            }
        }
        return rows
    }
}

/// The facts card (the web's ui-grouped list of Fact rows): label left, value right, hairlines between.
struct RebuildSyncFacts: View {
    struct Row: Hashable {
        let label: String
        let value: String
        var strong = false
    }
    let rows: [Row]
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { i, row in
                if i > 0 { Rectangle().fill(DS.color.line).frame(height: 1 / 3).padding(.leading, 16) }
                HStack(spacing: 12) {
                    Text(row.label).foregroundStyle(DS.color.ink)
                    Spacer(minLength: 0)
                    Text(row.value)
                        .foregroundStyle(row.strong ? DS.color.heading : DS.color.inkMuted)
                        .fontWeight(row.strong ? .semibold : nil)
                        .monospacedDigit()
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .webText(.role(.body))
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(minHeight: 44)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("sync-fact-\(i)")
            }
        }
        .background(RoundedRectangle(cornerRadius: 26, style: .continuous).fill(DS.color.ink.opacity(scheme == .dark ? 0.08 : 0.045)))
    }
}

/// The hero's mark (the web's HeroIcon): cloud-check synced, cloud-off offline, git-merge conflict, cloud-alert
/// not saved, a turning loader while sending.
struct RebuildSyncHeroIcon: View {
    let state: SyncState

    var body: some View {
        switch state {
        case .saved: WebIconView(.cloudCheck, size: 30, strokeWidth: 1.8)
        case .offline: WebIconView(.cloudOff, size: 30, strokeWidth: 1.8)
        case .conflict: WebIconView(.gitMerge, size: 30, strokeWidth: 1.8)
        case .error: WebIconView(.cloudAlert, size: 30, strokeWidth: 1.8)
        case .saving, .syncing: RebuildSyncSpinner(size: 30, strokeWidth: 1.8)
        }
    }
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

    /// The same words as the web and Mac's cloud button (SYNC_LABELS; the owner, 2026-11-25: one set on every screen).
    static func title(_ state: SyncState) -> String {
        switch state {
        case .saved: "Saved"
        case .saving: "Saving\u{2026}"
        case .syncing: "Syncing\u{2026}"
        case .offline: "Offline"
        case .conflict: "Conflict"
        case .error: "Not saved"
        }
    }

    /// Read out as the web's button: "Sync status: Offline, 2 changes waiting".
    static func label(_ s: SyncStatusValue?) -> String {
        let pending = s?.pending ?? 0
        let changes = pending == 0 ? "" : pending == 1 ? ", 1 change waiting" : ", \(pending) changes waiting"
        return "Sync status: \(title(s?.state ?? .saved))\(changes)"
    }

    static func describe(_ s: SyncStatusValue?, state: SyncState, pending n: Int, local: Bool = false) -> String {
        guard s != nil || debugState != nil else { return "Starting\u{2026}" }
        switch state {
        case .saved: return local ? "Every change is saved in your library." : "Every change is saved to Folevi."
        case .saving, .syncing: return n == 1 ? "Sending 1 change." : n > 0 ? "Sending \(n) changes." : "Sending your latest changes."
        case .offline:
            return n > 0
                ? "\(n == 1 ? "1 change is" : "\(n) changes are") kept on this iPhone until you\u{2019}re back online."
                : "What you write is kept on this iPhone and syncs when you\u{2019}re back online."
        case .conflict:
            let c = max(1, s?.conflicts ?? 1)
            return c == 1
                ? "A note was also edited somewhere else. Open it to choose which version to keep."
                : "\(c) notes were also edited somewhere else. Open them to choose which version to keep."
        case .error:
            return s?.authRequired == true
                ? "Sign in again to send your changes. They\u{2019}re kept on this iPhone."
                : "Some changes weren\u{2019}t accepted. They\u{2019}re kept on this iPhone, so you can try again."
        }
    }

    /// The status's colours (the web's toneOf): calm green when all is saved, red when something needs a look,
    /// neutral otherwise.
    static func tone(_ state: SyncState) -> (disc: Color, icon: Color) {
        switch state {
        case .saved: (DS.color.success.opacity(0.14), DS.color.success)
        case .error, .conflict: (DS.color.destructiveSoft, DS.color.destructive)
        case .offline: (DS.color.surfaceSunken, DS.color.heading)
        case .saving, .syncing: (DS.color.accentSoft, DS.color.heading)
        }
    }

    /// The web's ageText (lib/format.ts formatRelative, sentence case): "Just now", "1 min ago", "3 hours ago",
    /// "2 days ago", then the date ("Sep 10", with the year when it isn't this year's).
    static func age(_ date: Date, now: Date = Date()) -> String {
        let mins = Int((now.timeIntervalSince(date) / 60).rounded())
        func unit(_ n: Int, _ u: String) -> String { "\(n) \(u)\(n == 1 ? "" : "s") ago" }
        let out: String
        if mins < 1 { out = "just now" }
        else if mins < 60 { out = unit(mins, "min") }
        else if Int((Double(mins) / 60).rounded()) < 24 { out = unit(Int((Double(mins) / 60).rounded()), "hour") }
        else if Int((Double(mins) / 1440).rounded()) < 7 { out = unit(Int((Double(mins) / 60 / 24).rounded()), "day") }
        else {
            let sameYear = Calendar.current.component(.year, from: date) == Calendar.current.component(.year, from: now)
            out = date.formatted(sameYear ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year())
        }
        return out.prefix(1).uppercased() + out.dropFirst()
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
