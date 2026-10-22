// foleviDesktop's native side (docs/MAC_WEBKIT_PLAN.md §5.2): the Dock badge, notifications, the menu bar icon's
// recent notes and status, the app's settings, the window buttons' place, Quick Add, opening a path in the main
// window. WM2 owns this file and fills it in; WM5 adds its rows (dragFile, recognizeText, call capture) in
// DesktopRouter+Capabilities.swift through `extraHandlers` and `features`.
//
// Until then every call says it isn't here yet ("unavailable"); the page treats foleviDesktop's calls as
// fire and forget, and its promises answer null.
import AppKit

final class DesktopRouter {
    let context: BridgeContext

    /// The optional foleviDesktop members the app answers (mac-bridge.js shows only these to the page):
    /// "signInInBrowser", "dragFile", "callCapture", "screenAccess", "openSystemSettings", "recognizeText".
    nonisolated(unsafe) static var features: Set<String> = []

    /// More methods, by name, from other files (WM5's capabilities): tried before `handle` gives up.
    nonisolated(unsafe) static var extraHandlers: [String: @MainActor (DesktopRouter, [String: Any]) async throws -> [String: Any]] = [:]

    init(context: BridgeContext) {
        self.context = context
    }

    @MainActor
    func handle(_ method: String, _ options: [String: Any]) async throws -> [String: Any] {
        if let extra = Self.extraHandlers[method] { return try await extra(self, options) }
        throw BridgeError.unavailable("foleviDesktop.\(method)")
    }
}
