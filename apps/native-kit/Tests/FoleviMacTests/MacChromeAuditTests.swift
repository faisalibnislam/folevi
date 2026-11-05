// The Mac chrome's audit fixes (MAC-01 to MAC-67, 2026-11-06): the logic behind them, and pictures of the visual
// ones drawn in light and dark (written at 2x to FOLEVI_AUDITFIX_OUT when set, for a person to look at).
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac
import FoleviScreens

@Suite("Mac chrome audit fixes", .serialized) @MainActor
struct MacChromeAuditTests {
    // MARK: MAC-05: the first click acts

    @Test func hostsTakeTheFirstClick() {
        // AppKit hands a click on an inactive window to the view under it only when that view accepts the first mouse.
        let plain = NSHostingView(rootView: Text("x"))
        let through = ClickThroughHostingView(rootView: Text("x"))
        #expect(plain.acceptsFirstMouse(for: nil) == false)
        #expect(through.acceptsFirstMouse(for: nil))
        // The toasts' host (with its own hit area) and the dialogs' host are click-through too.
        let frame = FrameModel(client: DemoEngine().client())
        #expect(ToastHostingView(rootView: ToastStack(model: frame)).acceptsFirstMouse(for: nil))
        #expect(SheetHostingView(rootView: AnyView(Text("x"))).acceptsFirstMouse(for: nil))
    }

    // MARK: MAC-06, MAC-08, MAC-43: menus

    @Test func aClickOnTheMenusOwnButtonOnlyClosesIt() {
        let trigger = NSRect(x: 100, y: 100, width: 32, height: 32)
        #expect(WebMenuWindow.outsideClick(at: NSPoint(x: 110, y: 110), inParent: true, left: true, trigger: trigger) == .closeAndSwallow)
        // Anywhere else, another window, a right click, or a menu opened by a right click (no button): it goes on.
        #expect(WebMenuWindow.outsideClick(at: NSPoint(x: 300, y: 110), inParent: true, left: true, trigger: trigger) == .closeAndPass)
        #expect(WebMenuWindow.outsideClick(at: NSPoint(x: 110, y: 110), inParent: false, left: true, trigger: trigger) == .closeAndPass)
        #expect(WebMenuWindow.outsideClick(at: NSPoint(x: 110, y: 110), inParent: true, left: false, trigger: trigger) == .closeAndPass)
        #expect(WebMenuWindow.outsideClick(at: NSPoint(x: 0, y: 0), inParent: true, left: true, trigger: .zero) == .closeAndPass)
    }

    @Test func theButtonKnowsItsMenuIsOpen() async throws {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 400), styleMask: [.titled], backing: .buffered, defer: false)
        let content = NSView(frame: window.contentRect(forFrameRect: window.frame))
        window.contentView = content
        let button = NSView(frame: NSRect(x: 40, y: 300, width: 32, height: 32))
        content.addSubview(button)
        let menu = try #require(WebMenuWindow.show([WebMenuEntry(.item("One"))], below: button))
        #expect(WebMenuWindow.isOpen(from: button))
        #expect(WebMenuTrigger.shared.open == ObjectIdentifier(button))
        menu.close()
        #expect(!WebMenuWindow.isOpen(from: button))
        #expect(WebMenuTrigger.shared.open == nil)
    }

    // MARK: MAC-01, MAC-42: disabled rows

    @Test func disabledEntriesDrawDisabled() {
        let state = WebMenuState([WebMenuEntry(.item("Cut"), disabled: true), WebMenuEntry(.item("Paste"))])
        #expect(state.panelItems.map(\.disabled) == [true, false])
        #expect(state.selectable.map(\.item.title) == ["Paste"])
    }

    @Test func backAndForwardNeedSomewhereToGo() {
        let frame = FrameModel(client: DemoEngine().client())
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
        let fresh = AppContextMenu.anywhereEntries(frame, window: window)
        #expect(fresh.first { $0.item.title == "Back" }?.disabled == true)
        #expect(fresh.first { $0.item.title == "Forward" }?.disabled == true)
        // Somewhere to go back to (as the top bar's Back): the row is offered.
        frame.open(.notes(.all), .replace)
        frame.open(.tasks(.today), .replace)
        let after = AppContextMenu.anywhereEntries(frame, window: window)
        #expect(after.first { $0.item.title == "Back" }?.disabled == !frame.history.canGoBack)
        #expect(after.first { $0.item.title == "Forward" }?.disabled == !frame.history.canGoForward)
    }

    // MARK: MAC-09, MAC-03: keys in dialogs

    @Test func returnNeverRunsADestructiveButton() {
        #expect(WebSheetButton.key(primary: true, danger: false) == .defaultAction)
        #expect(WebSheetButton.key(primary: false, danger: false) == .cancelAction)
        #expect(WebSheetButton.key(primary: false, danger: true) == .none)
        #expect(WebSheetButton.key(primary: true, danger: true) == .none)
    }

    // MARK: MAC-12: hover after a real move only

    @Test func hoverWaitsForThePointerToMove() {
        let p = PointerMoves()
        let here = NSEvent.mouseLocation
        // A row scrolled under a still pointer: no.
        #expect(!p.moved(to: here))
        #expect(p.moved(to: NSPoint(x: here.x + 5, y: here.y)))
        #expect(!p.moved(to: NSPoint(x: here.x + 5, y: here.y)))
    }

    // MARK: MAC-63: the bar's double click

    @Test func doubleClickFollowsSystemSettings() {
        #expect(WindowTitleBar.action(nil, legacyMinimize: nil) == .zoom)
        #expect(WindowTitleBar.action("Maximize", legacyMinimize: nil) == .zoom)
        #expect(WindowTitleBar.action("Fill", legacyMinimize: nil) == .zoom)
        #expect(WindowTitleBar.action("Minimize", legacyMinimize: nil) == .minimize)
        #expect(WindowTitleBar.action("None", legacyMinimize: true) == .none)
        #expect(WindowTitleBar.action(nil, legacyMinimize: true) == .minimize)
    }

    @Test func aDoubleClickOnAButtonStaysTheButtons() {
        // The double-click catcher sits behind the bar: SwiftUI's own z-order decides, so a button in front keeps its
        // clicks and only the empty room behind reaches the catcher.
        WindowTitleBar.DoubleClick.View.testing = true
        defer { WindowTitleBar.DoubleClick.View.testing = false }
        let root = ZStack(alignment: .leading) {
            Color.clear
            Button("Back") {}.frame(width: 60, height: 40)
        }
        .frame(width: 300, height: 40)
        .background(WindowTitleBar.DoubleClick())
        let host = NSHostingView(rootView: root)
        host.frame = NSRect(x: 0, y: 0, width: 300, height: 40)
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        let onButton = host.hitTest(NSPoint(x: 30, y: 20))
        let onRoom = host.hitTest(NSPoint(x: 250, y: 20))
        #expect(!(onButton is WindowTitleBar.DoubleClick.View))
        #expect(onRoom is WindowTitleBar.DoubleClick.View)
    }

    // MARK: MAC-07: presses darken on the Mac

    @Test func pressesDarkenNotScale() {
        #expect(PressDip.macPressBrightness(.light) < 0)
        #expect(PressDip.macPressBrightness(.dark) > 0)
    }

    // MARK: MAC-35: tabs keep a readable width

    @Test func tabsInANormalWindowStayReadable() {
        // A 920 pt window leaves the list about 320 pt: three tabs now share it whole, each at least 96 wide (172
        // before: a tab and a half, the rest faded fragments).
        let s = TabStripMath.sizes(fixed: [nil, nil, nil], gap: 6, padding: 8, available: 320)
        #expect(s.widths.allSatisfy { $0 >= TabStripMath.minTab })
        #expect(TabStripMath.minTab == 96)
        #expect(s.content <= 320 + 0.5)
    }

    // MARK: MAC-36: the toast keeps its padding

    @Test func aLongToastStaysInItsPill() {
        let frame = FrameModel(client: DemoEngine().client())
        frame.toast("Couldn't move \u{201C}A very long note title that goes on and on and on and on\u{201D} to the folder you picked. Please try again.", tone: .error)
        let host = NSHostingView(rootView: ToastStack(model: frame).frame(width: 900))
        host.frame = NSRect(x: 0, y: 0, width: 900, height: 200)
        #expect(host.fittingSize.height > 0)
        let stack = NSHostingView(rootView: ToastStack(model: frame))
        // Its ideal width is never past the 448 pt pill (padding inside it).
        #expect(stack.fittingSize.width <= ToastStack.maxWidth + 0.5)
    }

    // MARK: pictures

    static let out = ProcessInfo.processInfo.environment["FOLEVI_AUDITFIX_OUT"]

    private func draw<V: View>(_ name: String, size: CGSize, _ view: (ColorScheme) -> V) async {
        _ = FoleviFonts.register()
        for scheme in [ColorScheme.light, .dark] {
            let root = view(scheme)
                .frame(width: size.width, height: size.height)
                .background(WebStyles.vars["color-canvas"]?.resolve(scheme).color ?? .white)
                .environment(\.colorScheme, scheme)
            let host = NSHostingView(rootView: root)
            host.frame = CGRect(origin: .zero, size: size)
            let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            window.contentView = host
            window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
            window.orderFrontRegardless()
            defer { window.orderOut(nil) }
            for _ in 0..<4 {
                host.layoutSubtreeIfNeeded()
                try? await Task.sleep(for: .milliseconds(120))
            }
            let image = DnaSnapshotTests.image(host, scale: 2)
            #expect(image != nil, "\(name): couldn't draw")
            if let out = Self.out, let image, let data = DnaSnapshotTests.png(image) {
                let d = URL(fileURLWithPath: out)
                try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
                try? data.write(to: d.appendingPathComponent("\(name)-\(scheme == .dark ? "dark" : "light").png"))
            }
        }
    }

    @Test func pictures() async {
        // MAC-01: disabled rows (Cut and Copy with nothing selected, a spelling row with no guesses).
        await draw("menu-disabled-rows", size: CGSize(width: 280, height: 240)) { _ in
            WebMenuContent(state: WebMenuState([
                WebMenuEntry(.item("No guesses found", id: "spell-none"), disabled: true),
                .separator(1),
                WebMenuEntry(.item("Cut", icon: .scissors, shortcut: "⌘X"), disabled: true),
                WebMenuEntry(.item("Copy", icon: .copy, shortcut: "⌘C"), disabled: true),
                WebMenuEntry(.item("Paste", icon: .clipboardPaste, shortcut: "⌘V")),
            ]), width: 220) { _ in }
            .padding(20)
        }
        // MAC-36: a long toast.
        let frame = FrameModel(client: DemoEngine().client())
        frame.toast("Couldn't move \u{201C}A very long note title that goes on and on\u{201D} to the folder you picked. Please try again.", tone: .error)
        await draw("toast-long", size: CGSize(width: 560, height: 160)) { _ in ToastStack(model: frame) }
        // MAC-11: a long name in a dialog's title, cut in the middle.
        await draw("dialog-long-title", size: CGSize(width: 480, height: 260)) { _ in
            WebSheetDialog(title: "Delete \u{201C}Quarterly planning notes for the whole team and partners\u{201D}?", description: "The folder is removed. Its documents are kept and move to Drafts.", close: {}) {
                EmptyView()
            } footer: {
                WebSheetFooter {
                    WebSheetButton(title: "Cancel") {}
                    WebSheetButton(title: "Delete folder", danger: true) {}
                }
            }
        }
        // MAC-03: a Settings confirmation in Folevi's dialog.
        await draw("settings-confirm", size: CGSize(width: 480, height: 240)) { _ in
            SettingsConfirmDialog(title: "Revoke Claude Code?", message: "Anything using it stops working at once.", confirm: "Revoke", destructive: true) {}
        }
        // MAC-02: Quick Add's calendar, the planner's own.
        await draw("quickadd-calendar", size: CGSize(width: 320, height: 340)) { _ in
            CalendarPopover(value: "2026-11-06", clearable: false) { _ in }
        }
        // MAC-31, MAC-62: the open folder's row, its pill across the chevron, title and "…"; MAC-64 at 640 pt tall.
        let side = FrameModel(client: DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000)).client())
        side.open(.folder("fld_trips"), .replace)
        let tasks: ValueStore<TaskCounts> = side.client.watch(.tasksCounts(), snapshotKey: "tasks.counts")
        await eventually("folders", timeout: .seconds(8)) { side.folders.value != nil && side.home.value != nil }
        await draw("sidebar-640-tall", size: CGSize(width: 280, height: 640)) { _ in
            WebSidebar(model: side, tasks: tasks, actions: WebSidebarActions())
        }
        await draw("sidebar-folder-row", size: CGSize(width: 280, height: 1100)) { _ in
            WebSidebar(model: side, tasks: tasks, actions: WebSidebarActions())
        }
        // MAC-35: the tab strip in a 920 pt window with five tabs open.
        let bar = FrameModel(client: DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000)).client())
        for r in [FrameRoute.notes(.starred), .notes(.all), .calendar(nil), .tasks(.today)] { bar.open(r) }
        await draw("tabstrip-920", size: CGSize(width: 920 - 272, height: 60)) { _ in WebTopBar(model: bar) }
        // MAC-65: a page the Mac has no screen for.
        await draw("unknown-page", size: CGSize(width: 640, height: 420)) { _ in
            MoreScreen(model: frame, more: MoreModels(frame: frame, feedback: ScreenModels(frame: frame).feedback), path: "/nowhere")
        }
    }
}
#endif
