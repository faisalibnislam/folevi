package com.folevi.android

import com.folevi.android.library.FolderFs
import com.folevi.android.library.IfMatch
import com.folevi.android.library.LibraryException
import com.folevi.android.library.ReadResult
import com.folevi.android.library.WriteResult
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.nio.file.Files

/** packages/local-store/fixtures/fs-contract.json against the phone's library folder (FolderFs). */
class FolderFsContractTest {
    private val contract = JSONObject(Fixtures.text("packages/local-store/fixtures/fs-contract.json"))

    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    private fun bytesOf(step: JSONObject) = if (step.has("hex")) hex(step.getString("hex")) else step.optString("text").toByteArray()

    @Test
    fun everyCase() {
        val cases = contract.getJSONArray("cases")
        var ran = 0
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            if (c.has("requires") && c.getJSONArray("requires").length() > 0) continue // provider hooks only
            val fs = FolderFs(Files.createTempDirectory("fs-contract").toFile())
            val saved = HashMap<String, String>()
            fun etag(ref: String) = if (ref.startsWith("$")) saved[ref.substring(1)] ?: error("no saved ${ref}") else ref
            val steps = c.getJSONArray("steps")
            for (j in 0 until steps.length()) {
                val s = steps.getJSONObject(j)
                val label = "${c.getString("name")} step $j ${s.getString("op")}"
                when (s.getString("op")) {
                    "write" -> {
                        val cond = when {
                            !s.has("ifMatch") -> IfMatch.Any
                            s.isNull("ifMatch") -> IfMatch.Create
                            else -> IfMatch.Etag(etag(s.getString("ifMatch")))
                        }
                        val w = fs.write(s.getString("path"), bytesOf(s), cond)
                        val got = when (w) { is WriteResult.Written -> "written" to w.etag; is WriteResult.Mismatch -> "mismatch" to w.etag }
                        assertEquals(label, s.getString("expect"), got.first)
                        if (s.has("save")) saved[s.getString("save")] = got.second
                        if (s.has("etagIs")) assertEquals(label, s.getString("etagIs").let { if (it.isEmpty()) "" else etag(it) }, got.second)
                        if (s.has("etagNot")) assertNotEquals(label, etag(s.getString("etagNot")), got.second)
                    }
                    "read" -> {
                        val expect = s.getString("expect")
                        try {
                            val r = fs.read(s.getString("path"))
                            assertTrue(label, r is ReadResult.Bytes)
                            r as ReadResult.Bytes
                            assertEquals(label, "bytes", expect)
                            assertTrue(label, r.bytes.contentEquals(bytesOf(s)))
                            if (s.has("etagIs")) assertEquals(label, etag(s.getString("etagIs")), r.etag)
                            if (s.has("save")) saved[s.getString("save")] = r.etag
                        } catch (e: LibraryException) {
                            assertEquals(label, expect, e.code)
                        }
                    }
                    "remove" -> {
                        val outcome = try {
                            fs.remove(s.getString("path"), if (s.has("ifMatch")) etag(s.getString("ifMatch")) else null)
                            "ok"
                        } catch (e: LibraryException) {
                            e.code
                        }
                        assertEquals(label, s.getString("expect"), outcome)
                    }
                    "list" -> {
                        val got = fs.list(s.getString("dir"))
                        val want = s.getJSONArray("paths").let { a -> (0 until a.length()).map { a.getString(it) } }.sorted()
                        assertEquals(label, want, got.map { it.path }.sorted())
                        s.optJSONObject("etags")?.let { e -> e.keys().forEach { k -> assertEquals(label, etag(e.getString(k)), got.first { it.path == k }.etag) } }
                    }
                    "conflictVersions" -> assertEquals(label, s.getJSONArray("texts").length(), fs.conflictVersions(s.getString("path")).size)
                    "resolveConflicts" -> fs.resolveConflicts(s.getString("path"), emptyList())
                    else -> fail("unknown step $label")
                }
            }
            ran++
        }
        assertTrue(ran >= 8)
    }

    @Test
    fun invalidPathsAreRefused() {
        val fs = FolderFs(Files.createTempDirectory("fs-contract").toFile())
        val bad = contract.getJSONArray("invalidPaths")
        for (i in 0 until bad.length()) {
            val p = bad.getString(i)
            for (op in listOf<() -> Unit>({ fs.read(p) }, { fs.write(p, ByteArray(1), IfMatch.Any) }, { fs.remove(p) }, { if (p.isNotEmpty()) fs.list(p) else throw LibraryException("invalid_path", "") })) {
                try {
                    op()
                    fail("accepted ${JSONArray(listOf(p))}")
                } catch (e: LibraryException) {
                    assertEquals("invalid_path", e.code)
                }
            }
        }
    }
}
