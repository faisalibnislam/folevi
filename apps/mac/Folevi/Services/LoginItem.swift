// Open at login (Settings > General): SMAppService registers the app itself, only when the setting changes
// (Electron's applyLoginItem: the service can be slow to answer, so it never runs at launch). A Debug build or a
// FOLEVI_USER_DATA run never registers, so development never adds a login item to the owner's Mac.
import Foundation
import ServiceManagement

enum LoginItem {
    static var allowed: Bool { !Paths.isDebug && Paths.userDataOverride == nil && !Paths.testing }

    static func apply(_ on: Bool) {
        guard allowed else { return }
        DispatchQueue.global(qos: .utility).async {
            let service = SMAppService.mainApp
            do {
                if on, service.status != .enabled { try service.register() }
                if !on, service.status == .enabled { try service.unregister() }
            } catch {
                NSLog("Folevi: open at login couldn't change: \(error.localizedDescription)")
            }
        }
    }
}
