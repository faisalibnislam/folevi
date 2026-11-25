package com.folevi.android.web

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient

/** Serves what the app adds to its own origin (a local library's attachments at /_files/<sha256>). */
fun interface LocalFiles {
    fun serve(request: WebResourceRequest): WebResourceResponse?
}

/**
 * The Page View's client: the built-in interface from the app's own origin ([assets]), Folevi's link rules
 * ([Links]: the app's own pages stay in the web view, other sites open in a Custom Tab, mail and phone links go
 * to their apps, folevi:// links go to the page, everything else never loads), and the page's lifecycle for the
 * engine transport.
 *
 * Each HTML page of the app also gets the open place's Content-Security-Policy header ([pagePolicy],
 * ShellServer.Policy): a Folevi Server place's pages reach that server only; it narrows the export's meta policy.
 */
class FoleviWebViewClient(
    private val appOrigin: String,
    private val serviceOrigin: String,
    private val assets: (Uri) -> WebResourceResponse?,
    private val openBrowser: (Uri) -> Unit,
    private val deepLink: (String) -> Unit,
    private val files: LocalFiles?,
    private val onStarted: () -> Unit,
    private val onGone: () -> Unit,
    /** The policy header for the app's HTML pages, or null for none. */
    private val pagePolicy: () -> String? = { null },
) : WebViewClient() {

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (Links.originOf(url) != appOrigin) return null
        if (files != null && url.encodedPath?.startsWith("/_files/") == true) {
            return files.serve(request) ?: WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("x-content-type-options" to "nosniff"), null)
        }
        val res = assets(url) ?: return null
        if (res.mimeType?.startsWith("text/html") == true) {
            pagePolicy()?.let { policy ->
                res.responseHeaders = HashMap(res.responseHeaders ?: emptyMap()).apply { put("Content-Security-Policy", policy) }
            }
        }
        return res
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        // Embeds (a video in a note) load in their own frame.
        if (!request.isForMainFrame) return false
        return route(view, request.url.toString())
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        onStarted()
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        onGone()
        return true
    }

    private fun route(view: WebView, url: String): Boolean = when (val t = Links.target(url, appOrigin, serviceOrigin)) {
        is Links.Target.App -> {
            if (url.startsWith(appOrigin)) false
            else {
                view.loadUrl(appOrigin + t.path)
                true
            }
        }
        Links.Target.Browser -> {
            openBrowser(Uri.parse(url))
            true
        }
        Links.Target.System -> {
            try {
                view.context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: ActivityNotFoundException) {
                // No app for it on this phone: nothing happens, as in a browser.
            }
            true
        }
        is Links.Target.DeepLink -> {
            deepLink(t.url)
            true
        }
        Links.Target.Ignore -> true
    }
}
