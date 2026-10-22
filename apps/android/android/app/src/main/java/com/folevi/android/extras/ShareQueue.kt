package com.folevi.android.extras

import android.content.Context
import com.getcapacitor.JSObject

/** What was shared to Folevi, waiting for the page (phase 3). */
class ShareQueue private constructor(context: Context) {
    fun pending(): List<JSObject> = emptyList()
    fun remove(id: String) {}

    companion object {
        private var shared: ShareQueue? = null
        fun get(context: Context): ShareQueue = shared ?: ShareQueue(context.applicationContext).also { shared = it }
    }
}
