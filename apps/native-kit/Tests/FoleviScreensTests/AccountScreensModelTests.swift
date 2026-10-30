// View model tests for the gates, sign-in, Settings, sharing and Quick Add (N13, N14), against the scripted engine
// with the contract's own fixtures (every gate kind) and a scripted auth service. No real account is ever reached.
import Foundation
import Testing
@testable import FoleviEngine
@testable import FoleviScreens

/// FakeEngine plus what these screens also ask: `query` (task.parse, search), `editor` (web.show) and events.
@MainActor
final class AccountEngine {
    let fake: FakeEngine
    var queries: [String: JSONValue] = [:]
    private(set) var editors: [(name: String, args: JSONValue)] = []
    private(set) var queried: [(name: String, args: JSONValue)] = []

    init() {
        fake = FakeEngine()
        fake.transport = ScriptedTransport { m in try await self.respond(m) } // the test-only cycle FakeEngine has too
        // These screens' commands answer `OkResult` unless a test says otherwise.
        fake.onCommand = { _, _ in .object(["ok": .bool(true)]) }
        for (view, file) in [("account.details", "view.account.details.json"), ("settings.account", "view.settings.account.json"), ("settings.general", "view.settings.general.json"), ("settings.appearance", "view.settings.appearance.json"), ("settings.notifications", "view.settings.notifications.json"), ("settings.ai", "view.settings.ai.json"), ("settings.security", "view.settings.security.json"), ("sharing.get", "view.sharing.get.json")] {
            fake.values[view] = Fixtures.value(file)
        }
        queries["task.parse"] = Fixtures.value("view.task.parse.json")
        queries["search"] = .object(["text": .string(""), "hits": .array([]), "meaningAvailable": .bool(false)])
    }

    func client() -> EngineClient { fake.client() }

    func respond(_ m: JSONValue) async throws -> JSONValue {
        switch m["kind"]?.string ?? "" {
        case "query":
            let name = m["name"]?.string ?? ""
            queried.append((name, m["args"] ?? .null))
            if let v = queries[name] { return v }
            throw EngineFailure.engine(EngineError(code: "unknown_view", message: "No view \(name)."))
        case "editor":
            editors.append((m["name"]?.string ?? "", m["args"] ?? .null))
            return .object(["id": m["args"]?["page"] ?? .string(""), "ready": .bool(true)])
        default:
            return try await fake.respond(m)
        }
    }

    func push(event name: String, _ data: JSONValue) {
        fake.transport.push(.array([.object(["kind": .string("event"), "name": .string(name), "data": data])]))
    }

    /// A gate fixture's payload.
    static func gate(_ file: String) -> GateChangedEvent { try! Fixtures.json(file)["data"]!.decode(GateChangedEvent.self) }
}

let gateFixtures = ["event.gate.changed.approval.json", "event.gate.changed.device-limit.json", "event.gate.changed.e2ee-setup.json", "event.gate.changed.json", "event.gate.changed.loading.json", "event.gate.changed.locked.json", "event.gate.changed.migration-moving.json", "event.gate.changed.migration.json", "event.gate.changed.mode-choice.json", "event.gate.changed.onboarding.json", "event.gate.changed.signed-out.json", "event.gate.changed.wrong-passphrase.json"]

@Suite("Gates") @MainActor
struct GateModelTests {
    @Test func everyFixtureShowsAScreen() {
        let engine = AccountEngine()
        let model = GateModel(client: engine.client(), device: .iPhone)
        for file in gateFixtures {
            let e = AccountEngine.gate(file)
            model.show(e)
            if e.gate == nil {
                #expect(model.gate == nil, "\(file)")
                continue
            }
            #expect(!model.title.isEmpty, "\(file) has a heading")
            #expect(model.kind.raw == e.gate, "\(file)")
            #expect(model.visibleActions.allSatisfy { a in e.actions.contains { $0.id == a.id } }, "\(file) only offers its own buttons")
        }
    }

    @Test func kindsRoundTrip() {
        for raw in ["loading", "modeChoice", "signedOut", "emailUnverified", "suspended", "setupFailed", "offline", "error", "deviceLimit", "onboarding", "librarySetup", "libraryLocked", "updateRequired", "migration", "placeMove", "e2eeLocked", "e2eeSetup", "e2eeWaiting", "e2eeTrust", "somethingNew"] {
            #expect(GateKind(raw).raw == raw)
        }
        #expect(!GateKind.loading.isScreen)
        #expect(GateKind("somethingNew") == .other("somethingNew"))
    }

    @Test func emptyHeadingsUseNativeWords() {
        let model = GateModel(client: AccountEngine().client(), device: .mac)
        model.show(AccountEngine.gate("event.gate.changed.signed-out.json"))
        #expect(model.title == "Sign in to Folevi")
        var update = AccountEngine.gate("event.gate.changed.signed-out.json")
        update.gate = "updateRequired"
        model.show(update)
        #expect(model.message.contains("Check for Updates in the Folevi menu"))
        let phone = GateModel(client: AccountEngine().client(), device: .iPhone, gate: update)
        #expect(phone.message.contains("App Store"))
    }

    @Test func unlockOffersOneWayAtATime() async {
        let engine = AccountEngine()
        let model = GateModel(client: engine.client(), device: .iPhone)
        model.show(AccountEngine.gate("event.gate.changed.locked.json"))
        #expect(model.methodActions.map(\.id) == ["passphrase", "recovery"])
        #expect(model.visibleFields.map(\.id) == ["passphrase"])
        #expect(model.visibleActions.first?.id == "passphrase")
        #expect(model.otherMethods.map(\.id) == ["recovery"])
        #expect(!model.isEnabled(model.visibleActions[0]), "waits for the passphrase")
        model.choose(method: "recovery")
        #expect(model.visibleFields.map(\.id) == ["recoveryKey"])
        model.values["recoveryKey"] = "k7qm 2rtx-9vbn4hjw"
        #expect(model.isEnabled(model.visibleActions[0]))
        await model.act("recovery")
        #expect(model.errorMessage == nil)
        let sent = engine.fake.commands(named: "gate.act").last
        #expect(sent?["action"]?.string == "recovery")
        #expect(sent?["values"]?["recoveryKey"]?.string == "K7QM-2RTX-9VBN-4HJW")
        #expect(sent?["values"]?["passphrase"] == nil, "only the fields on screen go")
    }

    @Test func wrongPassphraseShowsTheErrorAndClearsTheField() {
        let model = GateModel(client: AccountEngine().client())
        model.show(AccountEngine.gate("event.gate.changed.locked.json"))
        model.values["passphrase"] = "nope"
        model.show(AccountEngine.gate("event.gate.changed.wrong-passphrase.json"))
        #expect(model.errorMessage == "That passphrase isn't right.")
        #expect(model.values["passphrase"] == "")
    }

    @Test func refusedPressShowsTheEngineMessage() async {
        let engine = AccountEngine()
        engine.fake.onCommand = { _, _ in throw EngineFailure.engine(EngineError(code: "wrong_secret", message: "That passphrase isn't right.")) }
        let log = FeedbackLog()
        let model = GateModel(client: engine.client(), feedback: log.feedback)
        model.show(AccountEngine.gate("event.gate.changed.wrong-passphrase.json"))
        model.values["passphrase"] = "still wrong"
        await model.act("passphrase")
        #expect(model.errorMessage == "That passphrase isn't right.")
        #expect(log.haptics.contains(.error))
        #expect(model.pending == nil)
    }

    @Test func followsGateEvents() async {
        let engine = AccountEngine()
        let client = engine.client()
        let model = GateModel(client: client)
        model.start()
        await eventually("ready") { client.state == .ready }
        engine.push(event: "gate.changed", Fixtures.json("event.gate.changed.mode-choice.json")["data"]!)
        await eventually("mode choice") { model.kind == .modeChoice }
        #expect(model.gate?.actions.map(\.id) == ["account", "local"])
        engine.push(event: "gate.changed", Fixtures.json("event.gate.changed.json")["data"]!)
        await eventually("no gate") { model.gate == nil }
        model.stop()
    }

    @Test func deviceLimitSignsOutADevice() async {
        let engine = AccountEngine()
        let model = GateModel(client: engine.client())
        model.show(AccountEngine.gate("event.gate.changed.device-limit.json"))
        #expect(model.gate?.deviceLimit?.devices.first?.label == "MacBook Air")
        await model.act("signOut:sess_a")
        #expect(engine.fake.commands(named: "gate.act").last?["action"]?.string == "signOut:sess_a")
    }

    @Test func setupConfirmsTheRecoveryKeyGroups() async {
        let engine = AccountEngine()
        let model = GateModel(client: engine.client())
        model.show(AccountEngine.gate("event.gate.changed.e2ee-setup.json"))
        #expect(model.gate?.e2ee?.recoveryKey == "K7QM-2RTX-9VBN-4HJW-PL3D-8SZC-6YFE-MA5G-UQ2N")
        #expect(model.gate?.e2ee?.setupStep == "recovery")
        let confirm = model.visibleActions.first { $0.id == "confirmRecovery" }!
        #expect(!model.isEnabled(confirm))
        model.values["group3"] = "9vbn"
        model.values["group7"] = "6yfe"
        #expect(model.isEnabled(confirm))
        await model.act("confirmRecovery")
        let v = engine.fake.commands(named: "gate.act").last?["values"]
        #expect(v?["group3"]?.string == "9VBN")
        #expect(v?["group7"]?.string == "6YFE")
    }

    @Test func approvalShowsTheSharedCode() {
        let model = GateModel(client: AccountEngine().client())
        model.show(AccountEngine.gate("event.gate.changed.approval.json"))
        #expect(model.gate?.e2ee?.approval == "compare")
        #expect(model.gate?.e2ee?.approvalCode == "482 913")
        #expect(model.visibleActions.map(\.id) == ["cancelApproval"])
        #expect(model.isEnabled(model.visibleActions[0]))
    }

    @Test func busyMoveCanStillBeStopped() {
        let model = GateModel(client: AccountEngine().client())
        model.show(AccountEngine.gate("event.gate.changed.migration-moving.json"))
        #expect(model.gate?.progress?.done == 120)
        #expect(model.isEnabled(model.visibleActions.first { $0.id == "stop" }!))
        var ready = AccountEngine.gate("event.gate.changed.migration.json")
        ready.busy = true
        model.show(ready)
        #expect(!model.isEnabled(model.visibleActions.first { $0.id == "move" }!), "nothing else while busy")
    }

    @Test func recoveryKeysAreNormalized() {
        #expect(GateModel.normalizedRecoveryKey(" k7qm2rtx 9vbn-4hjw ") == "K7QM-2RTX-9VBN-4HJW")
        #expect(GateModel.normalizedRecoveryKey("abc") == "ABC")
    }

    @Test func onboardingStepsMatchTheWeb() {
        #expect(OnboardingBlock.index("useCases") == 1)
        #expect(OnboardingBlock.index("uses") == 1)
        #expect(OnboardingBlock.index("welcome") == 5)
        #expect(OnboardingBlock.index("unknown") == 0)
    }
}

@Suite("Sign-in") @MainActor
struct SignInModelTests {
    @Test func appleUsesTheSystemSheetAndSignsIn() async {
        let auth = ScriptedAuthService()
        var signedIn = false
        let model = SignInModel(auth: auth, device: .iPhone)
        model.onSignedIn = { signedIn = true }
        await model.signIn(with: .apple)
        #expect(auth.calls == ["provider:apple"])
        #expect(signedIn)
        #expect(model.step == .choose, "no waiting screen for Apple's own sheet")
    }

    @Test func googleWaitsAndComesBackWhenCancelled() async {
        let auth = ScriptedAuthService()
        auth.holds = true
        auth.providerOutcome = .cancelled
        let model = SignInModel(auth: auth, device: .mac)
        let t = Task { await model.signIn(with: .google) }
        await eventually("waiting") { model.step == .waiting(.google) }
        #expect(model.lede.contains("Your browser is open on Google's page"))
        auth.release()
        await t.value
        #expect(model.step == .choose)
        #expect(!auth.calls.contains("cancel"), "a closed sheet needs no cancelling")
    }

    @Test func emailFormChecksAndGoesToTwoStep() async {
        let auth = ScriptedAuthService()
        auth.signInOutcome = .twoFactor
        let model = SignInModel(auth: auth)
        model.go(.email)
        await model.submitEmail()
        #expect(model.error == "Enter your email and password.")
        #expect(auth.calls.isEmpty)
        model.email = " me@example.com "
        model.password = "correct horse battery"
        await model.submitEmail()
        #expect(auth.calls == ["email:me@example.com"])
        #expect(model.step == .twoFactor)
        #expect(model.title == "Two-step verification")
    }

    @Test func twoStepCodeRules() async {
        let auth = ScriptedAuthService()
        let model = SignInModel(auth: auth, start: .twoFactor)
        model.setCode("12a34")
        #expect(model.code == "1234")
        await model.submitTwoFactor()
        #expect(model.error == "Enter all 6 digits.")
        model.setCode("1234567")
        #expect(model.code == "123456")
        model.trustDevice = true
        await model.submitTwoFactor()
        #expect(auth.calls == ["totp:123456:trust"])
        model.toggleBackup()
        #expect(model.lede.contains("backup codes"))
        model.backupCode = "abc"
        await model.submitTwoFactor()
        #expect(model.error == "Enter a backup code.")
    }

    @Test func unverifiedAddressAndWebFallback() async {
        let auth = ScriptedAuthService()
        auth.signInOutcome = .emailUnverified
        let model = SignInModel(auth: auth, start: .email)
        model.email = "me@example.com"
        model.password = "pw"
        await model.submitEmail()
        #expect(model.unverified)
        auth.signInOutcome = .useWebSignIn
        auth.providerOutcome = .signedIn
        await model.submitEmail()
        #expect(auth.calls.last == "web", "a host without native email sign-in opens the website's page")
    }

    @Test func failedSignInShowsTheMessage() async {
        let auth = ScriptedAuthService()
        auth.signInOutcome = .failed("Incorrect email or password.")
        let model = SignInModel(auth: auth, start: .email)
        model.email = "me@example.com"
        model.password = "wrong"
        await model.submitEmail()
        #expect(model.error == "Incorrect email or password.")
    }

    @Test func signUpValidatesLikeTheWeb() async {
        let auth = ScriptedAuthService()
        let model = SignInModel(auth: auth, start: .signUp)
        model.email = "nope"
        model.password = "short"
        await model.submitSignUp()
        #expect(model.fieldErrors["name"] == "Tell us what to call you.")
        #expect(model.fieldErrors["email"] == "Enter a valid email address.")
        #expect(model.fieldErrors["password"] == "Use at least 10 characters.")
        #expect(auth.calls.isEmpty)
        model.name = "Sam"
        model.email = "samwise@example.com"
        model.password = "samwise-is-here"
        await model.submitSignUp()
        #expect(model.fieldErrors["password"] == "Don't include your email address in your password.")
        model.password = "four unrelated words here"
        await model.submitSignUp()
        #expect(auth.calls == ["signUp:samwise@example.com"])
        #expect(model.step == .checkInbox("samwise@example.com"))
        #expect(model.lede.contains("We sent a confirmation link to samwise@example.com"))
        await model.resend()
        #expect(model.notice?.hasPrefix("If that address has an account") == true)
        auth.reply = .fieldError(field: "password", message: "That password has appeared in a data breach.")
        model.go(.signUp)
        model.password = "four unrelated words here"
        await model.submitSignUp()
        #expect(model.fieldErrors["password"] == "That password has appeared in a data breach.")
    }

    @Test func forgotPassword() async {
        let auth = ScriptedAuthService()
        let model = SignInModel(auth: auth, start: .email)
        model.go(.forgot)
        model.email = "me@example.com"
        await model.submitForgot()
        #expect(model.step == .forgotSent)
        #expect(model.forgotSentText.contains("me@example.com"))
        model.back()
        #expect(model.step == .forgot)
    }

    @Test func passwordRules() {
        #expect(SignInModel.passwordProblem("aaaaaaaaaaaa", email: "x@y.z") == "Avoid a single repeated character.")
        #expect(SignInModel.passwordProblem(String(repeating: "ab", count: 70), email: "x@y.z") == "Use at most 128 characters.")
        #expect(SignInModel.passwordProblem("a good long one", email: "x@y.z") == nil)
    }
}

@Suite("Settings") @MainActor
struct SettingsModelTests {
    func make(_ engine: AccountEngine, log: FeedbackLog = FeedbackLog(), version: String = "1.0.3", host: ((inout SettingsHost) -> Void)? = nil) -> SettingsModel {
        var h = SettingsHost(version: version)
        host?(&h)
        return SettingsModel(client: engine.client(), host: h, feedback: log.feedback, platform: .iOS)
    }

    @Test func sectionsForAnAccountAndALibrary() async {
        let engine = AccountEngine()
        let model = make(engine)
        await eventually("session") { model.session.value != nil }
        #expect(model.sections == [.account, .general, .appearance, .notifications, .ai, .security, .privacy, .connectedApps, .data, .aiExport, .help, .about])
        engine.fake.update(view: "session", Fixtures.value("view.session.local.json"))
        await eventually("local") { model.isLocal }
        #expect(model.sections == [.general, .appearance, .ai, .privacy, .data, .help, .about])
        // An admin looking at the workspace also gets its Data page.
        var ws = Fixtures.value("view.session.json")
        if case .object(var o) = ws { o["space"] = .string("ws_studio"); ws = .object(o) }
        engine.fake.update(view: "session", ws)
        await eventually("workspace") { model.managesWorkspace }
        #expect(model.sections.contains(.workspaceData))
    }

    @Test func planAndStorageWithoutBuying() async {
        let model = make(AccountEngine())
        await eventually("details") { model.details.value != nil }
        #expect(model.planName == "Pro")
        #expect(model.storageText == "1.1 GB of 9.3 GB used")
        #expect(model.devicesText == "3 devices")
        #expect(model.versionText == "Folevi 1.0.03")
        #expect(SettingsModel.displayVersion("1.0.03") == "1.0.03")
        #expect(SettingsModel.displayVersion("1.1.00") == "1.1.00")
        #expect(SettingsModel.bytes(750 * 1024 * 1024) == "750 MB")
        #expect(SettingsModel.bytes(1536 * 1024 * 1024) == "1.5 GB")
    }

    @Test func sectionsWatchWhenOpened() async {
        let engine = AccountEngine()
        let model = make(engine)
        #expect(model.account == nil)
        model.open(.account)
        model.open(.notifications)
        await eventually("account") { model.account?.value != nil && model.notifications?.value != nil }
        #expect(model.timeZone == "Asia/Dhaka")
        let comments = model.notifications!.value!.topics[0]
        #expect(model.topicSummary(comments) == "Email")
        await model.rename("  Faisal Islam ")
        #expect(engine.fake.commands(named: "settings.update").last?["name"]?.string == "Faisal Islam")
    }

    @Test func togglesAreOptimisticAndRollBack() async {
        let engine = AccountEngine()
        let log = FeedbackLog()
        let model = make(engine, log: log)
        model.open(.ai)
        await eventually("ai") { model.ai?.value != nil }
        #expect(!model.aiPref(.memory))
        await model.setAiPref(.memory, true)
        #expect(model.aiPref(.memory), "stays on while the view catches up")
        #expect(engine.fake.commands(named: "settings.setAiPref").last?["key"]?.string == "memory")
        engine.fake.onCommand = { _, _ in throw EngineFailure.engine(EngineError(code: "forbidden", message: "Foli AI isn't part of this plan.")) }
        await model.setAiPref(.digests, true)
        #expect(!model.aiPref(.digests), "rolled back")
        #expect(log.toasts.last?.message == "Foli AI isn't part of this plan.")
    }

    @Test func appearanceAndNotifications() async {
        let engine = AccountEngine()
        let model = make(engine)
        model.open(.appearance)
        model.open(.notifications)
        await eventually("values") { model.appearance?.value != nil && model.notifications?.value != nil }
        #expect(model.currentAppearance == .dark)
        await model.setAppearance(.light)
        #expect(engine.fake.commands(named: "settings.update").last?["appearance"]?.string == "light")
        #expect(model.currentAppearance == .light)
        let replies = model.notifications!.value!.topics[1]
        await model.setTopic(replies, email: true, on: false)
        let sent = engine.fake.commands(named: "settings.setNotificationTopic").last
        #expect(sent?["topic"]?.string == "replies")
        #expect(sent?["email"]?.bool == false)
        #expect(model.topicSummary(replies) == "In app")
        await model.setDailyDigest(false)
        #expect(engine.fake.commands(named: "settings.setNotificationEmails").last?["digest"]?.string == "off")
    }

    @Test func sessionsAndRevoking() async {
        let engine = AccountEngine()
        let log = FeedbackLog()
        let model = make(engine, log: log)
        model.open(.security)
        await eventually("security") { model.security?.value != nil }
        #expect(model.sessions.first?.current == true)
        let other = model.sessions[1]
        await model.revoke(other)
        #expect(engine.fake.commands(named: "session.revoke").last?["id"]?.string == "sess_2")
        #expect(log.toasts.last?.message == "Signed out of Safari on Mac.")
        await model.revoke(model.sessions[0])
        #expect(engine.fake.commands(named: "session.revoke").count == 1, "never this device's own session")
    }

    @Test func profilePictureLimits() async {
        let engine = AccountEngine()
        let log = FeedbackLog()
        let model = make(engine, log: log)
        await model.setAvatar(Data(count: 10), mimeType: "image/tiff")
        #expect(log.toasts.last?.message == "Choose a JPEG, PNG, WebP or GIF image.")
        await model.setAvatar(Data(count: SettingsModel.avatarMaxBytes + 1), mimeType: "image/png")
        #expect(log.toasts.last?.message == "Choose an image under 2 MB.")
        #expect(engine.fake.commands(named: "settings.setAvatar").isEmpty)
        await model.setAvatar(Data([1, 2, 3]), mimeType: "image/png")
        let sent = engine.fake.commands(named: "settings.setAvatar").last
        #expect(sent?["data"]?.string == "AQID")
        #expect(sent?["mimeType"]?.string == "image/png")
        await model.removeAvatar()
        #expect(engine.fake.commands(named: "settings.removeAvatar").count == 1)
    }

    @Test func technicalSectionsOpenWebPages() async {
        let engine = AccountEngine()
        let model = make(engine)
        model.showWeb(.connectedApps)
        await eventually("web.show") { !engine.editors.isEmpty }
        #expect(engine.editors.last?.name == "web.show")
        #expect(engine.editors.last?.args["page"]?.string == "settings.connectedApps")
        var shown: [WebPage] = []
        let hosted = make(engine) { $0.showWeb = { shown.append($0) } }
        hosted.showWeb(.aiExport)
        hosted.showWeb(.general)
        #expect(shown == [.settingsAiExport])
    }

    @Test func macWindowSectionsMap() {
        #expect(SettingsSection(macId: "desktop") == .general)
        #expect(SettingsSection(macId: "devices") == .security)
        #expect(SettingsSection(macId: "data") == .data)
        #expect(SettingsSection(macId: "nope") == nil)
    }

    @Test func appLockWords() async {
        let lock = ScriptedAppLock(method: "touchID")
        #expect(AppLockWords.toggleLabel(lock.method) == "Lock with Touch ID")
        #expect(AppLockWords.afterLabel(300) == "After 5 minutes")
        #expect(await lock.setEnabled(true))
        #expect(lock.enabled)
        let none = ScriptedAppLock(method: "none")
        #expect(await none.setEnabled(true) == false)
    }
}

@Suite("Sharing") @MainActor
struct SharingModelTests {
    @Test func peopleInvitesAndAccess() async {
        let engine = AccountEngine()
        engine.fake.onCommand = { name, _ in
            switch name {
            case "sharing.invite": return .object(["status": .string("invited")])
            default: return .object(["ok": .bool(true)])
            }
        }
        let log = FeedbackLog()
        let model = SharingModel(client: engine.client(), noteId: "doc_00002", title: "Q4 planning", feedback: log.feedback)
        await eventually("sharing") { model.value != nil }
        #expect(model.title == "Share \u{201C}Q4 planning\u{201D}")
        #expect(model.roles == [.editor, .commenter, .viewer])
        #expect(model.value?.people.count == 2)
        model.email = "kim"
        #expect(!model.canInvite)
        model.email = "kim@example.com"
        model.role = .viewer
        #expect(model.canInvite)
        await model.invite()
        let sent = engine.fake.commands(named: "sharing.invite").last
        #expect(sent?["email"]?.string == "kim@example.com")
        #expect(sent?["role"]?.string == "viewer")
        #expect(sent?["noteId"]?.string == "doc_00002")
        #expect(log.toasts.last?.message == "Invitation sent to kim@example.com. They get access once they sign up and accept.")
        #expect(model.email.isEmpty)
        let lee = model.value!.people[1]
        await model.remove(lee)
        #expect(engine.fake.commands(named: "sharing.revoke").last?["profileId"]?.string == "prof_9")
        await model.remove(model.value!.people[0])
        #expect(engine.fake.commands(named: "sharing.revoke").count == 1, "yourself can't be removed")
        await model.cancel(model.value!.invites[0])
        #expect(engine.fake.commands(named: "sharing.cancelInvite").last?["inviteId"]?.string == "pinv_2")
        await model.setAccess(.restricted)
        #expect(engine.fake.commands(named: "sharing.setAccessMode").last?["mode"]?.string == "restricted")
        await model.setAccess(.workspace)
        #expect(engine.fake.commands(named: "sharing.setAccessMode").count == 1, "already workspace")
    }

    @Test func publicLinks() async {
        let engine = AccountEngine()
        engine.fake.onCommand = { name, args in
            if name == "publicLink.create" {
                return .object(["id": .string("lnk_2"), "url": .string(args["plainCopy"]?.bool == true ? "https://app.folevi.com/s/Rt5yW8cK" : "https://app.folevi.com/s/q7Lm2Zx9#k=Vh3bS0eQ")])
            }
            return .object(["ok": .bool(true)])
        }
        let log = FeedbackLog()
        let model = SharingModel(client: engine.client(), noteId: "doc_00002", title: "Q4", feedback: log.feedback)
        await eventually("sharing") { model.value != nil }
        model.linkPassword = "abc"
        await model.createLink()
        #expect(log.toasts.last?.message == "Use a password of at least 5 characters.")
        model.linkPassword = ""
        model.linkTheme = .article
        model.linkExpiry = .week
        await model.createLink()
        let args = engine.fake.commands(named: "publicLink.create").last
        #expect(args?["theme"]?.string == "article")
        #expect(args?["expiresAt"]?.number != nil)
        #expect(args?["plainCopy"] == nil)
        #expect(model.freshLink?.hasPrefix("https://app.folevi.com/s/") == true)
        model.copyFreshLink()
        #expect(log.copied.last == model.freshLink)
        // An encrypted note: a readable copy after the question.
        var sealed = Fixtures.value("view.sharing.get.json")
        if case .object(var o) = sealed { o["encrypted"] = .bool(true); sealed = .object(o) }
        engine.fake.update(view: "sharing.get", sealed)
        await eventually("encrypted") { model.encrypted }
        await model.createLink(plainCopy: true)
        #expect(engine.fake.commands(named: "publicLink.create").last?["plainCopy"]?.bool == true)
        #expect(!model.freshLinkEncrypted)
        await model.createLink()
        #expect(model.freshLinkEncrypted)
        let link = model.activeLinks[0]
        await model.setTheme(link, .docs)
        #expect(engine.fake.commands(named: "publicLink.setTheme").last?["theme"]?.string == "docs")
        await model.revoke(link)
        #expect(engine.fake.commands(named: "publicLink.revoke").last?["linkId"]?.string == "lnk_1")
        #expect(SharingModel.expiryText(link) == "No expiry")
    }
}

@Suite("Quick Add") @MainActor
struct QuickAddModelTests {
    func make(_ engine: AccountEngine, mode: QuickAddModel.Mode = .task, log: FeedbackLog = FeedbackLog()) -> QuickAddModel {
        let m = QuickAddModel(client: engine.client(), mode: mode, queue: QuickAddQueue(url: nil), feedback: log.feedback)
        m.parseDelay = .milliseconds(1)
        return m
    }

    @Test func readsTheDateAndAddsTheTask() async {
        let engine = AccountEngine()
        engine.fake.onCommand = { _, _ in .object(["id": .string("blk_t9"), "noteId": .string("doc_inbox"), "where": .string("Inbox")]) }
        let model = make(engine)
        var saved: String?
        model.onSaved = { id, _ in saved = id }
        await eventually("session") { model.session.value != nil }
        model.text = "water the plants tomorrow 9am every monday"
        await eventually("parsed") { model.parsed != nil }
        #expect(model.parsedLine?.hasPrefix("Due Tomorrow") == true)
        #expect(model.parsedLine?.contains("\u{201C}tomorrow 9am\u{201D}") == true)
        #expect(model.repeatLine == "Repeats every monday")
        #expect(model.effectiveDueDate == "2026-10-25")
        #expect(model.destinationLabel == "Inbox")
        model.priority = .high
        await model.save()
        let sent = engine.fake.commands(named: "task.create").last
        #expect(sent?["text"]?.string == "water the plants tomorrow 9am every monday")
        #expect(sent?["priority"]?.string == "high")
        #expect(sent?["keepText"] == nil)
        #expect(saved == "blk_t9")
        #expect(model.confirmation == "Added to Inbox")
        #expect(model.text.isEmpty && model.priority == nil)
    }

    /// The Mac panel's tokens (web quickAddTokens.test.ts' cases): "!high" and "#page" leave the words.
    @Test func readsPriorityAndPageTokens() {
        let t = QuickAddTokens.read("Call Sam !high #Atlas tomorrow")
        #expect(t.rest == "Call Sam tomorrow")
        #expect(t.priority?.level == .high && t.priority?.text == "!high")
        #expect(t.page?.query == "Atlas" && t.page?.text == "#Atlas")
        #expect(QuickAddTokens.read("Fix it !!").priority?.level == .medium)
        #expect(QuickAddTokens.read("Fix it !!!").priority?.level == .high)
        #expect(QuickAddTokens.read("Fix it !").priority?.level == .low)
        #expect(QuickAddTokens.read("Fix it !med").priority?.level == .medium)
        #expect(QuickAddTokens.read("Read #\"Two words\" now").page?.query == "Two words")
        #expect(QuickAddTokens.read("Read #\"Two words\" now").rest == "Read now")
        // Not tokens: inside a word, a lone #, an exclamation in a sentence.
        #expect(QuickAddTokens.read("Wow!high").priority == nil)
        #expect(QuickAddTokens.read("Issue # 4").page == nil)
        #expect(QuickAddTokens.read("Hello!").rest == "Hello!")
        // Kept as text: stays in the words.
        let kept = QuickAddTokens.read("Call Sam !high", kept: ["!high"])
        #expect(kept.priority == nil && kept.rest == "Call Sam !high")
        #expect(QuickAddTokens.page(for: "kyoto", in: ["Rail passes", "Kyoto in November"], title: { $0 }) == "Kyoto in November")
        #expect(QuickAddTokens.page(for: "pass", in: ["Rail passes", "Passports"], title: { $0 }) == "Passports")
    }

    @Test func thePanelSendsTheWordsWithoutTokens() async {
        let engine = AccountEngine()
        engine.queries["search"] = Fixtures.value("view.search.json")
        engine.fake.onCommand = { _, _ in .object(["id": .string("blk_t9"), "noteId": .string("doc_00001"), "where": .string("Kyoto in November")]) }
        let model = make(engine)
        model.readsTokens = true
        model.text = "Book the ryokan !high #kyoto"
        #expect(model.taskText == "Book the ryokan")
        #expect(model.effectivePriority == .high)
        await eventually("page picked") { model.destination.noteId == "doc_00001" }
        #expect(model.destinationLabel == "Kyoto in November")
        await model.save(keepOpen: true)
        let sent = engine.fake.commands(named: "task.create").last
        #expect(sent?["text"]?.string == "Book the ryokan")
        #expect(sent?["priority"]?.string == "high")
        #expect(sent?["noteId"]?.string == "doc_00001")
        #expect(model.added == QuickAddModel.Added(label: "Kyoto in November", noteId: "doc_00001"))
        // A fresh field starts from the Inbox again.
        #expect(model.destination.noteId == nil && model.keptTokens.isEmpty)
        // A token kept as text goes with the words; a page picked by hand keeps "#..." as text.
        model.text = "Ask about trains !low"
        model.keep("!low")
        #expect(model.taskText == "Ask about trains !low" && model.effectivePriority == nil)
        model.text = "Pack #nowhere"
        await eventually("no page") { model.pageTokenMissing }
        model.pick(page: nil)
        #expect(model.taskText == "Pack #nowhere" && !model.pageTokenMissing)
    }

    @Test func theSheetKeepsTokensAsWords() async {
        let engine = AccountEngine()
        let model = make(engine)
        model.text = "Call Sam !high"
        #expect(model.taskText == "Call Sam !high")
        #expect(model.effectivePriority == nil)
    }

    @Test func keepingTheDateAsText() async {
        let engine = AccountEngine()
        engine.fake.onCommand = { _, _ in .object(["id": .string("blk_t9"), "noteId": .string("doc_inbox"), "where": .string("Inbox")]) }
        let model = make(engine)
        model.text = "water the plants tomorrow 9am"
        await eventually("parsed") { model.parsed != nil }
        model.keepDateAsText()
        #expect(model.parsedLine == nil)
        #expect(model.effectiveDueDate == nil)
        await model.save(keepOpen: true)
        #expect(engine.fake.commands(named: "task.create").last?["keepText"]?.bool == true)
    }

    @Test func notesGoToAFolderWithText() async {
        let engine = AccountEngine()
        engine.fake.onCommand = { _, _ in .object(["id": .string("doc_00130")]) }
        let model = make(engine, mode: .note)
        model.text = "Groceries\nMilk\nRice"
        #expect(model.destinationLabel == "Drafts")
        model.loadFolders()
        await eventually("tree") { !model.folders.isEmpty }
        let folder = model.folders[0]
        model.choose(folder: folder)
        #expect(model.destinationLabel == folder.name)
        await model.save()
        let sent = engine.fake.commands(named: "note.create").last
        #expect(sent?["text"]?.string == "Groceries\nMilk\nRice")
        #expect(sent?["folderId"]?.string == folder.id)
        #expect(engine.fake.commands(named: "task.create").isEmpty)
        #expect(engine.queried.allSatisfy { $0.name != "task.parse" }, "notes aren't read for dates")
    }

    @Test func waitsOnTheDeviceWhileNoEngineAnswers() async {
        let engine = AccountEngine()
        var down = true
        engine.fake.onCommand = { _, _ in
            if down { throw EngineFailure.notReady }
            return .object(["id": .string("blk_1"), "noteId": .string("doc_inbox"), "where": .string("Inbox")])
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("qa-\(UUID().uuidString)")
        let url = dir.appendingPathComponent("queue.json")
        let model = QuickAddModel(client: engine.client(), queue: QuickAddQueue(url: url))
        model.parseDelay = .milliseconds(1)
        model.text = "call Sam"
        await model.save()
        #expect(model.queue.count == 1)
        #expect(model.confirmation?.hasPrefix("Saved on this device") == true)
        #expect(QuickAddQueue(url: url).count == 1, "kept across launches")
        down = false
        await model.flushQueue()
        #expect(model.queue.count == 0)
        #expect(QuickAddQueue(url: url).count == 0)
        try? FileManager.default.removeItem(at: dir)
    }

    @Test func refusedItemsAreDroppedWithAMessage() async {
        let engine = AccountEngine()
        engine.fake.onCommand = { _, _ in throw EngineFailure.engine(EngineError(code: "forbidden", message: "You can't add to this page.")) }
        let log = FeedbackLog()
        let model = make(engine, log: log)
        model.text = "call Sam"
        await model.save()
        #expect(model.error == "You can't add to this page.")
        #expect(model.queue.count == 0)
        #expect(model.text == "call Sam", "kept for another try")
    }

    @Test func destinationsAcrossSpaces() async {
        let engine = AccountEngine()
        let model = make(engine)
        await eventually("session") { model.session.value != nil }
        #expect(model.spaces.map(\.name) == ["Personal", "Airly Studio"])
        model.choose(space: model.spaces[1])
        #expect(model.destinationLabel == "Airly Studio · Inbox")
        engine.queries["search"] = .object(["text": .string("plan"), "meaningAvailable": .bool(false), "hits": .array([.object(["id": .string("doc_7"), "title": .string("Q4 planning"), "icon": .null, "snippet": .string(""), "folder": .null, "updatedAt": .number(0), "archived": .bool(false), "kind": .string("note"), "space": .string("ws_studio"), "spaceName": .string("Airly Studio"), "matchIn": .string("title"), "blockId": .null])])])
        model.searchPages("plan")
        await eventually("hits") { !model.pageHits.isEmpty }
        #expect(engine.queried.last?.args["space"]?.string == "ws_studio")
        model.choose(page: model.pageHits[0])
        #expect(model.destinationLabel == "Airly Studio · Q4 planning")
        #expect(model.makeItem().noteId == "doc_7")
        #expect(QuickAddModel.dayLabel("2026-10-24", today: "2026-10-24") == "Today")
    }
}

@Suite("Invitations") @MainActor
struct InviteModelTests {
    @Test func previewAndAccept() async {
        let engine = AccountEngine()
        engine.queries["invite.preview"] = Fixtures.value("view.invite.preview.json")
        engine.fake.onCommand = { _, _ in .object(["noteId": .null, "space": .string("ws_studio")]) }
        let model = InviteModel(client: engine.client(), kind: .workspace, token: "tok_ws")
        var accepted: InviteTokenAcceptResult?
        model.onAccepted = { accepted = $0 }
        await model.load()
        #expect(model.title == "Join Airly Studio")
        #expect(model.message == "Sam invited you to join as a member.")
        #expect(model.canAccept)
        await model.accept()
        #expect(engine.fake.commands(named: "invite.acceptLink").last?["token"]?.string == "tok_ws")
        #expect(accepted?.space == "ws_studio")
    }

    @Test func invalidInvitation() async {
        let engine = AccountEngine()
        engine.queries["invite.preview"] = Fixtures.value("view.invite.preview.invalid.json")
        let model = InviteModel(client: engine.client(), kind: .page, token: "tok_old")
        await model.load()
        #expect(model.title == "This invitation is no longer valid")
        #expect(model.message.contains("already been used"))
        #expect(!model.canAccept)
    }
}

@Test func timeZoneChoicesKeepTheCurrentZone() {
    // The system's list leaves out "UTC": a person in UTC still finds their zone, first.
    #expect(!TimeZone.knownTimeZoneIdentifiers.contains("UTC") ? SettingsModel.zoneChoices("UTC").first == "UTC" : SettingsModel.zoneChoices("UTC").contains("UTC"))
    #expect(SettingsModel.zoneChoices("Asia/Dhaka") == TimeZone.knownTimeZoneIdentifiers)
}
