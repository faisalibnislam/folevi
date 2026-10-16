// The share sheet's card: "Save to Folevi", a title field, a short preview of what's saved, where it goes
// ("Inbox in Personal"), Cancel and Save; then "Saved to your Inbox" (or "Saved, it will sync when Folevi
// opens") before it closes by itself.
import SwiftUI

struct ShareView: View {
    @ObservedObject var model: ShareModel
    @FocusState private var titleFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            card
                .frame(maxWidth: 520)
                .padding(.horizontal, 12)
                .padding(.top, 12)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.001))
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button("Cancel", action: model.cancel)
                    .font(.system(size: 16))
                    .foregroundStyle(Palette.muted)
                    .disabled(model.phase == .saving)
                Spacer()
                Button(action: model.save) {
                    Text(model.phase == .saving ? "Saving…" : "Save")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Palette.accentInk)
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(Palette.accent, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(model.phase != .editing)
                .opacity(model.phase == .editing || model.phase == .saving ? 1 : 0.5)
            }
            // The title stays in the middle whatever the buttons say ("Saving…" is wider than "Save").
            .overlay {
                Text("Save to Folevi")
                    .font(Typeface.title(18))
                    .foregroundStyle(Palette.heading)
                    .accessibilityAddTraits(.isHeader)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            Divider().overlay(Palette.line)
            switch model.phase {
            case .loading:
                Text("Opening what you shared…")
                    .font(.system(size: 15))
                    .foregroundStyle(Palette.muted)
                    .padding(16)
            case .done(let message):
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(Palette.heading)
                    Text(message)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Palette.heading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .accessibilityAddTraits(.updatesFrequently)
            default:
                form
            }
        }
        // The shadow is the card's alone (on its shape): on the whole view it would fall under every field.
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Palette.canvas)
                .shadow(color: .black.opacity(0.18), radius: 24, y: 10)
        )
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Palette.line, lineWidth: 1))
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                caps("Title")
                TextField("Untitled", text: $model.title)
                    .font(.system(size: 16))
                    .foregroundStyle(Palette.ink)
                    .focused($titleFocused)
                    .submitLabel(.done)
                    .padding(.horizontal, 12)
                    .frame(height: 40)
                    .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
            if model.content.url != nil || !model.content.text.isEmpty || !model.files.isEmpty {
                preview
            }
            if !model.skipped.isEmpty {
                Text("Left out: \(model.skipped.prefix(3).joined(separator: ", ")). Folevi takes links, text, images and PDFs up to 20 MB.")
                    .font(.system(size: 12.5))
                    .foregroundStyle(Palette.muted)
            }
            VStack(alignment: .leading, spacing: 6) {
                caps("Save to")
                Menu {
                    ForEach(model.places) { place in
                        Button {
                            model.place = place.id
                        } label: {
                            if place.id == model.place { Label("Inbox in \(place.name)", systemImage: "checkmark") } else { Text("Inbox in \(place.name)") }
                        }
                    }
                } label: {
                    HStack {
                        Text("Inbox in \(model.places.first { $0.id == model.place }?.name ?? "Personal")")
                            .font(.system(size: 15))
                            .foregroundStyle(Palette.ink)
                        Spacer()
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Palette.muted)
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 40)
                    .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
                .accessibilityLabel("Save to")
            }
            if case .failed(let message) = model.phase {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.danger)
            }
        }
        .padding(16)
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let url = model.content.url {
                Label {
                    Text(url).lineLimit(1).truncationMode(.middle)
                } icon: {
                    Image(systemName: "link")
                }
                .font(.system(size: 13))
                .foregroundStyle(Palette.ink)
            }
            if !model.content.text.isEmpty {
                Text(model.content.text)
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.muted)
                    .lineLimit(4)
            }
            ForEach(model.files) { file in
                HStack(spacing: 8) {
                    if file.isImage, let image = UIImage(data: file.data) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 28, height: 28)
                            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                    } else {
                        Image(systemName: "doc.richtext")
                            .frame(width: 28, height: 28)
                            .foregroundStyle(Palette.muted)
                    }
                    Text(file.name)
                        .font(.system(size: 13))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("What will be saved")
    }

    private func caps(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(Palette.muted)
    }
}
