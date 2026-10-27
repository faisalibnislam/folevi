#if os(macOS)
import SwiftUI
import FoleviEngine
import FoleviScreens
@MainActor final class GraphModel { init(client: EngineClient, feedback: ScreenFeedback) {} }
@MainActor final class ReviewModel { init(client: EngineClient, feedback: ScreenFeedback) {} }
@MainActor final class SharedFolderModel { init(client: EngineClient, folderId: String, feedback: ScreenFeedback) {} }
struct GraphScreen: View { let model: GraphModel; let frame: FrameModel; var body: some View { Color.clear } }
struct ReviewScreen: View { let model: ReviewModel; let frame: FrameModel; var body: some View { Color.clear } }
struct SharedFolderScreen: View { let model: SharedFolderModel; let frame: FrameModel; var body: some View { Color.clear } }
#endif
