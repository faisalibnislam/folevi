// Folevi for iPhone's native look (the owner, 2026-11-19): native iOS chrome, Folevi content, as the Mac's
// (docs/MAC_NATIVE_LOOK.md). The system tab bar and navigation bars in Liquid Glass, the system font (SF Pro) for
// interface text at Apple's text sizes with Dynamic Type, native menus, sheets, fields, switches and segmented
// pickers, and Folevi's black and white accent. Notes, note cards and the editor keep Instrument Sans and Spectral
// (cards reset the chrome for what they draw, `noteContent()`).
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public enum PhoneNativeLook {
    #if canImport(UIKit)
    /// Folevi's accent (`.ui-neutral-chrome`): #1F1F22 light, #F2F2F3 dark.
    public static let accentColor = UIColor { t in
        t.userInterfaceStyle == .dark ? UIColor(red: 0xF2 / 255, green: 0xF2 / 255, blue: 0xF3 / 255, alpha: 1)
            : UIColor(red: 0x1F / 255, green: 0x1F / 255, blue: 0x22 / 255, alpha: 1)
    }

    /// Ink on the accent: #FFFFFF light, #101011 dark.
    public static let onAccentColor = UIColor { t in
        t.userInterfaceStyle == .dark ? UIColor(red: 0x10 / 255, green: 0x10 / 255, blue: 0x11 / 255, alpha: 1) : .white
    }

    public static let accent = Color(uiColor: accentColor)
    public static let onAccent = Color(uiColor: onAccentColor)
    #else
    public static let accent = Color.primary
    public static let onAccent = Color.white
    #endif

    /// What the shared web components draw natively on the iPhone: interface text at Apple's sizes with Dynamic Type
    /// (Large Title 34, Title 28, Title 3 20, Body 17, Footnote 13 as the fixed fallbacks), the accent for the one
    /// prominent action.
    public static let chrome = NativeChrome(title: 28, title3: 20, body: 17, small: 13, accent: accent, onAccent: onAccent,
                                            hover: Color.primary.opacity(0.08), dynamicType: true,
                                            brandText: true)

    /// How much of the web's drawn shadows (a note card's lift) the native look keeps: half, as the Mac (the
    /// owner, 2026-11-18: "less shadows").
    public static let webShadowScale = 0.5
}

public extension View {
    /// Rows on one opaque rounded card on the frame's grey, inset from the screen's edges (the owner, 2026-11-23):
    /// a list's group (a day's tasks, a note's group), with rounded press highlights and no lines between rows.
    func phoneCard(radius: CGFloat = PhoneLook.tileRadius, inset: CGFloat = PhoneLook.inset) -> some View {
        modifier(PhoneCardModifier(radius: radius, inset: inset))
    }

    /// The iPhone's native look for everything inside: the chrome, the accent as the tint, the lighter shadows.
    func phoneNativeChrome(menus: PhoneMenus? = nil) -> some View {
        environment(\.nativeChrome, PhoneNativeLook.chrome)
            .environment(\.phoneMenus, menus)
            .environment(\.nativeShadowScale, PhoneNativeLook.webShadowScale)
            .tint(PhoneNativeLook.accent)
            // Every plain switch in the switch's own colour: the accent can't fill it in dark mode (FoleviSwitchTint).
            .toggleStyle(NativeSwitchStyle())
    }
}

public extension EnvironmentValues {
    /// Set inside a system toolbar (PhoneScreen's bar): the glass controls drawn there leave the glass to the bar,
    /// which gives every item its own Liquid Glass capsule.
    @Entry var phoneInSystemBar = false
    /// The frame's menus, set by the native look: long presses and bar buttons show iOS's own menus holding the
    /// rows their menu-building code gives (`PhoneMenus.entries`). Nil: Folevi's drawn menus, from where they sit.
    @Entry var phoneMenus: PhoneMenus? = nil
    /// The colour of the screen behind the bar, set by PhoneScreen for its root bar's account button, whose badge
    /// is ringed in it. Nil: the grouped grey.
    @Entry var phoneScreenSurface: Color? = nil
    /// The tab's first screen's Create and Foli AI buttons, set by the frame for that screen only (PhoneScreen draws
    /// them in its bar). Nil: none.
    @Entry var phoneRootCreate: PhoneRootCreate? = nil
    /// Opens the app's Search (the frame's), for the search capsule at the end of every screen's top bar (the owner,
    /// 2026-11-23). Nil: no capsule (Search itself, a sheet, the iPad).
    @Entry var phoneOpenSearch: (@MainActor () -> Void)? = nil
    /// Inside iOS's own List (a PhoneScreen with `list`, the owner's 2026-11-24 pick): sections are the List's
    /// sections, swipe actions the system's.
    @Entry var phoneInList = false
}

/// A list's group of rows: in iOS's own List (`phoneInList`) one of its inset grouped sections, with no lines
/// between rows (the owner, 2026-11-24: system lists, no row lines) and an optional heading; elsewhere the rows on
/// one card (`phoneCard`) under the heading.
public struct PhoneListSection<Header: View, Content: View>: View {
    let header: Header
    let content: Content
    @Environment(\.phoneInList) private var inList

    public init(@ViewBuilder content: () -> Content, @ViewBuilder header: () -> Header) {
        self.content = content()
        self.header = header()
    }

    public var body: some View {
        if inList {
            Section {
                Group { content }
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .environment(\.phoneRowGrouped, true)
            } header: {
                if Header.self != EmptyView.self {
                    header.textCase(nil).listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 6, trailing: 0))
                }
            }
            .listSectionSeparator(.hidden)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                if Header.self != EmptyView.self { header }
                VStack(spacing: 0) { content }.phoneCard()
            }
        }
    }
}

public extension PhoneListSection where Header == EmptyView {
    init(@ViewBuilder content: () -> Content) {
        self.init(content: content, header: { EmptyView() })
    }
}

public extension PhoneListSection where Header == PhoneSectionHeading {
    /// With a heading in the Mac's section style (Subheadline semibold, muted, sentence case).
    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.init(content: content, header: { PhoneSectionHeading(title) })
    }
}

/// A section's heading: Subheadline semibold in the muted ink, sentence case.
public struct PhoneSectionHeading: View {
    let title: String
    @Environment(\.colorScheme) private var scheme
    @Environment(\.phoneInList) private var inList
    public init(_ title: String) { self.title = title }
    public var body: some View {
        Text(title)
            .webText(PhoneType.captionCaps)
            .lineLimit(1)
            .foregroundStyle(FoleviTokens.Chrome.inkMuted.resolve(scheme).color)
            .padding(.horizontal, inList ? 0 : 20)
            .padding(.top, inList ? 0 : 16)
            .padding(.bottom, inList ? 0 : 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

struct PhoneCardModifier: ViewModifier {
    let radius: CGFloat
    let inset: CGFloat
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .padding(.vertical, PhoneLook.cardPadding)
            // Plain rows on the screen's own colour, as today's app (the owner, 2026-11-25), not a card.
            .clipShape(shape)
            .padding(.horizontal, inset)
    }
}

/// The iPhone's redesign after the Mac's window (the owner, 2026-11-23; docs/design/macloving-mac-ui.md as iOS has
/// it): the frame's grey under everything, the content's sections as rounded opaque cards on it, no row lines,
/// interface text in four sizes (Subheadline 15, Body 17, Title 3 20, Title 28, with Dynamic Type), Folevi's ink.
public enum PhoneLook {
    /// The frame: the grey every screen sits on.
    /// iOS's own grouped background (systemGroupedBackground), as its lists draw it.
    /// Since 2026-11-25 (the owner: "match today's UI"): the web's canvas, white and near-black, as today's app.
    public static let frame = FoleviTokens.Chrome.canvas
    /// A tile or chip on it (Home's tiles, a filter's pills, an empty state): the web's whisper of grey
    /// (--iphone-card).
    public static let card = PhoneSurface.card
    /// A section's card corners (iOS 26's inset grouped corners), and a small card's (a tile, a chip row).
    public static let cardRadius: CGFloat = 26
    public static let tileRadius: CGFloat = 20
    /// Between a card and the screen's edge, and between cards.
    public static let inset: CGFloat = 16
    public static let gap: CGFloat = 12
    /// A section heading: Title 3 semibold over its card, sentence case (the Mac's Home), with "See all" after it.
    public static let sectionGap: CGFloat = 28
    /// A selected or pressed row's rounded highlight inside a card (no row lines).
    public static let highlightRadius: CGFloat = 14
    /// A card's air above its first row and under its last.
    public static let cardPadding: CGFloat = 4
    /// Something appearing in place (a filter field opening from the bar).
    @MainActor public static var reveal: Animation? { WebMotion.reduced ? nil : .spring(response: 0.34, dampingFraction: 0.86) }
}

/// What a tab's first screen offers in its bar besides the bell and More (the owner, 2026-11-19): + for the Create
/// menu, New note, From template and Quick task, no New folder (on Tasks a quick task straight away), and Foli AI's flower when Foli AI is on. They were a bar of their own
/// over the tab bar, Ask Foli AI as wide as the screen; up here Foli AI is there without being the screen's focus.
public struct PhoneRootCreate {
    public var aiOn: Bool
    /// Tasks: + adds a quick task, with no menu.
    public var quickTaskOnly: Bool
    public var openAI: @MainActor () -> Void
    public var newNote: @MainActor () -> Void
    public var fromTemplate: @MainActor () -> Void
    public var quickTask: @MainActor () -> Void

    public init(aiOn: Bool, quickTaskOnly: Bool, openAI: @escaping @MainActor () -> Void, newNote: @escaping @MainActor () -> Void,
                fromTemplate: @escaping @MainActor () -> Void, quickTask: @escaping @MainActor () -> Void) {
        self.aiOn = aiOn
        self.quickTaskOnly = quickTaskOnly
        self.openAI = openAI
        self.newNote = newNote
        self.fromTemplate = fromTemplate
        self.quickTask = quickTask
    }
}

#if os(iOS)
/// A tab's first screen's main action in its bar: + in Folevi's ink (the Mac's New Note pill as iOS has it, a
/// prominent glass circle), after the screen's actions and before search.
public struct PhoneRootCreateItem: ToolbarContent {
    let create: PhoneRootCreate

    public init(create: PhoneRootCreate) { self.create = create }

    @available(iOS 26, *)
    private var prominentItem: some View {
        PhoneRootCreateButtons(create, prominent: true)
            .buttonStyle(.glassProminent)
            .buttonBorderShape(.circle)
            .tint(PhoneNativeLook.accent)
    }

    public var body: some ToolbarContent {
        if #available(iOS 26, *) {
            // The system's prominent glass, tinted with Folevi's ink (liquid-glass: one prominent action per bar,
            // `.glassProminent` tinted with `.tint`, never hand-rolled glass where the bar provides it).
            if create.quickTaskOnly {
                // A button: the bar draws the prominent glass itself, in its shared capsule.
                ToolbarItem(placement: .topBarTrailing) { prominentItem }
            } else {
                // A menu draws its own prominent glass: the bar's shared capsule round it would be glass on glass.
                ToolbarItem(placement: .topBarTrailing) { prominentItem }
                    .sharedBackgroundVisibility(.hidden)
            }
        } else {
            ToolbarItem(placement: .topBarTrailing) { PhoneRootCreateButtons(create) }
        }
    }
}

/// A plain button, unless the bar draws it as its prominent glass (the style set round it then applies).
private struct PlainUnlessProminent: ViewModifier {
    let prominent: Bool
    func body(content: Content) -> some View {
        if prominent { content } else { content.buttonStyle(.plain) }
    }
}

/// A menu drawn as a button, so the prominent glass style set round it reaches it.
private struct ButtonMenuWhenProminent: ViewModifier {
    let prominent: Bool
    func body(content: Content) -> some View {
        if prominent { content.menuStyle(.button) } else { content }
    }
}

/// The flower and +, in one of the bar's glass capsules.
public struct PhoneRootCreateButtons: View {
    let create: PhoneRootCreate
    /// + on its own ink circle (the bar's main action), not in the bar's shared glass.
    let prominent: Bool

    public init(_ create: PhoneRootCreate, prominent: Bool = false) {
        self.create = create
        self.prominent = prominent
    }

    public var body: some View {
        HStack(spacing: 6) {
            if create.aiOn {
                Button(action: create.openAI) { AiMarkGlyph(size: 21).frame(width: 30, height: 30) }
                    .buttonStyle(.plain)
                    .sheetZoomSource("ai")
                    .accessibilityLabel("Foli AI")
                    .accessibilityIdentifier("root-ai")
            }
            if create.quickTaskOnly {
                Button(action: create.quickTask) { plus }
                    .modifier(PlainUnlessProminent(prominent: prominent))
                    .accessibilityLabel("Quick task")
                    .accessibilityIdentifier("root-create")
            } else {
                Menu {
                    Button(action: create.newNote) { Label { Text("New note") } icon: { WebIcon.filePlusCorner.image() } }
                    Button(action: create.fromTemplate) { Label { Text("From template") } icon: { WebIcon.layoutTemplate.image() } }
                    Button(action: create.quickTask) { Label { Text("Quick task") } icon: { WebIcon.listPlus.image() } }
                } label: {
                    plus
                }
                .modifier(ButtonMenuWhenProminent(prominent: prominent))
                .accessibilityLabel("Create")
                .accessibilityIdentifier("root-create")
            }
        }
    }

    @ViewBuilder private var plus: some View {
        if prominent {
            WebIconView(.plus, size: 22, strokeWidth: 2.2)
                .foregroundStyle(PhoneNativeLook.onAccent)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        } else {
            WebIconView(.plus, size: 22, strokeWidth: 2.1)
                .foregroundStyle(.primary)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
    }
}
#endif
