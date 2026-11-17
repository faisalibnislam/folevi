// Opening a folder in a tab behind the one on screen, as a browser opens a background tab (the owner, 6 November
// 2026): "Open in new tab" in a folder's menu, a middle-click on a folder anywhere, and a ⌘-click in the sidebar and
// on Home (the web's lib/app/tabs.tsx useFolderTabClicks). On a folder's page and the Folders page a ⌘-click selects
// the folder instead (multi-select, ListSelection) and only the middle-click opens its tab.
#if os(macOS)
import AppKit
#else
import UIKit
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
    /// Whether ⌘ is down now (the click being handled): on the iPad, the hardware keyboard's (Platform.swift).
    @MainActor static var commandHeld: Bool { NSEvent.modifierFlags.contains(.command) }
}

extension View {
    /// Runs `run` on a middle-click while the pointer is over this view (SwiftUI buttons only see the main button):
    /// the Mac's mouse, or a mouse's middle button on the iPad.
    @ViewBuilder
    func onMiddleClick(_ run: @escaping @MainActor () -> Void) -> some View {
        #if os(macOS)
        modifier(MiddleClick(run: run))
        #else
        gesture(MiddleClick(run: run))
        #endif
    }
}

#if os(iOS)
/// A pointer's middle-button click (a mouse's wheel pressed), beside the view's other gestures.
private struct MiddleClick: UIGestureRecognizerRepresentable {
    let run: @MainActor () -> Void

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
        // (Only a pointer's click: a finger's tap never counts.)
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool { touch.type == .indirectPointer }
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UITapGestureRecognizer {
        let click = UITapGestureRecognizer()
        click.buttonMaskRequired = .button(3)
        click.cancelsTouchesInView = false
        click.delegate = context.coordinator
        return click
    }

    func handleUIGestureRecognizerAction(_ recognizer: UITapGestureRecognizer, context: Context) {
        if recognizer.state == .ended { run() }
    }
}
#endif

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
