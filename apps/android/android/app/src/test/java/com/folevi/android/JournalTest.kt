package com.folevi.android

import com.folevi.android.library.Journal
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.nio.file.Files

class JournalTest {
    private fun temp() = File(Files.createTempDirectory("journal").toFile(), "j.fj")

    @Test
    fun appendsReadsAndTruncates() {
        val j = Journal(temp())
        j.append("one".toByteArray())
        j.append("two".toByteArray())
        j.append(ByteArray(0))
        assertEquals(listOf("one", "two", ""), j.readAll().map { String(it) })
        j.truncate(2)
        assertEquals(listOf(""), j.readAll().map { String(it) })
    }

    @Test
    fun aTornLastFrameIsCutBeforeTheNextAppend() {
        val f = temp()
        val j = Journal(f)
        j.append("kept".toByteArray())
        f.appendBytes(byteArrayOf(0, 0, 0, 9, 1, 2)) // a frame the app died writing
        assertEquals(listOf("kept"), j.readAll().map { String(it) })
        j.append("next".toByteArray())
        assertEquals(listOf("kept", "next"), j.readAll().map { String(it) })
    }

    @Test
    fun sameBytesAsTheMac() {
        // the Electron Mac app's library/journal.ts: "FLVJ" 0x01, u32 BE length, u32 BE CRC-32, the record.
        val f = temp()
        Journal(f).append("a".toByteArray())
        assertArrayEquals(byteArrayOf(0x46, 0x4c, 0x56, 0x4a, 0x01, 0, 0, 0, 1, 0xe8.toByte(), 0xb7.toByte(), 0xbe.toByte(), 0x43, 0x61), f.readBytes())
    }
}
