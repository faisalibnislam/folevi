// The iOS rebuild's frame (docs/IOS_REBUILD_PLAN.md, I1), while it's being built: Debug builds only, and only with
// FOLEVI_REBUILD=1 in the environment (or the `folevi.rebuild` setting). Release builds, TestFlight and today's
// frame are untouched. Screens are placeholders that name their route until the lists land (I3).
import SwiftUI
import UIKit
import FoleviDesign
import FoleviPhone
import FoleviScreens

@MainActor
enum RebuildFrame {
    static let enabled: Bool = {
        #if DEBUG
        ProcessInfo.processInfo.environment["FOLEVI_REBUILD"] == "1" || UserDefaults.standard.bool(forKey: "folevi.rebuild")
        #else
        false
        #endif
    }()

    static let model: PhoneFrameModel = {
        let m = PhoneFrameModel()
        // FOLEVI_REBUILD_OPEN: routes to open at launch, comma-separated (for checking the stacks headlessly).
        for path in (ProcessInfo.processInfo.environment["FOLEVI_REBUILD_OPEN"] ?? "").split(separator: ",") {
            m.open(FrameRoute(path: String(path)))
        }
        return m
    }()

    static func controller() -> UIViewController {
        FoleviFonts.register()
        let host = UIHostingController(rootView: RebuildRoot(model: model))
        host.view.backgroundColor = .clear
        return host
    }
}

private struct RebuildRoot: View {
    let model: PhoneFrameModel

    var body: some View {
        PhoneFrameView(model: model) { route in
            PlaceholderScreen(model: model, route: route)
        }
    }
}

/// A screen that names its route, with links to try the stacks (a folder, a note, another tab's first screen).
private struct PlaceholderScreen: View {
    let model: PhoneFrameModel
    let route: FrameRoute

    var body: some View {
        let root = PhoneFrameModel.isTabRoot(route) && model.stack.first?.route == route
        PhoneScreen(PhoneScreenOptions(title: route.fallbackTitle, large: !route.isNote, eyebrow: route == .home ? "Personal" : nil), root: root, scrollToTop: model.scrollToTop, back: { model.back() }) {
            Circle().fill(Color.primary.opacity(0.12)).frame(width: 34, height: 34).frame(width: 44, height: 44)
        } trailing: {
            WebGlassPill {
                WebPillButton("Notifications") { WebIconView(.bell, size: 21, strokeWidth: 1.9) }
                WebPillButton("More") { WebIconView(.ellipsis, size: 24, strokeWidth: 2.2) }
            }
        } content: {
            VStack(alignment: .leading, spacing: 12) {
                Text(route.path).webText(.role(.footnote)).foregroundStyle(.secondary)
                ForEach(["/folders/sample", "/d/sample-note", "/tasks/completed", "/calendar", "/documents"], id: \.self) { path in
                    WebButton("Open \(path)", variant: .secondary) { model.open(FrameRoute(path: path)) }
                }
                ForEach(0..<40, id: \.self) { i in
                    Text("Row \(i + 1)").webText(.role(.body)).foregroundStyle(.primary).frame(height: 44)
                }
            }
            .padding(.horizontal, 20)
        }
    }
}
