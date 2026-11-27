// This person's sidebar layout (SidebarLayout.swift), live, and a way to change it: the change shows at once and is
// saved with their account (convex/sidebarLayout.ts; in local mode the library's, lib/local/functions/sidebarLayout.ts),
// as the web's useSidebarLayout.ts does. Read and saved through the engine's Convex allowlist (viewsSettings.ts
// QUERIES and MUTATIONS: sidebarLayout.get, sidebarLayout.set), the one Settings' sections use; the last layout is
// in the launch snapshot, so the sidebar starts in the person's order with nothing jumping.
import Foundation
import Observation
import FoleviEngine

@MainActor
@Observable
public final class SidebarLayoutStore {
    @ObservationIgnored private let client: EngineClient
    @ObservationIgnored private let failed: @MainActor (String) -> Void
    private let live: ValueStore<SettingsQueryValue>
    /// The change in front of the saved layout until the saved one has it (or a moment has passed).
    private var pending: Pending?
    /// How long a change waits for the saved layout to show it before the saved one is shown again.
    @ObservationIgnored var settle: Duration = .seconds(3)

    private struct Pending: Equatable {
        let token: Int
        let slots: [SidebarSlot]
    }
    @ObservationIgnored private var nextToken = 0

    init(client: EngineClient, failed: @escaping @MainActor (String) -> Void) {
        self.client = client
        self.failed = failed
        live = client.watch(.settingsQuery(key: .convex, args: ["fn": .string("sidebarLayout.get"), "args": .object([:])]), snapshotKey: "sidebar.layout")
    }

    /// The saved layout (nil: the default, or not known yet).
    public var saved: SidebarLayout.Saved? { SidebarLayout.Saved(json: live.value?.data) }

    /// Every item in this person's order, the change being saved included.
    public var slots: [SidebarSlot] { pending?.slots ?? SidebarLayout.resolve(saved) }

    /// Saves a layout (nil: back to the default).
    public func save(_ next: [SidebarSlot]?) {
        nextToken += 1
        let mine = Pending(token: nextToken, slots: next ?? SidebarLayout.defaults)
        pending = mine
        let layout: JSONValue = next.map { SidebarLayout.save($0).json } ?? .null
        Task { [weak self] in
            guard let self else { return }
            do {
                _ = try await client.command(.settingsRun(key: .convexMutation, args: ["fn": .string("sidebarLayout.set"), "args": .object(["layout": layout])]))
                // (The saved layout comes on its own update: until it does, the change stays in front.)
                let wait = settle
                let deadline = ContinuousClock.now.advanced(by: wait)
                while pending == mine, SidebarLayout.resolve(saved) != mine.slots, ContinuousClock.now < deadline {
                    try? await Task.sleep(for: .milliseconds(50))
                }
            } catch {
                failed(Self.message(error))
            }
            if pending == mine { pending = nil }
        }
    }

    static func message(_ error: any Error) -> String {
        if case EngineFailure.engine(let e) = error { return e.message }
        return "Couldn't save the sidebar. Try again."
    }
}
