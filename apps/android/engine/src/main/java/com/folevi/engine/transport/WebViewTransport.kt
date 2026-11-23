// The transport over an Android WebView (the Android twin of FoleviEngine's WebViewTransport.swift):
//
// - JavaScript to native: the engine posts each batch, a JSON string, to `window.foleviEngineHost.postMessage`
//   (host.ts `defaultPost` falls back to it when there is no WebKit handler). `foleviEngineHost` is a
//   WebMessageListener object (androidx.webkit), which only the allowed origins' frames get.
// - Native to JavaScript: Android's evaluateJavascript can't wait for a promise, so each call runs
//   `__foleviEngine.handle(m)` and the page posts the reply back to `window.foleviEngineReply`, prefixed with the
//   call's token and a newline. An empty answer means no engine yet (`engine_not_ready`), `!` an exception.
// - Only the main frame of an allowed origin is listened to, and the host tells the transport when the page
//   reloads or its renderer ends so the client can resubscribe.
package com.folevi.engine.transport

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.folevi.engine.generated.EngineContract
import com.folevi.engine.protocol.EngineFailure
import com.folevi.engine.protocol.jsonString
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class WebViewTransport(
    private val webView: WebView,
    /** Origin rules for WebViewCompat (`https://appassets.androidplatform.net`, a dev server in debug builds). */
    private val allowedOrigins: Set<String>,
) : EngineTransport {
    override var onBatch: ((String) -> Unit)? = null
    override var onLifecycle: ((PageLifecycle) -> Unit)? = null

    private val pending = HashMap<String, CompletableDeferred<String>>()
    private var nextToken = 0

    init {
        check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { "This WebView is too old for Folevi (no WebMessageListener)." }
        WebViewCompat.addWebMessageListener(webView, BATCH_OBJECT, allowedOrigins) { _: WebView, message: WebMessageCompat, _: Uri, isMainFrame: Boolean, _: JavaScriptReplyProxy ->
            if (!isMainFrame) return@addWebMessageListener
            message.data?.let { onBatch?.invoke(it) }
        }
        WebViewCompat.addWebMessageListener(webView, REPLY_OBJECT, allowedOrigins) { _: WebView, message: WebMessageCompat, _: Uri, isMainFrame: Boolean, _: JavaScriptReplyProxy ->
            if (!isMainFrame) return@addWebMessageListener
            receiveReply(message.data ?: return@addWebMessageListener)
        }
    }

    /** Removes the listeners (the view is going away). Calls still waiting end with [EngineFailure.PageGone]. */
    fun detach() {
        WebViewCompat.removeWebMessageListener(webView, BATCH_OBJECT)
        WebViewCompat.removeWebMessageListener(webView, REPLY_OBJECT)
        failPending(EngineFailure.PageGone)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override suspend fun call(message: String): String {
        val token = "t${++nextToken}"
        val deferred = CompletableDeferred<String>()
        pending[token] = deferred
        val script = """
            (function(){var t=${jsonString(token)};var R=window.$REPLY_OBJECT;if(!R)return;
            var E=window.${EngineContract.ENGINE_GLOBAL};if(!E){R.postMessage(t+"\n");return;}
            Promise.resolve().then(function(){return E.handle(${jsonString(message)});})
            .then(function(r){R.postMessage(t+"\n"+(r==null?"":r));},function(e){R.postMessage(t+"\n!"+String(e&&e.message||e));});})();
        """.trimIndent()
        webView.evaluateJavascript(script, null)
        try {
            val answer = deferred.await()
            return when {
                answer.isEmpty() -> throw EngineFailure.NotReady
                answer.startsWith("!") -> throw EngineFailure.Transport(answer.substring(1))
                else -> answer
            }
        } finally {
            pending.remove(token)
        }
    }

    private fun receiveReply(data: String) {
        val nl = data.indexOf('\n')
        if (nl < 0) return
        pending.remove(data.substring(0, nl))?.complete(data.substring(nl + 1))
    }

    /** The host calls this when the main frame starts loading again. */
    fun pageWillReload() {
        failPending(EngineFailure.PageGone)
        onLifecycle?.invoke(PageLifecycle.RELOADING)
    }

    /** The host calls this from `WebViewClient.onRenderProcessGone`. */
    fun renderProcessGone() {
        failPending(EngineFailure.PageGone)
        onLifecycle?.invoke(PageLifecycle.TERMINATED)
    }

    private fun failPending(e: Throwable) {
        val all = pending.values.toList()
        pending.clear()
        all.forEach { it.completeExceptionally(e) }
    }

    companion object {
        /** The object the engine posts batches to (host.ts `foleviEngineHost`). */
        const val BATCH_OBJECT = "foleviEngineHost"
        /** The object replies come back on. */
        const val REPLY_OBJECT = "foleviEngineReply"

        /**
         * The script the host runs at document start to turn native chrome mode on (protocol.ts
         * `NativeChromeMarker`, platform "android"). Add it with [installMarker] before the first load.
         */
        fun markerScript(place: String?): String {
            val marker = buildJsonObject {
                put("platform", "android")
                put("protocol", EngineContract.PROTOCOL_VERSION)
                put("place", place)
            }
            return "document.documentElement.setAttribute('data-native-chrome','');window.${EngineContract.MARKER_GLOBAL}=$marker;"
        }

        /** Adds the marker as a document-start script for the allowed origins. */
        fun installMarker(webView: WebView, place: String?, allowedOrigins: Set<String>) {
            check(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) { "This WebView is too old for Folevi (no document-start scripts)." }
            WebViewCompat.addDocumentStartJavaScript(webView, markerScript(place), allowedOrigins)
        }
    }
}
