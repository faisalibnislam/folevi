import Observation
import SwiftUI
import Testing
@testable import FoleviDesign
#if os(macOS)
import AppKit
#endif

/// Cards drawn once into a picture (CardPictures, the performance pass of 21 November 2026): one picture per card,
/// drawn again only for a new place between pixels, let go on a memory warning; and a folder card shown as its
/// picture looks as it does drawn live.
@Suite("Card pictures") @MainActor
struct CardPictureTests {
    private func image(_ w: Int, _ h: Int) -> CGImage? {
        CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)?.makeImage()
    }

    @Test func aPictureIsKeptUntilItsPlaceChangesOrMemoryIsShort() {
        let pictures = CardPictures.shared
        pictures.relieve()
        let start = pictures.drawn
        var draws = 0
        let draw = { () -> CGImage? in
            draws += 1
            return self.image(40, 40)
        }
        let first = pictures.picture("test-card", at: .zero, draw: draw)
        #expect(first != nil)
        // Asked again at the same place: the kept one, not drawn again.
        #expect(pictures.picture("test-card", at: .zero, draw: draw) === first)
        #expect(draws == 1)
        // At a new place between pixels: drawn again, and that one kept instead (one picture per card).
        let moved = pictures.picture("test-card", at: CGSize(width: 0.5, height: 0), draw: draw)
        #expect(draws == 2)
        #expect(pictures.kept("test-card") === moved)
        #expect(pictures.drawn == start + 2)
        // Memory is short: it goes.
        pictures.relieve()
        #expect(pictures.kept("test-card") == nil)
    }

    @Observable final class Source {
        var value = 0
    }

    @Test func aPictureIsForgottenWhenSomethingItShowedChanges() async throws {
        let pictures = CardPictures.shared
        let source = Source()
        _ = pictures.picture("observed-card", at: .zero) {
            _ = source.value
            return self.image(4, 4)
        }
        #expect(pictures.kept("observed-card") != nil)
        let changes = pictures.changes.count
        // (A style image came, or WebKit's line breaks: what the picture read has changed.)
        source.value = 1
        try await Task.sleep(for: .milliseconds(100))
        #expect(pictures.kept("observed-card") == nil)
        #expect(pictures.changes.count == changes + 1)
    }

    #if os(macOS)
    /// The frosted folder card in a window (so it draws its picture), then drawn again from that picture: the same
    /// pixels as the card drawn live.
    @Test func aFolderCardsPictureLooksLikeTheCard() async throws {
        #expect(FoleviFonts.register())
        CardPictures.shared.relieve()
        // (Leaves nothing kept for the snapshot tests after it.)
        defer { CardPictures.shared.relieve() }
        for scheme in [ColorScheme.light, .dark] {
            let card = WebFolderCard(GallerySamples.folders[1])
                .frame(width: 200, height: 200)
                .environment(\.colorScheme, scheme)
                .environment(\.coverArt, .none)
                .environment(\.displayScale, 2)
            func render() -> [UInt8]? {
                let renderer = ImageRenderer(content: card.padding(40).background(Folevi.color.canvas).environment(\.colorScheme, scheme))
                renderer.scale = 2
                return renderer.cgImage.map(pixels)
            }
            // Nothing kept yet, and one pass: drawn live, as it always was (no picture drawn).
            let before = CardPictures.shared.drawn
            let live = try #require(render())
            #expect(CardPictures.shared.drawn == before)

            let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 200, height: 200), styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: card)
            window.contentView?.layoutSubtreeIfNeeded()
            for _ in 0..<100 where CardPictures.shared.drawn < before + 2 {
                try await Task.sleep(for: .milliseconds(20))
                window.contentView?.layoutSubtreeIfNeeded()
            }
            // Its shadow and the rest, one picture each (and again if it came to rest somewhere else between pixels).
            #expect(CardPictures.shared.drawn >= before + 2)
            try await Task.sleep(for: .milliseconds(500))
            window.close()
            let drawn = CardPictures.shared.drawn

            // Drawn again: from its pictures, none drawn anew.
            let pictured = try #require(render())
            #expect(CardPictures.shared.drawn == drawn)
            #expect(live.count == pictured.count)
            var off = 0
            for i in stride(from: 0, to: min(live.count, pictured.count), by: 4) where (0..<4).contains(where: { abs(Int(live[i + $0]) - Int(pictured[i + $0])) > 8 }) { off += 1 }
            #expect(Double(off) / Double(live.count / 4) < 0.005, "\(scheme): \(off) pixels differ")
        }
    }

    /// Note cards in a window (so they draw their shadows' pictures), then drawn again: the same pixels as the cards
    /// drawn live (the plain cards' shadow picture shared, the stack's its own).
    @Test func aNoteCardsShadowPictureLooksLikeTheCard() async throws {
        #expect(FoleviFonts.register())
        CardPictures.shared.relieve()
        defer { CardPictures.shared.relieve() }
        func card(_ i: Int, shape: String) -> NoteCardModel {
            var card = GallerySamples.notes[i]
            card.starred = false
            card.template = false
            card.shape = shape
            return card
        }
        let plain = card(0, shape: ""), other = card(1, shape: ""), stack = card(0, shape: "pages")
        for scheme in [ColorScheme.light, .dark] {
            let cards = HStack(spacing: 60) {
                WebNoteCard(plain).frame(width: 200)
                WebNoteCard(other).frame(width: 200)
                WebNoteCard(stack).frame(width: 200)
            }
            .padding(60)
            .environment(\.colorScheme, scheme)
            .environment(\.coverArt, .none)
            .environment(\.displayScale, 2)
            func render() -> [UInt8]? {
                let renderer = ImageRenderer(content: cards.background(Folevi.color.canvas).environment(\.colorScheme, scheme))
                renderer.scale = 2
                return renderer.cgImage.map(pixels)
            }
            // (No exact counts of pictures drawn here: other suites draw note cards at the same time, into the same
            // shared pictures.)
            let before = CardPictures.shared.drawn
            let live = try #require(render())

            let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 840, height: 340), styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: cards)
            window.contentView?.layoutSubtreeIfNeeded()
            for _ in 0..<100 where CardPictures.shared.drawn < before + 2 {
                try await Task.sleep(for: .milliseconds(20))
                window.contentView?.layoutSubtreeIfNeeded()
            }
            // Two pictures for three cards: the two plain cards share theirs, the stack has its own.
            #expect(CardPictures.shared.drawn >= before + 2)
            try await Task.sleep(for: .milliseconds(500))
            window.close()

            // Drawn again: the shadows from their pictures, the faces live.
            let pictured = try #require(render())
            #expect(live.count == pictured.count)
            var off = 0
            for i in stride(from: 0, to: min(live.count, pictured.count), by: 4) where (0..<4).contains(where: { abs(Int(live[i + $0]) - Int(pictured[i + $0])) > 8 }) { off += 1 }
            #expect(Double(off) / Double(live.count / 4) < 0.005, "\(scheme): \(off) pixels differ")
        }
    }
    #endif
}
