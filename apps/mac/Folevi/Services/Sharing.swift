// The Mac's Share picker (docs/MAC_POLISH_PLAN.md §3.1 File > Share, and decision M1's Share in Folevi's text
// menu): Mail, Messages, AirDrop, Notes, Reminders and the rest, from NSSharingServicePicker.
// - foleviDesktop.share({ title, text, url, fileName, rect }): what the page hands over (a note's link, selected
//   text, or a note's Markdown, which goes as a file when it has a file name), next to `rect` in the page.
// - File > Share ▸ and File > Print… (⌘P) in WM2's menu bar (Chrome.shareItems and Chrome.print, set in
//   ChromeHooks.swift): the services that take a note, and the note's print layout. Both ask the key window's
//   page for its open note (the "share" and "print" commands). Before WM2's menu bar, a File menu of their own.
import AppKit
import WebKit

@MainActor
enum Sharing {
    struct Item {
        var title: String
        var text: String?
        var url: URL?
        /// With text: send it as a file of this name ("Groceries.md") rather than as text.
        var fileName: String?
    }

    /// What NSSharingServicePicker gets for an item: a link (with its title), a file, or the text.
    static func objects(for item: Item) -> [Any] {
        if let url = item.url { return [url as NSURL] }
        guard let text = item.text, !text.isEmpty else { return [] }
        if let name = item.fileName, !name.isEmpty {
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Folevi share", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
            let file = dir.appendingPathComponent(DragOut.fileName(name.hasSuffix(".md") ? String(name.dropLast(3)) : name))
            if (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)) != nil, (try? Data(text.utf8).write(to: file, options: .atomic)) != nil {
                return [file as NSURL]
            }
        }
        return [text as NSString]
    }

    /// Shows the picker next to `rect` (page coordinates) or the pointer; true once a service was chosen.
    static func show(_ item: Item, in view: WKWebView, at rect: NSRect?) async -> Bool {
        let objects = objects(for: item)
        guard !objects.isEmpty, view.window != nil else { return false }
        let picker = NSSharingServicePicker(items: objects)
        let anchor = anchorRect(rect, in: view)
        return await withCheckedContinuation { cont in
            let delegate = PickerDelegate { cont.resume(returning: $0) }
            picker.delegate = delegate
            delegate.keep(picker)
            picker.show(relativeTo: anchor, of: view, preferredEdge: .minY)
        }
    }

    /// A page rectangle (CSS pixels from the top left) in the web view's terms; without one, the pointer.
    static func anchorRect(_ rect: NSRect?, in view: NSView) -> NSRect {
        let zoom = (view as? WKWebView)?.pageZoom ?? 1
        if let rect {
            let r = NSRect(x: rect.minX * zoom, y: rect.minY * zoom, width: rect.width * zoom, height: rect.height * zoom)
            return view.isFlipped ? r : NSRect(x: r.minX, y: view.bounds.height - r.maxY, width: r.width, height: r.height)
        }
        if let window = view.window {
            let p = view.convert(window.mouseLocationOutsideOfEventStream, from: nil)
            if view.bounds.contains(p) { return NSRect(x: p.x, y: p.y, width: 1, height: 1) }
        }
        // The top right of the page, under the toolbar.
        let y = view.isFlipped ? 44 : view.bounds.height - 44
        return NSRect(x: view.bounds.width - 60, y: y, width: 1, height: 1)
    }

    final class PickerDelegate: NSObject, NSSharingServicePickerDelegate {
        private static var alive: Set<PickerDelegate> = []
        private var done: ((Bool) -> Void)?
        private var picker: NSSharingServicePicker?

        init(_ done: @escaping (Bool) -> Void) {
            self.done = done
        }

        func keep(_ picker: NSSharingServicePicker) {
            self.picker = picker
            Self.alive.insert(self)
        }

        func sharingServicePicker(_ sharingServicePicker: NSSharingServicePicker, didChoose service: NSSharingService?) {
            done?(service != nil)
            done = nil
            picker = nil
            Self.alive.remove(self)
        }
    }

    // MARK: File > Share ▸ and File > Print… (⌘P)

    /// What a page's File > Share sends (foleviDesktop.setShareTarget, on every route change): the open note's
    /// title, and its link when it has one on Folevi's website. Its Markdown is asked for when a service is
    /// chosen. Nil: nothing to share there.
    struct Target {
        var title: String
        var url: URL?
    }

    static var targets: [ObjectIdentifier: Target] = [:]

    static func setTarget(_ target: Target?, for view: FoleviWebView) {
        targets[ObjectIdentifier(view)] = target
    }

    /// File > Share's items for a view: the services that take a note (a Markdown file, and its link).
    static func menuItems(for view: FoleviWebView) -> [NSMenuItem] {
        guard NativeFrame.showsNote(view), let target = targets[ObjectIdentifier(view)] else { return [] }
        let sample = FileManager.default.temporaryDirectory.appendingPathComponent("Folevi share sample.md")
        if !FileManager.default.fileExists(atPath: sample.path) { try? Data("Folevi".utf8).write(to: sample) }
        let services = NSSharingService.sharingServices(forItems: [sample] + (target.url.map { [$0] } ?? []))
        return services.map { service in
            let item = NSMenuItem(title: service.menuItemTitle, action: #selector(Actions.shareWith(_:)), keyEquivalent: "")
            item.image = service.image
            item.target = Actions.shared
            item.representedObject = ShareChoice(service: service, view: view)
            return item
        }
    }

    final class ShareChoice: NSObject {
        let service: NSSharingService
        weak var view: FoleviWebView?
        init(service: NSSharingService, view: FoleviWebView) {
            self.service = service
            self.view = view
        }
    }

    final class Actions: NSObject {
        static let shared = Actions()

        @objc func shareWith(_ sender: NSMenuItem) {
            guard let choice = sender.representedObject as? ShareChoice, let view = choice.view else { return }
            Task { @MainActor in await Sharing.share(with: choice.service, from: view) }
        }

        @objc func shareFront(_ sender: Any?) {
            Task { @MainActor in
                guard let view = WindowManager.shared.frontMain?.view else { return }
                await Sharing.shareWithPicker(from: view)
            }
        }

        @objc func printFront(_ sender: Any?) {
            Task { @MainActor in
                guard let view = WindowManager.shared.frontMain?.view else { return }
                await Sharing.printNote(view)
            }
        }
    }

    /// The note the page shows, from the page: { title, text (Markdown), url? }. Nil when it has none.
    static func note(from view: FoleviWebView) async -> Item? {
        guard NativeFrame.showsNote(view), let answer = await Capabilities.ask(["type": "share"], to: view, timeout: 20), answer["ok"] as? Bool != false, let text = answer["text"] as? String else { return nil }
        let title = answer["title"] as? String ?? ""
        return Item(
            title: title,
            text: text,
            url: (answer["url"] as? String).flatMap(URL.init(string:)).flatMap { ["http", "https"].contains($0.scheme ?? "") ? $0 : nil },
            fileName: title.isEmpty ? "Untitled" : title
        )
    }

    static func share(with service: NSSharingService, from view: FoleviWebView) async {
        guard let item = await note(from: view) else { return }
        let objects = objects(for: item) + (item.url.map { [$0 as NSURL] } ?? [])
        service.subject = item.title
        if service.canPerform(withItems: objects) { service.perform(withItems: objects) }
    }

    static func shareWithPicker(from view: FoleviWebView) async {
        guard var item = await note(from: view) else { return }
        let link = item.url
        item.url = nil
        let objects = objects(for: item) + (link.map { [$0 as NSURL] } ?? [])
        guard !objects.isEmpty else { return }
        let picker = NSSharingServicePicker(items: objects)
        picker.show(relativeTo: anchorRect(nil, in: view), of: view, preferredEdge: .minY)
    }

    /// File > Print: the page prints its open note in the note's print layout (the PDF export's clean page);
    /// a page that has no note open, or doesn't answer, prints as it is. With the native frame only a note on
    /// screen prints (the page behind a native screen isn't what the window shows).
    static func printNote(_ view: FoleviWebView) async {
        let framed = NativeFrame.controller(for: view) != nil
        guard NativeFrame.showsNote(view) else { return NSSound.beep() }
        let answer = await Capabilities.ask(["type": "print"], to: view, timeout: 20)
        if answer?["handled"] as? Bool != true, !framed { Printing.printPage(view) }
    }

    /// Before WM2's menu bar (the starter menu has no File menu): Share… and Print… in a File menu of their own.
    static func installMenu() {
        guard let main = NSApp.mainMenu, !main.items.contains(where: { $0.submenu?.title == "File" }) else { return }
        let file = NSMenu(title: "File")
        let share = NSMenuItem(title: "Share…", action: #selector(Actions.shareFront(_:)), keyEquivalent: "")
        share.target = Actions.shared
        file.addItem(share)
        let print = NSMenuItem(title: "Print…", action: #selector(Actions.printFront(_:)), keyEquivalent: "p")
        print.target = Actions.shared
        file.addItem(print)
        let item = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
        item.submenu = file
        main.insertItem(item, at: min(1, main.items.count))
    }
}
