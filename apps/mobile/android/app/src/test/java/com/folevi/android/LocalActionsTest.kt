package com.folevi.android

import com.folevi.android.extras.LocalActions
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.nio.file.Files

class LocalActionsTest {
    private fun queue() = LocalActions.at(File(Files.createTempDirectory("local-actions").toFile(), "q.json"))

    @Test
    fun keepsCheckOffsUntilThePageFinishesThem() {
        val q = queue()
        val a = q.toggleTask("task-a", true)
        q.toggleTask("task-b", true)
        assertEquals(2, q.pending().length())
        assertEquals(setOf("task-a", "task-b"), q.doneTaskIds())
        q.finish(a)
        assertEquals(setOf("task-b"), q.doneTaskIds())
        val first = q.pending().getJSONObject(0)
        assertEquals("toggleTask", first.getString("kind"))
        assertEquals("task-b", first.getString("taskId"))
        assertEquals(true, first.getBoolean("completed"))
    }

    @Test
    fun eachPlacesPageTakesOnlyItsOwn() {
        // Several places: the library's check-offs (no place) for the library's page, an account's for that account.
        val f = File(Files.createTempDirectory("local-actions").toFile(), "q.json")
        f.writeText("""[{"id":"1","kind":"toggleTask","taskId":"t","completed":true},{"id":"2","kind":"addTask","text":"Buy milk","place":"acct:ana"}]""")
        val q = LocalActions.at(f)
        assertEquals(listOf("1"), (0 until q.pendingFor("library").length()).map { q.pendingFor("library").getJSONObject(it).getString("id") })
        assertEquals(listOf("2"), (0 until q.pendingFor("acct:ana").length()).map { q.pendingFor("acct:ana").getJSONObject(it).getString("id") })
        assertEquals(0, q.pendingFor("acct:ben").length())
        // No place open yet (the sign-in screen): nothing.
        assertEquals(0, q.pendingFor(null).length())
    }

    @Test
    fun theSameTaskTwiceKeepsTheLastWord() {
        val q = queue()
        q.toggleTask("task-a", true)
        q.toggleTask("task-a", false)
        assertEquals(1, q.pending().length())
        assertEquals(emptySet<String>(), q.doneTaskIds())
    }

    @Test
    fun aBrokenOrMissingFileIsAnEmptyQueueAndItStaysSmall() {
        val f = File(Files.createTempDirectory("local-actions").toFile(), "q.json")
        f.writeText("{not json")
        val q = LocalActions.at(f)
        assertEquals(0, q.pending().length())
        repeat(LocalActions.MAX + 20) { q.toggleTask("t$it", true) }
        assertEquals(LocalActions.MAX, q.pending().length())
        assertEquals("t20", q.pending().getJSONObject(0).getString("taskId"))
        q.clear()
        assertEquals(0, q.pending().length())
    }
}
