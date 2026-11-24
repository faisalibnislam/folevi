package com.folevi.android.library

import org.json.JSONObject
import java.io.File

/**
 * A cloud library's copy on this phone (packages/cloud-folders mirror.ts MirrorStore, kept natively): every file
 * read from or written to Dropbox or Drive, with the provider's etag, and the provider's state (cursor or page
 * token and file index). Signing out of the provider leaves this copy as a usable library folder.
 */
class MirrorStore(private val fs: FolderFs, private val stateFile: File) {
    private val etagsFile = File(stateFile.parentFile, stateFile.name.removeSuffix(".state.json") + ".etags.json")
    private val lock = Any()
    private var etags: MutableMap<String, String>? = null

    private fun etagMap(): MutableMap<String, String> = etags ?: HashMap<String, String>().also { map ->
        if (etagsFile.isFile) runCatching { JSONObject(etagsFile.readText()).let { o -> o.keys().forEach { k -> map[k] = o.getString(k) } } }
        etags = map
    }

    private fun saveEtags() {
        val o = JSONObject()
        for ((k, v) in etagMap()) o.put(k, v)
        atomicWrite(etagsFile, o.toString().toByteArray())
    }

    fun readFile(path: String): Pair<ByteArray, String>? = synchronized(lock) {
        val etag = etagMap()[LibraryPaths.check(path)] ?: return null
        val r = try {
            fs.read(path)
        } catch (e: LibraryException) {
            return null
        }
        (r as? ReadResult.Bytes)?.let { it.bytes to etag }
    }

    fun writeFile(path: String, bytes: ByteArray, etag: String) = synchronized(lock) {
        fs.write(path, bytes, IfMatch.Any)
        etagMap()[path] = etag
        saveEtags()
    }

    fun deleteFile(path: String) = synchronized(lock) {
        fs.remove(path)
        if (etagMap().remove(path) != null) saveEtags()
    }

    fun paths(): List<String> = synchronized(lock) { etagMap().keys.sorted() }

    fun loadState(): String? = synchronized(lock) { if (stateFile.isFile) stateFile.readText() else null }

    fun saveState(json: String) = synchronized(lock) { atomicWrite(stateFile, json.toByteArray()) }

    companion object {
        fun atomicWrite(target: File, bytes: ByteArray) {
            target.parentFile?.mkdirs()
            val tmp = File(target.parentFile, "${target.name}.${System.nanoTime()}.tmp")
            tmp.outputStream().use { it.write(bytes); it.fd.sync() }
            if (!tmp.renameTo(target)) {
                tmp.delete()
                throw LibraryException("io", "Folevi couldn't save ${target.name}.")
            }
        }
    }
}
