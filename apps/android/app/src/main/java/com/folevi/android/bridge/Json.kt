// JSON objects for the host bridge, with the chaining `put` the services were written against (they came from
// the Capacitor app, whose JSObject and JSArray these replace).
package com.folevi.android.bridge

import org.json.JSONArray
import org.json.JSONObject

open class JSObject : JSONObject {
    constructor() : super()
    constructor(json: String) : super(json)
    constructor(o: JSONObject, names: Array<String>) : super(o, names)

    override fun put(name: String, value: Boolean): JSObject = apply { super.put(name, value) }
    override fun put(name: String, value: Int): JSObject = apply { super.put(name, value) }
    override fun put(name: String, value: Long): JSObject = apply { super.put(name, value) }
    override fun put(name: String, value: Double): JSObject = apply { super.put(name, value) }
    override fun put(name: String, value: Any?): JSObject = apply { super.put(name, value) }

    fun getString(name: String, default: String?): String? = if (has(name) && !isNull(name)) optString(name) else default
    fun getBoolean(name: String, default: Boolean?): Boolean? = if (has(name) && !isNull(name)) optBoolean(name) else default
    fun getInteger(name: String): Int? = if (has(name) && !isNull(name)) optInt(name) else null
    fun getJSObject(name: String): JSObject? = optJSONObject(name)?.let { from(it) }

    companion object {
        /** JSONObject.NULL, reachable through this class as Capacitor's JSObject allowed. */
        @JvmField val NULL: Any = JSONObject.NULL

        fun from(o: JSONObject): JSObject = if (o is JSObject) o else JSObject(o.toString())
    }
}

open class JSArray : JSONArray {
    constructor() : super()
    constructor(json: String) : super(json)
    constructor(items: Collection<*>) : super(items)

    @Suppress("UNCHECKED_CAST")
    fun <T> toList(): List<T> = (0 until length()).map { get(it) as T }
}
