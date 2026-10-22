package com.folevi.android

import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import com.folevi.android.auth.AuthPlugin
import com.folevi.android.secure.SecretsPlugin
import com.folevi.android.web.BridgeScript
import com.folevi.android.web.FoleviWebViewClient
import com.folevi.android.web.Links
import com.folevi.android.web.ShellPlugin
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeActivity
import org.json.JSONObject
import kotlinx.coroutines.launch

/**
 * The one activity: Capacitor's web view showing the built-in interface (https://localhost), drawn edge to edge,
 * with Android's back gesture (and predictive back) handed to the page, the keyboard's height, the system bars'
 * colours following the page's theme, sign-in returning from a Custom Tab, and links into the app.
 */
class MainActivity : BridgeActivity() {
    private val app get() = FoleviApp.instance
    private lateinit var script: BridgeScript
    private var attached: Bridge? = null
    private var ready = false
    private val queued = ArrayList<Pair<String, String>>()
    private var lastInsets: JSONObject = JSONObject().put("top", 0).put("right", 0).put("bottom", 0).put("left", 0).put("keyboard", 0)
    private var pageDark: Boolean? = null
    private var signInOpen = false
    /** The optional fingerprint or face lock (AppLock.kt). */
    val lock: com.folevi.android.lock.AppLock by lazy { com.folevi.android.lock.AppLock(this) }
    private var started = false
    private var widgetsAt = 0L

    private val back = object : OnBackPressedCallback(false) {
        override fun handleOnBackStarted(backEvent: BackEventCompat) = sendBack("progress", backEvent)
        override fun handleOnBackProgressed(backEvent: BackEventCompat) = sendBack("progress", backEvent)
        override fun handleOnBackCancelled() = event("back", JSONObject().put("phase", "cancel"))
        override fun handleOnBackPressed() = event("back", JSONObject().put("phase", "commit"))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        script = BridgeScript(this)
        registerPlugin(ShellPlugin::class.java)
        registerPlugin(AuthPlugin::class.java)
        registerPlugin(SecretsPlugin::class.java)
        registerPlugin(com.folevi.android.extras.NativePlugin::class.java)
        registerPlugin(com.folevi.android.library.LibraryPlugin::class.java)
        registerPlugin(com.folevi.android.cloud.CloudPlugin::class.java)
        registerPlugin(com.folevi.android.ai.AiPlugin::class.java)
        registerPlugin(com.folevi.android.host.NotifyPlugin::class.java)
        registerPlugin(com.folevi.android.host.FilesPlugin::class.java)
        registerPlugin(com.folevi.android.host.HttpPlugin::class.java)
        registerPlugin(com.folevi.android.lock.LockPlugin::class.java)
        registerPlugin(com.folevi.android.e2ee.E2eePlugin::class.java)
        registerPlugin(com.folevi.android.web.PlacesPlugin::class.java)
        applyBars(systemDark())
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, back)
        app.showForResult = { pi -> showForResult(pi) }
        current = java.lang.ref.WeakReference(this)
        bridge?.webView?.let { setUpWebView(it) }
        adoptLegacySession()
    }

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

    // ---------------------------------------------------------------- the page

    /** Called by ShellPlugin.load(), before Capacitor loads the page. */
    fun attachBridge(b: Bridge) {
        if (attached === b) return
        attached = b
        val wv = b.webView
        installScript(wv)
        b.setWebViewClient(
            FoleviWebViewClient(
                bridge = b,
                appOrigin = APP_ORIGIN,
                serviceOrigin = serviceOrigin(),
                openBrowser = { openBrowser(it) },
                deepLink = { deliverLink(it) },
                files = com.folevi.android.library.LibraryFiles {
                    val lib = app.library
                    when (lib.kind) {
                        "device" -> lib.deviceFs.root
                        "dropbox" -> lib.mirror("dropbox").root
                        "gdrive" -> lib.mirror("googleDrive").root
                        else -> null
                    }
                },
            ),
        )
    }

    private fun installScript(wv: WebView) {
        val s = app.settings
        val boot = JSONObject()
            .put("origin", APP_ORIGIN)
            .put("mode", s.mode)
            .put("version", BuildConfig.VERSION_NAME)
            .put("deviceName", s.deviceName)
            // A foldable is a phone, folded or not; a big screen without a hinge is a tablet.
            .put("deviceFamily", if (resources.configuration.smallestScreenWidthDp >= 600 && !packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_SENSOR_HINGE_ANGLE)) "tablet" else "phone")
            .put("webViewVersion", WebViewCompat.getCurrentWebViewPackage(this)?.versionName ?: "")
            .put("insets", lastInsets)
            // Several places (Places.kt): the page is the open place's.
            .put("places", JSONObject().put("current", app.places.state.current ?: JSONObject.NULL).put("background", false))
        script.install(wv, boot, APP_ORIGIN)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView(wv: WebView) {
        wv.overScrollMode = WebView.OVER_SCROLL_NEVER
        wv.isVerticalScrollBarEnabled = false
        wv.isHorizontalScrollBarEnabled = false
        wv.settings.apply {
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            // The text follows Android's font size, up to 150% (past that the screens don't have the room).
            textZoom = (resources.configuration.fontScale * 100).toInt().coerceIn(85, 150)
            allowFileAccess = false
            allowContentAccess = false
        }
        wv.setBackgroundColor(if (pageDark ?: systemDark()) CANVAS_DARK else CANVAS_LIGHT)

        // Edge to edge: the page lays itself out under the bars with the insets; the keyboard shrinks the web
        // view so what's being typed stays above it.
        val parent = wv.parent as? ViewGroup
        ViewCompat.setOnApplyWindowInsetsListener(wv) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val keyboard = (ime.bottom - bars.bottom).coerceAtLeast(0)
            val lp = v.layoutParams as ViewGroup.MarginLayoutParams
            val bottomMargin = if (ime.bottom > 0) ime.bottom else 0
            if (lp.bottomMargin != bottomMargin) {
                lp.bottomMargin = bottomMargin
                v.layoutParams = lp
            }
            val d = resources.displayMetrics.density
            val json = JSONObject()
                .put("top", (bars.top / d).toInt())
                .put("right", (bars.right / d).toInt())
                .put("bottom", if (ime.bottom > 0) 0 else (bars.bottom / d).toInt())
                .put("left", (bars.left / d).toInt())
                .put("keyboard", (keyboard / d).toInt())
            if (json.toString() != lastInsets.toString()) {
                lastInsets = json
                event("insets", JSONObject().put("insets", json))
            }
            // With the keyboard up, the web view no longer reaches the gesture bar.
            if (ime.bottom > 0) {
                WindowInsetsCompat.Builder(insets)
                    .setInsets(WindowInsetsCompat.Type.navigationBars(), androidx.core.graphics.Insets.of(bars.left, 0, bars.right, 0))
                    .setInsets(WindowInsetsCompat.Type.ime(), androidx.core.graphics.Insets.NONE)
                    .build()
            } else insets
        }
        ViewCompat.setWindowInsetsAnimationCallback(
            wv,
            object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                private var showing = false

                override fun onStart(animation: WindowInsetsAnimationCompat, bounds: WindowInsetsAnimationCompat.BoundsCompat): WindowInsetsAnimationCompat.BoundsCompat {
                    if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) {
                        val visible = ViewCompat.getRootWindowInsets(wv)?.isVisible(WindowInsetsCompat.Type.ime()) == true
                        showing = visible
                        val h = (bounds.upperBound.bottom / resources.displayMetrics.density).toInt()
                        event("keyboard", JSONObject().put("visible", visible).put("phase", "start").put("height", if (visible) h else 0))
                    }
                    return bounds
                }

                override fun onProgress(insets: WindowInsetsCompat, running: MutableList<WindowInsetsAnimationCompat>): WindowInsetsCompat = insets

                override fun onEnd(animation: WindowInsetsAnimationCompat) {
                    if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) {
                        val h = ViewCompat.getRootWindowInsets(wv)?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0
                        event("keyboard", JSONObject().put("visible", showing).put("phase", "end").put("height", (h / resources.displayMetrics.density).toInt()))
                    }
                }
            },
        )
        parent?.let { ViewCompat.requestApplyInsets(it) }
    }

    /**
     * Several places: the one session older builds kept moves to its account (a first launch of this version, once the
     * server says whose it is); the page then opens again in that account.
     */
    private fun adoptLegacySession() {
        if (app.auth.token(null) == null) return
        kotlinx.coroutines.MainScope().launch {
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

    fun reloadForMode(path: String = "/documents") {
        val wv = bridge?.webView ?: return
        ready = false
        installScript(wv)
        wv.loadUrl("$APP_ORIGIN$path")
    }

    /** The bridge script is up and listening: commands that waited (a link that opened the app) go now. */
    fun pageReady() {
        ready = true
        val waiting = ArrayList(queued)
        queued.clear()
        for ((name, data) in waiting) bridge?.triggerWindowJSEvent("folevi-android:$name", data)
        event("insets", JSONObject().put("insets", lastInsets))
    }

    /** A window event for the bridge script ("folevi-android:<name>"), held until the page is ready. */
    fun event(name: String, data: JSONObject) {
        val b = bridge
        if (b == null || !ready) {
            if (name != "insets" && name != "back" && name != "keyboard") queued.add(name to data.toString())
            return
        }
        runOnUiThread { b.triggerWindowJSEvent("folevi-android:$name", data.toString()) }
    }

    // ---------------------------------------------------------------- back

    private fun sendBack(phase: String, e: BackEventCompat) {
        event("back", JSONObject().put("phase", phase).put("progress", e.progress.toDouble()).put("edge", if (e.swipeEdge == BackEventCompat.EDGE_RIGHT) "right" else "left"))
    }

    /** The page says whether it has something to close or go back to (else the system takes the app home). */
    fun setBackEnabled(on: Boolean) {
        back.isEnabled = on
    }

    /** The page had nothing to do with a back press after all: leave as Android does at an app's root. */
    fun leave() {
        back.isEnabled = false
        moveTaskToBack(true)
    }

    // ---------------------------------------------------------------- the system bars

    private fun systemDark(): Boolean = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    fun setPageTheme(dark: Boolean) {
        if (pageDark == dark) return
        pageDark = dark
        applyBars(dark)
        bridge?.webView?.setBackgroundColor(if (dark) CANVAS_DARK else CANVAS_LIGHT)
    }

    private fun applyBars(dark: Boolean) {
        val bar = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = bar, navigationBarStyle = bar)
        window.isNavigationBarContrastEnforced = false
        window.decorView.setBackgroundColor(if (dark) CANVAS_DARK else CANVAS_LIGHT)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (pageDark == null) applyBars(systemDark())
    }

    // ---------------------------------------------------------------- links

    private fun serviceOrigin(): String = Links.originOf(BuildConfig.SERVICE_URL)

    private fun tabColours(): CustomTabColorSchemeParams {
        val dark = pageDark ?: systemDark()
        return CustomTabColorSchemeParams.Builder().setToolbarColor(if (dark) CANVAS_DARK else CANVAS_LIGHT).setNavigationBarColor(if (dark) CANVAS_DARK else CANVAS_LIGHT).build()
    }

    /** Another site in a Custom Tab over the app. */
    fun openBrowser(uri: Uri) {
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
    fun openLink(url: String): Boolean = when (val t = Links.target(url, APP_ORIGIN, serviceOrigin())) {
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
    fun deliverLink(url: String) {
        event("command", JSONObject().put("command", JSONObject().put("type", "link").put("url", url)))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val data = intent?.dataString ?: return
        if (intent.action != Intent.ACTION_VIEW) return
        // A notification from another place on this phone (several places): that place opens first, at the page.
        if (data.startsWith("folevi://")) {
            val uri = Uri.parse(data)
            val place = uri.getQueryParameter("place")
            if (place != null && app.places.has(place) && place != app.places.state.current) {
                app.places.setCurrent(place)
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
            bridge?.webView?.postDelayed({
                if (app.auth.pendingSignIn()) app.auth.cancelPending()
                app.cloud.cancel()
            }, 1500)
        }
    }

    override fun onDestroy() {
        if (current?.get() === this) current = null
        super.onDestroy()
    }

    companion object {
        /** The open app, for a widget's word to the page (Widgets.kt CompleteTask). */
        @Volatile var current: java.lang.ref.WeakReference<MainActivity>? = null

        const val APP_ORIGIN = "https://localhost"
        const val CANVAS_LIGHT = 0xFFFFFFFF.toInt()
        const val CANVAS_DARK = 0xFF101011.toInt()
    }
}
