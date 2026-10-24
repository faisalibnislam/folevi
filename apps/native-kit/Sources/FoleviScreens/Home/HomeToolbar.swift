// Home's bar items (web iphone/RootBar.tsx): the avatar (the account and place switcher) on the leading side,
// and the glass pill with the bell (unread badge) and "…" (New folder, All folders, Graph) on the trailing side. The
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
    let glass: Bool
    @Environment(\.screenNavigator) private var navigator
    /// `glass: false` inside a system toolbar that draws its own glass (iOS 26 and macOS 26).
    public init(model: HomeModel, glass: Bool = true) {
        self.model = model
        self.glass = glass
    }

    public var body: some View {
        GlassWrap(glass) {
            IconButton("bell", label: "Notifications", badge: model.unread) { navigator.open(.notifications, nil) }
                .accessibilityIdentifier("home-bell")
            Menu {
                if model.canEdit {
                    Button { model.dialogs.open(.newFolder(parent: nil)) } label: { Label("New folder", systemImage: "folder.badge.plus") }
                }
                Button { navigator.open(.allFolders, nil) } label: { Label("All folders", systemImage: "folder") }
                if model.graphOn {
                    Button { navigator.open(.graph, nil) } label: { Label("Graph", systemImage: "point.3.connected.trianglepath.dotted") }
                }
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
        // The avatar is its own rounded square: no system glass around it (iOS 26 and macOS 26 add one).
        if #available(iOS 26, macOS 26, *) {
            ToolbarItem(placement: .navigation) { HomeAvatarButton(model: model) }.sharedBackgroundVisibility(.hidden)
        } else {
            ToolbarItem(placement: .navigation) { HomeAvatarButton(model: model) }
        }
        ToolbarItem(placement: .primaryAction) { HomeTrailingPill(model: model, glass: !SystemGlass.inToolbars) }
    }
}

/// Whether the system draws glass behind toolbar items itself (iOS 26, macOS 26 and later).
public enum SystemGlass {
    public static var inToolbars: Bool {
        if #available(iOS 26, macOS 26, *) { return true }
        return false
    }
}

/// The glass pill, or just the items in a row when the toolbar draws the glass.
struct GlassWrap<Content: View>: View {
    let glass: Bool
    let content: Content
    init(_ glass: Bool, @ViewBuilder content: () -> Content) {
        self.glass = glass
        self.content = content()
    }
    var body: some View {
        if glass { GlassPill { content } } else { HStack(spacing: 2) { content } }
    }
}
