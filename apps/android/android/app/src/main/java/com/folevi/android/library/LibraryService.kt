package com.folevi.android.library

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom

/**
 * The local library on this phone (docs/ANDROID_PLAN.md "Local mode", docs/LOCAL_MODE_PLAN.md §3): where it is,
 * its manifest (folevi-library.json), the device folder's files, the journal, and the copies of a Dropbox or
 * Google Drive library. The files of a cloud library are read and written by the shared provider code in the
 * bridge (packages/cloud-folders), which keeps its copy here through the "mirror" folders; the provider tokens
 * stay in CloudAuth.kt.
 *
 * Places (`kind`): "device" (This phone only: app storage, never backed up) and "dropbox" / "gdrive". There is no
 * iCloud and no folder picker on Android (the owner's decision).
 */
class LibraryService(private val base: File, private val prefsContext: Context?) {
    private val prefs = prefsContext?.applicationContext?.getSharedPreferences("folevi-library", Context.MODE_PRIVATE)
    private val memory = HashMap<String, String>()

    private fun get(key: String): String? = prefs?.getString(key, null) ?: memory[key]
    private fun put(key: String, value: String?) {
        if (prefs != null) prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.commit()
        else if (value == null) memory.remove(key) else memory[key] = value
    }

    val kind: String? get() = get("kind")?.takeIf { it in KINDS }
    val libraryId: String? get() = get("libraryId")

    /** The device library's folder (This phone only). */
    val deviceFs: FolderFs by lazy { FolderFs(File(base, "library").apply { mkdirs() }) }

    /** The copy of a cloud library kept on this phone, one folder per provider (also usable after signing out). */
    fun mirror(provider: String): FolderFs {
        require(provider == "dropbox" || provider == "googleDrive")
        return FolderFs(File(base, "cloud/$provider").apply { mkdirs() })
    }

    /** Provider state (list cursors, page tokens, the file index) beside the copy. */
    fun mirrorState(provider: String): File = File(base, "cloud/$provider.state.json")

    fun journal(): Journal {
        val id = libraryId ?: "unset"
        return Journal(File(base, "journal/$id.fj"))
    }

    /** "This phone only": makes or opens the library in the app's storage. */
    fun setupDevice(): String {
        val fs = deviceFs
        val existing = readManifest(fs)
        val id = existing?.optString("libraryId") ?: run {
            val m = newManifest()
            when (val w = fs.write(LIBRARY_FILE, encode(m), IfMatch.Create)) {
                is WriteResult.Written -> m.getString("libraryId")
                is WriteResult.Mismatch -> readManifest(fs)?.optString("libraryId") ?: throw LibraryException("unreadable", "The library file can't be read.")
            }
        }
        setState("device", id)
        return id
    }

    /** A cloud library prepared by the bridge (the provider's library file read or made there). */
    fun setState(kind: String, libraryId: String) {
        require(kind in KINDS)
        require(ID_RE.matches(libraryId))
        put("kind", kind)
        put("libraryId", libraryId)
    }

    fun info(): JSONObject {
        val k = kind ?: return JSONObject().put("kind", "device").put("displayPath", "").put("available", false).put("encrypted", false).put("locked", false).put("configured", false)
        if (k != "device") return JSONObject().put("kind", k).put("configured", true)
        val manifest = readManifest(deviceFs)
        val encrypted = manifest?.opt("encryption").let { it != null && it != JSONObject.NULL }
        return JSONObject()
            .put("kind", "device")
            .put("displayPath", "Folevi's storage on this phone")
            .put("available", manifest != null)
            .put("encrypted", encrypted)
            // A passphrase-encrypted library isn't opened on Android yet (docs/ANDROID_PLAN.md "Not done").
            .put("locked", encrypted)
            .put("configured", true)
    }

    fun readManifest(fs: LocalFs): JSONObject? = try {
        when (val r = fs.read(LIBRARY_FILE)) {
            is ReadResult.Bytes -> JSONObject(r.bytes.toString(Charsets.UTF_8)).takeIf { it.optString("format") == "folevi-library" && ID_RE.matches(it.optString("libraryId")) }
            ReadResult.NotDownloaded -> null
        }
    } catch (e: LibraryException) {
        null
    } catch (e: org.json.JSONException) {
        null
    }

    companion object {
        const val LIBRARY_FILE = "folevi-library.json"
        val KINDS = setOf("device", "dropbox", "gdrive")
        val ID_RE = Regex("^[A-Za-z0-9_-]{1,64}$")
        private const val CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

        fun newLibraryId(now: Long = System.currentTimeMillis()): String {
            var t = now
            val time = StringBuilder()
            repeat(10) {
                time.insert(0, CROCKFORD[(t % 32).toInt()])
                t /= 32
            }
            val r = ByteArray(16).also { SecureRandom().nextBytes(it) }
            return time.toString() + r.joinToString("") { CROCKFORD[(it.toInt() and 0xff) % 32].toString() }
        }

        fun newManifest(now: Long = System.currentTimeMillis()): JSONObject = JSONObject()
            .put("format", "folevi-library")
            .put("v", 1)
            .put("libraryId", newLibraryId(now))
            .put("createdAt", now)
            .put("minWriterVersion", 1)
            .put("encryption", JSONObject.NULL)

        fun encode(m: JSONObject): ByteArray = (m.toString(2) + "\n").toByteArray()
    }
}
