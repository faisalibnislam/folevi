// The host bridge without Capacitor. The page's `window.Capacitor` is a small stand-in (STAND_IN below, injected
// at document start before assets/folevi-bridge.js) that posts each call to the `foleviHostBridge`
// WebMessageListener, for the app's own origin only. Plugin methods run on a background thread, as Capacitor
// ran them; answers go back through the frame's JavaScriptReplyProxy. Window events for the bridge script
// (`folevi-android:<name>`) go through `triggerWindowJSEvent`.
package com.folevi.android.bridge

import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

class Bridge(val activity: ComponentActivity, val webView: WebView, private val origin: String) {
    private val plugins = LinkedHashMap<String, Plugin>()
    private val saved = ConcurrentHashMap<String, PluginCall>()
    private val main = Handler(Looper.getMainLooper())
    private val worker = HandlerThread("FoleviHostPlugins").apply { start() }
    private val background = Handler(worker.looper)
    @Volatile private var reply: JavaScriptReplyProxy? = null

    private var permissionDone: ((Map<String, Boolean>) -> Unit)? = null
    private val permissionLauncher = activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        val done = permissionDone
        permissionDone = null
        done?.invoke(r)
    }

    init {
        WebViewCompat.addWebMessageListener(webView, OBJECT, setOf(origin)) { _: WebView, message: WebMessageCompat, _: Uri, isMainFrame: Boolean, proxy: JavaScriptReplyProxy ->
            if (!isMainFrame) return@addWebMessageListener
            reply = proxy
            message.data?.let { receive(it) }
        }
    }

    fun register(plugin: Plugin) {
        plugin.bridge = this
        plugins[plugin.info.name] = plugin
    }

    /** Runs every plugin's load(), before the first page load. */
    fun loadPlugins() = plugins.values.forEach { runCatching { it.load() }.onFailure { e -> Log.e(TAG, "${it.info.name}.load failed", e) } }

    fun destroy() {
        plugins.values.forEach { runCatching { it.handleOnDestroy() } }
        WebViewCompat.removeWebMessageListener(webView, OBJECT)
        worker.quitSafely()
    }

    private fun receive(text: String) {
        val m = runCatching { JSONObject(text) }.getOrNull() ?: return
        val id = m.optString("id")
        val name = m.optString("plugin")
        val method = m.optString("method")
        val args = m.optJSONObject("args")?.let { JSObject.from(it) } ?: JSObject()
        val call = PluginCall(this, name, id, method, args)
        val plugin = plugins[name] ?: return call.reject("Folevi has no $name here.", "unimplemented")
        val target = plugin.methods[method] ?: return call.reject("$name has no $method.", "unimplemented")
        background.post {
            try {
                target.invoke(plugin, call)
            } catch (e: java.lang.reflect.InvocationTargetException) {
                Log.e(TAG, "$name.$method failed", e.cause)
                call.reject(e.cause?.message ?: "Folevi couldn't do that.", "failed")
            } catch (e: Exception) {
                Log.e(TAG, "$name.$method failed", e)
                call.reject(e.message ?: "Folevi couldn't do that.", "failed")
            }
        }
    }

    internal fun answer(id: String, ok: Boolean, data: JSONObject?, error: JSONObject?, keep: Boolean) {
        val json = JSONObject().put("id", id).put("ok", ok).put("keep", keep)
        if (data != null) json.put("data", data)
        if (error != null) json.put("error", error)
        val text = json.toString()
        main.post { runCatching { reply?.postMessage(text) } }
    }

    // ---- Calls kept for later (Capacitor's saveCall) --------------------------------------------------------

    fun saveCall(call: PluginCall) {
        saved[call.callbackId] = call
    }

    fun getSavedCall(id: String): PluginCall? = saved[id]

    fun releaseCall(call: PluginCall) {
        saved.remove(call.callbackId)
    }

    // ---- Events and threads ----------------------------------------------------------------------------------

    /** A window event for the bridge script: its fields are the event's (as Capacitor's triggerWindowJSEvent). */
    fun triggerWindowJSEvent(name: String, data: String) {
        val script = "window.Capacitor&&window.Capacitor.triggerEvent(${JSONObject.quote(name)},'window',$data)"
        main.post { webView.evaluateJavascript(script, null) }
    }

    fun runOnBackground(fn: () -> Unit) {
        background.post(fn)
    }

    // ---- Permissions -----------------------------------------------------------------------------------------

    private val asked by lazy { activity.getSharedPreferences("folevi.permissions", 0) }

    internal fun permissionsAsked(alias: String): Boolean = asked.getBoolean(alias, false)

    internal fun requestPermissions(alias: String, strings: Array<String>, done: () -> Unit) {
        main.post {
            asked.edit().putBoolean(alias, true).apply()
            permissionDone = { done() }
            permissionLauncher.launch(strings)
        }
    }

    companion object {
        private const val TAG = "FoleviHost"
        const val OBJECT = "foleviHostBridge"

        /** The page's `window.Capacitor`: just what assets/folevi-bridge.js calls. */
        val STAND_IN = """
            (function () {
              if (window.Capacitor) return;
              var H = window.$OBJECT;
              if (!H) return;
              var next = 0, calls = {};
              function send(plugin, method, args, keep, onAnswer) {
                var id = "h" + (++next) + "_" + Date.now().toString(36);
                calls[id] = onAnswer;
                H.postMessage(JSON.stringify({ id: id, plugin: String(plugin), method: String(method), args: args || {}, keep: !!keep }));
                return id;
              }
              H.onmessage = function (ev) {
                var m;
                try { m = JSON.parse(ev.data); } catch (e) { return; }
                var c = calls[m.id];
                if (!c) return;
                if (!m.keep) delete calls[m.id];
                c(m);
              };
              function failure(e) {
                var err = new Error((e && e.message) || "Folevi couldn't do that.");
                err.code = (e && e.code) || "failed";
                if (e && e.data) err.data = e.data;
                return err;
              }
              window.Capacitor = {
                platform: "android",
                isNativePlatform: function () { return true; },
                getPlatform: function () { return "android"; },
                nativePromise: function (plugin, method, args) {
                  return new Promise(function (resolve, reject) {
                    send(plugin, method, args, false, function (m) { if (m.ok) resolve(m.data || {}); else reject(failure(m.error)); });
                  });
                },
                nativeCallback: function (plugin, method, args, cb) {
                  return send(plugin, method, args, true, function (m) { if (m.ok) cb(m.data || {}, null); else cb(null, failure(m.error)); });
                },
                triggerEvent: function (name, target, data) {
                  var ev = document.createEvent("Events");
                  ev.initEvent(name, false, false);
                  if (data && typeof data === "object") for (var k in data) { try { ev[k] = data[k]; } catch (e) {} }
                  (target === "document" ? document : window).dispatchEvent(ev);
                }
              };
            })();
        """.trimIndent()
    }
}
