// The Vault in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I6): FoleviPhone's PhoneVaultScreen on the kit's shared
// VaultModel (the Mac's), kept while on the stack. /vault/<section> opens that section (links, notifications, the
// screen comparison).
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviPhone
import FoleviScreens

struct RebuildVaultScreen: View {
    let path: String
    let frame: PhoneFrameModel
    let menus: PhoneMenus
    @State private var model: VaultModel

    init(path: String, frame: PhoneFrameModel, menus: PhoneMenus, phone: PhoneModel) {
        self.path = path
        self.frame = frame
        self.menus = menus
        let feedback = ScreenFeedback(toast: { [weak phone] t in phone?.toast(t.message, tone: t.tone == .error ? .error : t.tone == .success ? .success : .info) })
        _model = State(initialValue: VaultModel(client: phone.client, feedback: feedback, section: VaultSection(path: path)))
    }

    var body: some View {
        PhoneVaultScreen(model: model, menus: menus, back: { frame.back() })
            .onChange(of: path) { _, p in model.section = VaultSection(path: p) ?? .files }
    }
}
