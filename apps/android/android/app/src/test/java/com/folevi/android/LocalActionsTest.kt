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
