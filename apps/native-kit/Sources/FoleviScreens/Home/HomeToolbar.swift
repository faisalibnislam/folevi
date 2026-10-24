// Home's bar items (web iphone/RootBar.tsx): the avatar (the account and place switcher) on the leading side,
// and the glass pill with the bell (unread badge) and "…" (New folder, All folders) on the trailing side. The
// frame places them: in a UIKit navigation bar (UIHostingController items), an NSToolbar, or SwiftUI `.toolbar`.
import SwiftUI
import FoleviDesign
import FoleviEngine

/// The leading item: the person's avatar, opening the account and place switcher.
public struct HomeAvatarButton: View {
    let model: HomeModel
    @Environment(\.screenNavigator) private var navigator
    public init(model: HomeModel) { self.model = model }

    public var body: some View {
        Button { navigator.open(.places, nil) } label: {
            Avatar(name: model.profileName.isEmpty ? "Folevi" : model.profileName, size: 30)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Account and places")
        .accessibilityIdentifier("home-avatar")
    }
}

/// The trailing pill: notifications (with the unread count) and More.
public struct HomeTrailingPill: View {
    let model: HomeModel
    @Environment(\.screenNavigator) private var navigator
    public init(model: HomeModel) { self.model = model }

    public var body: some View {
        GlassPill {
            IconButton("bell", label: "Notifications", badge: model.unread) { navigator.open(.notifications, nil) }
                .accessibilityIdentifier("home-bell")
            Menu {
                if model.canEdit {
                    Button { model.dialogs.open(.newFolder(parent: nil)) } label: { Label("New folder", systemImage: "folder.badge.plus") }
                }
                Button { navigator.open(.allFolders, nil) } label: { Label("All folders", systemImage: "folder") }
                #if os(macOS)
                Divider()
                Button { Task { await model.refresh() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .keyboardShortcut("r", modifiers: .command)
                #endif
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 15, weight: .medium)).foregroundStyle(Folevi.color.ink).frame(width: 30, height: 30)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("More")
            .accessibilityIdentifier("home-more")
        }
    }
}

/// Everything Home puts in a SwiftUI toolbar, for frames that host it in a NavigationStack.
public struct HomeToolbar: ToolbarContent {
    let model: HomeModel
    public init(model: HomeModel) { self.model = model }

    public var body: some ToolbarContent {
        ToolbarItem(placement: .navigation) { HomeAvatarButton(model: model) }
        ToolbarItem(placement: .primaryAction) { HomeTrailingPill(model: model) }
    }
}
