// Folevi for Android, native (docs/ANDROID_NATIVE_PLAN.md). One activity per window: Compose draws everything
// except the note page, which is the window's Page View (a WebView running the web engine and editor, with the
// host bridge the moved Kotlin services answer) laid over the note pane's spot. It also keeps the host duties
// the Capacitor app's MainActivity had (system screens with a result, links, sign-in returning from a Custom
// Tab, the lock (a FragmentActivity for BiometricPrompt), window events for the bridge script). Debug builds launched with `--ez demo true` use the demo
// engine (fixtures, no page).
package com.folevi.android

import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.fragment.app.FragmentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.ComposeView
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewCompat
import com.folevi.android.design.FoleviTheme
import com.folevi.android.engine.AppSession
import com.folevi.android.engine.DemoEngine
import com.folevi.android.engine.PageView
import com.folevi.android.ui.AppShell
import com.folevi.android.ui.GateScreen
import com.folevi.android.ui.LocalSession
import com.folevi.android.web.Links
import com.folevi.engine.client.EngineClient
import com.folevi.engine.generated.GateChangedEvent
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : FragmentActivity(), PageView.Host {
    private val app get() = FoleviApp.instance
    lateinit var session: AppSession
        private set
    private var ready = false
    private val queued = ArrayList<Pair<String, String>>()
    private var pageDark: Boolean? = null
    private var signInOpen = false
    /** The optional fingerprint or face lock (AppLock.kt). */
    val lock: com.folevi.android.lock.AppLock by lazy { com.folevi.android.lock.AppLock(this) }
    private var started = false
    private var widgetsAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        app.showForResult = { pi -> showForResult(pi) }
        current = java.lang.ref.WeakReference(this)
        val demo = BuildConfig.DEBUG && intent.getBooleanExtra("demo", false) && DemoEngine.available(this)
        session = AppSession(this, lifecycleScope, demo, host = this)

        val root = FrameLayout(this)
        val compose = ComposeView(this)
        root.addView(compose, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        session.page?.webView?.let { web ->
            web.visibility = View.INVISIBLE
            root.addView(web, FrameLayout.LayoutParams(1, 1))
        }
        setContentView(root)

        compose.setContent {
            CompositionLocalProvider(LocalSession provides session) {
                val gate by session.gate.collectAsState()
                val state by session.client.state.collectAsState()
                // Settings > Appearance (the engine's), once the app is up; the system's until then.
                val ready = state is EngineClient.State.Ready
                val chosen = if (ready && !session.isDemo) com.folevi.android.ui.rememberView(com.folevi.engine.generated.Views.settingsAppearance()).value.value?.appearance else null
                val dark = when (chosen) {
                    com.folevi.engine.generated.AppearanceSettings.Appearance.LIGHT -> false
                    com.folevi.engine.generated.AppearanceSettings.Appearance.DARK -> true
                    else -> androidx.compose.foundation.isSystemInDarkTheme()
                }
                FoleviTheme(dark = dark) {
                    LaunchedEffect(Unit) { snapshotFlow { session.noteSlot.value }.collect { placePage(it) } }
                    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding()) {
                        val g = gate
                        when {
                            g != null -> GateScreen(g)
                            state is EngineClient.State.Ready || session.isDemo -> AppShell()
                            else -> GateScreen(LOADING)
                        }
                    }
                }
            }
        }
        session.start()
        adoptLegacySession()
        handleIntent(intent)
    }

    /** Lays the Page View over the note pane (or hides it, still running, when no note is on screen). */
    private fun placePage(slot: Rect?) {
        val web = session.page?.webView ?: return
        if (slot == null || slot.width < 1f || slot.height < 1f) {
            web.visibility = View.INVISIBLE
            return
        }
        val lp = web.layoutParams as FrameLayout.LayoutParams
        val w = slot.width.roundToInt()
        val h = slot.height.roundToInt()
        if (lp.width != w || lp.height != h) {
            lp.width = w
            lp.height = h
            web.layoutParams = lp
        }
        web.translationX = slot.left
        web.translationY = slot.top
        web.visibility = View.VISIBLE
    }

    // ---------------------------------------------------------------- the page (PageView.Host)

    override fun bootValues(): JSONObject {
        val s = app.settings
        return JSONObject()
            .put("origin", PageView.APP_ORIGIN)
            .put("mode", s.mode)
            .put("version", BuildConfig.VERSION_NAME)
            .put("deviceName", s.deviceName)
            // A foldable is a phone, folded or not; a big screen without a hinge is a tablet.
            .put("deviceFamily", if (resources.configuration.smallestScreenWidthDp >= 600 && !packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_SENSOR_HINGE_ANGLE)) "tablet" else "phone")
            .put("webViewVersion", WebViewCompat.getCurrentWebViewPackage(this)?.versionName ?: "")
            // Native chrome: the native bars sit around the page, so it has no insets of its own.
            .put("insets", JSONObject().put("top", 0).put("right", 0).put("bottom", 0).put("left", 0).put("keyboard", 0))
            .put("places", JSONObject().put("current", app.places.state.current ?: JSONObject.NULL).put("background", false))
    }

    /** Several places: the session older builds kept moves to its account, then the page opens in it. */
    private fun adoptLegacySession() {
        if (app.auth.token(null) == null) return
        lifecycleScope.launch {
            val user = runCatching { app.auth.adoptLegacy() }.getOrNull() ?: return@launch
            val first = app.places.state.accounts.isEmpty()
            val added = app.places.addAccount(user.userId, user.name, user.email, user.avatarUrl) ?: return@launch
            if (first) app.adoptLegacyKeys(user.userId)
            if (app.places.state.current == null && app.settings.mode == "account") {
                app.places.setCurrent(added.id)
                reloadForMode()
            }
        }
    }

    /** Opens the page again (a new mode or place): the bridge script gets fresh boot values first. */
    fun reloadForMode(path: String = "/documents") {
        ready = false
        session.page?.load(path)
    }

    /** The bridge script is up and listening: window events that waited go now. */
    fun pageReady() {
        ready = true
        val waiting = ArrayList(queued)
        queued.clear()
        val bridge = session.page?.bridge ?: return
        for ((name, data) in waiting) bridge.triggerWindowJSEvent("folevi-android:$name", data)
    }

    /** A window event for the bridge script ("folevi-android:<name>"), held until the page is ready. */
    fun event(name: String, data: JSONObject) {
        val bridge = session.page?.bridge
        if (bridge == null || !ready) {
            if (name != "insets" && name != "back" && name != "keyboard") queued.add(name to data.toString())
            return
        }
        bridge.triggerWindowJSEvent("folevi-android:$name", data.toString())
    }

    /** The page's own back handling: native screens own the back gesture in native chrome mode. */
    fun setBackEnabled(@Suppress("UNUSED_PARAMETER") on: Boolean) = Unit

    fun leave() {
        moveTaskToBack(true)
    }

    fun setPageTheme(dark: Boolean) {
        pageDark = dark
    }

    private fun systemDark(): Boolean = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    // ---------------------------------------------------------------- system screens with a result

    private var resultWaiting: kotlinx.coroutines.CompletableDeferred<Intent?>? = null
    private val forResult = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.StartIntentSenderForResult()) { r ->
        val w = resultWaiting
        resultWaiting = null
        w?.complete(if (r.resultCode == RESULT_OK) r.data else null)
    }

    /** Google's consent screen (and others like it): its result's data, or null when the person backed out. */
    suspend fun showForResult(pi: android.app.PendingIntent): Intent? = showForResult(pi.intentSender)

    suspend fun showForResult(sender: android.content.IntentSender): Intent? {
        resultWaiting?.complete(null)
        val w = kotlinx.coroutines.CompletableDeferred<Intent?>()
        resultWaiting = w
        lock.openingOwnScreen()
        forResult.launch(androidx.activity.result.IntentSenderRequest.Builder(sender).build())
        return w.await()
    }

    private var photosWaiting: kotlinx.coroutines.CompletableDeferred<List<Uri>>? = null
    private val pickPhotos = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.PickMultipleVisualMedia(10)) { uris ->
        val w = photosWaiting
        photosWaiting = null
        w?.complete(uris)
    }

    /** Android's photo picker (no permission needed): up to ten images, or none when the person backed out. */
    suspend fun pickImages(): List<Uri> {
        photosWaiting?.complete(emptyList())
        val w = kotlinx.coroutines.CompletableDeferred<List<Uri>>()
        photosWaiting = w
        lock.openingOwnScreen()
        pickPhotos.launch(androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly))
        return w.await()
    }

    private var saveWaiting: kotlinx.coroutines.CompletableDeferred<Uri?>? = null
    private var saveMime = "application/octet-stream"
    private val createDocument = registerForActivityResult(object : androidx.activity.result.contract.ActivityResultContracts.CreateDocument("*/*") {
        override fun createIntent(context: android.content.Context, input: String): Intent = super.createIntent(context, input).setType(saveMime)
    }) { uri ->
        val w = saveWaiting
        saveWaiting = null
        w?.complete(uri)
    }

    /** Android's "Save to" screen for a file the page made (an export); false when the person backed out. */
    suspend fun saveDocument(name: String, mime: String, bytes: ByteArray): Boolean {
        saveWaiting?.complete(null)
        val w = kotlinx.coroutines.CompletableDeferred<Uri?>()
        saveWaiting = w
        saveMime = mime
        lock.openingOwnScreen()
        createDocument.launch(name)
        val uri = w.await() ?: return false
        return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes) } != null
        }
    }

    // ---------------------------------------------------------------- links

    private fun serviceOrigin(): String = Links.originOf(BuildConfig.SERVICE_URL)

    private fun tabColours(): CustomTabColorSchemeParams {
        val dark = pageDark ?: systemDark()
        val c = if (dark) CANVAS_DARK else CANVAS_LIGHT
        return CustomTabColorSchemeParams.Builder().setToolbarColor(c).setNavigationBarColor(c).build()
    }

    /** Another site in a Custom Tab over the app. */
    override fun openBrowser(uri: Uri) {
        lock.openingOwnScreen()
        runCatching {
            CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(tabColours())
                .setColorScheme(if (pageDark ?: systemDark()) CustomTabsIntent.COLOR_SCHEME_DARK else CustomTabsIntent.COLOR_SCHEME_LIGHT)
                .setShowTitle(true)
                .setShareState(CustomTabsIntent.SHARE_STATE_ON)
                .build()
                .launchUrl(this, uri)
        }.onFailure {
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        }
    }

    /** foleviNative.openExternal: web pages in a Custom Tab, mail and phone links to their apps. */
    fun openLink(url: String): Boolean = when (val t = Links.target(url, PageView.APP_ORIGIN, serviceOrigin())) {
        Links.Target.Browser, is Links.Target.App -> {
            openBrowser(Uri.parse(url))
            true
        }
        Links.Target.System -> runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }.isSuccess
        is Links.Target.DeepLink -> {
            deliverLink(t.url)
            true
        }
        Links.Target.Ignore -> false
    }

    /** The sign-in page in a Custom Tab; it comes back on the redirect (onNewIntent). */
    fun openSignIn(url: String) {
        signInOpen = true
        lock.openingOwnScreen()
        CustomTabsIntent.Builder()
            .setDefaultColorSchemeParams(tabColours())
            .setShowTitle(true)
            .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
            .setUrlBarHidingEnabled(false)
            .build()
            .launchUrl(this, Uri.parse(url))
    }

    /** A folevi:// link for the page (lib/deepLink.ts reads it). */
    override fun deliverLink(url: String) {
        event("command", JSONObject().put("command", JSONObject().put("type", "link").put("url", url)))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        var data = intent?.dataString ?: return
        if (intent.action != Intent.ACTION_VIEW) return
        // A notification from another place on this phone (several places): that place opens first, at the page.
        if (data.startsWith("folevi://")) {
            val uri = Uri.parse(data)
            val place = uri.getQueryParameter("place")
            if (place != null) {
                data = uri.buildUpon().clearQuery().apply { for (k in uri.queryParameterNames) if (k != "place") for (v in uri.getQueryParameters(k)) appendQueryParameter(k, v) }.build().toString()
            }
            if (place != null && app.places.has(place) && place != app.places.state.current) {
                app.places.setCurrent(place)
                if (uri.host == "quick-add" || uri.host == "new") {
                    reloadForMode("/documents")
                    deliverLink(data)
                    return
                }
                val path = "/" + (uri.host ?: "documents") + (uri.path ?: "")
                reloadForMode(path.takeIf { Regex("^/[A-Za-z0-9/_-]{0,200}$").matches(it) } ?: "/documents")
                return
            }
        }
        if (app.cloud.handleCallback(data)) {
            signInOpen = false
            return
        }
        if (app.auth.handleCallback(data)) {
            signInOpen = false
            return
        }
        // App Actions (shortcuts.xml): "new note", "quick add", "today" from Google Assistant or Gemini.
        if (data.startsWith("folevi://feature/")) {
            val feature = Uri.decode(data.removePrefix("folevi://feature/")).lowercase()
            deliverLink(
                when {
                    feature.contains("note") -> "folevi://new"
                    feature.contains("today") || feature.contains("my task") -> "folevi://tasks/today"
                    else -> "folevi://quick-add"
                },
            )
            return
        }
        Links.asDeepLink(data, serviceOrigin())?.let { deliverLink(it) }
    }

    override fun onStart() {
        super.onStart()
        lock.onStart(this, launch = !started)
        started = true
    }

    override fun onStop() {
        super.onStop()
        lock.onStop()
    }

    override fun onResume() {
        super.onResume()
        // The page takes what was shared meanwhile, and the widgets' copy is refreshed (at most every 5 minutes).
        event("app-active", JSONObject())
        val now = System.currentTimeMillis()
        if (now - widgetsAt > 5 * 60_000) {
            widgetsAt = now
            com.folevi.android.extras.Widgets.refreshSoon(this)
        }
        // Back from the sign-in tab without finishing (closed it): the sign-in ends.
        if (signInOpen) {
            signInOpen = false
            window.decorView.postDelayed({
                if (app.auth.pendingSignIn()) app.auth.cancelPending()
                app.cloud.cancel()
            }, 1500)
        }
    }

    override fun onDestroy() {
        if (current?.get() === this) current = null
        session.stop()
        super.onDestroy()
    }

    companion object {
        /** The open window, for a widget's word to the page (Widgets.kt CompleteTask). */
        @Volatile var current: java.lang.ref.WeakReference<MainActivity>? = null

        const val APP_ORIGIN = PageView.APP_ORIGIN
        const val CANVAS_LIGHT = 0xFFFAF6F3.toInt()
        const val CANVAS_DARK = 0xFF15110F.toInt()

        private val LOADING = GateChangedEvent(gate = "loading", title = "", message = "", busy = true, actions = emptyList(), fields = emptyList(), progress = null, migration = null, deviceLimit = null, e2ee = null, onboarding = null, error = null)
    }
}
