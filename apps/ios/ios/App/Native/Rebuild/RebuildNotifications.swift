// Notifications in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I3): the bell's medium sheet (FoleviPhone's
// PhoneNotificationsContent from a NotificationsModel), what a notification opens, and a row's menu.
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviPhone
import FoleviScreens

struct RebuildNotificationsSheet: View {
    let frame: PhoneFrameModel
    let menus: PhoneMenus
    let phone: PhoneModel
    let close: () -> Void
    @State private var model: NotificationsModel

    init(frame: PhoneFrameModel, menus: PhoneMenus, phone: PhoneModel, close: @escaping () -> Void) {
        self.frame = frame
        self.menus = menus
        self.phone = phone
        self.close = close
        let feedback = ScreenFeedback(toast: { [weak phone] t in phone?.toast(t.message, tone: t.tone == .error ? .error : .info) })
        _model = State(initialValue: NotificationsModel(client: phone.client, feedback: feedback))
    }

    var body: some View {
        PhoneSheetPanel(title: "Notifications", close: close, scrolls: false) {
            PhoneNotificationsContent(model: model, open: { intent in
                close()
                switch intent {
                case .openNote(let id, _): phone.router?.openNote(id, source: nil, focus: false)
                case .openRoute(let path): frame.open(FrameRoute(path: path))
                case .openSettings(let section): frame.open(.web("/settings/\(section ?? "account")"))
                case .switchPlace(let id, _): (phone.router as? RebuildFrameController)?.switchPlace(id)
                default: break
                }
            }, settings: {
                close()
                frame.open(.web("/settings/notifications"))
            }, rowMenu: { n, anchor in
                let row = model.row(n)
                menus.show([
                    PhoneMenuEntry(.item(row.read ? "Mark as unread" : "Mark as read", icon: row.read ? .circleDot : .check)) { Task { await model.toggleRead(n) } },
                    PhoneMenuEntry(.separator()),
                    PhoneMenuEntry(.item("Remove", icon: .trash, danger: true)) { Task { await model.remove(n) } },
                ], from: anchor, side: .bottom, align: .end)
            })
        }
    }
}
