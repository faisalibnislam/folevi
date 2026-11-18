// "Move or copy notes…" from the account menu (the web's MovePlaces.tsx, revision 8's places.move.preview and
// places.move): pick another place (or a space in it), move or copy, see what goes and whether it fits, run it.
// The move's progress shows as the placeMove gate (the page's own screen, full window); a move that has to run
// in the other place answers `switched` and the window goes there.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import FoleviDesign
import FoleviEngine

@MainActor
@Observable
final class PlaceMoveModel {
    let frame: FrameModel
    var preview: PlaceMovePreview?
    var destination: String?
    var copy = false
    var running = false
    var error: String?

    init(frame: FrameModel) { self.frame = frame }

    func load() async {
        do {
            let p = try await frame.client.query(.placesMovePreview(to: destination))
            preview = p
            if destination == nil { destination = p.destinations.first?.value }
            if let d = destination, p.to?.value != d { preview = try await frame.client.query(.placesMovePreview(to: d)) }
            error = nil
        } catch let f as EngineFailure {
            error = f.message
        } catch {
            self.error = "Something went wrong. Try again."
        }
    }

    func run(close: @escaping () -> Void) async {
        guard let d = destination else { return }
        running = true
        defer { running = false }
        do {
            let r = try await frame.client.command(.placesMove(to: d, copy: copy))
            close()
            switch r.status {
            case "switched": frame.toast("The move continues in the other place.")
            case "done": frame.toast("\(copy ? "Copied" : "Moved") \(r.notes) \(r.notes == 1 ? "note" : "notes")\(r.problems > 0 ? ", \(r.problems) couldn't" : "").", tone: r.problems > 0 ? .error : .success)
            default: break
            }
        } catch let f as EngineFailure {
            error = f.message
        } catch {
            self.error = "Something went wrong. Try again."
        }
    }
}

struct PlaceMoveSheet: View {
    @State var model: PlaceMoveModel
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            title
            if let p = model.preview {
                Picker("To", selection: Binding(get: { model.destination ?? "" }, set: { v in
                    model.destination = v
                    Task { await model.load() }
                })) {
                    ForEach(p.destinations, id: \.value) { d in Text(d.label).tag(d.value) }
                }
                .accessibilityIdentifier("move.destination")
                Picker("", selection: $model.copy) {
                    Text("Move").tag(false)
                    Text("Copy").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                note(summary(p), danger: false)
                if p.fits == false {
                    note("It doesn't fit in that account's storage.", danger: true)
                }
            } else if model.error == nil {
                ProgressView().controlSize(.small)
            }
            if let e = model.error { note(e, danger: true) }
            HStack {
                Spacer()
                Button("Cancel", action: close).keyboardShortcut(.cancelAction)
                Button(model.copy ? "Copy" : "Move") { Task { await model.run(close: close) } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.running || model.destination == nil || model.preview?.fits == false)
                    .accessibilityIdentifier("move.run")
            }
        }
        .padding(24)
        .frame(width: 420)
        .task { await model.load() }
    }

    /// The sheet's title: the system's 13 pt bold on the Mac (a sheet, 2026-11-18), the display face on the iPad.
    @ViewBuilder private var title: some View {
        #if os(macOS)
        Text("Move or copy notes").font(MacLook.Text.headline).foregroundStyle(MacLook.Colors.label)
        #else
        Text("Move or copy notes").font(FoleviFonts.font(.display, size: 22, weight: .semibold)).foregroundStyle(Folevi.color.heading)
        #endif
    }

    /// What will happen, or a problem (red).
    @ViewBuilder private func note(_ text: String, danger: Bool) -> some View {
        #if os(macOS)
        Text(text).font(MacLook.Text.body).foregroundStyle(danger ? MacLook.Colors.red : MacLook.Colors.secondary).fixedSize(horizontal: false, vertical: true)
        #else
        Text(text).foleviFont(.callout).foregroundStyle(danger ? Folevi.color.coralInk : Folevi.color.inkMuted).fixedSize(horizontal: false, vertical: true)
        #endif
    }

    private func summary(_ p: PlaceMovePreview) -> String {
        let what = p.everything ? "Everything here" : "\(p.notes) \(p.notes == 1 ? "note" : "notes") and \(p.folders) \(p.folders == 1 ? "folder" : "folders")"
        return model.copy ? "\(what) will be copied. The originals stay here." : "\(what) will move. They leave this place once they've arrived."
    }
}

@MainActor
public enum PlaceMove {
#if os(macOS)
    /// Shows the sheet over a window's frame.
    public static func present(from controller: NSViewController, model frame: FrameModel) {
        var host: NSHostingController<PlaceMoveSheet>?
        let sheet = PlaceMoveSheet(model: PlaceMoveModel(frame: frame)) { [weak controller] in
            if let h = host { controller?.dismiss(h) }
        }
        let h = NSHostingController(rootView: sheet)
        host = h
        controller.presentAsSheet(h)
    }
#else
    /// Shows the sheet over a window's frame.
    public static func present(from controller: UIViewController, model frame: FrameModel) {
        var host: UIHostingController<PlaceMoveSheet>?
        let sheet = PlaceMoveSheet(model: PlaceMoveModel(frame: frame)) {
            host?.dismiss(animated: true)
        }
        let h = UIHostingController(rootView: sheet)
        host = h
        h.modalPresentationStyle = .formSheet
        controller.present(h, animated: true)
    }
#endif
}
#endif
