// The Tasks and Calendar tabs' words (TasksScreens.kt, CalendarScreens.kt) as the web's phone layout writes them,
// and the task line and view chips drawn headless on Robolectric.
package com.folevi.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.folevi.android.design.FoleviTheme
import com.folevi.android.design.ViewChip
import com.folevi.engine.generated.CalendarEvent
import com.folevi.engine.generated.TaskCounts
import com.folevi.engine.generated.TaskParseValue
import com.folevi.engine.generated.TaskRow
import com.folevi.engine.generated.TaskViewName
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = android.app.Application::class, qualifiers = "w411dp-h891dp")
class TasksScreensTest {
    @get:Rule val compose = createComposeRule()

    private val us = Locale.US
    // A Wednesday.
    private val today = LocalDate.of(2026, 11, 25)

    private fun task(
        title: String = "Book the ryokan",
        due: String? = null,
        time: String? = null,
        overdue: Boolean = false,
        status: String = "open",
        priority: String? = null,
        assignee: String? = null,
        repeat: String? = null,
        note: String = "Kyoto in November",
    ) = TaskRow(
        id = "t1", noteId = "n1", noteTitle = note, noteIcon = null, title = title, status = status, dueDate = due, dueTime = time,
        priority = priority, assigneeId = assignee?.let { "u1" }, assigneeName = assignee, reminderAt = null, repeat = repeat,
        completedAt = null, updatedAt = 0.0, overdue = overdue,
    )

    @Test fun dueDatesInWords() {
        assertEquals("Today", dueLabel(today, today, us))
        assertEquals("Tomorrow", dueLabel(today.plusDays(1), today, us))
        assertEquals("Yesterday", dueLabel(today.minusDays(1), today, us))
        assertEquals("Saturday", dueLabel(today.plusDays(3), today, us))
        assertEquals("Thu, Dec 10", dueLabel(today.plusDays(15), today, us))
        assertEquals("Jan 4, 2027", dueLabel(LocalDate.of(2027, 1, 4), today, us))
    }

    @Test fun theMetaLinesRules() {
        // Late: "Overdue · " first, with the day and time, even where only times show.
        assertEquals("Overdue · Yesterday " + timeLabel("15:00", us), taskMeta(task(due = "2026-11-24", time = "15:00", overdue = true), today, timeOnly = true, showNote = false, locale = us))
        // Today and Upcoming: only the time.
        assertEquals(timeLabel("09:30", us), taskMeta(task(due = "2026-11-25", time = "09:30"), today, timeOnly = true, showNote = false, locale = us))
        assertNull(taskMeta(task(due = "2026-11-25"), today, timeOnly = true, showNote = false, locale = us))
        // Elsewhere: the day; then the note (when asked), the assignee and the priority in words.
        assertEquals("Friday · Kyoto in November · Mia · High priority", taskMeta(task(due = "2026-11-27", priority = "high", assignee = "Mia"), today, timeOnly = false, showNote = true, locale = us))
        assertEquals("Low priority", taskMeta(task(priority = "low"), today, timeOnly = false, showNote = false, locale = us))
        assertNull(taskMeta(task(priority = "none"), today, timeOnly = false, showNote = false, locale = us))
    }

    @Test fun dayHeadersFilterAndClosedTasks() {
        assertEquals("Today" to "Nov 25", dayHeader(today, today, us))
        assertEquals("Monday" to "Nov 30", dayHeader(today.plusDays(5), today, us))
        assertEquals("No date" to null, dayHeader(null, today, us))
        assertTrue(taskMatches(task(), "ryokan"))
        assertTrue(taskMatches(task(), "KYOTO"))
        assertFalse(taskMatches(task(), "rail"))
        assertTrue(isClosed(task(status = "done")))
        assertTrue(isClosed(task(status = "canceled")))
        assertFalse(isClosed(task()))
    }

    @Test fun chipsInTheWebsOrderWithCounts() {
        assertEquals(listOf("Today", "Inbox", "Upcoming", "All", "Mine", "Done"), TASK_CHIPS.map { it.label })
        val counts = TaskCounts(inbox = 2, today = 3, upcoming = 4, all = 9, mine = 1)
        assertEquals(3L, chipCount(TaskViewName.TODAY, counts))
        assertEquals(1L, chipCount(TaskViewName.MINE, counts))
        assertNull(chipCount(TaskViewName.COMPLETED, counts))
    }

    @Test fun quickAddPreviewSaysWhatItRead() {
        val p = TaskParseValue(title = "Call Mia", dueDate = "2026-11-27", dueTime = null, dateText = "fri", repeatLabel = "Every week", repeatText = "weekly")
        assertEquals(listOf("Due Friday, from “fri”", "Repeats every week, from “weekly”"), parsePreview(p, today, us))
        assertEquals(emptyList<String>(), parsePreview(null, today, us))
        assertEquals(emptyList<String>(), parsePreview(TaskParseValue("x", null, null, null, null, null), today, us))
    }

    @Test fun calendarWords() {
        assertEquals("November", calendarTitle(today, today, us))
        assertEquals("January 2027", calendarTitle(LocalDate.of(2027, 1, 3), today, us))
        assertEquals("Today" to "Wednesday, Nov 25", agendaHeader(today, today, us))
        assertEquals("Friday" to "Nov 27", agendaHeader(today.plusDays(2), today, us))
        assertEquals(LocalDate.of(2026, 11, 23), weekStart(today))
        val allDay = CalendarEvent("e", "c", "Home", "moss", "Holiday", "", "", today.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(), 0, allDay = true)
        assertEquals(today, eventDay(allDay))
        assertEquals("All day", eventWhen(allDay))
    }

    @Test fun theTaskLineDrawsTheWebsRow() {
        var opened = 0
        compose.setContent {
            FoleviTheme(dark = false) {
                TaskLine(task(due = "2026-11-27", priority = "high"), timeOnly = false, showNote = false, today = LocalDate.now(), onOpen = { opened++ }, onLongPress = {}, onToggle = {})
            }
        }
        compose.onNodeWithText("Book the ryokan").assertIsDisplayed().performClick()
        assertEquals(1, opened)
        compose.onNodeWithContentDescription("Book the ryokan").assertIsDisplayed()
    }

    @Test fun aViewChipShowsItsCountAndSelection() {
        compose.setContent { FoleviTheme(dark = false) { ViewChip("Today", selected = true, onClick = {}, count = 3) } }
        compose.onNodeWithContentDescription("Today").assertIsSelected()
        compose.onNodeWithText("3").assertIsDisplayed()
    }
}
