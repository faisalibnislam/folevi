package com.folevi.android.library

import android.util.Base64
import com.folevi.android.FoleviApp
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * "FoleviLibrary": `foleviShell.library` for a library on this phone, the journal, and the copy of a cloud
 * library the bridge's provider code keeps here (the `mirror*` calls). Every path is checked
 * (LibraryPaths); bytes cross as base64, large ones in chunks. Work runs off the main thread, one call at a time.
 */
@CapacitorPlugin(name = "FoleviLibrary")
class LibraryPlugin : Plugin() {
    private val io = Executors.newSingleThreadExecutor()
    private val uploads = ConcurrentHashMap<String, ByteArrayOutputStream>()
    private val service get() = FoleviApp.instance.library

    private fun run(call: PluginCall, work: () -> JSObject?) {
        io.execute {
            try {
                call.resolve(work() ?: JSObject())
            } catch (e: LibraryException) {
                call.reject(e.message ?: "Folevi couldn't do that with its library.", e.code, null, JSObject().apply { e.path?.let { put("path", it) }; put("code", e.code) })
            } catch (e: IllegalArgumentException) {
                call.reject(e.message ?: "That isn't something the library takes.", "invalid_argument")
            } catch (e: Exception) {
                call.reject("Folevi couldn't reach its library on this phone.", "io")
            }
        }
    }

    private fun fsFor(call: PluginCall): LocalFs {
        val root = call.getString("root") ?: "library"
        return when {
            root == "library" -> {
                if (service.kind != "device") throw LibraryException("not_set_up", "There's no library on this phone yet.")
                service.deviceFs
            }
            root.startsWith("mirror:") -> service.mirror(root.removePrefix("mirror:"))
            else -> throw IllegalArgumentException("Unknown library root.")
        }
    }

    private fun bytesOf(call: PluginCall): ByteArray {
        call.getString("upload")?.let { id ->
            val buf = uploads.remove(id) ?: throw IllegalArgumentException("That upload isn't here.")
            val bytes = buf.toByteArray()
            if (bytes.size.toLong() != call.getData().optLong("size", -1)) throw IllegalArgumentException("That upload is incomplete.")
            return bytes
        }
        return Base64.decode(call.getString("data") ?: "", Base64.NO_WRAP)
    }

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun entryJson(e: Entry) = JSObject().put("path", e.path).put("size", e.size).put("mtimeMs", e.mtimeMs).put("etag", e.etag).put("downloaded", e.downloaded).put("hasConflicts", e.hasConflicts)

    @PluginMethod
    fun chunk(call: PluginCall) = run(call) {
        val id = call.getString("upload") ?: throw IllegalArgumentException("No upload.")
        val data = Base64.decode(call.getString("data") ?: "", Base64.NO_WRAP)
        val buf = uploads.getOrPut(id) { ByteArrayOutputStream() }
        if (buf.size().toLong() != call.getData().optLong("offset", -1)) throw IllegalArgumentException("A piece arrived out of order.")
        if (buf.size() + data.size > 600 * 1024 * 1024) throw IllegalArgumentException("That file is too big.")
        buf.write(data)
        null
    }

    @PluginMethod
    fun setup(call: PluginCall) = run(call) {
        when (val kind = call.getString("kind")) {
            "device" -> {
                service.setupDevice()
                JSObject().put("info", JSObject(service.info().toString()))
            }
            // Dropbox and Google Drive are set up by the bridge's provider code, which then calls setState.
            "dropbox", "gdrive" -> throw LibraryException("unavailable", "Connect first.", null)
            else -> throw LibraryException("unavailable", if (kind == "icloud") "iCloud isn't on Android." else "Folevi for Android keeps its library on this phone, in Dropbox or in Google Drive.")
        }
    }

    @PluginMethod
    fun setState(call: PluginCall) = run(call) {
        service.setState(call.getString("kind") ?: "", call.getString("libraryId") ?: "")
        null
    }

    @PluginMethod
    fun info(call: PluginCall) = run(call) { JSObject(service.info().toString()) }

    @PluginMethod
    fun list(call: PluginCall) = run(call) {
        val arr = JSArray()
        for (e in fsFor(call).list(call.getString("dir") ?: "")) arr.put(entryJson(e))
        JSObject().put("entries", arr)
    }

    @PluginMethod
    fun read(call: PluginCall) = run(call) {
        when (val r = fsFor(call).read(LibraryPaths.check(call.getString("path") ?: ""))) {
            is ReadResult.Bytes -> JSObject().put("data", b64(r.bytes)).put("etag", r.etag)
            ReadResult.NotDownloaded -> JSObject().put("notDownloaded", true)
        }
    }

    @PluginMethod
    fun write(call: PluginCall) = run(call) {
        val path = LibraryPaths.check(call.getString("path") ?: "")
        val d = call.getData()
        val ifMatch = when {
            !d.optBoolean("hasIfMatch", false) -> IfMatch.Any
            d.isNull("ifMatch") -> IfMatch.Create
            else -> IfMatch.Etag(d.optString("ifMatch"))
        }
        when (val w = fsFor(call).write(path, bytesOf(call), ifMatch)) {
            is WriteResult.Written -> JSObject().put("etag", w.etag)
            is WriteResult.Mismatch -> JSObject().put("mismatch", true).put("etag", w.etag)
        }
    }

    @PluginMethod
    fun remove(call: PluginCall) = run(call) {
        fsFor(call).remove(LibraryPaths.check(call.getString("path") ?: ""), call.getString("ifMatch"))
        null
    }

    @PluginMethod
    fun conflictVersions(call: PluginCall) = run(call) {
        val arr = JSArray()
        for ((id, bytes) in fsFor(call).conflictVersions(LibraryPaths.check(call.getString("path") ?: ""))) arr.put(JSObject().put("id", id).put("data", b64(bytes)))
        JSObject().put("versions", arr)
    }

    @PluginMethod
    fun resolveConflicts(call: PluginCall) = run(call) {
        val ids = call.getArray("ids")?.toList<String>() ?: emptyList()
        fsFor(call).resolveConflicts(LibraryPaths.check(call.getString("path") ?: ""), ids)
        null
    }

    /** Every file of a library on this phone is already here. */
    @PluginMethod
    fun startDownload(call: PluginCall) = run(call) { null }

    /** A library on this phone only changes through this app, so nothing else ever reports a change. */
    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    fun watch(call: PluginCall) {
        call.setKeepAlive(true)
        bridge.saveCall(call)
    }

    @PluginMethod
    fun unwatch(call: PluginCall) {
        call.getString("callbackId")?.let { id -> bridge.getSavedCall(id)?.let { bridge.releaseCall(it) } }
        call.resolve()
    }

    @PluginMethod
    fun journalAppend(call: PluginCall) = run(call) {
        service.journal().append(bytesOf(call))
        null
    }

    @PluginMethod
    fun journalRead(call: PluginCall) = run(call) {
        val arr = JSArray()
        for (r in service.journal().readAll()) arr.put(b64(r))
        JSObject().put("records", arr)
    }

    @PluginMethod
    fun journalTruncate(call: PluginCall) = run(call) {
        service.journal().truncate(call.getInt("count") ?: 0)
        null
    }

    private fun noPassphrase(call: PluginCall) = call.reject("Encrypting a library with a passphrase isn't in Folevi for Android yet. Use Folevi for Mac to change it.", "unavailable")

    @PluginMethod fun unlock(call: PluginCall) = noPassphrase(call)
    @PluginMethod fun setPassphrase(call: PluginCall) = noPassphrase(call)
    @PluginMethod fun changePassphrase(call: PluginCall) = noPassphrase(call)

    // ---------------------------------------------------------------- a cloud library's copy on this phone

    private fun mirrorOf(call: PluginCall): MirrorStore {
        val p = call.getString("provider") ?: ""
        if (p != "dropbox" && p != "googleDrive") throw IllegalArgumentException("Unknown provider.")
        return MirrorStore(service.mirror(p), service.mirrorState(p))
    }

    @PluginMethod
    fun mirrorRead(call: PluginCall) = run(call) {
        val r = mirrorOf(call).readFile(LibraryPaths.check(call.getString("path") ?: ""))
        if (r == null) JSObject().put("missing", true) else JSObject().put("data", b64(r.first)).put("etag", r.second)
    }

    @PluginMethod
    fun mirrorWrite(call: PluginCall) = run(call) {
        mirrorOf(call).writeFile(LibraryPaths.check(call.getString("path") ?: ""), bytesOf(call), call.getString("etag") ?: "")
        null
    }

    @PluginMethod
    fun mirrorDelete(call: PluginCall) = run(call) {
        mirrorOf(call).deleteFile(LibraryPaths.check(call.getString("path") ?: ""))
        null
    }

    @PluginMethod
    fun mirrorPaths(call: PluginCall) = run(call) { JSObject().put("paths", JSArray(mirrorOf(call).paths())) }

    @PluginMethod
    fun mirrorLoadState(call: PluginCall) = run(call) { JSObject().put("state", mirrorOf(call).loadState()) }

    @PluginMethod
    fun mirrorSaveState(call: PluginCall) = run(call) {
        val s = call.getString("state") ?: "null"
        if (s.length > 32 * 1024 * 1024) throw IllegalArgumentException("That state is too big.")
        mirrorOf(call).saveState(s)
        null
    }
}
