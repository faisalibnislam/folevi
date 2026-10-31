// The iPad's wide layout in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I7): FoleviMac's frame (IPadFrameView:
// the sidebar, the content card, its glass top bar and tab strip) on the same engine as the phone's, the note
// being the app's one Page View in the card. Under 700 pt wide (Split View, Slide Over, a small Stage Manager
// window) the iPad shows the phone's layout, as the web does (lib/iphone.ts IPAD_COMPACT).
import SwiftUI
import UIKit
import WebKit
import FoleviDesign
import FoleviEngine
import FoleviMac
import FoleviPhone
import FoleviScreens

enum RebuildIPad {
    /// lib/iphone.ts: `(max-width: 699px)` is compact.
    static let minWidth: CGFloat = 700
}

struct RebuildIPadRoot: View {
    let desk: FrameModel
    let phone: PhoneModel
    let pageHost: PageViewHost
    let gate: GateModel

    var body: some View {
        IPadFrameView(model: desk) {
            IPadNotePage(pageHost: pageHost)
        }
        // The screens before the app, as on the phone.
        .overlay {
            if let g = phone.gate, g.gate != nil, g.gate != "loading" {
                WebGateScreen(model: gate)
                    .onAppear { gate.show(g) }
                    .onChange(of: g) { _, next in gate.show(next) }
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: phone.gate?.gate)
    }
}

/// The note in the card: the Page View, adopted while the note shows and parked again when it goes.
private struct IPadNotePage: UIViewControllerRepresentable {
    let pageHost: PageViewHost

    final class Controller: UIViewController, PageViewOwner {
        weak var pageHost: PageViewHost?
        var pageViewContainer: UIView { view }

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .clear
        }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            pageHost?.adopt(by: self)
        }

        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            if let pageHost, pageHost.isOwned(by: self) { pageHost.park() }
        }

        func pageViewWillLeave(_ pageView: WKWebView) {}
    }

    func makeUIViewController(context: Context) -> Controller {
        let c = Controller()
        c.pageHost = pageHost
        return c
    }

    func updateUIViewController(_ c: Controller, context: Context) {
        if let host = c.pageHost, !host.isOwned(by: c), c.view.window != nil { host.adopt(by: c) }
    }
}

/// What the iPad frame asks of the app (FrameHost): the phone's account flows and the system's own sheets.
extension RebuildFrameController: FrameHost {
    func frameOpenSettings(section: String?) {
        desk.open(FrameRoute(path: section.map { "/settings/\($0)" } ?? "/settings"))
    }

    func frameSwitchPlace(_ place: String, space: String?) { switchPlace(place) }

    func frameSignInAnotherAccount() {
        account(.signInAnother, places: PlacesModel(client: model.client, feedback: ScreenFeedback(toast: { [weak self] t in self?.model.toast(t.message) })), close: {})
    }

    func frameSignOut(place: String) { signOutNow() }

    func frameSignOutConfirmed(place: String) { signOutNow() }

    func frameDownloadFile(_ id: String) { model.toast("Downloads come to the iPad with the next update.") }

    func frameMoveOrCopy() {
        PlaceMove.present(from: self, model: desk)
    }

    func frameOpenHelp() { desk.open(FrameRoute(path: "/help")) }

    func frameOpenExternal(_ url: URL) { openExternal(url) }

    func frameOpenInNewWindow(_ route: FrameRoute) {
        let activity = NSUserActivity(activityType: RebuildFrame.restorationType)
        activity.userInfo = ["path": route.path]
        UIApplication.shared.requestSceneSessionActivation(nil, userActivity: activity, options: nil)
    }

    func frameStateChanged() {}
}
