package com.folevi.android.bridge

import org.json.JSONObject

/**
 * One call from the page. `resolve` and `reject` answer it once; a call kept alive (`setKeepAlive(true)`, the
 * page's `nativeCallback`) may resolve many times until it is released.
 */
class PluginCall internal constructor(
    private val bridge: Bridge,
    val pluginId: String,
    val callbackId: String,
    val methodName: String,
    private val args: JSObject,
) {
    @Volatile private var keepAlive = false
    @Volatile private var done = false

    fun getData(): JSObject = args
    fun getString(name: String): String? = args.getString(name, null)
    fun getString(name: String, default: String?): String? = args.getString(name, default)
    fun getBoolean(name: String): Boolean? = args.getBoolean(name, null)
    fun getBoolean(name: String, default: Boolean?): Boolean? = args.getBoolean(name, default)
    fun getInt(name: String): Int? = args.getInteger(name)
    fun getInt(name: String, default: Int?): Int? = args.getInteger(name) ?: default
    fun getDouble(name: String): Double? = if (args.has(name) && !args.isNull(name)) args.optDouble(name) else null
    fun getLong(name: String): Long? = if (args.has(name) && !args.isNull(name)) args.optLong(name) else null
    fun getObject(name: String): JSObject? = args.getJSObject(name)
    fun getObject(name: String, default: JSObject?): JSObject? = args.getJSObject(name) ?: default
    fun getArray(name: String): JSArray? = args.optJSONArray(name)?.let { JSArray(it.toString()) }

    fun setKeepAlive(on: Boolean) {
        keepAlive = on
    }

    fun isKeptAlive(): Boolean = keepAlive

    fun resolve() = resolve(null)

    fun resolve(value: JSONObject?) {
        if (done) return
        if (!keepAlive) done = true
        bridge.answer(callbackId, ok = true, data = value, error = null, keep = keepAlive)
    }

    fun reject(message: String) = reject(message, null, null, null)
    fun reject(message: String, code: String?) = reject(message, code, null, null)
    fun reject(message: String, code: String?, e: Exception?) = reject(message, code, e, null)

    fun reject(message: String, code: String?, e: Exception?, data: JSONObject?) {
        if (done) return
        done = true
        val err = JSObject().put("message", message).put("code", code ?: "failed")
        if (data != null) err.put("data", data)
        bridge.answer(callbackId, ok = false, data = null, error = err, keep = false)
    }

    fun unavailable(message: String = "Not available on this device.") = reject(message, "unavailable")
    fun unimplemented(message: String = "Not in this build.") = reject(message, "unimplemented")
}
