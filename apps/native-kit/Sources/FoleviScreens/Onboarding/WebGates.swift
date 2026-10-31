// The screens before the app in the native frames (the Mac's, and the iPhone's from I2), drawn as the web draws them in Folevi for Mac (owner,
// 2026-10-27: "looks must match 100% with the web app"), from the live web's styles ("gates.*" in
// packages/design-tokens/match/app-styles/gates.json):
//
//   modeChoice      components/app/ModeChoice.tsx: the logo, "Where should your notes live?", two choices
//   librarySetup    components/app/LibrarySetup.tsx: the places (iCloud, Dropbox, Google Drive, a folder, this Mac
//                   only) and Back; then "Your library is ready" with the optional passphrase and Open Folevi
//   libraryLocked   components/app/LockedLibrary.tsx: the passphrase and Unlock
//   loading         the page's background (the web shows nothing for its first moments, then the F loader)
//   everything else lib/app/state.tsx FullPageMessage: the card with its title, text, fields and buttons (sign-in,
//                   offline, update required, suspended, email unverified, setup failed, device limit, moves,
//                   migration, encryption, onboarding)
//
// The page's own screen stays mounted behind (components/engine NativeGate reports it); every button here is
// `gate.act` on it, so the web's handlers do the work (library.setup opens the folder picker, sign-in opens the
// sign-in sheet with PKCE) and native never has a second copy of the logic.
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import FoleviDesign
import FoleviEngine

/// A gate style by id, for this scheme.
@MainActor
private func gs(_ id: String, _ scheme: ColorScheme) -> WebComputedStyle { WebStyles.named(id).resolve(scheme) }

public struct WebGateScreen: View {
    @Bindable var model: GateModel
    @Environment(\.colorScheme) private var scheme

    public init(model: GateModel) { self.model = model }

    public var body: some View {
        ZStack {
            gs("gates.page", scheme).background.color.ignoresSafeArea()
            switch model.kind {
            case .loading: Color.clear
            case .modeChoice: ModeChoiceGate(model: model)
            case .librarySetup: LibrarySetupGate(model: model)
            case .libraryLocked: LockedLibraryGate(model: model)
            default: MessageCardGate(model: model)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("gate-\(model.kind.raw)")
    }
}

// MARK: Pieces shared by the screens

/// One line of text in a measured style (its font, line box and colour).
struct GateLine: View {
    let text: String
    let id: String
    var align: Alignment = .leading
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let s = gs(id, scheme)
        Text(text).webText(s.text).lineLimit(1).foregroundStyle(s.color.color).opacity(s.opacity)
            .frame(maxWidth: .infinity, alignment: align)
    }
}

/// A paragraph in a measured style, broken into lines as WebKit breaks it (`text-wrap: pretty`) at the
/// element's measured width.
struct GateParagraph: View {
    let runs: [WebRun]
    let id: String
    var center = true
    var width: CGFloat?
    var color: RGBA?
    /// A `<p>` (`text-wrap: pretty`, globals.css); false for a span, which breaks greedily on the iPhone.
    var paragraph = true
    @Environment(\.colorScheme) private var scheme

    init(_ text: String, id: String, center: Bool = true, width: CGFloat? = nil, color: RGBA? = nil, paragraph: Bool = true) {
        self.init(runs: [WebRun(text)], id: id, center: center, width: width, color: color, paragraph: paragraph)
    }

    init(runs: [WebRun], id: String, center: Bool = true, width: CGFloat? = nil, color: RGBA? = nil, paragraph: Bool = true) {
        self.runs = runs
        self.id = id
        self.center = center
        self.width = width
        self.color = color
        self.paragraph = paragraph
    }

    var body: some View {
        let s = gs(id, scheme)
        // (Its lines break inside its padding.)
        WebParagraph(runs, style: s.text, width: width ?? (s.width - s.padding.left - s.padding.right), alignment: center ? .center : .leading, wrap: Self.wrap(paragraph))
            .padding(.horizontal, width == nil ? s.padding.left : 0)
            .foregroundStyle((color ?? s.color).color)
            .opacity(s.opacity)
            .frame(maxWidth: .infinity, alignment: center ? .center : .leading)
    }
}

extension GateParagraph {
    /// `text-wrap: pretty` (a paragraph) as each platform's WebKit lays it out; a span's plain breaks on the iPhone.
    static func wrap(_ paragraph: Bool) -> WebTextWrap {
        #if os(iOS)
        paragraph ? .iPhonePretty : .greedy
        #else
        .pretty
        #endif
    }
}

/// The spinner the web draws for a busy button (Loader2, spinning).
struct GateSpinner: View {
    let size: CGFloat
    @State private var on = false
    var body: some View {
        WebIconView(.loaderCircle, size: size)
            .rotationEffect(.degrees(on ? 360 : 0))
            .animation(.linear(duration: 1).repeatForever(autoreverses: false), value: on)
            .onAppear { on = true }
    }
}

/// `ChoiceButton` (ModeChoice.tsx) on the Mac: the 40 pt tile, the title over its line, the chevron; `emphasis` is
/// the black one. Hover: the emphasis one mixes 12% of the canvas in, the other takes the glass hover.
struct GateChoice<Icon: View>: View {
    let title: String
    let detail: String
    var emphasis = false
    var busy = false
    let action: () -> Void
    @ViewBuilder let icon: () -> Icon
    @State private var hover = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        #if os(iOS)
        phone
        #else
        mac
        #endif
    }

    /// The iPhone's: every answer the same card (--iphone-row, the container radius, a hairline and a soft
    /// shadow), the suggested one saying so in a caption over its title.
    private var phone: some View {
        let base = emphasis ? "gates.choice.emphasis" : "gates.choice"
        let box = gs(base, scheme)
        let tile = gs("\(base).tile", scheme)
        let chevron = gs("\(base).chevron", scheme)
        let corners = WebCornersShape(topLeft: box.radius, topRight: box.radius, bottomRight: box.radius, bottomLeft: box.radius)
        return Button(action: action) {
            HStack(spacing: box.gap) {
                icon()
                    .frame(width: tile.width, height: tile.height)
                    .background(RoundedRectangle(cornerRadius: tile.radius, style: .continuous).fill(tile.background.color))
                VStack(alignment: .leading, spacing: 0) {
                    if emphasis {
                        // (On the iPhone the Mac's selector for this card's title finds its caption, its first line:
                        // that measured style is the caption's; both titles share the other card's.)
                        GateLine(text: "RECOMMENDED", id: "gates.choice.emphasis.title")
                    }
                    GateLine(text: title, id: "gates.choice.title")
                    GateParagraph(detail, id: emphasis ? "gates.choice.emphasis.detail" : "gates.lib.place.detail", center: false, paragraph: false)
                        .padding(.top, 2)
                }
                Group {
                    if busy { GateSpinner(size: 18) } else { WebIconView(.chevronRight, size: 18, strokeWidth: 2.2) }
                }
                .frame(width: chevron.width, height: chevron.height)
                .foregroundStyle(chevron.color.color)
            }
            .padding(box.padding.edgeInsets)
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .foregroundStyle(box.color.color)
            .background(WebShapeBox(shape: corners, fill: box.background.color, shadows: box.shadows))
            .contentShape(RoundedRectangle(cornerRadius: box.radius, style: .continuous))
        }
        .buttonStyle(ChoicePress())
        .opacity(enabled ? 1 : 0.6)
    }

    @ViewBuilder private var mac: some View {
        let base = emphasis ? "gates.choice.emphasis" : "gates.choice"
        let box = gs(base, scheme)
        let tile = gs("\(base).tile", scheme)
        let chevron = gs("\(base).chevron", scheme)
        let canvas = gs("gates.page", scheme).background
        let fill: RGBA = !hover || !enabled ? box.background : emphasis ? box.background.mixed(with: canvas, 0.12) : (WebStyles.vars["glass-hover"]?.resolve(scheme) ?? box.background)
        Button(action: action) {
            HStack(spacing: box.gap) {
                icon()
                    .frame(width: tile.width, height: tile.height)
                    .background(RoundedRectangle(cornerRadius: tile.radius, style: .continuous).fill(tile.background.color))
                VStack(alignment: .leading, spacing: 0) {
                    GateLine(text: title, id: "\(base).title")
                    GateParagraph(detail, id: emphasis ? "gates.choice.emphasis.detail" : "gates.lib.place.detail", center: false)
                        .padding(.top, 2)
                }
                Group {
                    if busy { GateSpinner(size: 18) } else { WebIconView(.chevronRight, size: 18).opacity(chevron.opacity).offset(x: hover && enabled ? 2 : 0) }
                }
                .frame(width: chevron.width, height: chevron.height)
                .foregroundStyle(chevron.color.color)
            }
            .padding(box.padding.edgeInsets)
            // (CSS draws the 1 pt border outside the padding: it takes room.)
            .padding(box.borderWidth)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .foregroundStyle(box.color.color)
            .background(
                RoundedRectangle(cornerRadius: box.radius, style: .continuous).fill(fill.color)
                    .overlay(RoundedRectangle(cornerRadius: box.radius, style: .continuous).strokeBorder(box.borderColor.color, lineWidth: box.borderWidth))
            )
            .contentShape(RoundedRectangle(cornerRadius: box.radius, style: .continuous))
        }
        .buttonStyle(GatePressStyle())
        .opacity(enabled ? 1 : 0.6)
        .onHover { hover = $0 }
        .animation(.easeOut(duration: 0.15), value: hover)
    }
}

/// The column every screen before the app stands in: centred in the window, `width` wide. On the iPhone the web's
/// page starts under the status bar (the page's body is padded by it) and is the screen's height from there, so the
/// column centres there and the page scrolls by the status bar's height.
struct GateColumn<Content: View>: View {
    let width: CGFloat
    let gap: CGFloat
    @ViewBuilder let content: () -> Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let page = gs("gates.page", scheme)
        #if os(iOS)
        GeometryReader { geo in
            let top = geo.safeAreaInsets.top
            ScrollView(.vertical) {
                VStack(spacing: gap, content: content)
                    .frame(width: width)
                    .padding(page.padding.edgeInsets)
                    .frame(maxWidth: .infinity)
                    .containerRelativeFrame(.vertical, alignment: .center) { h, _ in h }
                    .padding(.top, top)
            }
            .scrollBounceBehavior(.basedOnSize)
            .ignoresSafeArea()
        }
        #else
        ScrollView(.vertical) {
            VStack(spacing: gap, content: content)
                .frame(width: width)
                .padding(page.padding.edgeInsets)
                .frame(maxWidth: .infinity)
                .containerRelativeFrame(.vertical, alignment: .center) { h, _ in h }
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollIndicators(.automatic)
        #endif
    }
}

/// The logo and the title (and its line), as the screens before the app head themselves.
struct GateHeader: View {
    let title: String
    var message: [WebRun]?
    var messageId = "gates.lib.message"
    var gap: CGFloat = 20
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let logo = gs("gates.logo", scheme)
        VStack(spacing: gap) {
            WebFoleviLogo(height: logo.height, color: logo.color.color)
            #if os(iOS)
            // The large title, on as many lines as it takes at its width (`text-wrap: balance`).
            let t = gs("gates.title", scheme)
            WebParagraph([WebRun(title)], style: t.text, width: t.width, alignment: .center, wrap: .balance)
                .foregroundStyle(t.color.color)
                .frame(maxWidth: .infinity)
            #else
            GateLine(text: title, id: "gates.title", align: .center)
            #endif
            if let message { GateParagraph(runs: message, id: messageId) }
        }
    }
}

extension RGBA {
    /// CSS `color-mix(in oklab, self (1 - t), other t)`, close enough in sRGB for the small mixes the web uses.
    func mixed(with other: RGBA, _ t: CGFloat) -> RGBA {
        let s = 1 - t
        return RGBA((r * s + other.r * t).rounded(), (g * s + other.g * t).rounded(), (b * s + other.b * t).rounded(), a * s + other.a * t)
    }
}

// MARK: First launch

struct ModeChoiceGate: View {
    @Bindable var model: GateModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let column = gs("gates.column", scheme)
        let actions = model.gate?.actions ?? []
        GateColumn(width: column.width, gap: column.gap) {
            GateHeader(title: model.title)
            VStack(spacing: 12) {
                ForEach(actions, id: \.id) { a in
                    let account = a.id == "account"
                    GateChoice(title: a.label, detail: Self.detail(a.id), emphasis: account, busy: model.pending == a.id, action: { Task { await model.act(a.id) } }) {
                        if account {
                            // (Inverse on the Mac's black card; the iPhone's cards are all white.)
                            WebFoleviMark(size: 24, inverse: Self.macCards)
                        } else {
                            WebIconView(.hardDrive, size: 20)
                        }
                    }
                    .disabled(model.pending != nil || !a.enabled)
                    .accessibilityIdentifier("gate-action-\(a.id)")
                }
            }
            GateParagraph(model.message, id: "gates.footnote")
            if let error = model.errorMessage {
                GateParagraph(error, id: "gates.footnote", color: WebStyles.vars["color-danger"]?.resolve(scheme) ?? RGBA(179, 52, 44))
            }
        }
    }

    static var macCards: Bool {
        #if os(macOS)
        true
        #else
        false
        #endif
    }

    static func detail(_ id: String) -> String {
        switch id {
        case "account": "Your notes in your Folevi account, with sharing."
        case "local": "Free forever. No account."
        default: ""
        }
    }
}

// MARK: Library setup

struct LibrarySetupGate: View {
    @Bindable var model: GateModel
    @Environment(\.colorScheme) private var scheme

    private var ready: Bool { model.gate?.actions.contains { $0.id == "open" } == true }

    var body: some View {
        let column = gs("gates.lib.column", scheme)
        GateColumn(width: column.width, gap: column.gap) {
            if ready { readyScreen } else { places }
        }
    }

    // The places, then Back.
    @ViewBuilder private var places: some View {
        let actions = model.gate?.actions ?? []
        GateHeader(title: model.title, message: [WebRun("Folevi keeps your notes as files in one folder. Pick where that folder goes. If the place already holds your Folevi library, Folevi opens it.")])
        VStack(spacing: gs("gates.lib.group", scheme).gap) {
            ForEach(actions.filter { $0.id.hasPrefix("place:") }, id: \.id) { a in
                let kind = String(a.id.dropFirst("place:".count))
                GateChoice(title: a.label, detail: Self.detail(kind), busy: model.pending == a.id, action: { Task { await model.act(a.id) } }) {
                    Self.icon(kind)
                }
                .disabled(model.pending != nil || !a.enabled)
                .accessibilityIdentifier("place-\(kind)")
            }
            if let error = model.errorMessage { GateProblem(text: error) }
        }
        if let back = actions.first(where: { $0.id == "back" }) {
            GateTextButton(title: back.label, icon: .arrowLeft, id: "gates.lib.back") { Task { await model.act("back") } }
                .disabled(model.pending != nil)
                .accessibilityIdentifier("gate-action-back")
        }
    }

    // "Your library is ready": the passphrase card, Open Folevi, Choose another place.
    @ViewBuilder private var readyScreen: some View {
        let message = model.message
        let path = message.replacingOccurrences(of: "Folevi keeps your notes as files in ", with: "").trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let ink = gs("gates.ready.path", scheme)
        GateHeader(
            title: model.title,
            message: [WebRun("Folevi keeps your notes as files in "), WebRun(path, weight: ink.fontWeight, color: ink.color), WebRun(".")]
        )
        ReadyForm(model: model)
    }

    /// LibrarySetup.tsx's placeOptions, in the words of the device it's on.
    static func detail(_ kind: String) -> String {
        #if os(iOS)
        let here = UIDevice.current.userInterfaceIdiom == .pad ? "this iPad" : "this iPhone"
        switch kind {
        case "icloud": return "The Folevi folder in iCloud Drive, on every iPhone, iPad and Mac signed in to your iCloud account."
        case "dropbox": return "Sign in to Dropbox in the sign-in sheet. Folevi only uses its own folder, Apps \u{203A} Folevi."
        case "gdrive": return "Sign in to Google in the sign-in sheet. Folevi only sees the files it makes."
        case "folder": return "Any folder the Files app offers, such as one in Dropbox, Google Drive or OneDrive."
        case "device": return "Your notes stay on \(here). You can turn on sync later in Settings."
        default: return ""
        }
        #else
        return macDetail(kind)
        #endif
    }

    static func macDetail(_ kind: String) -> String {
        switch kind {
        case "icloud": "A Folevi folder in iCloud Drive, on every Mac signed in to your iCloud account."
        case "dropbox": "Sign in to Dropbox in the sign-in sheet. Folevi only uses its own folder, Apps \u{203A} Folevi."
        case "gdrive": "Sign in to Google in the sign-in sheet. Folevi only sees the files it makes."
        case "folder": "Any folder on this Mac, such as one OneDrive or another app keeps in sync."
        case "device": "Your notes stay on this Mac. You can turn on sync later in Settings."
        default: ""
        }
    }

    @ViewBuilder static func icon(_ kind: String) -> some View {
        switch kind {
        case "icloud": WebIconView(.cloud, size: 20)
        case "folder": WebIconView(.folder, size: 20)
        case "dropbox": WebBrandGlyph.dropbox.frame(width: 20, height: 20)
        case "gdrive": WebBrandGlyph.drive.frame(width: 20, height: 20)
        default: WebIconView(.hardDrive, size: 20)
        }
    }
}

/// The outline marks LibrarySetup.tsx draws for Dropbox and Google Drive (not the providers' logos).
enum WebBrandGlyph {
    static var dropbox: some View { glyph("M7 3.5 2.5 6.5 7 9.5l5-3zM17 3.5l-5 3 5 3 4.5-3zM2.5 12.5 7 15.5l5-3-5-3zM17 9.5l-5 3 5 3 4.5-3zM7 17l5 3.5 5-3.5-5-3z") }
    static var drive: some View { glyph("M8.5 3.5h7l6 10.5-3.5 6h-12L2.5 14zM8.5 3.5l6 10.5H2.5M15.5 3.5 9.5 14l-3.5 6M21.5 14h-7l3.5 6") }
    private static func glyph(_ d: String) -> some View {
        GeometryReader { g in
            WebSVGPathShape(d: d, viewBox: 24).stroke(style: StrokeStyle(lineWidth: 1.8 * g.size.width / 24, lineJoin: .round))
        }
    }
}

/// The new library's passphrase card and buttons (NewLibrary in LibrarySetup.tsx).
struct ReadyForm: View {
    @Bindable var model: GateModel
    @State private var encrypt = false
    @State private var confirm = ""
    @State private var understood = false
    @State private var problem: String?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let form = gs("gates.ready.form", scheme)
        let card = gs("gates.ready.card", scheme)
        let tile = gs("gates.ready.card.tile", scheme)
        let hasPassphrase = model.gate?.fields.contains { $0.id == "passphrase" } == true
        VStack(spacing: form.gap) {
            if hasPassphrase {
                VStack(alignment: .leading, spacing: card.gap) {
                    HStack(alignment: .top, spacing: 12) {
                        WebIconView(.lock, size: 18)
                            .frame(width: tile.width, height: tile.height)
                            .foregroundStyle(tile.color.color)
                            .background(RoundedRectangle(cornerRadius: tile.radius, style: .continuous).fill(tile.background.color))
                        VStack(alignment: .leading, spacing: 2) {
                            GateLine(text: "Encrypt with a passphrase", id: "gates.ready.card.title")
                            GateParagraph(model.message.contains("this Mac") || model.message.contains("On My iPhone") || model.message.contains("On My iPad") || model.message.hasSuffix("only.") ? "Optional. The library's files can't be read without it, by anyone, including Folevi." : "Optional. The synced copy can't be read without it, by anyone, including Folevi.", id: "gates.ready.card.detail", center: false)
                        }
                        .frame(width: gs("gates.ready.card.detail", scheme).width)
                        WebSwitch(on: $encrypt, label: "Encrypt with a passphrase")
                    }
                    if encrypt { passphraseFields }
                }
                .padding(card.padding.edgeInsets)
                .padding(card.borderWidth)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background {
                    #if os(iOS)
                    // The grouped card: --iphone-row with its 0.5 pt hairline (a box-shadow), no border.
                    WebShapeBox(shape: WebCornersShape(topLeft: card.radius, topRight: card.radius, bottomRight: card.radius, bottomLeft: card.radius), fill: card.background.color, shadows: card.shadows)
                    #else
                    RoundedRectangle(cornerRadius: card.radius, style: .continuous).fill(card.background.color)
                        .overlay(RoundedRectangle(cornerRadius: card.radius, style: .continuous).strokeBorder(card.borderColor.color, lineWidth: card.borderWidth))
                    #endif
                }
            }
            if let error = model.errorMessage { GateParagraph(error, id: "gates.footnote", color: danger) }
            VStack(spacing: gs("gates.ready.buttons", scheme).gap) {
                GateFullButton(title: model.pending == "open" && encrypt ? "Encrypting\u{2026}" : "Open Folevi", id: "gates.ready.open", busy: model.pending == "open") { open() }
                    .disabled(model.pending != nil)
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("gate-action-open")
                GateFullButton(title: "Choose another place", id: "gates.ready.elsewhere") { Task { await model.act("elsewhere") } }
                    .disabled(model.pending != nil)
                    .accessibilityIdentifier("gate-action-elsewhere")
            }
        }
        .onChange(of: encrypt) { _, on in
            problem = nil
            if !on { model.values["passphrase"] = "" }
        }
    }

    private var danger: RGBA { WebStyles.vars["color-danger"]?.resolve(scheme) ?? RGBA(179, 52, 44) }

    @ViewBuilder private var passphraseFields: some View {
        let muted = gs("gates.lib.message", scheme).color
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                WebIconView(.shieldAlert, size: 18).foregroundStyle(danger.color).padding(.top, 1)
                (Text("If you lose this passphrase, nobody can open the synced copy of your notes.").bold() + Text(" Folevi can't reset it or recover it. Write it down and keep it somewhere safe."))
                    .webText(.role(.body)).fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(danger.opacity(0.09).color))
            labeled("Passphrase") { WebSecureField(text: Binding(get: { model.values["passphrase"] ?? "" }, set: { model.values["passphrase"] = $0; problem = nil })) }
            labeled("Type it again") { WebSecureField(text: $confirm) }
            Text("Use at least 8 characters. A few unrelated words are easy to remember and hard to guess.").webText(.role(.subheadline)).foregroundStyle(muted.color)
            Toggle("I understand Folevi can't recover a lost passphrase", isOn: $understood).toggleStyle(GateCheckboxStyle()).font(Font(WebFont.ctFont(.sans, size: 14)))
            if let problem { Text(problem).webText(.role(.body)).foregroundStyle(danger.color) }
        }
    }

    private func labeled<F: View>(_ label: String, @ViewBuilder field: () -> F) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).webText(.role(.subheadline)).foregroundStyle(gs("gates.lib.message", scheme).color.color)
            field()
        }
    }

    private func open() {
        if encrypt {
            let p = model.values["passphrase"] ?? ""
            if p.count < 8 { problem = "Use at least 8 characters."; return }
            if p != confirm { problem = "The two passphrases don't match."; return }
            if !understood { problem = "Tick the box to say you understand a lost passphrase can't be recovered."; return }
        } else {
            model.values["passphrase"] = ""
        }
        Task { await model.act("open") }
    }
}

/// A full-width web button in a measured style (Open Folevi, Choose another place, Unlock).
struct GateFullButton: View {
    let title: String
    let id: String
    var icon: WebIcon?
    var leading: AnyView?
    var busy = false
    let action: () -> Void
    @State private var hover = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        let pair = WebStyles.named(id)
        let s = pair.resolve(scheme)
        Button(action: action) {
            HStack(spacing: s.gap) {
                if busy { GateSpinner(size: 16) } else if let leading { leading } else if let icon { WebIconView(icon, size: 15) }
                Text(title).webText(s.text).lineLimit(1).fixedSize()
            }
            .frame(maxWidth: .infinity)
            .frame(height: s.height)
            .foregroundStyle(s.color.color)
            .webBox(pair)
            .overlay(RoundedRectangle(cornerRadius: s.radius, style: .continuous).fill(hoverFill(s)))
            .contentShape(RoundedRectangle(cornerRadius: s.radius, style: .continuous))
        }
        .buttonStyle(GatePressStyle())
        .opacity(enabled ? 1 : 0.4)
        .onHover { hover = $0 }
    }

    private func hoverFill(_ s: WebComputedStyle) -> Color {
        guard hover, enabled else { return .clear }
        return (WebStyles.vars["glass-hover"]?.resolve(scheme) ?? RGBA(0, 0, 0, 0)).color
    }
}

/// A quiet button sized to its label (Back), centred.
struct GateTextButton: View {
    let title: String
    var icon: WebIcon?
    let id: String
    let action: () -> Void
    @State private var hover = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        let pair = WebStyles.named(id)
        let s = pair.resolve(scheme)
        Button(action: action) {
            HStack(spacing: s.gap) {
                if let icon { WebIconView(icon, size: 15) }
                Text(title).webText(s.text).lineLimit(1).fixedSize()
            }
            .padding(s.padding.edgeInsets)
            .frame(height: s.height)
            .foregroundStyle(s.color.color)
            .background(RoundedRectangle(cornerRadius: s.radius, style: .continuous).fill(hover && enabled ? (WebStyles.vars["glass-hover"]?.resolve(scheme) ?? RGBA(0, 0, 0, 0)).color : s.background.color))
            .contentShape(Rectangle())
        }
        .buttonStyle(GatePressStyle())
        .opacity(enabled ? 1 : 0.4)
        .onHover { hover = $0 }
        .frame(maxWidth: .infinity)
    }
}

/// PlaceList's problem: a soft red panel.
struct GateProblem: View {
    let text: String
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let danger = WebStyles.vars["color-danger"]?.resolve(scheme) ?? RGBA(179, 52, 44)
        Text(text).webText(.role(.body)).foregroundStyle(gs("gates.column", scheme).color.color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(danger.opacity(0.09).color))
            .accessibilityIdentifier("gate-error")
    }
}

/// The web's Switch (ui/Switch.tsx on the Mac): 40 x 24, a 20 pt thumb.
struct WebSwitch: View {
    @Binding var on: Bool
    let label: String
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let track = gs("gates.ready.switch", scheme)
        let thumb = gs("gates.ready.switch.thumb", scheme)
        let heading = WebStyles.vars["color-heading"]?.resolve(scheme) ?? RGBA(11, 11, 12)
        Button { on.toggle() } label: {
            ZStack(alignment: on ? .trailing : .leading) {
                RoundedRectangle(cornerRadius: track.radius, style: .continuous).fill((on ? heading : track.background).color)
                RoundedRectangle(cornerRadius: thumb.radius, style: .continuous).fill(thumb.background.color)
                    .frame(width: thumb.width, height: thumb.height)
                    .webBox(WebStyles.named("gates.ready.switch.thumb"))
                    .padding(thumb.x - track.x)
            }
            .frame(width: track.width, height: track.height)
            .animation(.easeOut(duration: 0.15), value: on)
        }
        .buttonStyle(GatePressStyle())
        .accessibilityLabel(label)
        .accessibilityValue(on ? "On" : "Off")
        .accessibilityAddTraits(.isToggle)
    }
}

/// A password field drawn as `.ui-input` (no system bezel), 40 tall.
struct WebSecureField: View {
    @Binding var text: String
    var height: CGFloat = 40
    var submit: () -> Void = {}
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let style = WebStyles.named("input")
        let s = style.resolve(scheme)
        SecureField("", text: $text)
            .textFieldStyle(.plain)
            .font(Font(WebFont.ctFont(.sans, size: 14)))
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .foregroundStyle(s.color.color)
            .webBox(style)
            .onSubmit(submit)
    }
}

// MARK: The library's lock

struct LockedLibraryGate: View {
    @Bindable var model: GateModel
    @State private var help = false
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let where_ = model.message
        GateColumn(width: 384, gap: 24) {
            VStack(spacing: 20) {
                WebFoleviLogo(height: 26, color: gs("gates.logo", scheme).color.color)
                WebIconView(.lock, size: 22)
                    .frame(width: 48, height: 48)
                    .foregroundStyle(gs("gates.title", scheme).color.color)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(gs("gates.choice.tile", scheme).background.color))
                WebParagraph("Enter your library's passphrase", style: gs("gates.title", scheme).text, width: 384, alignment: .center, wrap: .balance)
                    .foregroundStyle(gs("gates.title", scheme).color.color)
                GateParagraph(runs: where_.isEmpty
                    ? [WebRun("This library is encrypted. Folevi needs the passphrase once on this Mac to read it.")]
                    : [WebRun("This library in "), WebRun(where_, weight: 500, color: gs("gates.ready.path", scheme).color), WebRun(" is encrypted. Folevi needs the passphrase once on this Mac to read it.")], id: "gates.lib.message", width: 384)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Passphrase").webText(.role(.subheadline)).foregroundStyle(gs("gates.lib.message", scheme).color.color)
                WebSecureField(text: Binding(get: { model.values["passphrase"] ?? "" }, set: { model.values["passphrase"] = $0 }), height: 44) { unlock() }
                    .focused($focused)
                    .accessibilityIdentifier("gate-field-passphrase")
            }
            if let error = model.errorMessage {
                Text(error).webText(.role(.body)).foregroundStyle((WebStyles.vars["color-danger"]?.resolve(scheme) ?? RGBA(179, 52, 44)).color)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, -12)
                    .accessibilityIdentifier("gate-error")
            }
            GateFullButton(title: "Unlock", id: "gates.ready.open", busy: model.pending == "unlock") { unlock() }
                .disabled(model.pending != nil)
                .accessibilityIdentifier("gate-action-unlock")
            VStack(spacing: 8) {
                GateTextButton(title: "Forgot the passphrase?", id: "gates.lib.back") { help.toggle() }
                if help {
                    GateParagraph("Nobody can reset it, Folevi included. If another device still opens this library, change the passphrase there in Settings, under Library. Without any device that opens it, the synced copy can't be read.", id: "gates.choice.detail", width: 384)
                }
            }
        }
        .onAppear { focused = true }
    }

    private func unlock() {
        guard !(model.values["passphrase"] ?? "").isEmpty else { return }
        Task { await model.act("unlock") }
    }
}

/// The Mac's Touch ID lock over a window (apps/mac MacAppLock.swift): no web page of its own, so it stands as the
/// web's locked library stands (LockedLibrary.tsx): the logo, the lock in its tile, the title and its line, and
/// one full-width button, in the same measured styles.
public struct WebLockCover: View {
    let unlock: () -> Void
    @Environment(\.colorScheme) private var scheme

    public init(unlock: @escaping () -> Void) { self.unlock = unlock }

    public var body: some View {
        ZStack {
            gs("gates.page", scheme).background.color.ignoresSafeArea()
            GateColumn(width: 384, gap: 24) {
                VStack(spacing: 20) {
                    WebFoleviLogo(height: 26, color: gs("gates.logo", scheme).color.color)
                    WebIconView(.lock, size: 22)
                        .frame(width: 48, height: 48)
                        .foregroundStyle(gs("gates.title", scheme).color.color)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(gs("gates.choice.tile", scheme).background.color))
                    WebParagraph("Folevi is locked", style: gs("gates.title", scheme).text, width: 384, alignment: .center, wrap: .balance)
                        .foregroundStyle(gs("gates.title", scheme).color.color)
                        .accessibilityAddTraits(.isHeader)
                    GateParagraph("Your notes stay covered until Touch ID says it's you.", id: "gates.lib.message", width: 384)
                }
                GateFullButton(title: "Unlock with Touch ID", id: "gates.ready.open", action: unlock)
                    .accessibilityIdentifier("lock-cover-unlock")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("lock-cover")
    }
}

// MARK: FullPageMessage

/// lib/app/state.tsx FullPageMessage: a card in the middle of the window with the title, the text and what the
/// gate offers (fields, buttons, progress, the devices to sign out of, the encryption steps).
struct MessageCardGate: View {
    @Bindable var model: GateModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let card = gs("gates.card", scheme)
        let pair = WebStyles.named("gates.card")
        let title = gs("gates.card.title", scheme)
        let body = gs("gates.card.body", scheme)
        GateColumn(width: card.width, gap: 0) {
            VStack(alignment: .leading, spacing: 0) {
                // (An h1: text-wrap balance. The text is a div: plain breaks.)
                WebParagraph(model.title, style: title.text, width: title.width, wrap: .balance).foregroundStyle(title.color.color)
                if !model.message.isEmpty {
                    WebParagraph(model.message, style: body.text, width: body.width, wrap: .greedy).foregroundStyle(body.color.color).padding(.top, 12)
                }
                if model.gate?.busy == true, model.gate?.progress == nil, model.gate?.actions.isEmpty != false {
                    GateBusyBar().padding(.top, 24)
                }
                if let p = model.gate?.progress { GateProgressBar(progress: p).padding(.top, 24) }
                if model.kind == .signedOut {
                    SignInChoices(model: model).padding(.top, 24)
                } else if hasChildren {
                    GateCardChildren(model: model).padding(.top, 24)
                }
            }
            .padding(card.padding.edgeInsets)
            .padding(card.borderWidth)
            .frame(width: card.width, alignment: .leading)
            .webBox(pair)
        }
    }

    private var hasChildren: Bool {
        guard let g = model.gate else { return false }
        return !g.actions.isEmpty || !g.fields.isEmpty || g.deviceLimit != nil || g.e2ee?.recoveryKey != nil || g.migration != nil || model.errorMessage != nil
    }
}

/// ShellSignIn's buttons (components/app/ShellSignIn.tsx, the Mac's): Continue with Apple (Apple's black button),
/// Continue with Google, Sign in with email, Keep notes on my devices instead; while the sign-in sheet is open,
/// Waiting..., Open the browser again, Sign in another way. Each opens the page's own PKCE sign-in.
struct SignInChoices: View {
    @Bindable var model: GateModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let list = gs("gates.signin.list", scheme)
        let actions = model.gate?.actions ?? []
        VStack(spacing: list.gap) {
            ForEach(actions, id: \.id) { a in
                Group {
                    switch a.id {
                    case "apple": WebAppleButton(title: a.label, busy: !a.enabled) { press(a) }
                    case "google": GateFullButton(title: a.label, id: "gates.signin.google", leading: AnyView(WebGoogleMark().frame(width: 18, height: 18))) { press(a) }
                    case "local": GateFullButton(title: a.label, id: "gates.signin.local") { press(a) }
                    case "waiting": GateFullButton(title: a.label, id: "gates.card.button") {}.disabled(true)
                    default: GateFullButton(title: a.label, id: "gates.signin.email") { press(a) }
                    }
                }
                .disabled(model.pending != nil || (!a.enabled && a.id != "apple"))
                .accessibilityIdentifier("gate-action-\(a.id)")
            }
            if let error = model.errorMessage {
                Text(error).webText(.role(.body)).foregroundStyle(gs("gates.card.body", scheme).color.color)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("gate-error")
            }
        }
    }

    private func press(_ a: GateAction) { Task { await model.act(a.id) } }
}

/// Apple's sign-in button as the web draws it (APPLE_BUTTON): the system font, black (white in dark), 44 tall.
struct WebAppleButton: View {
    let title: String
    var busy = false
    let action: () -> Void
    @State private var hover = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let s = gs("gates.signin.apple", scheme)
        let dark = scheme == .dark
        let fill = hover ? (dark ? RGBA(0xf2, 0xf2, 0xf4) : RGBA(0x1d, 0x1d, 0x1f)) : s.background
        Button(action: action) {
            HStack(spacing: s.gap) {
                if busy { GateSpinner(size: 16) } else { WebSVGPathShape(d: WebGoogleMark.apple, viewBox: 24).fill(s.color.color).frame(width: 17, height: 17) }
                Text(title).font(.system(size: s.fontSize, weight: .medium)).lineLimit(1).fixedSize()
            }
            .frame(maxWidth: .infinity)
            .frame(height: s.height)
            .foregroundStyle(s.color.color)
            .background(RoundedRectangle(cornerRadius: s.radius, style: .continuous).fill(fill.color))
            .contentShape(RoundedRectangle(cornerRadius: s.radius, style: .continuous))
        }
        .buttonStyle(GatePressStyle())
        .onHover { hover = $0 }
    }
}

/// Google's G (GoogleMark in SocialSignIn.tsx), in its four colours, on a 48-unit square.
struct WebGoogleMark: View {
    static let apple = "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.960.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
    static let parts: [(String, RGBA)] = [
        ("M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z", RGBA(0xEA, 0x43, 0x35)),
        ("M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.020h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z", RGBA(0x42, 0x85, 0xF4)),
        ("M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z", RGBA(0xFB, 0xBC, 0x05)),
        ("M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z", RGBA(0x34, 0xA8, 0x53)),
    ]
    var body: some View {
        ZStack {
            ForEach(0..<Self.parts.count, id: \.self) { i in WebSVGPathShape(d: Self.parts[i].0, viewBox: 48).fill(Self.parts[i].1.color) }
        }
    }
}

/// The busy card's line: a third of the bar sliding across.
struct GateBusyBar: View {
    @State private var phase: CGFloat = -0.33
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2).fill(Color.primary.opacity(0.06))
                RoundedRectangle(cornerRadius: 3).fill(Color.primary.opacity(0.7)).frame(width: g.size.width / 3).offset(x: phase * g.size.width)
            }
        }
        .frame(height: 4)
        .clipped()
        .onAppear { withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: false)) { phase = 1 } }
    }
}

struct GateProgressBar: View {
    let progress: GateProgress
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let fraction = progress.total.map { $0 > 0 ? min(1, Double(progress.done) / Double($0)) : 0 } ?? 0
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2).fill(Color.primary.opacity(0.06))
                    RoundedRectangle(cornerRadius: 2).fill(gs("gates.card.title", scheme).color.color).frame(width: g.size.width * fraction)
                }
            }
            .frame(height: 4)
            if !progress.label.isEmpty { Text(progress.label).webText(.role(.subheadline)).foregroundStyle(gs("gates.card.body", scheme).color.color) }
        }
    }
}

/// The card's children: fields, then the buttons in a row (the primary one first), the error under them.
struct GateCardChildren: View {
    @Bindable var model: GateModel
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let d = model.gate?.deviceLimit {
                ForEach(d.devices, id: \.id) { device in
                    HStack {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(device.label).webText(.role(.body, weight: 600)).lineLimit(1)
                            Text("Last seen \(Date(timeIntervalSince1970: device.lastSeenAt / 1000).formatted(.relative(presentation: .named)))").webText(.role(.subheadline)).lineLimit(1).foregroundStyle(gs("gates.card.body", scheme).color.color)
                        }
                        Spacer(minLength: 8)
                        WebButton("Sign out", variant: .secondary) { Task { await model.act("signOut:\(device.id)") } }
                    }
                }
            }
            if let key = model.gate?.e2ee?.recoveryKey {
                Text(key).font(Font(WebFont.ctFont(.mono, size: 15))).textSelection(.enabled)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
            }
            ForEach(model.visibleFields, id: \.id) { f in
                VStack(alignment: .leading, spacing: 4) {
                    Text(f.label).webText(.role(.subheadline)).foregroundStyle(gs("gates.card.body", scheme).color.color)
                    let binding = Binding(get: { model.values[f.id] ?? "" }, set: { model.values[f.id] = $0 })
                    if f.kind == .secret { WebSecureField(text: binding) { pressPrimary() } } else { WebTextField(f.placeholder, text: binding) }
                }
                .accessibilityIdentifier("gate-field-\(f.id)")
            }
            let actions = model.visibleActions.filter { !$0.id.hasPrefix("signOut:") }
            if !actions.isEmpty {
                // The web's FullPageMessage children: the buttons as the page lays them out (a row that wraps).
                GateFlowRow(spacing: 8) {
                    ForEach(actions, id: \.id) { a in
                        WebButton(a.label, variant: Self.variant(a.style)) { Task { await model.act(a.id) } }
                            .disabled(!model.isEnabled(a))
                            .accessibilityIdentifier("gate-action-\(a.id)")
                    }
                }
            }
            ForEach(model.otherMethods, id: \.id) { m in
                WebButton(m.id == "passphrase" ? "Use passphrase instead" : m.label, variant: .quiet, size: .sm) { model.choose(method: m.id) }
            }
            if let error = model.errorMessage {
                Text(error).webText(.role(.body)).foregroundStyle((WebStyles.vars["color-danger"]?.resolve(scheme) ?? RGBA(179, 52, 44)).color)
                    .accessibilityIdentifier("gate-error")
            }
        }
    }

    private func pressPrimary() {
        if let a = model.visibleActions.first(where: { $0.style == .primary && model.isEnabled($0) }) { Task { await model.act(a.id) } }
    }

    static func variant(_ s: GateAction.Style) -> WebButtonVariant {
        switch s {
        case .primary: .primary
        case .secondary: .secondary
        case .quiet: .quiet
        case .destructive: .danger
        }
    }
}

/// Children in a row, wrapping onto the next line when they don't fit.
struct GateFlowRow: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0, x + s.width > width { y += line + spacing; x = 0; line = 0 }
            x += s.width + spacing
            line = max(line, s.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX, x + s.width > bounds.maxX { y += line + spacing; x = bounds.minX; line = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            line = max(line, s.height)
        }
    }
}

/// No system highlight: the web draws its own hover and press states.
public struct GatePressStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View { configuration.label.contentShape(Rectangle()) }
}

/// A checkbox: the system's on the Mac; on the iPhone and iPad (which have none) a 18 pt box with a tick, as the
/// web draws its native checkbox there.
struct GateCheckboxStyle: ToggleStyle {
    @Environment(\.colorScheme) private var scheme

    func makeBody(configuration: Configuration) -> some View {
        #if os(macOS)
        Toggle(configuration).toggleStyle(.checkbox)
        #else
        Button { configuration.isOn.toggle() } label: {
            HStack(alignment: .top, spacing: 8) {
                RoundedRectangle(cornerRadius: 4, style: .circular)
                    .fill(configuration.isOn ? FoleviTokens.Chrome.heading.resolve(scheme).color : .clear)
                    .overlay(RoundedRectangle(cornerRadius: 4, style: .circular).strokeBorder(configuration.isOn ? .clear : FoleviTokens.Chrome.inkMuted.resolve(scheme).color, lineWidth: 1.5))
                    .overlay { if configuration.isOn { WebIconView(.check, size: 13, strokeWidth: 3).foregroundStyle(FoleviTokens.Chrome.canvas.resolve(scheme).color) } }
                    .frame(width: 18, height: 18)
                configuration.label.foregroundStyle(FoleviTokens.Chrome.ink.resolve(scheme).color)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
        #endif
    }
}

/// A choice card pressed on the iPhone: it shrinks to 98.5% (150 ms).
struct ChoicePress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.985 : 1).animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
