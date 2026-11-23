// The window's Page View (docs/NATIVE_APP_PLAN.md section 3, docs/ANDROID_NATIVE_PLAN.md section 3): one WebView
// running the web export in native chrome mode. It is the engine the Compose screens talk to (through
// WebViewTransport) and the note page they show. Configuration changes are handled in place (the manifest), so
// the view lives as long as its activity.
//
// The export (apps/android/web, build-shell.mjs --platform android) is served from the app's own https origin by
// WebViewAssetLoader, with the SPA fallback the Mac and iPhone apps use: a path without an extension is
// index.html and the client router takes it from there. Debug builds can load a dev server instead
// (BuildConfig.PAGE_URL). Links to other sites never load in the view.
package com.folevi.android.engine

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.util.Log
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import com.folevi.android.BuildConfig
import com.folevi.engine.transport.WebViewTransport
import java.io.InputStream

class PageView(context: Context, place: String?) {
    /** The origin the page runs on (the export's, or a dev server's). */
    val origin: String
    private val startUrl: String
    val webView: WebView = WebView(context)
    val transport: WebViewTransport

    init {
        val devUrl = BuildConfig.PAGE_URL.takeIf { it.isNotBlank() }
        startUrl = devUrl?.let { Uri.parse(it).buildUpon().path("/documents").build().toString() } ?: "https://$ASSET_HOST/documents"
        origin = devUrl?.let { Uri.parse(it).let { u -> "${u.scheme}://${u.authority}" } } ?: "https://$ASSET_HOST"
        configure(context)
        val origins = setOf(origin)
        WebViewTransport.installMarker(webView, place, origins)
        transport = WebViewTransport(webView, origins)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configure(context: Context) {
        webView.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        webView.setBackgroundColor(Color.TRANSPARENT)
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(false)
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val loader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .addPathHandler("/", ExportHandler(context))
            .build()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val url = request.url
                if ("${url.scheme}://${url.authority}" == origin) return false
                // Other sites open in the browser, never in the Page View.
                if (url.scheme == "https" || url.scheme == "http" || url.scheme == "mailto") {
                    runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                }
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                transport.pageWillReload()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.w(TAG, "the page's renderer ended (crash: ${detail.didCrash()}); reloading")
                transport.renderProcessGone()
                view.post { load() }
                return true
            }
        }
    }

    fun load() = webView.loadUrl(startUrl)

    fun destroy() {
        transport.detach()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
    }

    /** The export from assets/public with the SPA fallback. */
    private class ExportHandler(private val context: Context) : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            val clean = path.trimStart('/').substringBefore('?')
            val ext = clean.substringAfterLast('/', clean).substringAfterLast('.', "")
            val candidates = if (ext.isEmpty()) listOf("index.html") else listOf(clean)
            for (c in candidates) {
                val stream = open("public/$c") ?: continue
                return WebResourceResponse(mimeOf(c), if (mimeOf(c).startsWith("text/") || c.endsWith(".js")) "utf-8" else null, stream)
            }
            return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("x-content-type-options" to "nosniff"), null)
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
        const val ASSET_HOST = "appassets.androidplatform.net"
        private const val TAG = "FoleviPage"
    }
}
