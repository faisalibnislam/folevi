package com.folevi.android.web

import android.content.Context
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * The bridge script (assets/folevi-bridge.js) with the values the page needs before its first render, injected
 * at document start into the app's own origin only. Installed again (with the new mode) before each reload
 * that follows a mode change.
 */
class BridgeScript(private val context: Context) {
    private var handle: ScriptHandler? = null
    private val source: String by lazy { context.assets.open("folevi-bridge.js").bufferedReader().use { it.readText() } }
    /** The bridge's TypeScript half (scripts/bundle-bridge.mjs): defines FoleviCloudKit, local to the wrapper below. */
    private val kit: String by lazy { context.assets.open("folevi-cloud.js").bufferedReader().use { it.readText() } }

    fun supported(): Boolean = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    fun install(webView: WebView, boot: JSONObject, origin: String) {
        handle?.remove()
        handle = null
        if (!supported()) return
        val script = "(function () {\n$kit\n;(${source.trimEnd().removeSuffix(";")})($boot, FoleviCloudKit);\n})();"
        handle = WebViewCompat.addDocumentStartJavaScript(webView, script, setOf(origin))
    }
}
