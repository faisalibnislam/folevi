// Opening a folder in a tab behind the one on screen, as a browser opens a background tab (the owner, 6 November
// 2026): "Open in new tab" in a folder's menu, a middle-click on a folder anywhere, and a ⌘-click in the sidebar and
// on Home (the web's lib/app/tabs.tsx useFolderTabClicks). On a folder's page and the Folders page a ⌘-click selects
// the folder instead (multi-select, ListSelection) and only the middle-click opens its tab.
#if os(macOS)
import AppKit
#endif
import SwiftUI
import FoleviScreens

@MainActor
extension FrameModel {
    /// A folder clicked where the list doesn't select (the sidebar, Home): a ⌘-click adds its tab behind the one on
    /// screen; a plain click shows it.
    func openFolder(_ id: String, name: String) {
        if FolderTabClicks.commandHeld { openInBackground(.folder(id), title: name) } else { open(.folder(id), title: name) }
    }
}

enum FolderTabClicks {
    /// Whether ⌘ is down now (the click being handled).
    @MainActor static var commandHeld: Bool {
        #if os(macOS)
        NSEvent.modifierFlags.contains(.command)
        #else
        false
        #endif
    }
}

extension View {
    /// Runs `run` on a middle-click while the pointer is over this view (the Mac; SwiftUI buttons only see the left
    /// button). Elsewhere it does nothing.
    @ViewBuilder
    func onMiddleClick(_ run: @escaping @MainActor () -> Void) -> some View {
        #if os(macOS)
        modifier(MiddleClick(run: run))
        #else
        self
        #endif
    }
}

#if os(macOS)
private struct MiddleClick: ViewModifier {
    let run: @MainActor () -> Void
    @State private var box = Box()

    @MainActor final class Box {
        var hovering = false
        var monitor: Any?
        var run: (@MainActor () -> Void)?
    }

    func body(content: Content) -> some View {
        content
            .onHover { box.hovering = $0 }
            .onAppear {
                box.run = run
                guard box.monitor == nil else { return }
                let box = box
                box.monitor = NSEvent.addLocalMonitorForEvents(matching: .otherMouseUp) { event in
                    guard event.buttonNumber == 2 else { return event }
                    let hit = MainActor.assumeIsolated { () -> Bool in
                        guard box.hovering, let run = box.run else { return false }
                        run()
                        return true
                    }
                    return hit ? nil : event
                }
            }
            .onDisappear {
                if let m = box.monitor { NSEvent.removeMonitor(m) }
                box.monitor = nil
                box.hovering = false
            }
    }
}
#endif
