import AppKit
import Observation
import SwiftUI

/// Everything that exists only while someone is signed in to a workspace.
final class SessionContext: Sendable {
    let profileId: String
    let workspaceId: String
    let store: SQLiteStore
    let engine: SyncEngine
    let account: AccountRepository
    let documents: DocumentsRepository
    let organization: OrganizationRepository
    let tasks: TasksRepository
    let search: SearchRepository
    let files: FilesRepository
    let convex: ConvexService

    init(profileId: String, workspaceId: String, store: SQLiteStore, engine: SyncEngine, convex: ConvexService, files: FilesRepository) {
        self.profileId = profileId
        self.workspaceId = workspaceId
        self.store = store
        self.engine = engine
        self.files = files
        self.convex = convex
        account = AccountRepository(convex: convex)
        documents = DocumentsRepository(convex: convex)
        organization = OrganizationRepository(convex: convex)
        tasks = TasksRepository(convex: convex)
        search = SearchRepository(convex: convex)
    }
}

enum AppearancePreference: String, CaseIterable, Identifiable, Sendable {
    case system, light, dark
    var id: String { rawValue }
    var title: LocalizedStringKey {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }
}

/// App-wide state shared by every window: auth phase, the signed-in session, local document cache,
/// sidebar data and sync status. Main-actor isolated; talks to actors/services with async calls.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case launching
        case notConfigured
        case signedOut(String?)
        case signingIn
        case emailUnverified
        case mfaRequired
        case suspended
        case sessionRevoked
        case onboarding
        case ready
    }

    let config = AppConfig.current
    let convex: ConvexService?
    let authProvider: RoutingAuthProvider
    let monitor = ConnectionMonitor()

    var phase: Phase = .launching
    var profile: Profile?
    var workspace: WorkspaceInfo?
    var session: SessionContext?
    var isAuthenticatedOnline = false
    var sync = SyncSnapshot()
    var documents: [DocumentSummary] = []
    var sidebar = SidebarData(folders: [], tags: [])
    var bannerMessage: String?
    var readOnlyMode = false
    var toast: String?
    var showQuickAdd = false
    var showCommandPalette = false
    var showHelp = false
    var showImporter = false
    var showDevSignIn = false
    /// A document to open once the main window appears (onboarding, notifications, launch arguments).
    var pendingOpenDocumentId: String?
    var signInError: String?
    /// Documents whose content changed (bumped on every block event; views observe it).
    var blockRevision: [String: Int] = [:]
    var remoteRevision: [String: Int] = [:]
    var documentsRevision = 0

    var appearance: AppearancePreference {
        didSet {
            UserDefaults.standard.set(appearance.rawValue, forKey: "appearance")
            applyAppearance()
        }
    }

    var editorScale: Double {
        didSet { UserDefaults.standard.set(editorScale, forKey: "editorScale") }
    }

    private var eventTask: Task<Void, Never>?
    private var meTask: Task<Void, Never>?
    private var sidebarTask: Task<Void, Never>?

    init() {
        let provider = RoutingAuthProvider(config: config)
        authProvider = provider
        if config.isBackendConfigured {
            convex = ConvexService(deploymentURL: config.convexURL, auth: provider)
        } else {
            convex = nil
        }
        appearance = AppearancePreference(rawValue: UserDefaults.standard.string(forKey: "appearance") ?? "") ?? .system
        let scale = UserDefaults.standard.double(forKey: "editorScale")
        editorScale = scale == 0 ? 1 : min(1.6, max(0.8, scale))
    }

    // MARK: Appearance

    func applyAppearance() {
        switch appearance {
        case .system: NSApp?.appearance = nil
        case .light: NSApp?.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp?.appearance = NSAppearance(named: .darkAqua)
        }
    }

    var colorScheme: ColorScheme? {
        switch appearance {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    func zoomIn() { editorScale = min(1.6, (editorScale + 0.1).rounded(toPlaces: 1)) }
    func zoomOut() { editorScale = max(0.8, (editorScale - 0.1).rounded(toPlaces: 1)) }
    func zoomReset() { editorScale = 1 }

    // MARK: Launch

    func start() async {
        guard phase == .launching else { return }
        #if DEBUG
        if let a = LaunchOptions.value(after: "-FoleviAppearance"), let pref = AppearancePreference(rawValue: a) { appearance = pref }
        #endif
        applyAppearance()
        if LaunchOptions.uiTestReset { resetForUITests() }
        guard config.isBackendConfigured, convex != nil else {
            phase = .notConfigured
            return
        }
        #if DEBUG
        if let token = LaunchOptions.devToken {
            authProvider.setMode(.token(token))
            await signIn(interactive: true)
            return
        }
        #endif
        if authProvider.restoreSavedMode() {
            // Offline-first: open the last session from the local cache immediately, then authenticate.
            if let cached = await cachedSession() {
                await openSession(profile: cached.profile, workspace: cached.workspace, authenticated: false)
                phase = .ready
                Task { await self.authenticateInBackground() }
                return
            }
            await signIn(interactive: false)
            return
        }
        phase = .signedOut(nil)
    }

    private func resetForUITests() {
        try? Keychain.app.deleteAll()
        try? KeychainCredentialsStorage().deleteAllEntries()
        UserDefaults.standard.removeObject(forKey: "lastProfileId")
        if let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            try? FileManager.default.removeItem(at: base.appendingPathComponent("Folevi", isDirectory: true))
        }
    }

    private struct CachedSession {
        var profile: Profile
        var workspace: WorkspaceInfo
    }

    private func cachedSession() async -> CachedSession? {
        guard let id = UserDefaults.standard.string(forKey: "lastProfileId"),
              let store = try? SQLiteStore(url: SQLiteStore.defaultURL(account: id)),
              let profile = try? await store.codable(Profile.self, forKey: "profile"),
              let workspace = try? await store.codable(WorkspaceInfo.self, forKey: "workspace") else { return nil }
        await store.close()
        return CachedSession(profile: profile, workspace: workspace)
    }

    private func authenticateInBackground() async {
        guard let convex else { return }
        switch await convex.loginFromCache() {
        case .success:
            await routeAfterAuth(silent: true)
        case .failure(let error):
            let mapped = ConvexService.mapError(error)
            Log.auth.error("background sign-in failed: \(mapped.code, privacy: .public)")
            if mapped.code == "unauthenticated" || mapped.code == "not_configured" || !(error is URLError) && !mapped.isNetwork && isCredentialError(error) {
                await signOut(message: String(localized: "Your session ended. Sign in again to keep syncing."))
            } else {
                // Still offline: keep working locally; retry when the network returns.
                scheduleAuthRetry()
            }
        }
    }

    private func isCredentialError(_ error: Error) -> Bool {
        let text = String(describing: error).lowercased()
        return text.contains("nocredentials") || text.contains("refresh") && text.contains("invalid") || text.contains("notsignedin")
    }

    private func scheduleAuthRetry() {
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(15))
            guard let self, !self.isAuthenticatedOnline, self.phase == .ready else { return }
            await self.authenticateInBackground()
        }
    }

    // MARK: Sign in / out

    func signInWithAuth0() async {
        guard config.isAuth0Configured else {
            signInError = String(localized: "Folevi isn't configured for sign-in yet.")
            return
        }
        authProvider.setMode(.auth0)
        await signIn(interactive: true)
    }

    #if DEBUG
    func signInAsDeveloper(email: String, name: String) async {
        authProvider.setMode(.developer(email: email, name: name))
        await signIn(interactive: true)
    }
    #endif

    func signIn(interactive: Bool) async {
        guard let convex else {
            phase = .notConfigured
            return
        }
        signInError = nil
        phase = .signingIn
        let result = interactive ? await convex.login() : await convex.loginFromCache()
        switch result {
        case .success:
            await routeAfterAuth(silent: false)
        case .failure(let error):
            let mapped = ConvexService.mapError(error)
            Log.auth.error("sign-in failed: \(mapped.code, privacy: .public)")
            let message: String?
            if case .server(_, let m) = mapped { message = m } else if interactive { message = String(localized: "Sign-in didn't complete. Try again.") } else { message = nil }
            phase = .signedOut(message)
        }
    }

    /// After a token is in place: ask the server who we are and route.
    func routeAfterAuth(silent: Bool) async {
        guard let convex else { return }
        let account = AccountRepository(convex: convex)
        do {
            var me = try await account.me()
            if me.state == .needsBootstrap {
                try await account.bootstrap()
                me = try await account.me()
            }
            switch me.state {
            case .ready:
                guard let profile = me.profile else { throw FoleviError.invalidResponse("profile") }
                self.profile = profile
                isAuthenticatedOnline = true
                if session == nil || session?.profileId != profile.id {
                    let workspaces = try await account.workspaces()
                    guard let ws = workspaces.first(where: { $0.id == profile.defaultWorkspaceId }) ?? workspaces.first else {
                        throw FoleviError.invalidResponse("workspace")
                    }
                    await openSession(profile: profile, workspace: ws, authenticated: true)
                } else {
                    await session?.engine.setAuthReady(true)
                    if let store = session?.store { try? await store.setCodable(profile, forKey: "profile") }
                }
                phase = profile.onboardingStep == "done" ? .ready : .onboarding
                startAccountWatch()
                Task { try? await account.registerSession() }
            case .signedOut:
                phase = .signedOut(String(localized: "You're signed out."))
            case .emailUnverified: phase = .emailUnverified
            case .mfaRequired: phase = .mfaRequired
            case .suspended: phase = .suspended
            case .sessionRevoked: phase = .sessionRevoked
            case .needsBootstrap: phase = .signedOut(String(localized: "We couldn't finish setting up your account. Try again."))
            }
        } catch {
            let mapped = ConvexService.mapError(error)
            Log.auth.error("route after auth failed: \(mapped.code, privacy: .public)")
            if mapped.isNetwork, let cached = await cachedSession() {
                if session == nil { await openSession(profile: cached.profile, workspace: cached.workspace, authenticated: false) }
                phase = .ready
                scheduleAuthRetry()
            } else if silent, session != nil {
                scheduleAuthRetry()
            } else {
                phase = .signedOut(mapped.isNetwork ? String(localized: "Can't reach Folevi right now. Check your connection and try again.") : mapped.localizedDescription)
            }
        }
    }

    func signOut(message: String? = nil) async {
        meTask?.cancel()
        sidebarTask?.cancel()
        eventTask?.cancel()
        if let engine = session?.engine {
            await engine.flushNow()
            await engine.stop()
        }
        await convex?.logout()
        authProvider.clearSaved()
        UserDefaults.standard.removeObject(forKey: "lastProfileId")
        session = nil
        profile = nil
        workspace = nil
        documents = []
        isAuthenticatedOnline = false
        phase = .signedOut(message)
    }

    // MARK: Session

    func openSession(profile: Profile, workspace: WorkspaceInfo, authenticated: Bool) async {
        guard let convex else { return }
        do {
            let store = try SQLiteStore(url: SQLiteStore.defaultURL(account: profile.id))
            try await store.setCodable(profile, forKey: "profile")
            try await store.setCodable(workspace, forKey: "workspace")
            UserDefaults.standard.set(profile.id, forKey: "lastProfileId")
            let files = FilesRepository(convex: convex, store: store)
            let engine = SyncEngine(store: store, convex: convex, files: files, monitor: monitor, workspaceId: workspace.id, deviceId: DeviceIdentity.deviceId)
            let context = SessionContext(profileId: profile.id, workspaceId: workspace.id, store: store, engine: engine, convex: convex, files: files)
            self.profile = profile
            self.workspace = workspace
            self.session = context
            if let cachedSidebar = try? await store.codable(SidebarData.self, forKey: "sidebar") { sidebar = cachedSidebar }
            await engine.start(forcedOffline: LaunchOptions.forceOffline) { [weak self] in
                await self?.refreshAuthForSync() ?? false
            }
            listen(to: engine)
            await reloadDocuments()
            await engine.setAuthReady(authenticated)
            if authenticated { startSidebarWatch() }
            if let remote = profile.appearance as String?, let pref = AppearancePreference(rawValue: remote),
               UserDefaults.standard.string(forKey: "appearance") == nil {
                appearance = pref
            }
        } catch {
            Log.store.error("open session failed: \(String(describing: error), privacy: .public)")
            phase = .signedOut(String(localized: "Folevi couldn't open its local library on this Mac."))
        }
    }

    private func refreshAuthForSync() async -> Bool {
        guard let convex else { return false }
        switch await convex.loginFromCache() {
        case .success: return true
        case .failure: return false
        }
    }

    private func listen(to engine: SyncEngine) {
        eventTask?.cancel()
        eventTask = Task { [weak self] in
            let stream = await engine.events()
            for await event in stream {
                guard let self else { return }
                switch event {
                case .status(let snap):
                    if self.sync != snap { self.sync = snap }
                case .documents:
                    await self.reloadDocuments()
                case .blocks(let docs):
                    for d in docs { self.blockRevision[d, default: 0] += 1 }
                case .remoteBlocks(let docs):
                    for d in docs { self.remoteRevision[d, default: 0] += 1 }
                case .acknowledged(let docs):
                    NotificationCenter.default.post(name: .foleviAcknowledged, object: nil, userInfo: ["documents": Array(docs)])
                }
            }
        }
    }

    private func startAccountWatch() {
        guard let convex, meTask == nil else { return }
        let account = AccountRepository(convex: convex)
        meTask = Task { [weak self] in
            do {
                for try await me in account.meUpdates() {
                    guard let self else { return }
                    switch me.state {
                    case .sessionRevoked:
                        await self.signOut(message: String(localized: "This Mac was signed out from another device."))
                        return
                    case .suspended:
                        self.phase = .suspended
                    case .ready:
                        if let p = me.profile { self.profile = p }
                    default:
                        break
                    }
                }
            } catch {
                Log.auth.error("account watch ended: \(ConvexService.mapError(error).code, privacy: .public)")
            }
            self?.meTask = nil
        }
    }

    private func startSidebarWatch() {
        guard let session, sidebarTask == nil else { return }
        let org = session.organization
        let store = session.store
        let workspaceId = session.workspaceId
        sidebarTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    for try await data in org.sidebarUpdates(workspaceId: workspaceId) {
                        self?.sidebar = data
                        try? await store.setCodable(data, forKey: "sidebar")
                    }
                } catch {
                    Log.remote.error("sidebar subscription ended")
                }
                try? await Task.sleep(for: .seconds(10))
            }
        }
        Task {
            if let status = try? await session.account.settingsStatus() {
                self.bannerMessage = status.bannerMessage
                self.readOnlyMode = status.readOnly
            }
        }
    }

    func reloadDocuments() async {
        guard let engine = session?.engine else { return }
        documents = await engine.documents()
        documentsRevision += 1
    }

    // MARK: Onboarding

    func completeOnboarding(step: String, workspaceName: String? = nil, appearance: String? = nil) async throws {
        guard let session else { return }
        try await session.account.completeOnboarding(step: step, workspaceName: workspaceName, appearance: appearance)
        if step == "welcome" {
            profile?.onboardingStep = "done"
            if let p = profile { try? await session.store.setCodable(p, forKey: "profile") }
            phase = .ready
        } else if step == "workspace", let name = workspaceName {
            workspace?.name = name
            if let w = workspace { try? await session.store.setCodable(w, forKey: "workspace") }
        }
    }

    // MARK: Documents

    func document(_ id: String) -> DocumentSummary? {
        documents.first { $0.id == id }
    }

    var welcomeDocument: DocumentSummary? {
        documents.first { $0.title.localizedCaseInsensitiveContains("Welcome") && $0.deletedAt == nil }
    }

    /// Creates a document locally (works offline) with a first empty paragraph. Returns its id.
    @discardableResult
    func createDocument(id explicitId: String? = nil, title: String = "", folderId: String? = nil, parentDocumentId: String? = nil,
                        kind: DocumentKind = .document, dailyDate: String? = nil, blocks: [WireBlock]? = nil) async -> String? {
        guard let session, let profile else { return nil }
        let id = explicitId ?? ULID.make()
        let now = Date().timeIntervalSince1970 * 1000
        let create = WireDocumentCreate(id: id, parentDocumentId: parentDocumentId, folderId: folderId, kind: kind, title: title, dailyDate: dailyDate)
        let summary = DocumentSummary(id: id, workspaceId: session.workspaceId, parentDocumentId: parentDocumentId, folderId: folderId, kind: kind,
                                      title: title, dailyDate: dailyDate, createdAt: now, updatedAt: now, createdBy: profile.id)
        let initial = blocks ?? [WireBlock(id: ULID.make(), type: "paragraph", parentId: nil, rank: "V")]
        await session.engine.createDocument(create, summary: summary, blocks: initial)
        return id
    }

    /// Opens (creating if needed) the Daily Note for a date. The id is deterministic, so every device
    /// converges on the same document even when created offline.
    func dailyNoteId(for date: String) async -> String? {
        guard let profile, let workspace else { return nil }
        let id = DailyNote.documentId(profileId: profile.id, workspaceId: workspace.id, date: date)
        if document(id) != nil { return id }
        if let existing = documents.first(where: { $0.kind == .daily && $0.dailyDate == date && $0.deletedAt == nil }) { return existing.id }
        // No initial blocks: the note may already exist on the server with content.
        return await createDocument(id: id, title: DailyNote.title(for: date), kind: .daily, dailyDate: date, blocks: [])
    }

    func updateDocument(_ id: String, patch: WireDocumentPatch) async {
        await session?.engine.updateDocument(id, patch: patch)
    }

    func showToast(_ message: String) {
        toast = message
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            if self?.toast == message { self?.toast = nil }
        }
    }

    /// Online-only document action with a friendly offline message.
    func perform(_ label: String, _ action: @escaping @Sendable (SessionContext) async throws -> Void) {
        guard let session else { return }
        guard sync.isOnline else {
            showToast(String(localized: "\(label) needs a connection. Try again when you're back online."))
            return
        }
        Task {
            do {
                try await action(session)
                await session.engine.syncNow()
            } catch {
                showToast(ConvexService.mapError(error).localizedDescription)
            }
        }
    }

    func setForcedOffline(_ offline: Bool) async {
        await session?.engine.setForcedOffline(offline)
    }
}

extension Notification.Name {
    static let foleviAcknowledged = Notification.Name("FoleviAcknowledged")
    static let foleviOpenDocument = Notification.Name("FoleviOpenDocument")
}

extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let m = pow(10, Double(places))
        return (self * m).rounded() / m
    }
}
