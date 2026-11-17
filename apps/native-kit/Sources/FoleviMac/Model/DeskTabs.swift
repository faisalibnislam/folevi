// The iPad's wide layout keeps its tabs and the screen on show between launches, as the Mac's windows do (apps/mac
// WindowRestore keeps each window's TabsModel.Saved in windows.json): a moment after they change they are kept in
// the app's settings, and in the scene's restoration activity when iOS asks; the app puts them back when the
// window opens.
import Foundation

@MainActor
public enum DeskTabs {
    /// Where the last saved tabs are kept (UserDefaults).
    public static let defaultsKey = "folevi.desk.tabs"

    public nonisolated static func encode(_ saved: TabsModel.Saved) -> Data? { try? JSONEncoder().encode(saved) }

    public nonisolated static func decode(_ data: Data) -> TabsModel.Saved? { try? JSONDecoder().decode(TabsModel.Saved.self, from: data) }

    /// The frame's tabs as they are now.
    public static func data(_ model: FrameModel) -> Data? { encode(model.tabs.saved) }

    public static func save(_ model: FrameModel, to defaults: UserDefaults = .standard) {
        pending?.cancel()
        pending = nil
        guard let data = data(model) else { return }
        defaults.set(data, forKey: defaultsKey)
    }

    /// The tabs saved last, if any (and readable).
    public static func saved(in defaults: UserDefaults = .standard) -> TabsModel.Saved? {
        defaults.data(forKey: defaultsKey).flatMap(decode)
    }

    private static var pending: Task<Void, Never>?

    /// The frame's tabs or route changed: saved a moment later (once for a burst of changes).
    public static func changed(_ model: FrameModel, defaults: UserDefaults = .standard) {
        pending?.cancel()
        pending = Task { @MainActor [weak model] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let model else { return }
            save(model, to: defaults)
        }
    }
}
