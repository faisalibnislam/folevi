// Shared with Me and Changes in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I3), signed in only: FoleviPhone's
// PhoneSharedScreen and PhoneChangesScreen from the kit's models, kept while on the stack.
import SwiftUI
import FoleviDesign
import FoleviPhone
import FoleviScreens

struct RebuildSharedScreen: View {
    let frame: PhoneFrameModel
    let phone: PhoneModel
    @State private var model: SharedListModel

    init(frame: PhoneFrameModel, phone: PhoneModel) {
        self.frame = frame
        self.phone = phone
        _model = State(initialValue: SharedListModel(client: phone.client))
    }

    var body: some View {
        PhoneSharedScreen(model: model, openNote: { phone.router?.openNote($0, source: nil, focus: false) }, back: { frame.back() })
    }
}

struct RebuildChangesScreen: View {
    let frame: PhoneFrameModel
    let phone: PhoneModel
    @State private var model: ChangesModel

    init(frame: PhoneFrameModel, phone: PhoneModel) {
        self.frame = frame
        self.phone = phone
        let feedback = ScreenFeedback(toast: { [weak phone] t in phone?.toast(t.message, tone: t.tone == .error ? .error : .info) })
        _model = State(initialValue: ChangesModel(client: phone.client, feedback: feedback))
    }

    var body: some View {
        PhoneChangesScreen(model: model, openNote: { phone.router?.openNote($0, source: nil, focus: false) }, back: { frame.back() })
    }
}
