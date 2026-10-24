// "Move or copy notes…" from the account menu (the web's MovePlaces.tsx, revision 8's places.move.preview and
// places.move): pick another place (or a space in it), move or copy, see what goes and whether it fits, run it.
// The move's progress shows as the placeMove gate (the page's own screen, full window); a move that has to run
// in the other place answers `switched` and the window goes there.
#if os(macOS)
import AppKit
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
            Text("Move or copy notes").font(FoleviFonts.font(.display, size: 22, weight: .semibold)).foregroundStyle(Folevi.color.heading)
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
                Text(summary(p)).foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).fixedSize(horizontal: false, vertical: true)
                if p.fits == false {
                    Text("It doesn't fit in that account's storage.").foleviFont(.callout).foregroundStyle(Folevi.color.coralInk)
                }
            } else if model.error == nil {
                ProgressView().controlSize(.small)
            }
            if let e = model.error { Text(e).foleviFont(.callout).foregroundStyle(Folevi.color.coralInk) }
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

    private func summary(_ p: PlaceMovePreview) -> String {
        let what = p.everything ? "Everything here" : "\(p.notes) \(p.notes == 1 ? "note" : "notes") and \(p.folders) \(p.folders == 1 ? "folder" : "folders")"
        return model.copy ? "\(what) will be copied. The originals stay here." : "\(what) will move. They leave this place once they've arrived."
    }
}

@MainActor
public enum PlaceMove {
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
}
#endif
