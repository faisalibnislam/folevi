import SwiftUI

/// The sidebar's own menu (the panel icon, the web's SidebarMenu): hide or show the sidebar, focus mode, and
/// on a note whether the sidebar shows the folders or the note's tools. It sits in the sidebar next to
/// notifications, and moves to the tab strip while the sidebar is hidden so it's always one click away.
struct SidebarMenu: View {
    @Bindable var nav: NavigationModel

    var body: some View {
        FoleviMenuButton(label: String(localized: "Sidebar"), entries: entries) { open in
            FoleviMenuTrigger(systemImage: "sidebar.left", size: 32, open: open)
        }
        .accessibilityIdentifier("sidebar.menu")
    }

    private func entries() -> [FoleviMenuEntry] {
        var out: [FoleviMenuEntry] = [
            .item(FoleviMenuItem(nav.sidebarVisible ? String(localized: "Hide sidebar") : String(localized: "Show sidebar"),
                                 systemImage: "sidebar.left", shortcut: "⌘\\") { withSidebarAnimation { nav.toggleSidebar() } }),
            nav.focusMode
                ? .item(FoleviMenuItem(String(localized: "Exit focus mode"), systemImage: "arrow.down.right.and.arrow.up.left") {
                    withSidebarAnimation { nav.setFocusMode(false) }
                })
                : .item(FoleviMenuItem(String(localized: "Focus mode"), systemImage: "arrow.up.left.and.arrow.down.right") {
                    withSidebarAnimation { nav.setFocusMode(true) }
                }),
        ]
        if nav.openDocumentId != nil {
            out.append(.separator)
            out.append(.item(FoleviMenuItem(String(localized: "Show folders"), checked: nav.docSidebarMode == .folders) {
                withSidebarAnimation { nav.setDocSidebarMode(.folders) }
            }))
            out.append(.item(FoleviMenuItem(String(localized: "Show document"), checked: nav.docSidebarMode == .document) {
                withSidebarAnimation { nav.setDocSidebarMode(.document) }
            }))
        }
        return out
    }
}
