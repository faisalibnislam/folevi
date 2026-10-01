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

/// Image from Unsplash, as on the web (UnsplashDialog.tsx): search, pick, and the photo is inserted
/// hotlinked with a credit caption. The search runs on the Folevi server.
struct UnsplashSheet: View {
    @Bindable var model: EditorModel
    var anchor: String
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var state: Phase = .idle
    @State private var seq = 0

    enum Phase: Equatable {
        case idle, loading, unconfigured
        case error(String)
        case results(query: String, photos: [UnsplashPhoto], page: Int, totalPages: Int)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Image from Unsplash").font(.ui(15, .semibold)).foregroundStyle(FoleviColor.heading)
                    Text("Free photos from Unsplash, credited to the photographer.").font(.ui(12.5)).foregroundStyle(FoleviColor.inkMuted)
                }
                Spacer()
                IconButton(systemImage: "xmark", label: "Close", size: 28) { dismiss() }
            }
            if state == .unconfigured {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Unsplash isn’t set up for this Folevi server yet").font(.ui(13, .medium)).foregroundStyle(FoleviColor.heading)
                    Text("An administrator can turn it on by adding an Unsplash access key (UNSPLASH_ACCESS_KEY) to the server’s settings.")
                        .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surfaceSunken))
            } else {
                HStack(spacing: 8) {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                        TextField("Search photos", text: $query)
                            .textFieldStyle(.plain)
                            .font(.ui(13.5))
                            .onSubmit { run(query.trimmingCharacters(in: .whitespaces)) }
                            .accessibilityLabel(Text("Search Unsplash photos"))
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .foleviWell(shape: .rounded(6))
                    Button("Search") { run(query.trimmingCharacters(in: .whitespaces)) }
                        .buttonStyle(.folevi(.primary, .medium))
                }
                results.frame(minHeight: 192)
                Text("Photos from Unsplash. Inserted photos are credited in their caption.")
                    .font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted)
            }
        }
        .padding(20)
        .frame(width: 640, height: 560, alignment: .top)
        .task { run("") }
    }

    @ViewBuilder private var results: some View {
        switch state {
        case .loading:
            Text("Searching…").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).frame(maxWidth: .infinity).padding(.vertical, 40)
        case .error(let message):
            Text(message).font(.ui(13)).foregroundStyle(FoleviColor.destructive).frame(maxWidth: .infinity).padding(.vertical, 40)
        case .results(let q, let photos, let page, let total):
            if photos.isEmpty {
                Text("No photos found for “\(q)”.").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).frame(maxWidth: .infinity).padding(.vertical, 40)
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                        ForEach(photos) { p in
                            VStack(alignment: .leading, spacing: 4) {
                                Button { choose(p) } label: {
                                    (p.color.flatMap { Color(hex: $0) } ?? FoleviColor.surfaceSunken)
                                        .aspectRatio(3 / 2, contentMode: .fit)
                                        .overlay {
                                            AsyncImage(url: URL(string: p.thumbUrl)) { image in
                                                image.resizable().aspectRatio(contentMode: .fill)
                                            } placeholder: { Color.clear }
                                        }
                                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(Text("Insert photo by \(p.photographer)\(p.alt.isEmpty ? "" : ": \(p.alt)")"))
                                Text(p.photographer).font(.ui(11.5)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
                            }
                        }
                    }
                    if page < total {
                        Button("More photos") { run(q, page: page + 1) }
                            .buttonStyle(.folevi(.quiet, .medium))
                            .frame(maxWidth: .infinity)
                            .padding(.top, 10)
                    }
                }
            }
        default:
            Color.clear
        }
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
