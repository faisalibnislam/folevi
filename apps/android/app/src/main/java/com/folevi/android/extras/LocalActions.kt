package com.folevi.android.extras

import android.content.Context
import com.folevi.android.library.MirrorStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * Local mode (no account, so no REST API): what a widget did while the page wasn't there to do it, kept on the
 * phone until the page that holds the library puts it in (apps/web components/app/LocalExtensions.tsx, the
 * same queue as the iPhone app's LocalActions). Only check-offs come from Android's widgets; Quick add opens
 * the app. Each action stays until the page says it's done (finish), so nothing is lost if the app closes
 * halfway. A task checked off twice before the page looks keeps only the last word.
 */
class LocalActions private constructor(private val file: File) {
    @Synchronized
    fun pending(): JSONArray = runCatching { JSONArray(file.readText()) }.getOrDefault(JSONArray())

    @Synchronized
    fun toggleTask(taskId: String, completed: Boolean): String {
        val kept = JSONArray()
        val all = pending()
        for (i in 0 until all.length()) {
            val a = all.getJSONObject(i)
            if (!(a.optString("kind") == "toggleTask" && a.optString("taskId") == taskId)) kept.put(a)
        }
        val id = UUID.randomUUID().toString()
        kept.put(JSONObject().put("id", id).put("kind", "toggleTask").put("taskId", taskId).put("completed", completed))
        // At most a few hundred, oldest first to go.
        val trimmed = JSONArray()
        for (i in maxOf(0, kept.length() - MAX) until kept.length()) trimmed.put(kept.get(i))
        write(trimmed)
        return id
    }

    /** The actions for one place's page: the library's (no place, as before places) or an account's. */
    @Synchronized
    fun pendingFor(place: String?): JSONArray {
        val wanted = if (place == null || place == com.folevi.android.Places.LIBRARY) null else place
        val out = JSONArray()
        val all = pending()
        for (i in 0 until all.length()) {
            val a = all.getJSONObject(i)
            val p = if (a.isNull("place")) null else a.optString("place").ifEmpty { null }
            if (p == wanted && (wanted != null || place != null)) out.put(a)
        }
        return out
    }

    @Synchronized
    fun finish(id: String) {
        val kept = JSONArray()
        val all = pending()
        for (i in 0 until all.length()) if (all.getJSONObject(i).optString("id") != id) kept.put(all.get(i))
        write(kept)
    }

    /** The task ids checked off here that the page hasn't put in yet (the widget keeps them hidden). */
    @Synchronized
    fun doneTaskIds(): Set<String> {
        val all = pending()
        return (0 until all.length()).map { all.getJSONObject(it) }.filter { it.optString("kind") == "toggleTask" && it.optBoolean("completed") }.map { it.optString("taskId") }.toSet()
    }

    @Synchronized
    fun clear() {
        file.delete()
    }

    private fun write(a: JSONArray) = MirrorStore.atomicWrite(file, a.toString().toByteArray())

    companion object {
        const val MAX = 300

        @Volatile private var shared: LocalActions? = null

        fun get(context: Context): LocalActions = shared ?: synchronized(this) {
            shared ?: LocalActions(File(context.applicationContext.noBackupFilesDir, "local-actions.json")).also { shared = it }
        }

        /** For tests: a queue in a folder of its own. */
        fun at(file: File) = LocalActions(file)
    }
}
