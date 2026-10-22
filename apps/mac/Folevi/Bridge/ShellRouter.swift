// foleviShell's native side on the Mac (docs/MAC_WEBKIT_PLAN.md §4.3 and §5.1): the same method names and options
// as the iOS plugin (Native/Shell/FoleviShellPlugin.swift), so the shared shell-bridge.js calls the same names on
// both, answered by the shared iOS services (LibraryService, ShellAuth, E2eeKeys, ShellAI, ShellPlaces, ...).
//
// WM1 owns this file and fills it in. Until then every call says it isn't here yet ("unavailable").
import AppKit

final class ShellRouter {
    /// The sender view's place, bound by the host (never an argument).
    let place: () -> String?
    /// The window a sheet or panel attaches to (nil for a runner).
    let window: () -> NSWindow?
    let events: BridgeEvents

    init(place: @escaping () -> String?, window: @escaping () -> NSWindow?, events: BridgeEvents) {
        self.place = place
        self.window = window
        self.events = events
    }

    @MainActor
    func handle(_ method: String, _ options: [String: Any]) async throws -> [String: Any] {
        throw BridgeError.unavailable("foleviShell (\(method))")
    }
}
