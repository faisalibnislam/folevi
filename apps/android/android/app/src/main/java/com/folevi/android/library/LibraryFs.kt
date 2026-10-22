package com.folevi.android.library

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.attribute.BasicFileAttributes
import java.util.concurrent.TimeUnit

/** A library file error with the code local-store reads (packages/local-store/src/io.ts LocalFsError). */
class LibraryException(val code: String, message: String, val path: String? = null) : IOException(message)

data class Entry(val path: String, val size: Long, val mtimeMs: Long, val etag: String, val downloaded: Boolean = true, val hasConflicts: Boolean = false)

sealed interface ReadResult {
    data class Bytes(val bytes: ByteArray, val etag: String) : ReadResult
    data object NotDownloaded : ReadResult
}

sealed interface WriteResult {
    data class Written(val etag: String) : WriteResult
    data class Mismatch(val etag: String) : WriteResult
}

/** The write's condition: [Any] (unconditional), [Create] (only if it doesn't exist yet) or [Etag] (only over that version). */
sealed interface IfMatch {
    data object Any : IfMatch
    data object Create : IfMatch
    data class Etag(val etag: String) : IfMatch
}

/** The library's file API (docs/LOCAL_MODE_PLAN.md §4.1), the same contract every host passes (fs-contract.json). */
interface LocalFs {
    fun list(dir: String): List<Entry>
    fun read(path: String): ReadResult
    fun write(path: String, bytes: ByteArray, ifMatch: IfMatch): WriteResult
    fun remove(path: String, ifMatch: String? = null)
    fun conflictVersions(path: String): List<Pair<String, ByteArray>> = emptyList()
    fun resolveConflicts(path: String, ids: List<String>) {}
}

object LibraryPaths {
    /** Same rules as local-store's isValidLibraryPath: relative, forward slashes, no dot segments or control characters. */
    fun valid(path: String): Boolean {
        if (path.isEmpty() || path.length > 1024) return false
        if (path.startsWith("/") || path.endsWith("/") || path.contains('\\')) return false
        if (path.any { it.code < 0x20 || it.code == 0x7f }) return false
        return path.split('/').all { it.isNotEmpty() && it != "." && it != ".." }
    }

    fun check(path: String): String {
        if (!valid(path)) throw LibraryException("invalid_path", "Invalid library path: $path", path)
        return path
    }

    fun checkDir(dir: String): String = if (dir.isEmpty()) dir else check(dir)

    const val TMP = ".folevi-tmp"
}

/**
 * A library in a folder on this phone (the app's own storage): atomic writes (a temp file in `.folevi-tmp`,
 * synced, then renamed over), etags from the file's size, modification time and identity, so any write changes
 * it. One lock for the whole folder: the app is the only writer.
 */
class FolderFs(val root: File) : LocalFs {
    private val lock = Any()

    private fun fileOf(path: String): File = File(root, LibraryPaths.check(path))

    private fun etagOf(f: File): String {
        val a = Files.readAttributes(f.toPath(), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
        val ns = a.lastModifiedTime().to(TimeUnit.NANOSECONDS)
        val key = a.fileKey()?.toString()?.hashCode()?.toUInt()?.toString(36) ?: "0"
        return "${a.size().toString(36)}-${ns.toString(36)}-$key"
    }

    private fun currentEtag(f: File): String? = if (f.isFile) etagOf(f) else null

    override fun list(dir: String): List<Entry> = synchronized(lock) {
        val d = if (LibraryPaths.checkDir(dir).isEmpty()) root else File(root, dir)
        if (!d.isDirectory) return emptyList()
        val out = ArrayList<Entry>()
        val base = root.canonicalFile.toPath()
        d.walkTopDown().onEnter { it.name != LibraryPaths.TMP }.filter { it.isFile }.forEach { f ->
            val rel = base.relativize(f.canonicalFile.toPath()).toString().replace(File.separatorChar, '/')
            if (!LibraryPaths.valid(rel)) return@forEach
            out.add(Entry(rel, f.length(), f.lastModified(), etagOf(f)))
        }
        out.sortedBy { it.path }
    }

    override fun read(path: String): ReadResult = synchronized(lock) {
        val f = fileOf(path)
        if (!f.isFile) throw LibraryException("not_found", "No such file: $path", path)
        val etag = etagOf(f)
        ReadResult.Bytes(f.readBytes(), etag)
    }

    override fun write(path: String, bytes: ByteArray, ifMatch: IfMatch): WriteResult = synchronized(lock) {
        val f = fileOf(path)
        val now = currentEtag(f)
        when (ifMatch) {
            IfMatch.Any -> Unit
            IfMatch.Create -> if (now != null) return WriteResult.Mismatch(now)
            is IfMatch.Etag -> if (now != ifMatch.etag) return WriteResult.Mismatch(now ?: "")
        }
        val tmpDir = File(root, LibraryPaths.TMP).apply { mkdirs() }
        f.parentFile?.mkdirs()
        val tmp = File(tmpDir, "${f.name}.${System.nanoTime()}.tmp")
        try {
            tmp.outputStream().use { out ->
                out.write(bytes)
                out.fd.sync()
            }
            if (!tmp.renameTo(f)) throw LibraryException("io", "Folevi couldn't save $path.", path)
        } finally {
            if (tmp.exists()) tmp.delete()
        }
        WriteResult.Written(etagOf(f))
    }

    override fun remove(path: String, ifMatch: String?) = synchronized(lock) {
        val f = fileOf(path)
        if (!f.isFile) return
        if (ifMatch != null && etagOf(f) != ifMatch) throw LibraryException("mismatch", "$path changed since it was read.", path)
        if (!f.delete()) throw LibraryException("io", "Folevi couldn't remove $path.", path)
        var parent = f.parentFile
        while (parent != null && parent != root && parent.list()?.isEmpty() == true) {
            parent.delete()
            parent = parent.parentFile
        }
    }
}
