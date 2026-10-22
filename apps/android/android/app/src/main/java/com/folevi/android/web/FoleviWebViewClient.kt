package com.folevi.android.web

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeWebViewClient

/** Serves what the app adds to its own origin (a local library's attachments at /_files/<sha256>). */
fun interface LocalFiles {
    fun serve(request: WebResourceRequest): WebResourceResponse?
}

/**
 * Capacitor's web view client with Folevi's link rules ([Links]): the app's own pages stay in the web view,
 * other sites open in a Custom Tab, mail and phone links go to their apps, folevi:// links go to the page,
 * and everything else (javascript:, file:, intent:, other apps' schemes) never loads.
 */
class FoleviWebViewClient(
    private val bridge: Bridge,
    private val appOrigin: String,
    private val serviceOrigin: String,
    private val openBrowser: (Uri) -> Unit,
    private val deepLink: (String) -> Unit,
    private val files: LocalFiles?,
) : BridgeWebViewClient(bridge) {

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (files != null && Links.originOf(url) == appOrigin && url.encodedPath?.startsWith("/_files/") == true) {
            return files.serve(request) ?: WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("x-content-type-options" to "nosniff"), null)
        }
        return super.shouldInterceptRequest(view, request)
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        // Embeds (a video in a note) load in their own frame.
        if (!request.isForMainFrame) return false
        return route(view, request.url.toString())
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
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
