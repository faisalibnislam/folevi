// The note's menu rows' icons, as the web's menu draws them (lucide): shared by the iPhone's note (its "…" and,
// on iPhone Duo, iOS's overflow menu) and the open iPhone Duo's toolbar (IPadToolbar).
import FoleviDesign

public extension NoteMenuItem {
    var webIcon: WebIcon {
        switch self {
        case .bookmark(let on): on ? .bookmarkOff : .bookmark
        case .info: .info
        case .find: .search
        case .review: .layers
        case .readImages: .scanText
        case .related, .dna: .waypoints
        case .history: .rotateCcwClock
        case .showEditors: .users
        case .move: .folderInput
        case .copyTo: .copyPlus
        case .duplicate: .copy
        case .moveToVault: .lock
        case .export: .download
        case .present: .presentation
        case .print: .printer
        case .saveAsTemplate: .layoutTemplate
        case .archive(let on, _): on ? .archiveRestore : .archive
        case .trash, .deleteForever: .trash
        case .restore: .undo2
        }
    }
}

public extension NoteMenuGroup {
    var webIcon: WebIcon {
        switch self {
        case .connections: .waypoints
        case .history: .rotateCcwClock
        case .moveCopy: .folderInput
        case .shareExport: .share
        }
    }
}
