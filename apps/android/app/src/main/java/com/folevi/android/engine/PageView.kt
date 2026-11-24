// The window's Page View (docs/NATIVE_APP_PLAN.md section 3, docs/ANDROID_NATIVE_PLAN.md section 3): one WebView
// running the web export in native chrome mode. It is three things at once:
//
// - the engine the Compose screens talk to (WebViewTransport, `foleviEngineHost` / `foleviEngineReply`);
// - the note page they show (MainActivity lays it over the note pane);
// - the page the host services serve (the Bridge: `window.foleviShell` and `window.foleviNative` from
//   assets/folevi-bridge.js, answered by the Kotlin plugins moved from the Capacitor app).
//
// The export (apps/android/web, build-shell.mjs --platform android) is served from https://localhost, the origin
// the Capacitor app used, with the SPA fallback the Mac and iPhone apps use: a path without an extension is
// index.html and the client router takes it from there. Configuration changes are handled in place (the
// manifest), so the view lives as long as its activity.
package com.folevi.android.engine

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewAssetLoader
import com.folevi.android.BuildConfig
import com.folevi.android.FoleviApp
import com.folevi.android.bridge.Bridge
import com.folevi.android.web.BridgeScript
import com.folevi.android.web.FoleviWebViewClient
import com.folevi.android.web.Links
import com.folevi.engine.transport.WebViewTransport
import java.io.InputStream
import org.json.JSONObject

class PageView(private val activity: ComponentActivity, private val host: Host) {
    /** What the page needs from its window (MainActivity). */
    interface Host {
        fun openBrowser(uri: Uri)
        fun deliverLink(url: String)
        /** The values the bridge script needs before the page's first render (BridgeScript). */
        fun bootValues(): JSONObject
    }

    val webView: WebView = WebView(activity)
    val transport: WebViewTransport
    val bridge: Bridge
    private val script = BridgeScript(activity)
    private val origins = setOf(APP_ORIGIN)
    private var marker: ScriptHandler? = null

    /** The open place changed: the next load, even one the page starts itself, opens the new place. */
    private val placeChanged: () -> Unit = {
        if (Looper.myLooper() == Looper.getMainLooper()) installScript() else webView.post { installScript() }
    }

    init {
        configure()
        transport = WebViewTransport(webView, origins)
        bridge = Bridge(activity, webView, APP_ORIGIN)
        Plugins.registerAll(bridge)
        installScript()
        FoleviApp.instance.placeListeners.add(placeChanged)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configure() {
        webView.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        webView.setBackgroundColor(Color.TRANSPARENT)
        webView.overScrollMode = WebView.OVER_SCROLL_NEVER
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            // The text follows Android's font size, up to 150%.
            textZoom = (activity.resources.configuration.fontScale * 100).toInt().coerceIn(85, 150)
            setSupportMultipleWindows(false)
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val loader = WebViewAssetLoader.Builder()
            .setDomain("localhost")
            .addPathHandler("/", ExportHandler(activity))
            .build()
        val app = FoleviApp.instance
        webView.webViewClient = FoleviWebViewClient(
            appOrigin = APP_ORIGIN,
            serviceOrigin = Links.originOf(BuildConfig.SERVICE_URL),
            assets = { loader.shouldInterceptRequest(it) },
            openBrowser = { host.openBrowser(it) },
            deepLink = { host.deliverLink(it) },
            files = com.folevi.android.library.LibraryFiles {
                val lib = app.library
                when (lib.kind) {
                    "device" -> lib.deviceFs.root
                    "dropbox" -> lib.mirror("dropbox").root
                    "gdrive" -> lib.mirror("googleDrive").root
                    else -> null
                }
            },
            onStarted = { transport.pageWillReload() },
            onGone = {
                Log.w(TAG, "the page's renderer ended; reloading")
                transport.renderProcessGone()
                webView.post { load() }
            },
        )
    }

    /**
     * The scripts for the next load: the native chrome marker with the current place (signing in or switching
     * libraries changes it, and the engine opens the place the marker names), then the bridge script (with the
     * Capacitor stand-in before it) with fresh boot values.
     */
    fun installScript() {
        marker?.remove()
        marker = WebViewTransport.installMarker(webView, FoleviApp.instance.places.state.current, origins)
        script.install(webView, host.bootValues(), APP_ORIGIN, prelude = Bridge.STAND_IN)
    }

    fun load(path: String = "/documents") {
        installScript()
        webView.loadUrl("$APP_ORIGIN$path")
    }

    fun destroy() {
        FoleviApp.instance.placeListeners.remove(placeChanged)
        transport.detach()
        bridge.destroy()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
    }

    /** The export from assets/public with the SPA fallback. */
    private class ExportHandler(private val context: Context) : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            val clean = path.trimStart('/').substringBefore('?')
            val ext = clean.substringAfterLast('/', clean).substringAfterLast('.', "")
            val file = if (ext.isEmpty()) "index.html" else clean
            val stream = open("public/$file")
                ?: return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("x-content-type-options" to "nosniff"), null)
            val mime = mimeOf(file)
            return WebResourceResponse(mime, if (mime.startsWith("text/") || mime.endsWith("json")) "utf-8" else null, stream)
        }

        private fun open(path: String): InputStream? = try {
            context.assets.open(path)
        } catch (_: Exception) {
            null
        }

        private fun mimeOf(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
            "html" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json", "map" -> "application/json"
            "txt" -> "text/plain"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "ttf" -> "font/ttf"
            "wasm" -> "application/wasm"
            "webmanifest" -> "application/manifest+json"
            else -> "application/octet-stream"
        }
    }

    companion object {
        /** The page's origin: the Capacitor app's, so the bridge script, links and stored data line up. */
        const val APP_ORIGIN = "https://localhost"
        private const val TAG = "FoleviPage"
    }
}

/** The host services the page can call (the Capacitor app's MainActivity registered the same list). */
object Plugins {
    fun registerAll(bridge: Bridge) {
        listOf(
            com.folevi.android.web.ShellPlugin(),
            com.folevi.android.auth.AuthPlugin(),
            com.folevi.android.secure.SecretsPlugin(),
            com.folevi.android.extras.NativePlugin(),
            com.folevi.android.library.LibraryPlugin(),
            com.folevi.android.cloud.CloudPlugin(),
            com.folevi.android.ai.AiPlugin(),
            com.folevi.android.host.NotifyPlugin(),
            com.folevi.android.host.FilesPlugin(),
            com.folevi.android.host.HttpPlugin(),
            com.folevi.android.lock.LockPlugin(),
            com.folevi.android.e2ee.E2eePlugin(),
            com.folevi.android.web.PlacesPlugin(),
        ).forEach { bridge.register(it) }
        bridge.loadPlugins()
    }
}
