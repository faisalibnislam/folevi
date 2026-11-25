package com.folevi.android.library

import java.io.File
import java.io.RandomAccessFile
import java.util.zip.CRC32

/**
 * The native journal (docs/LOCAL_MODE_PLAN.md §3.6, `shell.library.journal`): every local edit is appended and
 * synced here before the page calls it saved. It lives in the app's own storage, never in the library. The same
 * file format as the Mac's (the Electron Mac app's library/journal.ts): "FLVJ" 0x01, then frames of u32 BE length,
 * u32 BE CRC-32 and the record. A torn last frame (the app died mid-append) is cut off before the next append.
 */
class Journal(private val file: File) {
    private val lock = Any()

    fun append(record: ByteArray) = synchronized(lock) {
        if (record.size > MAX_RECORD) throw LibraryException("invalid_argument", "That journal record is too big.")
        file.parentFile?.mkdirs()
        RandomAccessFile(file, "rw").use { raf ->
            val existing = if (raf.length() > 0) ByteArray(raf.length().toInt()).also { raf.readFully(it) } else ByteArray(0)
            val (_, valid) = parse(existing)
            if (existing.isEmpty() || valid < MAGIC.size) {
                raf.setLength(0)
                raf.write(MAGIC)
            } else raf.setLength(valid.toLong())
            raf.seek(raf.length())
            val header = ByteArray(8)
            putU32(header, 0, record.size.toLong())
            putU32(header, 4, CRC32().apply { update(record) }.value)
            raf.write(header)
            raf.write(record)
            raf.fd.sync()
        }
    }

    fun readAll(): List<ByteArray> = synchronized(lock) {
        if (!file.isFile) return emptyList()
        parse(file.readBytes()).first
    }

    /** Drops the first `n` records (the library files now hold them). */
    fun truncate(n: Int) = synchronized(lock) {
        if (n <= 0 || !file.isFile) return
        val rest = parse(file.readBytes()).first.drop(n)
        val tmp = File(file.parentFile, "${file.name}.tmp")
        tmp.outputStream().use { out ->
            out.write(MAGIC)
            for (r in rest) {
                val header = ByteArray(8)
                putU32(header, 0, r.size.toLong())
                putU32(header, 4, CRC32().apply { update(r) }.value)
                out.write(header)
                out.write(r)
            }
            out.fd.sync()
        }
        if (!tmp.renameTo(file)) throw LibraryException("io", "Folevi couldn't update its journal.")
    }

    fun delete() = synchronized(lock) { file.delete() }

    companion object {
        val MAGIC = byteArrayOf(0x46, 0x4c, 0x56, 0x4a, 0x01)
        const val MAX_RECORD = 16 * 1024 * 1024

        private fun putU32(b: ByteArray, at: Int, v: Long) {
            b[at] = (v ushr 24).toByte(); b[at + 1] = (v ushr 16).toByte(); b[at + 2] = (v ushr 8).toByte(); b[at + 3] = v.toByte()
        }

        private fun u32(b: ByteArray, at: Int): Long =
            ((b[at].toLong() and 0xff) shl 24) or ((b[at + 1].toLong() and 0xff) shl 16) or ((b[at + 2].toLong() and 0xff) shl 8) or (b[at + 3].toLong() and 0xff)

        /** The whole frames, and where the last one ends. */
        fun parse(bytes: ByteArray): Pair<List<ByteArray>, Int> {
            if (bytes.isEmpty()) return emptyList<ByteArray>() to 0
            if (bytes.size < MAGIC.size || !bytes.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) return emptyList<ByteArray>() to 0
            val out = ArrayList<ByteArray>()
            var off = MAGIC.size
            while (bytes.size - off >= 8) {
                val len = u32(bytes, off)
                val crc = u32(bytes, off + 4)
                if (len > MAX_RECORD || off + 8 + len > bytes.size) break
                val rec = bytes.copyOfRange(off + 8, off + 8 + len.toInt())
                if (CRC32().apply { update(rec) }.value != crc) break
                out.add(rec)
                off += 8 + len.toInt()
            }
            return out to off
        }
    }
}
