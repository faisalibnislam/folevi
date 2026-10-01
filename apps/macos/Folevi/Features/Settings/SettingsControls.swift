import AppKit
import CryptoKit
import SwiftUI
import UniformTypeIdentifiers

// The web's form pieces for Settings, Help and the account screens: `ui-input` fields (6 pt corners, a
// hairline ring, a soft outline when focused), the password field with its eye, Alert, the Dialog (title,
// description, body, footer), a checkbox, an underlined text link, and the profile picture / logo field.

// MARK: - Fields

/// `ui-input`: surface, 6 pt corners, an inner shade and a 1 pt line; focused, a 1.5 pt outline in heading at
/// 16.5%. `height` 36 (h-9, settings) or 44 (h-11, the auth forms), text 14 or 15 pt.
struct WebFieldStyle: TextFieldStyle {
    var height: CGFloat = 36
    var fontSize: CGFloat = 14
    var mono = false
    var centered = false
    var invalid = false
    var readOnly = false

    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration.modifier(WebFieldChrome(height: height, fontSize: fontSize, mono: mono, centered: centered, invalid: invalid, readOnly: readOnly))
    }
}

/// The chrome of `ui-input`, for TextField, SecureField and the read-only "well" variant.
struct WebFieldChrome: ViewModifier {
    var height: CGFloat = 36
    var fontSize: CGFloat = 14
    var mono = false
    var centered = false
    var invalid = false
    var readOnly = false
    var trailingInset: CGFloat = 0
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        content
            .textFieldStyle(.plain)
            .font(mono ? .system(size: fontSize, design: .monospaced) : .ui(fontSize))
            .multilineTextAlignment(centered ? .center : .leading)
            .foregroundStyle(readOnly ? FoleviColor.inkMuted : FoleviColor.ink)
            .focused($focused)
            .padding(.leading, height >= 44 ? 16 : 12)
            .padding(.trailing, (height >= 44 ? 16 : 12) + trailingInset)
            .frame(height: height)
            .background {
                if readOnly {
                    // `ui-well`: the glass behind shows through.
                    shape.fill(FoleviGlass.hover).overlay(shape.strokeBorder(FoleviGlass.border))
                } else {
                    shape.fill(FoleviColor.surface)
                        .overlay(shape.strokeBorder(invalid ? FoleviColor.destructive : focused ? FoleviColor.heading.opacity(0.165) : FoleviColor.line,
                                                    lineWidth: invalid || focused ? 1.5 : 1))
                        .shadow(color: .black.opacity(focused ? 0.08 : 0), radius: 1.5, y: 1)
                }
            }
            .animation(.easeOut(duration: 0.14), value: focused)
    }
}

/// A labelled field (`label.text-sm.font-medium` above, optional hint and error below).
struct LabeledField<Field: View>: View {
    var label: String
    var hint: String? = nil
    var error: String? = nil
    var large = false
    @ViewBuilder var field: Field

    var body: some View {
        VStack(alignment: .leading, spacing: large ? 6 : 4) {
            Text(label)
                .font(.ui(14, .medium))
                .foregroundStyle(large ? FoleviColor.ink : FoleviColor.ink)
                .accessibilityHidden(true)
            field
            if let hint {
                Text(hint)
                    .font(.ui(12))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .padding(.horizontal, large ? 4 : 0)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error {
                Text(error)
                    .font(.ui(12, .medium))
                    .foregroundStyle(FoleviColor.destructive)
                    .padding(.horizontal, large ? 4 : 0)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// The web's PasswordField: a 44 pt field with an eye button that shows or hides what's typed.
struct WebPasswordField: View {
    var label: String
    @Binding var text: String
    var hint: String? = nil
    var contentType: NSTextContentType = .password
    var onSubmit: () -> Void = {}
    @State private var shown = false

    var body: some View {
        LabeledField(label: label, hint: hint, large: true) {
            ZStack(alignment: .trailing) {
                Group {
                    if shown {
                        TextField("", text: $text)
                    } else {
                        SecureField("", text: $text)
                    }
                }
                .textContentType(contentType)
                .onSubmit(onSubmit)
                .accessibilityLabel(Text(label))
                .modifier(WebFieldChrome(height: 44, fontSize: 15, trailingInset: 32))
                Button {
                    shown.toggle()
                } label: {
                    Image(systemName: shown ? "eye.slash" : "eye")
                        .font(.system(size: 14))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(WebIconButtonStyle())
                .padding(.trailing, 6)
                .accessibilityLabel(Text(shown ? "Hide password" : "Show password"))
                .accessibilityAddTraits(shown ? .isSelected : [])
            }
        }
    }
}

/// A small square icon button that tints on hover (`hover:bg-accent-soft hover:text-heading`).
struct WebIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { WebIconButtonBody(configuration: configuration) }
}

private struct WebIconButtonBody: View {
    let configuration: ButtonStyle.Configuration
    @State private var hovering = false
    var body: some View {
        configuration.label
            .foregroundStyle(hovering ? FoleviColor.heading : FoleviColor.inkMuted)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering || configuration.isPressed ? FoleviColor.accentSoft : .clear))
            .onHover { hovering = $0 }
    }
}

// MARK: - Alert, link, checkbox

/// The web's auth Alert: a rounded 6 pt box in danger, success or accent soft, 14 pt text.
struct WebAlert: View {
    enum Tone { case error, success, info }
    var text: String
    var tone: Tone = .error

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        Text(text)
            .font(.ui(14))
            .foregroundStyle(FoleviColor.ink)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                switch tone {
                case .error: shape.fill(FoleviColor.destructiveSoft).overlay(shape.strokeBorder(FoleviColor.destructive.opacity(0.25)))
                case .success: shape.fill(FoleviColor.successSoft).overlay(shape.strokeBorder(FoleviColor.success.opacity(0.25)))
                case .info: shape.fill(FoleviColor.accentSoft)
                }
            }
            .accessibilityAddTraits(tone == .error ? .isStaticText : .updatesFrequently)
            .onAppear { AccessibilityNotification.Announcement(text).post() }
    }
}

/// An underlined text link (`font-medium text-heading underline decoration-line-strong`), or the accent one
/// (`text-accent underline`) on the auth pages.
struct TextLinkButton: View {
    var title: String
    var accent = false
    var size: CGFloat = 13
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.ui(size, .medium))
                .foregroundStyle(accent ? FoleviColor.accent : FoleviColor.heading)
                .underline(true, color: hovering ? (accent ? FoleviColor.accent : FoleviColor.heading) : (accent ? FoleviColor.accent.opacity(0.35) : FoleviColor.lineStrong))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(.isLink)
    }
}

/// A checkbox drawn in the app's style (never the OS check box): 16 pt, accent when ticked.
struct WebCheckbox<Label: View>: View {
    @Binding var isOn: Bool
    var accessibilityLabel: String
    @ViewBuilder var label: Label

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(alignment: .top, spacing: 12) {
                let shape = RoundedRectangle(cornerRadius: 4, style: .continuous)
                ZStack {
                    shape.fill(isOn ? FoleviColor.accent : FoleviColor.surface)
                    shape.strokeBorder(isOn ? FoleviColor.accent : FoleviColor.lineStrong, lineWidth: 1.25)
                    if isOn {
                        Image(systemName: "checkmark")
                            .font(.system(size: 9.5, weight: .bold))
                            .foregroundStyle(FoleviColor.accentInk)
                    }
                }
                .frame(width: 16, height: 16)
                .padding(.top, 2)
                label
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityLabel))
        .accessibilityValue(Text(isOn ? String(localized: "Checked") : String(localized: "Not checked")))
        .accessibilityAddTraits(.isToggle)
        .accessibilityAction { isOn.toggle() }
    }
}

// MARK: - Dialog

/// The web's Dialog: a 21 pt serif title with an optional description and a close button, the body, and an
/// optional footer on a sunken band. `sm` is 384 pt wide, `md` 512, `lg` 768. Escape closes it.
struct WebDialog<Content: View, Footer: View>: View {
    enum Size { case sm, md, lg
        var width: CGFloat { switch self { case .sm: return 384; case .md: return 512; case .lg: return 768 } }
    }
    var title: String
    var description: String? = nil
    var size: Size = .md
    var onClose: () -> Void
    @ViewBuilder var content: Content
    @ViewBuilder var footer: Footer

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(FoleviType.display(21))
                        .tracking(FoleviType.displayTracking(21))
                        .foregroundStyle(FoleviColor.heading)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    if let description {
                        Text(description)
                            .font(.ui(14))
                            .foregroundStyle(FoleviColor.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .medium))
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(WebIconButtonStyle())
                .keyboardShortcut(.cancelAction)
                .accessibilityLabel(Text("Close"))
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 8)
            ScrollView {
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 16)
            }
            .scrollBounceBehavior(.basedOnSize)
            .fixedSize(horizontal: false, vertical: true)
            if !(Footer.self == EmptyView.self) {
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    footer
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(FoleviColor.surfaceSunken.opacity(0.6))
                .overlay(alignment: .top) { FoleviColor.line.frame(height: 1) }
            }
        }
        .frame(width: size.width)
        .background(FoleviColor.surface)
    }
}

extension WebDialog where Footer == EmptyView {
    init(title: String, description: String? = nil, size: Size = .md, onClose: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.init(title: title, description: description, size: size, onClose: onClose, content: content, footer: { EmptyView() })
    }
}

/// A confirmation in the web's Dialog: Cancel and the action in the footer (`size="sm"`). Return confirms.
struct WebConfirmDialog<Content: View>: View {
    var title: String
    var description: String?
    var cancelTitle: String = String(localized: "Cancel")
    var confirmTitle: String
    var confirmKind: FoleviButtonKind = .danger
    var confirmDisabled = false
    var busy = false
    var onCancel: () -> Void
    var onConfirm: () -> Void
    @ViewBuilder var content: Content

    var body: some View {
        WebDialog(title: title, description: description, size: .sm, onClose: onCancel) {
            content
        } footer: {
            Button(cancelTitle, action: onCancel)
                .buttonStyle(.folevi(.secondary, .medium))
            Button(confirmTitle, action: onConfirm)
                .buttonStyle(.folevi(confirmKind, .medium))
                .keyboardShortcut(.defaultAction)
                .disabled(confirmDisabled || busy)
        }
    }
}

extension WebConfirmDialog where Content == EmptyView {
    init(title: String, description: String?, cancelTitle: String = String(localized: "Cancel"), confirmTitle: String,
         confirmKind: FoleviButtonKind = .danger, confirmDisabled: Bool = false, busy: Bool = false,
         onCancel: @escaping () -> Void, onConfirm: @escaping () -> Void) {
        self.init(title: title, description: description, cancelTitle: cancelTitle, confirmTitle: confirmTitle, confirmKind: confirmKind,
                  confirmDisabled: confirmDisabled, busy: busy, onCancel: onCancel, onConfirm: onConfirm) { EmptyView() }
    }
}

/// "Type <strong>X</strong> to confirm" and a 40 pt field (the web's delete dialogs).
struct ConfirmByTyping: View {
    var expected: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Type \(Text(expected).bold()) to confirm").font(.ui(14))
            TextField("", text: $text)
                .textFieldStyle(WebFieldStyle(height: 40))
                .autocorrectionDisabled()
                .textContentType(.none)
                .accessibilityLabel(Text("Type \(expected) to confirm"))
        }
    }
}

// MARK: - Profile picture and workspace logo

/// Image types the server accepts for profile pictures and workspace logos (it re-checks the bytes).
enum IdentityImage {
    static let types: [UTType] = [.png, .jpeg, .webP, .gif]
    static let maxBytes = 2 * 1024 * 1024

    /// A friendly reason the file can't be used, checked before uploading.
    static func problem(mimeType: String?, size: Int) -> String? {
        let ok = ["image/png", "image/jpeg", "image/webp", "image/gif"]
        if !ok.contains(mimeType ?? "") { return String(localized: "Choose a PNG, JPEG, WebP or GIF image.") }
        if size > maxBytes { return String(localized: "Images can be up to 2 MB.") }
        if size == 0 { return String(localized: "That file is empty.") }
        return nil
    }

    /// Uploads a profile picture ("avatar") or a workspace logo ("logo"); returns the verified file id.
    static func upload(_ data: Data, filename: String, mimeType: String, kind: String, workspaceId: String?, convex: ConvexService) async throws -> String {
        var args: [String: JSONValue] = [
            "filename": .string(filename.isEmpty ? "image" : filename), "size": .number(Double(data.count)),
            "mimeType": .string(mimeType), "kind": .string(kind),
        ]
        if let workspaceId { args["scope"] = Scope.workspace(workspaceId).arg }
        let ticket: UploadTicket = try await convex.mutation("files:generateUploadUrl", args)
        return try await SettingsUploads.send(data, mimeType: mimeType, ticket: ticket, convex: convex)
    }
}

/// The second half of an upload: POST the bytes, then finalize with their SHA-256.
enum SettingsUploads {
    static func send(_ data: Data, mimeType: String, ticket: UploadTicket, convex: ConvexService) async throws -> String {
        guard let url = URL(string: ticket.uploadUrl) else { throw FoleviError.invalidResponse("upload url") }
        var request = URLRequest(url: url, timeoutInterval: 120)
        request.httpMethod = "POST"
        request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        let (body, response) = try await URLSession.shared.upload(for: request, from: data)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status), let storageId = (try? JSONValue(jsonData: body))?["storageId"]?.stringValue else {
            throw FoleviError.server(code: "upload_failed", message: String(localized: "The upload failed (\(status))."))
        }
        let hash = SHA256Hex.of(data)
        let result: FinalizeResult = try await convex.action("files:finalize", [
            "intentId": .string(ticket.intentId), "storageId": .string(storageId), "sha256": .string(hash),
        ])
        return result.fileId
    }
}

/// A profile picture or workspace logo: a 56 pt preview (the image, or the initial on a heading tile) with
/// "Upload…" and "Remove", and the hint. Round for people, a 6 pt rounded square for workspaces.
struct IdentityImageField: View {
    enum Shape { case circle, square }
    var label: String
    var shape: Shape
    var url: String?
    var initial: String
    var onUpload: (Data, String, String) async throws -> Void
    var onRemove: () async throws -> Void
    @Environment(AppModel.self) private var app
    @State private var busy: String?
    @State private var failedURL: String?

    private var shown: URL? { url.flatMap { $0 == failedURL ? nil : URL(string: $0) } }

    var body: some View {
        HStack(spacing: 16) {
            preview
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Button(busy == "upload" ? String(localized: "Uploading…") : String(localized: "Upload…")) { choose() }
                        .buttonStyle(.folevi(.secondary, .small))
                        .disabled(busy != nil)
                        .accessibilityLabel(Text("Upload \(label.lowercased())"))
                        .accessibilityHint(Text("PNG, JPEG, WebP or GIF, up to 2 MB. A square image works best."))
                    if url != nil {
                        Button(busy == "remove" ? String(localized: "Removing…") : String(localized: "Remove")) { remove() }
                            .buttonStyle(.folevi(.ghost, .small))
                            .disabled(busy != nil)
                    }
                }
                Text("PNG, JPEG, WebP or GIF, up to 2 MB. A square image works best.")
                    .font(.ui(12))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(label))
    }

    @ViewBuilder private var preview: some View {
        let radius: CGFloat = shape == .circle ? 28 : 6
        let clip = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if let shown {
            AsyncImage(url: shown) { phase in
                switch phase {
                case .success(let image): image.resizable().aspectRatio(contentMode: .fill)
                case .failure: initialTile.onAppear { failedURL = url }
                default: FoleviColor.surfaceSunken
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(clip)
            .overlay(clip.strokeBorder(FoleviColor.line))
            .accessibilityHidden(true)
        } else {
            initialTile.accessibilityHidden(true)
        }
    }

    private var initialTile: some View {
        let first = initial.trimmingCharacters(in: .whitespaces).prefix(1).uppercased()
        return Text(first.isEmpty ? "·" : first)
            .font(.ui(20, .semibold))
            .foregroundStyle(FoleviColor.canvas)
            .frame(width: 56, height: 56)
            .background(FoleviColor.heading, in: RoundedRectangle(cornerRadius: shape == .circle ? 28 : 6, style: .continuous))
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = IdentityImage.types
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.begin { response in
            guard response == .OK, let file = panel.url else { return }
            MainActor.assumeIsolated { upload(file) }
        }
    }

    private func upload(_ file: URL) {
        let data = (try? Data(contentsOf: file)) ?? Data()
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType
        if let problem = IdentityImage.problem(mimeType: mime, size: data.count) {
            app.showToast(problem)
            return
        }
        run("upload", String(localized: "\(label) updated")) { try await onUpload(data, file.lastPathComponent, mime ?? "image/png") }
    }

    private func remove() {
        run("remove", String(localized: "\(label) removed")) { try await onRemove() }
    }

    private func run(_ kind: String, _ done: String, _ body: @escaping @MainActor () async throws -> Void) {
        guard app.sync.isOnline else {
            app.showToast(String(localized: "This needs a connection. Try again when you're back online."))
            return
        }
        busy = kind
        Task {
            defer { busy = nil }
            do {
                try await body()
                app.showToast(done)
            } catch {
                app.showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }
}

/// Lowercase hex SHA-256 (the upload checksum).
enum SHA256Hex {
    static func of(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Wrapping row

/// CSS `flex flex-wrap items-center gap-*`: children left to right, wrapping onto new lines when they don't
/// fit; on each line the `flexible` child (the web's `flex-1 min-w-0`) takes the space that's left.
struct WrapHStack: Layout {
    var spacing: CGFloat = 12
    var lineSpacing: CGFloat? = nil
    /// The index of the child that grows (nil: none does).
    var flexible: Int? = 0

    private struct Line { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func lines(_ widths: [CGFloat], heights: [CGFloat], max: CGFloat) -> [Line] {
        var out: [Line] = []
        var line = Line()
        for i in widths.indices {
            let w = Swift.min(widths[i], max)
            let next = line.indices.isEmpty ? w : line.width + spacing + w
            if !line.indices.isEmpty && next > max {
                out.append(line)
                line = Line()
            }
            line.width = line.indices.isEmpty ? w : line.width + spacing + w
            line.height = Swift.max(line.height, heights[i])
            line.indices.append(i)
        }
        if !line.indices.isEmpty { out.append(line) }
        return out
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let max = proposal.width ?? .infinity
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let ls = lines(sizes.map(\.width), heights: sizes.map(\.height), max: max)
        let height = ls.map(\.height).reduce(0, +) + CGFloat(Swift.max(0, ls.count - 1)) * (lineSpacing ?? spacing)
        let width = proposal.width ?? (ls.map(\.width).max() ?? 0)
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let ls = lines(sizes.map(\.width), heights: sizes.map(\.height), max: bounds.width)
        var y = bounds.minY
        for line in ls {
            let extra = Swift.max(0, bounds.width - line.width)
            var x = bounds.minX
            for i in line.indices {
                var w = Swift.min(sizes[i].width, bounds.width)
                if i == flexible { w += extra }
                let h = sizes[i].height
                subviews[i].place(at: CGPoint(x: x, y: y + (line.height - h) / 2), anchor: .topLeading,
                                  proposal: ProposedViewSize(width: w, height: h))
                x += w + spacing
            }
            y += line.height + (lineSpacing ?? spacing)
        }
    }
}

// MARK: - Select

/// The web's Select in a `ui-input` trigger (`h-9 rounded-[6px] px-3`, a chevron that turns when open),
/// with its list in a popover that scrolls (long lists like time zones) and opens at the chosen row.
/// Never the OS pop-up button.
struct WebSelect<Value: Hashable>: View {
    struct Option: Identifiable {
        var value: Value
        var title: String
        var id: Value { value }
    }

    @Binding var selection: Value
    var options: [Option]
    var accessibilityLabel: String
    var height: CGFloat = 36
    var fontSize: CGFloat = 14
    var fill = true
    @State private var open = false
    @State private var width: CGFloat = 180
    @Environment(\.isEnabled) private var isEnabled

    private var current: String { options.first { $0.value == selection }?.title ?? "" }

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 6) {
                Text(current)
                    .font(.ui(fontSize))
                    .foregroundStyle(FoleviColor.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 4)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(FoleviColor.ink.opacity(0.6))
                    .rotationEffect(.degrees(open ? 180 : 0))
                    .animation(.easeOut(duration: 0.15), value: open)
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: fill ? .infinity : nil)
            .frame(height: height)
            .fixedSize(horizontal: !fill, vertical: false)
            .background {
                let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
                shape.fill(FoleviColor.surface)
                    .overlay(shape.strokeBorder(open ? FoleviColor.heading.opacity(0.165) : FoleviColor.line, lineWidth: open ? 1.5 : 1))
            }
            .contentShape(Rectangle())
            .opacity(isEnabled ? 1 : 0.5)
            .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { w in width = w }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(accessibilityLabel))
        .accessibilityValue(Text(current))
        .accessibilityHint(Text("Opens a list to choose from"))
        .foleviPopover(isPresented: $open, arrowEdge: .bottom) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(options) { o in
                            WebSelectRow(title: o.title, checked: o.value == selection, fontSize: 13.5) {
                                open = false
                                if o.value != selection { selection = o.value }
                            }
                            .id(o.value)
                        }
                    }
                    .padding(6)
                }
                .frame(minWidth: max(160, width), maxWidth: 420)
                .frame(height: options.count > 9 ? 320 : CGFloat(options.count) * 31 + 12)
                .onAppear { proxy.scrollTo(selection, anchor: .center) }
            }
        }
    }
}

private struct WebSelectRow: View {
    var title: String
    var checked: Bool
    var fontSize: CGFloat
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(title.isEmpty ? " " : title)
                    .font(.ui(fontSize, checked ? .semibold : .regular))
                    .foregroundStyle(checked || hover ? FoleviColor.heading : FoleviColor.ink)
                    .lineLimit(1)
                Spacer(minLength: 12)
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(FoleviColor.heading)
                    .opacity(checked ? 1 : 0)
                    .frame(width: 14)
            }
            .padding(.horizontal, 10)
            .frame(height: 31)
            .background(hover ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}
