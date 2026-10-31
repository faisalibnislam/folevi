// Foli AI in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I5): the tab bar's sheet and the page (FoleviPhone's
// PhoneAiSheet and PhoneAiPage on FoleviScreens' FoliChatModel). The sheet keeps its conversation while it's closed,
// as the web's (AskAiPanel stays mounted); the page has its own, as on the Mac. In local mode the engine asks Apple's
// on-device model or the person's own key (Shell/ShellAI.swift); Debug builds answer with the stand-in model under
// FOLEVI_FAKE_AI=1 (Shell/FakeAI.swift).
//
// Debug hooks: FOLEVI_REBUILD_SHEET=ai opens the sheet at launch; FOLEVI_REBUILD_ASK="…" asks that in it.
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviPhone
import FoleviScreens

@MainActor
@Observable
final class RebuildAI {
    /// The tab bar's sheet is up.
    var sheetOpen = ProcessInfo.processInfo.environment["FOLEVI_REBUILD_SHEET"] == "ai"
    @ObservationIgnored private var made: (sheet: FoliChatModel, page: FoliChatModel, history: FoliHistoryModel)?
    @ObservationIgnored private weak var phone: PhoneModel?
    @ObservationIgnored private weak var frame: PhoneFrameModel?

    /// Made with the window's engine (RebuildFrameController.viewDidLoad).
    func attach(phone: PhoneModel, frame: PhoneFrameModel) {
        self.phone = phone
        self.frame = frame
        made = nil
        #if DEBUG
        if let q = ProcessInfo.processInfo.environment["FOLEVI_REBUILD_ASK"], !q.isEmpty {
            // Once the engine has the library open (the scratch library in the screen diffs).
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(4))
                self?.sheet.send(q)
            }
        }
        #endif
    }

    private var models: (sheet: FoliChatModel, page: FoliChatModel, history: FoliHistoryModel) {
        if let made { return made }
        guard let phone else { preconditionFailure("RebuildAI used before attach") }
        let feedback = ScreenFeedback(toast: { [weak phone] t in phone?.toast(t.message, tone: t.tone == .error ? .error : t.tone == .success ? .success : .info) })
        let sheet = FoliChatModel(client: phone.client, feedback: feedback)
        let page = FoliChatModel(client: phone.client, feedback: feedback)
        sheet.onOpen = { [weak self] route in
            self?.sheetOpen = false
            self?.open(route)
        }
        page.onOpen = { [weak self] route in self?.open(route) }
        let m = (sheet, page, FoliHistoryModel(client: phone.client))
        made = m
        return m
    }

    var sheet: FoliChatModel { models.sheet }
    var page: FoliChatModel { models.page }
    var history: FoliHistoryModel { models.history }

    /// The tab bar's Foli AI, or "Ask Foli AI" from search (its words in the box, as the web's openAsk).
    func ask(draft: String? = nil) {
        if let draft, !draft.isEmpty { sheet.draft = draft }
        sheetOpen = true
    }

    /// A folder's Foli AI (its menu): a new conversation about the folder (AskAiPanel's `folder`).
    func ask(about: FoliContext) {
        sheet.reopen(about: about)
        sheetOpen = true
    }

    func closeSheet() {
        sheetOpen = false
    }

    var host: PhoneAiHost {
        PhoneAiHost(session: phone?.session.value, openSettings: { [weak self] section in
            self?.sheetOpen = false
            self?.frame?.open(.web("/settings/\(section)"))
        }, openExternal: { [weak self] url in self?.phone?.router?.openExternal(url) })
    }

    /// A citation, a note an agent made, a link in an answer.
    private func open(_ route: ScreenRoute) {
        switch route {
        case .note(let id): phone?.router?.openNote(id, source: nil, focus: false)
        default: phone?.router?.open(route, source: nil)
        }
    }
}

/// The sheet's content: PhoneAiSheet on the window's sheet model.
struct RebuildAiSheet: View {
    let ai: RebuildAI
    let frame: PhoneFrameModel

    var body: some View {
        PhoneAiSheet(model: ai.sheet, host: ai.host, close: { ai.closeSheet() }, openPage: { id in
            ai.closeSheet()
            frame.open(.web(id.map { "/ai/\($0)" } ?? "/ai"))
        })
    }
}

/// /ai and /ai/<conversation>: the page on its own model. The route says which conversation it opens with; another
/// one picked from the drawer, or a new chat getting its address, changes the model, not the stack.
struct RebuildAiPage: View {
    let ai: RebuildAI
    let frame: PhoneFrameModel
    let path: String
    /// (Once: coming back from a note a citation opened keeps the conversation.)
    @State private var synced = false

    private var conversationId: String? {
        let p = path.split(separator: "?").first.map(String.init) ?? path
        guard p.hasPrefix("/ai/") else { return nil }
        return String(p.dropFirst(4)).removingPercentEncoding
    }

    private var question: String? {
        URLComponents(string: path)?.queryItems?.first { $0.name == "q" }?.value
    }

    var body: some View {
        let model = ai.page
        PhoneAiPage(model: model, history: ai.history, host: ai.host, back: { frame.back() }, open: { id in
            if let id { model.open(conversationId: id) } else { model.newChat() }
        })
        .onAppear {
            guard !synced else { return }
            synced = true
            if let id = conversationId {
                if model.conversationId != id { model.open(conversationId: id) }
            } else if !model.isNew {
                model.newChat()
            }
            if let q = question, model.isNew, model.draft.isEmpty { model.draft = q }
        }
    }
}
