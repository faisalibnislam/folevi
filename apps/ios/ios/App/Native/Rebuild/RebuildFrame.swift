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

    static let menus = PhoneMenus()

    static func controller() -> UIViewController {
        FoleviFonts.register()
        let host = UIHostingController(rootView: RebuildRoot(model: model, menus: menus))
        host.view.backgroundColor = .clear
        return host
    }
}

private struct RebuildRoot: View {
    let model: PhoneFrameModel
    let menus: PhoneMenus
    // FOLEVI_REBUILD_SHEET=account opens the account sheet at launch (for checking it headlessly).
    @State private var account = ProcessInfo.processInfo.environment["FOLEVI_REBUILD_SHEET"] == "account"

    var body: some View {
        PhoneFrameView(model: model, menus: menus, actions: PhoneFrameActions(fromTemplate: { model.open(FrameRoute(path: "/templates")) })) { route in
            PlaceholderScreen(model: model, route: route) { account = true }
        }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { screen in
            // FOLEVI_REBUILD_SHEET=create: the Create menu at launch, over where + sits.
            guard ProcessInfo.processInfo.environment["FOLEVI_REBUILD_SHEET"] == "create", menus.open == nil else { return }
            let bottom = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.windows.first?.safeAreaInsets.bottom ?? 34
            let plus = CGRect(x: screen.maxX - 16 - 4 - 56, y: screen.maxY + bottom - max(10, bottom - 10) - 4 - 56, width: 56, height: 56)
            menus.show([
                PhoneMenuEntry(.item("New note", icon: .filePlusCorner)),
                PhoneMenuEntry(.item("From template", icon: .layoutTemplate)),
                PhoneMenuEntry(.item("New folder", icon: .folderPlus)),
                PhoneMenuEntry(.item("Quick task", icon: .listPlus)),
            ], from: plus, side: .top, align: .end, minWidth: 248)
        }
        .phoneSheet(isPresented: $account, size: .medium, snapToBlocks: true) {
            PhoneSheetPanel(title: "Account", close: { account = false }) {
                // Sample places until the account and places arrive (I2).
                PhoneAccountSheetContent(places: [
                    PhonePlaceRow(id: "me", mark: .avatar(name: "Sam Rivera", url: nil), label: "Sam Rivera", description: "sam.rivera@example.com", checked: true),
                    PhonePlaceRow(id: "w1", mark: .workspace(name: "Studio", url: nil), label: "Studio", detail: "Team", sub: true),
                    PhonePlaceRow(id: "new", mark: .newWorkspace, label: "New workspace…", checked: nil, sub: true),
                    PhonePlaceRow(id: "library", mark: .library(.smartphone), label: "On this iPhone", description: "On your devices", dot: true),
                ], severalPlaces: true, otherPlaces: true, signOutLabel: "Sign out of Sam Rivera") { _ in account = false }
            }
        }
    }
}

/// A screen that names its route, with links to try the stacks (a folder, a note, another tab's first screen).
private struct PlaceholderScreen: View {
    let model: PhoneFrameModel
    let route: FrameRoute
    let openAccount: () -> Void

    var body: some View {
        let root = PhoneFrameModel.isTabRoot(route) && model.stack.first?.route == route
        PhoneScreen(PhoneScreenOptions(title: route.fallbackTitle, large: !route.isNote, eyebrow: route == .home ? "Personal" : nil), root: root, scrollToTop: model.scrollToTop, back: { model.back() }) {
            Button(action: openAccount) {
                PhonePlaceMarkView(mark: .avatar(name: "Sam Rivera", url: nil), size: 34).frame(width: 44, height: 44)
            }
            .accessibilityLabel("Account")
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
