// The web routes the Mac frame draws natively beyond the shared screens: Help (/help), Graph (/graph), Reviews
// (/review) and a folder shared with this person (/shared/<id>). Anything else keeps the placeholder that
// names it.
#if os(macOS)
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

/// The models of these screens, kept while the window lives (as ScreenModels keeps the others).
@MainActor
final class MoreModels {
    let frame: FrameModel
    let feedback: ScreenFeedback
    private var graph: GraphModel?
    private var review: ReviewModel?
    private var sharedFolders: [String: SharedFolderModel] = [:]
    private var shared: SharedWithMeModel?
    private var changes: ChangesWebModel?

    func sharedModel() -> SharedWithMeModel {
        if let shared { return shared }
        let m = SharedWithMeModel(client: frame.client)
        shared = m
        return m
    }

    func changesModel() -> ChangesWebModel {
        if let changes { return changes }
        let m = ChangesWebModel(client: frame.client, feedback: feedback)
        changes = m
        return m
    }

    init(frame: FrameModel, feedback: ScreenFeedback) {
        self.frame = frame
        self.feedback = feedback
    }

    func graphModel() -> GraphModel {
        if let graph { return graph }
        let m = GraphModel(client: frame.client, feedback: feedback)
        graph = m
        return m
    }

    func reviewModel() -> ReviewModel {
        if let review { return review }
        let m = ReviewModel(client: frame.client, feedback: feedback)
        review = m
        return m
    }

    func sharedFolder(_ id: String) -> SharedFolderModel {
        if let m = sharedFolders[id] { return m }
        let m = SharedFolderModel(client: frame.client, folderId: id, feedback: feedback)
        sharedFolders[id] = m
        return m
    }
}

struct MoreScreen: View {
    /// The routes drawn here, over the content card's own fill as the web's are.
    static func clear(_ route: FrameRoute) -> Bool {
        switch route {
        case .web(let p): return ["/help", "/graph", "/review", "/shared/"].contains { p.hasPrefix($0) }
        case .shared, .changes: return true
        default: return false
        }
    }

    let model: FrameModel
    let more: MoreModels
    let path: String

    var body: some View {
        let head = path.split(separator: "/").map(String.init)
        switch head.first {
        case "help": HelpScreen(model: model)
        case "graph": GraphScreen(model: more.graphModel(), frame: model)
        case "review": ReviewScreen(model: more.reviewModel(), frame: model)
        case "shared" where head.count > 1: SharedFolderScreen(model: more.sharedFolder(head[1].removingPercentEncoding ?? head[1]), frame: model)
        default: Placeholder(symbol: "globe", title: "Not here yet", message: "\(path) doesn't have a screen in the Mac app yet.")
        }
    }
}
#endif
