// Debug builds only: scripts open the frame's dialogs (mr/more's screens.mjs entries and style reads).
//
//   cmd more {"do":"palette"}                       ⌘K
//   cmd more {"do":"newFolder"}                     the sidebar's New folder
//   cmd more {"do":"rename"|"color"|"moveFolder","folder":"Travel"}   a folder's dialog, by its name
//   cmd more {"do":"moveNote","note":"Packing list"}                  Move to folder for a note on Home
//   cmd more {"do":"toast","message":"…","tone":"error"}             a toast
//   cmd more {"do":"close"}                         closes the dialog on screen (and the toasts)
#if DEBUG
import AppKit
import FoleviMac

extension NativeFrame {
    static func installMoreEval() {
        MacEval.commands["more"] = { req, done in
            let mains = WindowManager.shared.mains
            let i = req["window"] as? Int ?? 0
            guard mains.indices.contains(i), let frame = mains[i].frame else { return done(["error": "no framed window"]) }
            let m = frame.model
            let folder = (req["folder"] as? String).flatMap { name in m.folders.value?.folders.first { $0.name == name } }
            switch req["do"] as? String {
            case "palette": frame.sidebar.focusSearch()
            case "newFolder": FrameDialogs.newFolder(m)
            case "rename": if let folder { FrameDialogs.renameFolder(m, folder) }
            case "color": if let folder { FrameDialogs.folderColor(m, folder) }
            case "moveFolder": if let folder { FrameDialogs.moveFolder(m, folder) }
            case "moveNote":
                let note = (req["note"] as? String).flatMap { t in m.home.value?.recents.first { $0.title == t } }
                if let note { FrameDialogs.moveNotes(m, ids: [note.id], title: note.title, currentFolderId: .some(note.folder?.id)) }
            case "toast": m.toast(req["message"] as? String ?? "Something went wrong. Please try again.", tone: (req["tone"] as? String) == "error" ? .error : (req["tone"] as? String) == "success" ? .success : .info)
            case "close":
                FrameSheets.dismissAll()
                m.toasts.forEach { m.dismissToast($0.id) }
            default: return done(["error": "unknown"])
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { done(["value": FrameSheets.isShowing(m)]) }
        }
    }
}
#endif
