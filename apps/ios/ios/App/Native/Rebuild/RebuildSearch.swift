// Search in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I3): the web's iPhone search drawn natively
// (FoleviPhone's PhoneSearchScreen) over the whole screen, its actions the palette's, its scope chips' menus here.
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviPhone
import FoleviScreens

struct RebuildSearchScreen: View {
    let frame: PhoneFrameModel
    let menus: PhoneMenus
    let phone: PhoneModel
    @State private var model: SearchModel

    init(text: String, frame: PhoneFrameModel, menus: PhoneMenus, phone: PhoneModel) {
        self.frame = frame
        self.menus = menus
        self.phone = phone
        let feedback = ScreenFeedback(toast: { [weak phone] t in phone?.toast(t.message, tone: t.tone == .error ? .error : .info) })
        _model = State(initialValue: SearchModel(client: phone.client, text: text, feedback: feedback))
    }

    var body: some View {
        PhoneSearchScreen(model: model, aiOn: phone.aiOn, actions: actions, askAI: { q in
            // (The web's openAsk: the sheet, the words in its box.)
            frame.back()
            RebuildFrame.ai.ask(draft: q)
        }, openNote: { id in
            frame.back()
            phone.router?.openNote(id, source: nil, focus: false)
        }, close: { frame.back() }, scopeMenu: { which, anchor in showScope(which, from: anchor) })
    }

    /// The palette's actions (CommandPalette.tsx), in its order.
    private var actions: [PhoneSearchAction] {
        let go = { (path: String) in { frame.back(); frame.open(FrameRoute(path: path)) } }
        return [
            PhoneSearchAction(id: "new", label: "New document", icon: .plus) { frame.back(); phone.newNote() },
            PhoneSearchAction(id: "tasks", label: "Go to Tasks · Today", icon: .squareCheckBig, run: go("/tasks/today")),
            PhoneSearchAction(id: "calendar", label: "Go to Calendar", icon: .calendarDays, run: go("/calendar")),
            PhoneSearchAction(id: "review", label: "Go to Reviews", icon: .layers, run: go("/review")),
            PhoneSearchAction(id: "changes", label: "Go to Changes", icon: .fileDiff, run: go("/changes")),
            PhoneSearchAction(id: "all", label: "Go to Home", icon: .house, run: go("/documents")),
            PhoneSearchAction(id: "trash", label: "Open Trash", icon: .trash, run: go("/trash")),
            PhoneSearchAction(id: "settings", label: "Open Settings", icon: .settings, run: go("/settings/account")),
        ]
    }

    /// A scope chip's menu (IphoneScopes): where, the folder, the tag, when it was edited.
    private func showScope(_ which: String, from anchor: CGRect) {
        var entries: [PhoneMenuEntry] = []
        switch which {
        case "where":
            entries = [
                PhoneMenuEntry(.item(model.spaceName, checked: model.scope != .everywhere)) { model.scope = .place },
                PhoneMenuEntry(.item("All places", checked: model.scope == .everywhere)) { model.scope = .everywhere },
            ]
        case "folder":
            entries = [PhoneMenuEntry(.item("Any folder", checked: model.folderId == nil)) { model.folderId = nil }]
            for f in model.folders {
                entries.append(PhoneMenuEntry(.item(String(repeating: "\u{00a0}\u{00a0}\u{00a0}", count: f.depth) + f.name, checked: model.folderId == f.id)) { model.folderId = f.id })
            }
        case "tag":
            entries = [PhoneMenuEntry(.item("Any tag", checked: model.tagId == nil)) { model.tagId = nil }]
            for t in model.tags {
                entries.append(PhoneMenuEntry(.item("#\(t.name)", checked: model.tagId == t.id)) { model.tagId = t.id })
            }
        default:
            entries = [PhoneMenuEntry(.item("Any time", checked: model.updated == nil)) { model.updated = nil }]
            for u in SearchUpdated.allCases {
                entries.append(PhoneMenuEntry(.item(u.title, checked: model.updated == u)) { model.updated = u })
            }
        }
        menus.show(entries, from: anchor, side: .bottom, align: .start)
    }
}
