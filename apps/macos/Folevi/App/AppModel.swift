import AppKit
import Observation
import SwiftUI

/// Everything that exists only while someone is signed in, for the scope they have open (Personal or a
/// team workspace). Switching scope builds a new context over the same local library and op queue.
final class SessionContext: Sendable {
    let profileId: String
    let scope: Scope
    let store: SQLiteStore
    let engine: SyncEngine
    let account: AccountRepository
    let documents: DocumentsRepository
    let organization: OrganizationRepository
    let tasks: TasksRepository
    let search: SearchRepository
    let files: FilesRepository
    let convex: ConvexService

    init(profileId: String, scope: Scope, store: SQLiteStore, engine: SyncEngine, convex: ConvexService, files: FilesRepository) {
        self.profileId = profileId
        self.scope = scope
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
        case deviceLimit(limit: Int, active: Int)
        /// First sign-in: Personal is being set up (users.bootstrap), or that failed.
        case settingUp
        case setupFailed(String)
        /// Signed in on this Mac, but the server can't be reached and there's no copy here yet.
        case offline
        case onboarding
        case ready
    }

    let config = AppConfig.current
    let convex: ConvexService?
    let authProvider: RoutingAuthProvider
    let monitor = ConnectionMonitor()

    var phase: Phase = .launching
    var profile: Profile?
    /// The team workspace that's open; nil in Personal.
    var workspace: WorkspaceInfo?
    /// The team workspaces you belong to (Personal is never one of them).
    var workspaces: [WorkspaceInfo] = []
    var session: SessionContext?
    var isAuthenticatedOnline = false
    var sync = SyncSnapshot()
    var documents: [DocumentSummary] = []
    var sidebar = SidebarData(folders: [], tags: [])
    var bannerMessage: String?
    var readOnlyMode = false
    var toast: String?
    /// What the toast offers to do (Undo), as on the web.
    var toastAction: ToastAction?
    var showQuickAdd = false
    var showCommandPalette = false
    /// Help is a page of the main window, as on the web; setting this shows it (see `openHelp`).
    var showHelp: Bool {
        get { false }
        set { if newValue { openHelp() } }
    }
    var showImporter = false
    var showNewWorkspace = false
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
        editorScale = scale == 0 ? 1 : min(1.35, max(0.85, scale))
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
        #if DEBUG
        LayoutProbe.scheduleIfRequested()
        #endif
        if LaunchOptions.uiTestReset { resetForUITests() }
        guard config.isBackendConfigured, convex != nil else {
            phase = .notConfigured
            return
        }
        #if DEBUG
        if let session = LaunchOptions.devSession, let account = authProvider.account {
            account.useEphemeralSession(session)
            authProvider.setMode(.ephemeral)
            await signIn(interactive: false)
            return
        }
        if let token = LaunchOptions.devToken {
            authProvider.setMode(.token(token))
            await signIn(interactive: true)
            return
        }
        #endif
        if authProvider.restoreSavedMode() {
            // Offline-first: open the last session from the local cache immediately, then authenticate.
            if let cached = await cachedSession() {
                await openSession(profile: cached.profile, scope: cached.scope, workspaces: cached.workspaces, authenticated: false)
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
        try? Keychain(service: "com.folevi.mac.auth0").deleteAll()
        UserDefaults.standard.removeObject(forKey: "lastProfileId")
        if let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            try? FileManager.default.removeItem(at: base.appendingPathComponent("Folevi", isDirectory: true))
        }
    }

    private struct CachedSession {
        var profile: Profile
        var scope: Scope
        var workspaces: [WorkspaceInfo]
    }

    private func cachedSession() async -> CachedSession? {
        guard let id = UserDefaults.standard.string(forKey: "lastProfileId"),
              let store = try? SQLiteStore(url: SQLiteStore.defaultURL(account: id)),
              let profile = try? await store.codable(Profile.self, forKey: "profile") else { return nil }
        let workspaces = (try? await store.codable([WorkspaceInfo].self, forKey: "workspaces")) ?? []
        await store.close()
        return CachedSession(profile: profile, scope: rememberedScope(profileId: profile.id, workspaces: workspaces), workspaces: workspaces)
    }

    /// The scope last open for this person, when it still exists; Personal otherwise.
    private func rememberedScope(profileId: String, workspaces: [WorkspaceInfo]) -> Scope {
        let scope = Scope(key: UserDefaults.standard.string(forKey: "lastScope.\(profileId)") ?? "personal")
        guard let id = scope.workspaceId else { return .personal }
        return workspaces.contains { $0.id == id } ? scope : .personal
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

    /// Opens Folevi's sign-in page in a browser sheet (Authorization Code + PKCE).
    func signInWithFolevi() async {
        guard config.isSignInConfigured else {
            signInError = String(localized: "Folevi isn't configured for sign-in yet.")
            return
        }
        authProvider.setMode(.folevi)
        await signIn(interactive: true)
    }

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
            if error is CancellationError {
                // Closed the browser sheet or pressed Cancel there: back to the sign-in screen, no error.
                phase = .signedOut(nil)
                return
            }
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
                phase = .settingUp
                do {
                    try await account.bootstrap()
                } catch {
                    phase = .setupFailed(ConvexService.mapError(error).localizedDescription)
                    return
                }
                me = try await account.me()
            }
            switch me.state {
            case .ready:
                guard let profile = me.profile else { throw FoleviError.invalidResponse("profile") }
                self.profile = profile
                isAuthenticatedOnline = true
                let workspaces = try await account.workspaces()
                if session == nil || session?.profileId != profile.id {
                    await openSession(profile: profile, scope: rememberedScope(profileId: profile.id, workspaces: workspaces),
                                      workspaces: workspaces, authenticated: true)
                } else {
                    await session?.engine.setAuthReady(true)
                    if let store = session?.store { try? await store.setCodable(profile, forKey: "profile") }
                    await applyWorkspaces(workspaces)
                    startSidebarWatch()
                }
                phase = profile.onboardingStep == "done" ? .ready : .onboarding
                startAccountWatch()
                Task { try? await account.registerSession() }
            case .signedOut:
                phase = .signedOut(String(localized: "You're signed out."))
            case .emailUnverified: phase = .emailUnverified
            case .mfaRequired: phase = .mfaRequired
            case .suspended: phase = .suspended
            case .sessionRevoked:
                phase = .sessionRevoked
                Task { await self.recoverRevokedSession() }
            case .deviceLimit: phase = .deviceLimit(limit: Int(me.limit ?? 0), active: Int(me.active ?? 0))
            case .needsBootstrap: phase = .signedOut(String(localized: "We couldn't finish setting up your account. Try again."))
            }
        } catch {
            let mapped = ConvexService.mapError(error)
            Log.auth.error("route after auth failed: \(mapped.code, privacy: .public)")
            if mapped.isNetwork, let cached = await cachedSession() {
                if session == nil { await openSession(profile: cached.profile, scope: cached.scope, workspaces: cached.workspaces, authenticated: false) }
                phase = .ready
                scheduleAuthRetry()
            } else if silent, session != nil {
                scheduleAuthRetry()
            } else if mapped.isNetwork {
                // Offline cold start with nothing on this Mac yet: the web's "You're offline" page.
                phase = .offline
            } else {
                phase = .signedOut(mapped.localizedDescription)
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
        workspaces = []
        documents = []
        isAuthenticatedOnline = false
        phase = .signedOut(message)
    }

    // MARK: Session

    func openSession(profile: Profile, scope: Scope, workspaces: [WorkspaceInfo], authenticated: Bool) async {
        guard let convex else { return }
        do {
            let store = try SQLiteStore(url: SQLiteStore.defaultURL(account: profile.id))
            try await store.setCodable(profile, forKey: "profile")
            try await store.setCodable(workspaces, forKey: "workspaces")
            UserDefaults.standard.set(profile.id, forKey: "lastProfileId")
            UserDefaults.standard.set(scope.key, forKey: "lastScope.\(profile.id)")
            let files = FilesRepository(convex: convex, store: store)
            let engine = SyncEngine(store: store, convex: convex, files: files, monitor: monitor, scope: scope, profileId: profile.id,
                                    deviceId: DeviceIdentity.deviceId)
            let context = SessionContext(profileId: profile.id, scope: scope, store: store, engine: engine, convex: convex, files: files)
            self.profile = profile
            self.workspaces = workspaces
            self.workspace = scope.workspaceId.flatMap { id in workspaces.first { $0.id == id } }
            self.session = context
            sidebar = (try? await store.codable(SidebarData.self, forKey: sidebarCacheKey(context))) ?? SidebarData(folders: [], tags: [])
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

    private func sidebarCacheKey(_ session: SessionContext) -> String {
        "sidebar.\(session.scope.storeKey(profileId: session.profileId))"
    }

    // MARK: Scope (Personal or a team workspace)

    /// Where new pages, lists, search and AI go right now.
    var scope: Scope { session?.scope ?? .personal }

    /// "Personal" or the open workspace's name.
    var scopeName: String { workspace?.name ?? String(localized: "Personal") }

    /// Whether you can add and edit pages here (members with view or comment access can't).
    var canEditHere: Bool { workspace?.canEdit ?? true }

    /// Whether this scope's plan includes AI: your Personal plan (Core has none), or the workspace's plan.
    var aiIncludedHere: Bool { workspace?.aiIncluded ?? profile?.entitlements?.ai ?? true }

    /// AI entry points show only when it's included here and you haven't switched it off (as on the web).
    var aiAvailable: Bool { profile?.aiEnabled != false && aiIncludedHere }

    /// Opens another scope: the same local library and op queue, a new engine for its pages and cursor.
    /// Queued page creations keep the scope they were stamped with, so nothing moves.
    func switchScope(_ scope: Scope) async {
        guard let session, let profile, scope != session.scope else { return }
        sidebarTask?.cancel()
        sidebarTask = nil
        eventTask?.cancel()
        eventTask = nil
        await session.engine.flushNow()
        await session.engine.stop()
        documents = []
        await openSession(profile: profile, scope: scope, workspaces: workspaces, authenticated: isAuthenticatedOnline)
        NotificationCenter.default.post(name: .foleviScopeChanged, object: nil)
    }

    /// Takes a fresh workspaces list; leaves a workspace that's gone (removed, deleted) for Personal.
    func applyWorkspaces(_ list: [WorkspaceInfo]) async {
        workspaces = list
        if let session { try? await session.store.setCodable(list, forKey: "workspaces") }
        guard let id = scope.workspaceId else { return }
        if let current = list.first(where: { $0.id == id }) {
            workspace = current
        } else {
            await switchScope(.personal)
            showToast(String(localized: "That workspace isn't available anymore. You're in Personal."))
        }
    }

    /// Creates a team workspace and opens it.
    func createWorkspace(name: String) async throws {
        guard let session else { return }
        let id = try await session.account.createWorkspace(name: name)
        let list = try await session.account.workspaces()
        workspaces = list
        try? await session.store.setCodable(list, forKey: "workspaces")
        await switchScope(.workspace(id))
    }

    func refreshWorkspaces() async {
        guard let session, let list = try? await session.account.workspaces() else { return }
        await applyWorkspaces(list)
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
                        // A password or two-step change on this Mac replaced the session: recover; otherwise
                        // it was signed out elsewhere, revoked or expired (the web's AccountGate does the same).
                        self.meTask = nil
                        Task { await self.recoverRevokedSession() }
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
        let scope = session.scope
        let cacheKey = sidebarCacheKey(session)
        sidebarTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    for try await data in org.sidebarUpdates(scope: scope) {
                        guard self?.session?.scope == scope else { return }
                        self?.sidebar = data
                        try? await store.setCodable(data, forKey: cacheKey)
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

    func completeOnboarding(_ choice: OnboardingStepChoice) async throws {
        guard let session else { return }
        try await session.account.completeOnboarding(choice)
        if let ai = choice.aiEnabled { profile?.aiEnabled = ai }
        if let ids = choice.useCases { profile?.onboardingUseCases = Array(Set((profile?.onboardingUseCases ?? []) + ids)) }
        if choice.step == "welcome" {
            profile?.onboardingStep = "done"
            phase = .ready
            // A new account's first pages are in Personal.
            if !scope.isPersonal { await switchScope(.personal) }
        }
        if let p = profile { try? await self.session?.store.setCodable(p, forKey: "profile") }
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
    func createDocument(id explicitId: String? = nil, title: String = "", icon: String? = nil, folderId: String? = nil, parentDocumentId: String? = nil,
                        kind: DocumentKind = .document, dailyDate: String? = nil, blocks: [WireBlock]? = nil) async -> String? {
        guard let session, let profile else { return nil }
        if parentDocumentId == nil, !canEditHere {
            showToast(String(localized: "You can view this workspace but not add pages to it."))
            return nil
        }
        let id = explicitId ?? ULID.make()
        let now = Date().timeIntervalSince1970 * 1000
        // A nested page lives in its parent's scope; a top-level one is stamped with the scope open now.
        let parent = parentDocumentId.flatMap { document($0) }
        let create = WireDocumentCreate(id: id, parentDocumentId: parentDocumentId, folderId: folderId, kind: kind, title: title, icon: icon,
                                        dailyDate: dailyDate, scope: parentDocumentId == nil ? session.scope : nil)
        let workspaceId = parent?.workspaceId ?? session.scope.workspaceId ?? ""
        let owner = parent.map { $0.ownerProfileId } ?? (session.scope.isPersonal ? profile.id : nil)
        let summary = DocumentSummary(id: id, workspaceId: workspaceId, ownerProfileId: owner, parentDocumentId: parentDocumentId, folderId: folderId,
                                      kind: kind, title: title, icon: icon, dailyDate: dailyDate, createdAt: now, updatedAt: now, createdBy: profile.id)
        let initial = blocks ?? [WireBlock(id: ULID.make(), type: "paragraph", parentId: nil, rank: "V")]
        await session.engine.createDocument(create, summary: summary, blocks: initial)
        return id
    }

    /// The person's Inbox page (Quick Add target). Its id is deterministic, so every device — even
    /// offline — converges on the same page: created locally when missing, restored from the Trash
    /// when it was deleted (the server does the same).
    func inboxDocumentId() async -> String? {
        guard let profile, let session else { return nil }
        let id = InboxPage.documentId(profileId: profile.id, scopeKey: session.scope.key)
        var existing = document(id)
        if existing == nil { existing = await session.engine.document(id) }
        if let existing {
            if existing.deletedAt != nil, sync.isOnline {
                try? await session.documents.restoreFromTrash(id)
            }
            return id
        }
        // No initial blocks: the page may already exist on the server with content.
        return await createDocument(id: id, title: InboxPage.title, icon: InboxPage.icon, blocks: [])
    }

    func updateDocument(_ id: String, patch: WireDocumentPatch) async {
        await session?.engine.updateDocument(id, patch: patch)
    }

    // MARK: Session changes (Security)

    /// Set while Settings → Security replaces this Mac's session, so a "session revoked" meanwhile waits.
    private(set) var sessionRotation: Task<Void, Never>?
    private var recovering = false

    /// Better Auth replaced this Mac's session (a password change, two-step verification turned on or off):
    /// fetch a token for the new one and re-register this device, before anything else asks.
    func sessionReplaced() async {
        let work = Task { @MainActor [weak self] in
            guard let self, let convex = self.convex else { return }
            _ = await convex.loginFromCache()
            try? await AccountRepository(convex: convex).registerSession()
        }
        sessionRotation = work
        await work.value
        sessionRotation = nil
    }

    /// The server says this session is gone. When this Mac just replaced it, the new one takes over;
    /// otherwise, after a few tries, sign out with the web's "session ended" notice. Work written offline
    /// stays on this Mac and syncs after signing back in to the same account.
    func recoverRevokedSession() async {
        guard !recovering, let convex else { return }
        recovering = true
        defer { recovering = false }
        for _ in 0..<3 {
            if let rotation = sessionRotation { await rotation.value }
            if case .success = await convex.loginFromCache(), let me = try? await AccountRepository(convex: convex).me(), me.state == .ready {
                await routeAfterAuth(silent: true)
                return
            }
            try? await Task.sleep(for: .milliseconds(700))
        }
        await signOut(message: String(localized: "Your session ended. Sign in again to keep writing. Anything you wrote offline is still on this device."))
    }

    /// Shows Help in the main window (`contact` also opens Contact support). Signed out, the guide on the web.
    func openHelp(contact: Bool = false) {
        guard phase == .ready else {
            NSWorkspace.shared.open(HelpPage.docsURL)
            return
        }
        SettingsRouter.shared.openHelp(contact: contact)
    }

    func showToast(_ message: String, action: ToastAction? = nil) {
        toast = message
        toastAction = action
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(action == nil ? 4 : 7))
            if self?.toast == message {
                self?.toast = nil
                self?.toastAction = nil
            }
        }
    }

    /// Online-only document action with a friendly offline message.
    func perform(_ label: String, _ action: @escaping @Sendable (SessionContext) async throws -> Void) {
        guard let session else { return }
        guard sync.isOnline else {
            showToast(String(localized: "This needs a connection. Try again when you're back online."))
            Log.app.info("online-only action skipped offline: \(label, privacy: .private)")
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
    /// Personal ↔ workspace: windows go back to Home.
    static let foleviScopeChanged = Notification.Name("FoleviScopeChanged")
}

extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let m = pow(10, Double(places))
        return (self * m).rounded() / m
    }
}
