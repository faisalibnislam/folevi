// Core's share of docs/MAC_NATIVE_LOOK.md inside the system frame the owner chose (native tabs and sidebar):
// Folevi's web icons in place of SF Symbols wherever the web has one (RULE-034), a hover on every plain control
// (RULE-016, with the hover reaching past the words, never touching them), and the card sizes (RULE-011).
import FoleviDesign
import SwiftUI

/// Folevi's icon for an SF Symbol name, as a template image (menus and labels take only an image); the system's
/// symbol only where Folevi has none (filled status marks, the Apple logo).
enum CoreIcon {
    static func image(_ name: String, size: CGFloat = 15) -> Image {
        if flower.contains(name) { return AiMarkImage.image(size: size + 1) }
        if let icon = table[name] { return icon.image(size: (size * 1.15).rounded()) }
        return Image(systemName: name)
    }

    static let flower: Set<String> = ["sparkles", "wand.and.sparkles"]

    static let table: [String: WebIcon] = [
        "exclamationmark.triangle": .triangleAlert, "ellipsis.circle": .ellipsis, "ellipsis": .ellipsis, "globe": .globe,
        "arrow.up.arrow.down": .arrowDownUp, "wifi.slash": .wifiOff, "quote.bubble": .quote, "wand.and.stars": .wandSparkles,
        "plus.square.on.square": .copyPlus, "square.grid.2x2": .layoutGrid, "list.bullet": .list, "trash": .trash,
        "plus": .plus, "calendar": .calendar, "repeat": .repeat2, "checkmark": .check, "exclamationmark.circle": .circleAlert,
        "clock.badge.xmark": .clock, "arrow.down": .arrowDown, "arrow.uturn.backward": .undo2, "lock": .lock, "brain": .brain,
        "doc.text": .fileText, "gearshape": .settings, "square.stack.3d.up": .layers, "clock.arrow.circlepath": .rotateCcwClock,
        "person.2": .users, "list.bullet.indent": .listTree, "folder.badge.plus": .folderPlus, "paintpalette": .palette,
        "person": .userRound, "calendar.badge.plus": .calendarPlus, "mappin.and.ellipse": .mapPin, "folder": .folder,
        "doc.on.doc": .copy, "number": .hash, "archivebox": .archive, "folder.badge.gearshape": .folderTree,
        "person.crop.circle.badge.plus": .userPlus, "square.grid.3x3": .grid3x3, "pencil.line": .pencilLine,
        "checklist": .listChecks, "person.badge.shield.checkmark": .shieldCheck, "checkmark.circle": .circleCheck,
        "key.horizontal": .keyRound, "chevron.left": .chevronLeft, "chevron.right": .chevronRight, "link": .link,
        "square.and.arrow.up": .share, "magnifyingglass": .search, "bell": .bell, "xmark": .x, "pencil": .pencil,
        "arrow.clockwise": .refreshCw, "info.circle": .info, "paperclip": .paperclip, "bubble.left": .messageSquare,
        "plus.bubble": .messageSquare, "pin": .pin, "pin.slash": .pinOff, "tray": .inbox, "house": .house,
        "bookmark": .bookmark, "square.and.arrow.down": .download, "laptopcomputer": .laptop,
    ]
}

extension Label where Title == Text, Icon == Image {
    /// A label with Folevi's icon for `coreSymbol` (an SF Symbol name).
    init<S: StringProtocol>(_ title: S, coreSymbol: String) {
        self.init { Text(title) } icon: { CoreIcon.image(coreSymbol) }
    }
}

/// A plain control's hover: a quiet fill that reaches 8 pt past its words (6 pt round an icon), so the hover never
/// touches them; pressed, it dims.
struct HoverPlainButtonStyle: ButtonStyle {
    var capsule = false
    var inset: CGFloat = 8

    func makeBody(configuration: Configuration) -> some View {
        HoverBody(configuration: configuration, capsule: capsule, inset: inset)
    }

    struct HoverBody: View {
        let configuration: Configuration
        let capsule: Bool
        let inset: CGFloat
        @State private var hovering = false
        @Environment(\.isEnabled) private var enabled

        var body: some View {
            configuration.label
                .contentShape(Rectangle())
                .background {
                    Group {
                        if capsule { Capsule().fill(.quaternary) } else { RoundedRectangle(cornerRadius: 6, style: .continuous).fill(.quaternary) }
                    }
                    .padding(.horizontal, capsule ? -2 : -inset)
                    .padding(.vertical, capsule ? -1 : -3)
                    .opacity(hovering && enabled ? 1 : 0)
                }
                .opacity(configuration.isPressed ? 0.6 : 1)
                .onHover { hovering = $0 }
                .animation(.easeOut(duration: 0.12), value: hovering)
        }
    }
}

extension ButtonStyle where Self == HoverPlainButtonStyle {
    static var hoverPlain: HoverPlainButtonStyle { HoverPlainButtonStyle() }
    static var hoverIcon: HoverPlainButtonStyle { HoverPlainButtonStyle(inset: 6) }
    static var hoverChip: HoverPlainButtonStyle { HoverPlainButtonStyle(capsule: true) }
}

/// Card sizes in grids: 25% smaller than the web's (the owner's rule, as the main Mac app's MacCards).
enum CoreCards {
    static let noteWidth: CGFloat = 188
    static let folderWidth: CGFloat = 180
    static let gap: CGFloat = 16
}


/// Whether a screen is on screen: its window shows (not a hidden tab, not covered or minimised) and the screen is
/// up. Screens pass it to their live values, which pause after a minute off screen (today's `setVisible`).
struct OnScreen: ViewModifier {
    let window: WindowModel
    let changed: (Bool) -> Void

    func body(content: Content) -> some View {
        content
            .onAppear { changed(visible) }
            .onDisappear { changed(false) }
            .onReceive(NotificationCenter.default.publisher(for: NSWindow.didChangeOcclusionStateNotification)) { note in
                guard let w = note.object as? NSWindow, w === window.window else { return }
                changed(visible)
            }
    }

    private var visible: Bool { window.window?.occlusionState.contains(.visible) ?? true }
}

extension View {
    func onScreen(_ window: WindowModel, _ changed: @escaping (Bool) -> Void) -> some View {
        modifier(OnScreen(window: window, changed: changed))
    }
}
