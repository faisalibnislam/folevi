#if os(macOS)
import SwiftUI
import FoleviEngine
import FoleviScreens
@MainActor final class SharedFolderModel { init(client: EngineClient, folderId: String, feedback: ScreenFeedback) {} }
struct SharedFolderScreen: View { let model: SharedFolderModel; let frame: FrameModel; var body: some View { Color.clear } }
#endif
