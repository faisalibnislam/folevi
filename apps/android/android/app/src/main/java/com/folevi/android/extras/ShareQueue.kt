package com.folevi.android.extras

import android.content.Context
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * What was shared to Folevi and not saved yet (offline, signed out, local mode, or anything with files): kept in
 * the app's storage until the page takes it (`takeShares`), saves it with the web app's own share flow
 * (lib/share/save.ts, offline too) and lets it go (`finishShare`). The iPhone app's Shared/ShareQueue.swift.
 */
class ShareQueue private constructor(context: Context) {
    private val dir = File(context.noBackupFilesDir, "shares").apply { mkdirs() }
    private val lock = Any()

    data class SharedFile(val name: String, val type: String, val bytes: ByteArray)

    fun add(title: String, text: String, url: String, place: String?, files: List<SharedFile>): String = synchronized(lock) {
        val id = UUID.randomUUID().toString()
        val d = File(dir, id).apply { mkdirs() }
        val list = JSONArray()
        files.forEachIndexed { i, f ->
            val name = "f$i"
            File(d, name).writeBytes(f.bytes)
            list.put(JSONObject().put("file", name).put("name", f.name).put("type", f.type))
        }
        val meta = JSONObject().put("id", id).put("title", title).put("text", text).put("url", url).put("place", place ?: JSONObject.NULL).put("files", list).put("at", System.currentTimeMillis())
        com.folevi.android.library.MirrorStore.atomicWrite(File(d, "share.json"), meta.toString().toByteArray())
        id
    }

    /** Everything waiting, oldest first, with its files (base64) for the page. */
    fun pending(): List<JSObject> = synchronized(lock) {
        (dir.listFiles() ?: emptyArray()).mapNotNull { d ->
            val meta = runCatching { JSONObject(File(d, "share.json").readText()) }.getOrNull() ?: return@mapNotNull null
            val files = JSArray()
            val list = meta.optJSONArray("files") ?: JSONArray()
            for (i in 0 until list.length()) {
                val f = list.getJSONObject(i)
                val bytes = runCatching { File(d, f.getString("file")).readBytes() }.getOrNull() ?: continue
                files.put(JSObject().put("name", f.optString("name")).put("type", f.optString("type")).put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)))
            }
            meta.optLong("at") to JSObject()
                .put("id", meta.getString("id"))
                .put("title", meta.optString("title"))
                .put("text", meta.optString("text"))
                .put("url", meta.optString("url"))
                .put("place", if (meta.isNull("place")) null else meta.optString("place"))
                .put("files", files)
        }.sortedBy { it.first }.map { it.second }
    }

    fun remove(id: String) = synchronized(lock) {
        if (!Regex("^[0-9a-f-]{36}$").matches(id)) return
        File(dir, id).deleteRecursively()
        Unit
    }

    fun count(): Int = dir.listFiles()?.size ?: 0

    companion object {
        private var shared: ShareQueue? = null
        fun get(context: Context): ShareQueue = shared ?: ShareQueue(context.applicationContext).also { shared = it }
    }
}
