// A tab's screens as iOS's split view (iPhone Duo; the owner, 2026-11-19): the list in the leading column and the
// open note in the detail column. On a narrow window (iPhone Duo closed, any other iPhone) the split view collapses
// to one stack, the note pushed over its list; on the open inner screen the two sit side by side, the note's
// buttons in iOS's column at the side, the columns rebalanced on the fold as the phone half closes. The model keeps
// one stack per tab with the open notes last: the screens under them are the list column's path, the notes the
// detail column's.
#if os(iOS)
import SwiftUI
import FoleviDesign
import FoleviScreens

struct PhoneColumns<List: View, Note: View, Empty: View>: View {
    @Bindable var model: PhoneFrameModel
    let tab: PhoneTab
    /// The window is regular width: the split view shows its columns side by side.
    let regular: Bool
    /// The tab's stack from its first screen, on this path (the screens under the open notes).
    let list: (Binding<[PhoneStackEntry]>) -> List
    /// The detail column: its first note, then the notes over it on this path.
    let note: (FrameRoute, Binding<[PhoneStackEntry]>) -> Note
    /// The detail column with no note open (regular width only).
    let empty: () -> Empty

    var body: some View {
        let entries = model.stacks[tab] ?? []
        let run = PhoneFrameModel.noteRunStart(entries)
        let open = run < entries.count
        NavigationSplitView(columnVisibility: .constant(.all), preferredCompactColumn: compactColumn(open: open)) {
            list(listPath)
                .navigationSplitViewColumnWidth(min: 320, ideal: 375)
                // (Hiding the list would strand the note: its own Back and the tabs bring the list back.)
                .toolbar(removing: .sidebarToggle)
        } detail: {
            if open {
                note(entries[run].route, notePath)
            } else if !regular {
                // (Collapsed, Back has already closed the note while iOS slides it away: the page's colour, not the
                // empty column's words.)
                FoleviTokens.Chrome.canvas.color.ignoresSafeArea()
            } else {
                empty()
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    /// Collapsed (a narrow window), the note on top while one is open; Back to the list closes it.
    private func compactColumn(open: Bool) -> Binding<NavigationSplitViewColumn> {
        Binding(
            get: { open ? .detail : .sidebar },
            set: { column in
                if column != .detail, open { model.closeNotes(in: tab) }
            }
        )
    }

    /// The list column's path: the screens under the open notes.
    private var listPath: Binding<[PhoneStackEntry]> {
        Binding(
            get: {
                let s = model.stacks[tab] ?? []
                return Array(s[1..<PhoneFrameModel.noteRunStart(s)])
            },
            set: { model.setListPath($0, in: tab) }
        )
    }

    /// The notes over the detail column's first.
    private var notePath: Binding<[PhoneStackEntry]> {
        Binding(
            get: {
                let s = model.stacks[tab] ?? []
                let run = PhoneFrameModel.noteRunStart(s)
                return run + 1 < s.count ? Array(s[(run + 1)...]) : []
            },
            set: { model.setNotePath($0, in: tab) }
        )
    }
}

/// The detail column with no note open, before the most recent one shows (or with no notes yet).
struct PhoneEmptyDetail: View {
    let newNote: @MainActor () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("No note open", systemImage: "doc.text")
        } actions: {
            Button("New note", action: newNote)
                .buttonStyle(.bordered)
        }
        .background(FoleviTokens.Chrome.canvas.color.ignoresSafeArea())
    }
}
#endif
