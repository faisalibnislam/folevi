import SwiftUI

/// One Unsplash photo as `unsplash:search` returns it (convex/unsplash.ts).
struct UnsplashPhoto: Decodable, Sendable, Identifiable, Hashable {
    var id: String
    var alt: String
    var width: Double
    var height: Double
    var color: String?
    var thumbUrl: String
    var url: String
    var photographer: String
    var photographerUrl: String?
}

private struct UnsplashSearchResult: Decodable, Sendable {
    var configured: Bool
    var photos: [UnsplashPhoto]?
    var totalPages: Int?
}

/// Image from Unsplash, as on the web (UnsplashDialog.tsx in a large Dialog): search, pick, and the photo
/// is inserted hotlinked with a credit caption. The search runs on the Folevi server (the access key
/// never reaches this Mac).
struct UnsplashSheet: View {
    @Bindable var model: EditorModel
    var anchor: String
    @DialogDismiss private var dismiss
    @State private var query = ""
    @State private var state: Phase = .idle
    @State private var seq = 0
    @FocusState private var searchFocused: Bool

    enum Phase: Equatable {
        case idle, loading, unconfigured
        case error(String)
        case results(query: String, photos: [UnsplashPhoto], page: Int, totalPages: Int)
    }

    private static let unsplashLink = URL(string: "https://unsplash.com/?utm_source=folevi&utm_medium=referral")!

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                content
                    .padding(.horizontal, 24)
                    .padding(.vertical, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        // The web's `max-w-3xl` dialog, up to 85% of the window's height.
        .frame(width: 768)
        .frame(minHeight: 360, idealHeight: 660, maxHeight: 760)
        .background(FoleviColor.surface)
        .onExitCommand { dismiss() }
        .task {
            run("")
            try? await Task.sleep(for: .milliseconds(50))
            searchFocused = true
        }
    }

    /// Title, description and Close (the web Dialog's header: px 24, top 20, bottom 8).
    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Image from Unsplash")
                    .font(FoleviType.display(21))
                    .tracking(FoleviType.displayTracking(21))
                    .foregroundStyle(FoleviColor.heading)
                    .accessibilityAddTraits(.isHeader)
                Text("Free photos from Unsplash, credited to the photographer.")
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 14, weight: .medium))
            }
            .buttonStyle(UnsplashIconButtonStyle())
            .keyboardShortcut(.cancelAction)
            .help(Text("Close"))
            .accessibilityLabel(Text("Close"))
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
        .padding(.bottom, 8)
    }

    @ViewBuilder private var content: some View {
        if state == .unconfigured {
            VStack(alignment: .leading, spacing: 4) {
                Text("Unsplash isn’t set up for this Folevi server yet")
                    .font(.ui(13, .medium))
                    .foregroundStyle(FoleviColor.heading)
                Text("An administrator can turn it on by adding an Unsplash access key (UNSPLASH_ACCESS_KEY) to the server’s settings.")
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surfaceSunken))
            .accessibilityElement(children: .combine)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                searchRow
                results
                    .frame(maxWidth: .infinity, minHeight: 192, alignment: .top)
                    .padding(.top, 16)
                credit
                    .padding(.top, 12)
            }
        }
    }

    private var searchRow: some View {
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .accessibilityHidden(true)
                TextField("", text: $query, prompt: Text("Search photos").foregroundColor(FoleviColor.inkFaint))
                    .textFieldStyle(.plain)
                    .font(.ui(13))
                    .foregroundStyle(FoleviColor.ink)
                    .focused($searchFocused)
                    .onSubmit { run(query.trimmingCharacters(in: .whitespacesAndNewlines)) }
                    .accessibilityLabel(Text("Search Unsplash photos"))
            }
            .padding(.horizontal, 14)
            .frame(height: 40)
            .frame(maxWidth: .infinity)
            .background {
                // `.ui-well`: the glass hover tint with a fine inner edge.
                let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
                shape.fill(FoleviGlass.hover).overlay(shape.strokeBorder(FoleviGlass.border, lineWidth: 1))
            }
            .overlay {
                if searchFocused {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FoleviColor.focus, lineWidth: 2).padding(-2)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { searchFocused = true }
            Button("Search") { run(query.trimmingCharacters(in: .whitespacesAndNewlines)) }
                .buttonStyle(.folevi(.primary, .medium))
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var results: some View {
        switch state {
        case .loading:
            message(Text("Searching…"), color: FoleviColor.inkMuted)
        case .error(let text):
            message(Text(text), color: FoleviColor.destructive)
        case .results(let q, let photos, let page, let total):
            if photos.isEmpty {
                message(Text("No photos found for “\(q)”."), color: FoleviColor.inkMuted)
            } else {
                VStack(spacing: 0) {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .top), count: 3), spacing: 10) {
                        ForEach(photos) { p in
                            UnsplashTile(photo: p) { choose(p) }
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text("Photos"))
                    .accessibilityValue(Text("\(photos.count) photos"))
                    if page < total {
                        Button("More photos") { run(q, page: page + 1) }
                            .buttonStyle(.folevi(.quiet, .medium))
                            .frame(maxWidth: .infinity)
                            .padding(.top, 12)
                    }
                }
            }
        case .idle, .unconfigured:
            Color.clear.frame(height: 0)
        }
    }

    private func message(_ text: Text, color: Color) -> some View {
        text
            .font(.ui(13))
            .foregroundStyle(color)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
    }

    /// "Photos from Unsplash. Inserted photos are credited in their caption.", with Unsplash linked.
    private var credit: some View {
        var link = AttributedString(String(localized: "Unsplash"))
        link.link = Self.unsplashLink
        link.underlineStyle = .single
        link.foregroundColor = FoleviColor.inkMuted
        let text = AttributedString(String(localized: "Photos from ")) + link
            + AttributedString(String(localized: ". Inserted photos are credited in their caption."))
        return Text(text)
            .font(.ui(11.5))
            .foregroundStyle(FoleviColor.inkMuted)
            .tint(FoleviColor.inkMuted)
    }

    private func run(_ q: String, page: Int = 1) {
        guard let session = model.app.session else { return }
        seq += 1
        let mine = seq
        if page == 1 { state = .loading }
        Task { @MainActor in
            do {
                let r: UnsplashSearchResult = try await session.convex.action("unsplash:search", ["query": .string(q), "page": .number(Double(page))])
                guard mine == seq else { return }
                guard r.configured else { state = .unconfigured; return }
                let photos = r.photos ?? []
                if page > 1, case .results(let prevQ, let prev, _, _) = state {
                    state = .results(query: prevQ, photos: prev + photos, page: page, totalPages: r.totalPages ?? page)
                } else {
                    state = .results(query: q, photos: photos, page: page, totalPages: r.totalPages ?? 1)
                }
            } catch {
                if mine == seq { state = .error(ConvexService.mapError(error).localizedDescription) }
            }
        }
    }

    private func choose(_ p: UnsplashPhoto) {
        // Unsplash asks apps to report each use of a photo; failures don't block inserting it.
        if let session = model.app.session {
            Task { let _: JSONValue? = try? await session.convex.action("unsplash:trackDownload", ["photoId": .string(p.id)]) }
        }
        let credit = String(localized: "Photo by \(p.photographer) on Unsplash")
        model.insertAfterCurrent(.image(ImageProps(url: p.url, alt: p.alt.isEmpty ? credit : p.alt, caption: credit,
                                                   naturalWidth: p.width > 0 ? p.width : nil, naturalHeight: p.height > 0 ? p.height : nil)),
                                 anchor: anchor)
        dismiss()
    }
}

/// One result: the 3:2 thumbnail on the photo's own colour (it grows a touch on hover), and the
/// photographer's name linking to their Unsplash profile.
private struct UnsplashTile: View {
    let photo: UnsplashPhoto
    var onPick: () -> Void
    @State private var hovering = false
    @State private var nameHovering = false
    @FocusState private var focused: Bool
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button(action: onPick) {
                (photo.color.flatMap { Color(hex: $0) } ?? FoleviColor.surfaceSunken)
                    .aspectRatio(3 / 2, contentMode: .fit)
                    .overlay {
                        AsyncImage(url: URL(string: photo.thumbUrl)) { image in
                            image.resizable().aspectRatio(contentMode: .fill)
                        } placeholder: { Color.clear }
                        .scaleEffect(hovering ? 1.03 : 1)
                        .animation(.easeOut(duration: 0.2), value: hovering)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            .buttonStyle(.plain)
            .focused($focused)
            .focusEffectDisabled()
            .overlay {
                if focused {
                    RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(FoleviColor.focus, lineWidth: 2).padding(-4)
                }
            }
            .onHover { hovering = $0 }
            .accessibilityLabel(Text("Insert photo by \(photo.photographer)\(photo.alt.isEmpty ? "" : ": \(photo.alt)")"))
            Group {
                if let link = photo.photographerUrl.flatMap(URL.init(string:)) {
                    Button { openURL(link) } label: {
                        Text(photo.photographer)
                            .underline(nameHovering)
                            .foregroundStyle(nameHovering ? FoleviColor.ink : FoleviColor.inkMuted)
                    }
                    .buttonStyle(.plain)
                    .onHover { nameHovering = $0 }
                    .pointerStyle(.link)
                    .accessibilityAddTraits(.isLink)
                } else {
                    Text(photo.photographer).foregroundStyle(FoleviColor.inkMuted)
                }
            }
            .font(.ui(11.5))
            .lineLimit(1)
            .truncationMode(.tail)
        }
    }
}

/// The dialog's Close: a 32pt quiet icon button with 6pt corners (the web's IconButton).
private struct UnsplashIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        UnsplashIconButtonBody(configuration: configuration)
    }
}

private struct UnsplashIconButtonBody: View {
    let configuration: ButtonStyle.Configuration
    @State private var hovering = false

    var body: some View {
        configuration.label
            .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.inkMuted)
            .frame(width: 32, height: 32)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(hovering || configuration.isPressed ? FoleviGlass.hover : .clear))
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .onHover { hovering = $0 }
    }
}
