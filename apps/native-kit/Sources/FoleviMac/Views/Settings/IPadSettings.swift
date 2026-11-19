// Settings in the iPad's wide layout (the owner, 2026-11-19: the Mac's Settings redesign on the iPad, "a sheet or
// full-screen settings with a category list"): the Mac's Settings window's content (MacSettingsShell: the category
// list with its working search, the open category's compact title, its grouped native controls in a readable
// column) in a large form sheet, with Done at its top. ⌘, (the iPad's menu bar), the account menu, a /settings link
// and a Settings tab restored from before all open it here, as they open the Settings window on the Mac.
#if os(iOS)
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine

@MainActor
public enum IPadSettings {
    private static weak var shown: UIViewController?
    private static var state: MacSettingsState?
    private static var model: MacSettingsModel?
    private static let sectionKey = "folevi.settings.section"

    /// Whether Settings' sheet is on screen (the eval hook, tests).
    public static var isShowing: Bool { shown?.presentingViewController != nil }

    /// Opens Settings (at `section`, or the one last open), or moves the open sheet there.
    public static func present(_ frame: FrameModel, section: String? = nil) {
        let defaults = WebSidebarController.defaults
        if let section { defaults.set(section, forKey: sectionKey) }
        let current = defaults.string(forKey: sectionKey) ?? "account"
        if model?.frame !== frame { model = MacSettingsModel(frame: frame) }
        guard let model else { return }
        let state = self.state ?? MacSettingsState()
        self.state = state
        state.onSelect = { id in defaults.set(id, forKey: sectionKey) }
        state.onAction = { [weak frame] id in
            guard let frame else { return }
            switch id {
            case MacSettingsCategories.help:
                dismiss()
                frame.host?.frameOpenHelp()
            case MacSettingsCategories.contact:
                // Without an account there's no support form: an email, as the web opens.
                if state.local, let url = URL(string: "mailto:support@folevi.com") { UIApplication.shared.open(url) } else { dismiss(); frame.host?.frameOpenHelp() }
            default: break
            }
        }
        state.groups = MacSettingsCategories.groups(model)
        state.local = MacSettingsCategories.isLocal(model)
        state.select(MacSettingsCategories.resolve(current, model: model))
        if isShowing { return }
        guard let window = FrameSheets.window(for: frame), let presenter = window.rootViewController?.topmostPresented else { return }
        let sheet = UIHostingController(rootView: IPadSettingsSheet(model: model, state: state) { dismiss() })
        sheet.modalPresentationStyle = .formSheet
        let room = window.bounds.size
        sheet.preferredContentSize = CGSize(width: min(MacSettingsLook.defaultSize.width, room.width - 80), height: min(MacSettingsLook.defaultSize.height, room.height - 80))
        shown = sheet
        presenter.present(sheet, animated: !WebMotion.reduced)
    }

    public static func dismiss() {
        shown?.presentingViewController?.dismiss(animated: !WebMotion.reduced)
        shown = nil
    }
}

/// The sheet: the Mac's Settings shell, Done at the top's trailing end (Escape and ⌘. close it too).
struct IPadSettingsSheet: View {
    let model: MacSettingsModel
    @Bindable var state: MacSettingsState
    let close: () -> Void

    var body: some View {
        MacSettingsShell(state: state, chromeTop: MacLook.titleBarHeight) {
            MacSettingsNativePane(model: model, state: state)
        }
        .overlay(alignment: .topTrailing) {
            Button("Done", action: close)
                .font(MacLook.Text.body.weight(.semibold))
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .keyboardShortcut(.cancelAction)
                .padding(.trailing, MacLook.Space.l)
                .frame(height: MacLook.titleBarHeight)
                .accessibilityIdentifier("settings.done")
        }
        .environment(\.macNativeLook, true)
        .macNativeChrome()
        .tint(MacLook.Colors.accent)
        .background(MacLook.Colors.window)
    }
}
#endif
