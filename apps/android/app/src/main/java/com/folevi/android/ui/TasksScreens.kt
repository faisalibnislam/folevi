// The Tasks tab as the web's phone layout draws it (apps/web/src/components/iphone/Tasks.tsx, TaskSheet.tsx,
// QuickAddSheet.tsx): the view chips with counts, a filter, tasks grouped by note (or by day on Upcoming) with
// foldable headers, the web's task line (its own check box, held 420 ms before the task leaves, the meta line's
// rules), swipe actions and a long-press menu; a task opens its sheet; + opens Quick add. Folevi's colors, type
// and shadows (design/PhoneKit.kt), Android's ripple, Material for sheets, menus and pickers.
package com.folevi.android.ui

import androidx.compose.ui.semantics.heading

import androidx.compose.ui.state.ToggleableState

import androidx.compose.foundation.selection.triStateToggleable

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.folevi.android.design.AvatarButton
import com.folevi.android.design.FilterField
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.GlassPill
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneRadius
import com.folevi.android.design.PhoneScreen
import com.folevi.android.design.PhoneType
import com.folevi.android.design.PillButton
import com.folevi.android.design.Placeholder
import com.folevi.android.design.ScreenEmpty
import com.folevi.android.design.SwipeAction
import com.folevi.android.design.SwipeRow
import com.folevi.android.design.ViewChip
import com.folevi.android.design.WebIcon
import com.folevi.android.design.phoneColors
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.TaskCounts
import com.folevi.engine.generated.TaskCreateArgs
import com.folevi.engine.generated.TaskGroup
import com.folevi.engine.generated.TaskParseValue
import com.folevi.engine.generated.TaskRow
import com.folevi.engine.generated.TaskUpdateArgs
import com.folevi.engine.generated.TaskViewName
import com.folevi.engine.generated.Views
import com.folevi.engine.protocol.Patch
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch

// ---------------------------------------------------------------- words (pure, unit-tested)

/** The web's task views, in its order, with their chip labels and icons. Completed has no count. */
internal data class TaskViewChip(val view: TaskViewName, val label: String, val icon: WebIcon)

internal val TASK_CHIPS = listOf(
    TaskViewChip(TaskViewName.TODAY, "Today", WebIcon.SUN),
    TaskViewChip(TaskViewName.INBOX, "Inbox", WebIcon.INBOX),
    TaskViewChip(TaskViewName.UPCOMING, "Upcoming", WebIcon.CALENDAR_DAYS),
    TaskViewChip(TaskViewName.ALL, "All", WebIcon.LIST_TODO),
    TaskViewChip(TaskViewName.MINE, "Mine", WebIcon.USERS),
    TaskViewChip(TaskViewName.COMPLETED, "Done", WebIcon.CIRCLE_CHECK),
)

internal fun chipCount(view: TaskViewName, counts: TaskCounts?): Long? = when (view) {
    TaskViewName.TODAY -> counts?.today
    TaskViewName.INBOX -> counts?.inbox
    TaskViewName.UPCOMING -> counts?.upcoming
    TaskViewName.ALL -> counts?.all
    TaskViewName.MINE -> counts?.mine
    TaskViewName.COMPLETED -> null
}

/** A due date in words: Today, Tomorrow, Yesterday, a weekday within the week ahead, else "Mon, Oct 24". */
internal fun dueLabel(date: LocalDate, today: LocalDate, locale: Locale = Locale.getDefault()): String {
    val days = ChronoUnit.DAYS.between(today, date)
    return when {
        days == 0L -> "Today"
        days == 1L -> "Tomorrow"
        days == -1L -> "Yesterday"
        days in 2..6 -> date.dayOfWeek.getDisplayName(TextStyle.FULL, locale)
        date.year == today.year -> "${date.dayOfWeek.getDisplayName(TextStyle.SHORT, locale)}, ${date.month.getDisplayName(TextStyle.SHORT, locale)} ${date.dayOfMonth}"
        else -> "${date.month.getDisplayName(TextStyle.SHORT, locale)} ${date.dayOfMonth}, ${date.year}"
    }
}

/** "15:00" in the person's clock ("3:00 PM" or "15:00"). */
internal fun timeLabel(time: String, locale: Locale = Locale.getDefault()): String =
    runCatching { LocalTime.parse(time).format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale)) }.getOrDefault(time)

internal fun priorityWords(priority: String?): String? = when (priority) {
    "high" -> "High priority"
    "medium" -> "Medium priority"
    "low" -> "Low priority"
    else -> null
}

/**
 * The meta line under a task (Tasks.tsx TaskLine): the due part (with "Overdue · " first when late; on Today and
 * Upcoming, or in a day of the calendar, only the time unless it's late), the note (when asked), the assignee and
 * the priority in words, joined with " · ". Null when there's nothing to say.
 */
internal fun taskMeta(t: TaskRow, today: LocalDate, timeOnly: Boolean, showNote: Boolean, locale: Locale = Locale.getDefault()): String? {
    val parts = mutableListOf<String>()
    val date = t.dueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    val time = t.dueTime?.let { timeLabel(it, locale) }
    when {
        t.overdue && date != null -> parts += "Overdue · " + listOfNotNull(dueLabel(date, today, locale), time).joinToString(" ")
        timeOnly -> if (time != null) parts += time
        date != null -> parts += listOfNotNull(dueLabel(date, today, locale), time).joinToString(" ")
    }
    if (showNote && t.noteTitle.isNotBlank()) parts += t.noteTitle
    t.assigneeName?.takeIf { it.isNotBlank() }?.let { parts += it }
    priorityWords(t.priority)?.let { parts += it }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

/** A day group's header (Upcoming): "Today", "Tomorrow" or the weekday, then " · Oct 24" (null: no date). */
internal fun dayHeader(date: LocalDate?, today: LocalDate, locale: Locale = Locale.getDefault()): Pair<String, String?> {
    if (date == null) return "No date" to null
    val days = ChronoUnit.DAYS.between(today, date)
    val main = when (days) {
        0L -> "Today"
        1L -> "Tomorrow"
        -1L -> "Yesterday"
        else -> date.dayOfWeek.getDisplayName(TextStyle.FULL, locale)
    }
    val rest = "${date.month.getDisplayName(TextStyle.SHORT, locale)} ${date.dayOfMonth}" + if (date.year != today.year) ", ${date.year}" else ""
    return main to rest
}

/** Whether a task passes the filter (its title or its note's). */
internal fun taskMatches(t: TaskRow, filter: String): Boolean {
    val q = filter.trim()
    return q.isEmpty() || t.title.contains(q, ignoreCase = true) || t.noteTitle.contains(q, ignoreCase = true)
}

internal fun isClosed(t: TaskRow) = t.status == "done" || t.status == "canceled"

/** The quick-add preview lines (QuickAddSheet): "Due Friday, from "fri"", "Repeats every week, from "weekly"". */
internal fun parsePreview(p: TaskParseValue?, today: LocalDate, locale: Locale = Locale.getDefault()): List<String> {
    if (p == null) return emptyList()
    val out = mutableListOf<String>()
    val date = p.dueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    if (date != null && p.dateText != null) {
        val label = listOfNotNull(dueLabel(date, today, locale), p.dueTime?.let { timeLabel(it, locale) }).joinToString(" ")
        out += "Due $label, from “${p.dateText}”"
    }
    val repeat = p.repeatLabel
    val repeatText = p.repeatText
    if (repeat != null && repeatText != null) out += "Repeats ${repeat.replaceFirstChar { c -> c.lowercase(locale) }}, from “$repeatText”"
    return out
}

private fun epochDayMillis(d: LocalDate) = d.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
private fun dateOfMillis(ms: Long) = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()

// ---------------------------------------------------------------- Tasks

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TasksHome(open: (Route) -> Unit) {
    val p = LocalPalette.current
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var view by rememberSaveable { mutableStateOf(TaskViewName.TODAY) }
    var filter by rememberSaveable { mutableStateOf("") }
    // Folded groups, "view|group" each (the web keeps them per view and group).
    var folded by rememberSaveable { mutableStateOf("") }
    val foldedSet = folded.split('\n').filter { it.isNotEmpty() }.toSet()
    val tasks by rememberView(Views.tasksList(view = view), key = view)
    val counts by rememberView(Views.tasksCounts())
    var sheet by remember { mutableStateOf<TaskRow?>(null) }
    var menuOpen by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val today = LocalDate.now()
    val chips = rememberLazyListState()
    LaunchedEffect(view) { chips.animateScrollToItem(TASK_CHIPS.indexOfFirst { it.view == view }.coerceAtLeast(0)) }

    val update: (TaskRow, String) -> Unit = { t, what ->
        scope.launch {
            runCatching {
                when (what) {
                    "done" -> session.client.command(Commands.taskUpdate(id = t.id, checked = true))
                    "reopen" -> session.client.command(Commands.taskUpdate(id = t.id, checked = false, canceled = false))
                    "tomorrow" -> {
                        session.client.command(Commands.taskUpdate(id = t.id, dueDate = Patch.Set(today.plusDays(1).toString())))
                        val r = snackbar.showSnackbar("Moved to tomorrow", actionLabel = "Undo", duration = SnackbarDuration.Short)
                        if (r == SnackbarResult.ActionPerformed) {
                            session.client.command(Commands.taskUpdate(id = t.id, dueDate = t.dueDate?.let { Patch.Set(it) } ?: Patch.Clear))
                        }
                    }
                }
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        PhoneScreen(
            title = "Tasks",
            leading = { AvatarButton(rememberView(com.folevi.engine.generated.Views.session()).value.value?.profile?.name ?: "", onClick = LocalPhoneSheets.current.account) },
            trailing = {
                Box {
                    GlassPill {
                        PillButton("More", onClick = { menuOpen = true }) { FoleviIcon(WebIcon.ELLIPSIS, null, size = 24.dp, tint = p.ink) }
                    }
                    PhoneMenu(menuOpen, { menuOpen = false }) {
                        DropdownMenuItem(text = { Text("Calendar") }, leadingIcon = { FoleviIcon(WebIcon.CALENDAR_DAYS, null) }, onClick = { menuOpen = false; open(CalendarRoute) })
                        DropdownMenuItem(text = { Text("Completed tasks") }, leadingIcon = { FoleviIcon(WebIcon.CIRCLE_CHECK, null) }, onClick = { menuOpen = false; view = TaskViewName.COMPLETED })
                    }
                }
            },
            header = {
                LazyRow(
                    state = chips,
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.testTag("task-views"),
                ) {
                    items(TASK_CHIPS, key = { it.view.value }) { c ->
                        ViewChip(c.label, selected = view == c.view, onClick = { view = c.view }, icon = c.icon, count = chipCount(c.view, counts.value))
                    }
                }
                FilterField(filter, { filter = it }, "Filter by task or note")
            },
        ) {
            val v = tasks.value
            when {
                v == null && tasks.error != null -> item(key = "error") {
                    ScreenEmpty(WebIcon.CIRCLE_ALERT, "Tasks didn't load", tasks.error?.message, action = {
                        TextButton(onClick = { view = view }) { Text("Try again", color = p.heading) }
                    })
                }
                v == null -> items(5) { Placeholder(52.dp, Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) }
                else -> {
                    val groups = v.groups.map { g -> g to g.tasks.filter { taskMatches(it, filter) } }.filter { it.second.isNotEmpty() }
                    if (groups.isEmpty()) {
                        item(key = "empty") { TasksEmpty(view, filter.isNotBlank()) }
                    }
                    for ((g, rows) in groups) {
                        val key = "${view.value}|${g.id}"
                        val isFolded = key in foldedSet
                        item(key = "h" + g.id) {
                            TaskGroupHeader(g, today, folded = isFolded, count = rows.size, onFold = {
                                folded = (if (isFolded) foldedSet - key else foldedSet + key).joinToString("\n")
                            }, onOpenNote = { g.tasks.firstOrNull()?.let { open(NoteRoute(it.noteId, it.noteTitle)) } })
                        }
                        if (!isFolded) {
                            items(rows, key = { it.id }) { t ->
                                TaskSwipeLine(
                                    t,
                                    timeOnly = view == TaskViewName.TODAY || view == TaskViewName.UPCOMING,
                                    showNote = view == TaskViewName.UPCOMING,
                                    today = today,
                                    onOpen = { sheet = t },
                                    onAction = { what -> if (what == "date") sheet = t else update(t, what) },
                                    onOpenNote = { open(NoteRoute(t.noteId, t.noteTitle)) },
                                )
                            }
                        }
                        item(key = "s" + g.id) { Spacer(Modifier.height(16.dp)) }
                    }
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp))
    }
    sheet?.let { t -> TaskSheet(t, onDismiss = { sheet = null }, openNote = { sheet = null; open(NoteRoute(t.noteId, t.noteTitle)) }) }
}

@Composable
private fun TasksEmpty(view: TaskViewName, filtered: Boolean) {
    val (title, body) = when {
        filtered -> "No matching tasks" to "No task or note matches that filter."
        view == TaskViewName.TODAY -> "Nothing for today" to "Tasks due today show up here."
        view == TaskViewName.INBOX -> "Inbox is empty" to "Tasks without a date or note land here."
        view == TaskViewName.UPCOMING -> "Nothing coming up" to "Tasks with a due date show up here."
        view == TaskViewName.COMPLETED -> "Nothing done yet" to "Tasks you finish show up here."
        view == TaskViewName.MINE -> "Nothing assigned to you" to "Tasks assigned to you show up here."
        else -> "No tasks yet" to "Add a to-do in any note, or tap + to add one."
    }
    ScreenEmpty(if (view == TaskViewName.TODAY) WebIcon.SUN else WebIcon.SQUARE_CHECK_BIG, title, body)
}

@Composable
private fun TaskGroupHeader(g: TaskGroup, today: LocalDate, folded: Boolean, count: Int, onFold: () -> Unit, onOpenNote: () -> Unit) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (g.kind == TaskGroup.Kind.NOTE) {
            Row(Modifier.weight(1f).clickable(role = Role.Button, onClick = onOpenNote), verticalAlignment = Alignment.CenterVertically) {
                FoleviIcon(WebIcon.FILE_TEXT, null, size = 17.dp, tint = p.inkMuted)
                Spacer(Modifier.width(8.dp))
                Text(g.title.ifBlank { "Untitled" }, style = PhoneType.headline, color = p.heading, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false).semantics { heading() })
                FoleviIcon(WebIcon.CHEVRON_RIGHT, null, size = 15.dp, tint = p.inkFaint, modifier = Modifier.padding(start = 2.dp))
            }
        } else {
            val date = runCatching { LocalDate.parse(g.id) }.getOrNull()
            val (main, rest) = if (date != null || g.title.isBlank()) dayHeader(date, today) else g.title to null
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Text(main, style = PhoneType.headline, color = p.heading, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
                if (rest != null) Text(" · $rest", style = PhoneType.body, color = p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (folded) Text("$count", style = PhoneType.subheadline, color = p.inkMuted)
        val turn by animateFloatAsState(if (folded) -90f else 0f, com.folevi.android.design.Motion.fastSpatial(), label = "fold")
        Box(
            Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = if (folded) "Show" else "Hide", onClick = onFold)
                .semantics { contentDescription = if (folded) "Show ${g.title}" else "Hide ${g.title}" },
            contentAlignment = Alignment.Center,
        ) { FoleviIcon(WebIcon.CHEVRON_DOWN, null, size = 18.dp, tint = p.inkFaint, modifier = Modifier.graphicsLayer { rotationZ = turn }) }
    }
}

/** The swipe actions and long-press menu around a task line (Done or Reopen; Tomorrow and Date). */
@Composable
internal fun TaskSwipeLine(
    t: TaskRow,
    timeOnly: Boolean,
    showNote: Boolean,
    today: LocalDate,
    onOpen: () -> Unit,
    onAction: (String) -> Unit,
    onOpenNote: () -> Unit,
) {
    val closed = isClosed(t)
    var menu by remember { mutableStateOf(false) }
    val leading = listOf(if (closed) SwipeAction("Reopen", WebIcon.ROTATE_CCW, LocalPalette.current.swipeArchive) { onAction("reopen") } else SwipeAction("Done", WebIcon.CHECK, LocalPalette.current.swipeRestore) { onAction("done") })
    val trailing = if (closed) emptyList() else listOf(
        SwipeAction("Tomorrow", WebIcon.SUN, LocalPalette.current.swipeBookmark) { onAction("tomorrow") },
        SwipeAction("Date", WebIcon.CALENDAR_DAYS, LocalPalette.current.swipeDate) { onAction("date") },
    )
    Box {
        SwipeRow(leading, trailing) {
            TaskLine(t, timeOnly, showNote, today, onOpen = onOpen, onLongPress = { menu = true }, onToggle = { onAction(if (closed) "reopen" else "done") })
        }
        val p = LocalPalette.current
        PhoneMenu(menu, { menu = false }) {
            if (closed) DropdownMenuItem(text = { Text("Reopen") }, leadingIcon = { FoleviIcon(WebIcon.ROTATE_CCW, null) }, onClick = { menu = false; onAction("reopen") })
            else {
                DropdownMenuItem(text = { Text("Done") }, leadingIcon = { FoleviIcon(WebIcon.CHECK, null) }, onClick = { menu = false; onAction("done") })
                DropdownMenuItem(text = { Text("Tomorrow") }, leadingIcon = { FoleviIcon(WebIcon.SUN, null) }, onClick = { menu = false; onAction("tomorrow") })
                DropdownMenuItem(text = { Text("Date") }, leadingIcon = { FoleviIcon(WebIcon.CALENDAR_DAYS, null) }, onClick = { menu = false; onAction("date") })
            }
            DropdownMenuItem(text = { Text("Open note") }, leadingIcon = { FoleviIcon(WebIcon.FILE_TEXT, null) }, onClick = { menu = false; onOpenNote() })
        }
    }
}

/**
 * The web's task line (TaskLine): its own 22 box, the title (closed tasks muted and struck through) and the meta
 * line (danger when overdue). A tap on the box shows it checked at once; the task stays 420 ms before it goes.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun TaskLine(t: TaskRow, timeOnly: Boolean, showNote: Boolean, today: LocalDate, onOpen: () -> Unit, onLongPress: () -> Unit, onToggle: () -> Unit) {
    val p = LocalPalette.current
    val scope = rememberCoroutineScope()
    var held by remember(t.id, t.status) { mutableStateOf(false) }
    val closed = isClosed(t)
    val shownDone = if (held) !closed else t.status == "done"
    val meta = taskMeta(t, today, timeOnly, showNote)
    val c = phoneColors()
    Row(
        Modifier.fillMaxWidth().combinedClickable(role = Role.Button, onClick = onOpen, onLongClickLabel = "More actions", onLongClick = onLongPress)
            .padding(start = 20.dp).testTag("task-${t.id}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TaskBox(
            done = shownDone,
            canceled = !held && t.status == "canceled",
            onClick = {
                if (!held) {
                    held = true
                    scope.launch { delay(420); onToggle() }
                }
            },
            label = t.title,
        )
        Spacer(Modifier.width(12.dp - 11.dp))
        Column(
            Modifier.weight(1f).heightIn(min = if (meta != null) 64.dp else 52.dp)
                .drawBehind { drawLine(c.separator, Offset(0f, size.height), Offset(size.width, size.height), 0.5.dp.toPx()) }
                .padding(end = 16.dp, top = if (meta != null) 10.dp else 15.dp, bottom = if (meta != null) 10.dp else 15.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                t.title.ifBlank { "Untitled task" },
                style = PhoneType.body.copy(textDecoration = if (closed) TextDecoration.LineThrough else null),
                color = if (closed) p.inkMuted else p.ink,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            if (meta != null || t.repeat != null) {
                Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    val tint = if (t.overdue && !closed) p.destructive else p.inkMuted
                    if (t.repeat != null) FoleviIcon(WebIcon.REPEAT, "Repeats", size = 13.dp, tint = tint, modifier = Modifier.padding(end = 4.dp))
                    if (meta != null) Text(meta, style = PhoneType.subheadline, color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/** The web's check box: 22, radius 6, a 1.5 ink-34% edge; done is filled in `heading` with a `canvas` tick. */
@Composable
internal fun TaskBox(done: Boolean, canceled: Boolean, onClick: () -> Unit, label: String) {
    val p = LocalPalette.current
    val c = phoneColors()
    val draw by animateFloatAsState(if (done) 1f else 0f, com.folevi.android.design.Motion.fastEffects(), label = "tick")
    Box(
        Modifier.offset(x = (-11).dp).size(44.dp).clip(CircleShape)
            .triStateToggleable(state = if (done) ToggleableState.On else ToggleableState.Off, role = Role.Checkbox, onClick = onClick)
            .semantics { contentDescription = label; if (canceled) stateDescription = "Canceled" },
        contentAlignment = Alignment.Center,
    ) {
        val shape = RoundedCornerShape(6.dp)
        Box(
            Modifier.size(22.dp).clip(shape)
                .background(if (done) p.heading else if (canceled) p.surfaceSunken else Color.Transparent)
                .border(1.5.dp, if (done) p.heading else if (canceled) p.lineStrong else c.ink(0.34f), shape)
                .drawBehind {
                    if (draw > 0f) {
                        // "M6.4 11.6 9.6 14.7 15.8 7.9" on a 22 box, drawn in.
                        val k = size.width / 22f
                        val a = Offset(6.4f * k, 11.6f * k); val b = Offset(9.6f * k, 14.7f * k); val e = Offset(15.8f * k, 7.9f * k)
                        val first = 0.35f
                        val s = 2.3.dp.toPx()
                        if (draw <= first) drawLine(p.canvas, a, a + (b - a) * (draw / first), s, StrokeCap.Round)
                        else {
                            drawLine(p.canvas, a, b, s, StrokeCap.Round)
                            drawLine(p.canvas, b, b + (e - b) * ((draw - first) / (1f - first)), s, StrokeCap.Round)
                        }
                    } else if (canceled) {
                        drawLine(p.inkFaint, Offset(size.width / 2 - 5.dp.toPx(), size.height / 2), Offset(size.width / 2 + 5.dp.toPx(), size.height / 2), 1.5.dp.toPx(), StrokeCap.Round)
                    }
                },
        )
    }
}

// ---------------------------------------------------------------- the task's sheet

private enum class TaskStatus(val label: String) { OPEN("Open"), DONE("Done"), CANCELED("Canceled") }

/** The sheets' Folevi surface: the web's solid sheet fill, top corners 28. */
@Composable
internal fun sheetColor(): Color = phoneColors().solid

/** A task's sheet (TaskSheet.tsx): status, dates, priority, assignee, repeats and the note it's in. Saves at once. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskSheet(task: TaskRow, onDismiss: () -> Unit, openNote: () -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var t by remember(task.id) { mutableStateOf(task) }
    var error by remember { mutableStateOf<String?>(null) }
    val members by rememberView(Views.members())
    val today = LocalDate.now()
    // Every change saves at once; a failed save puts the old values back.
    val save: (TaskRow, suspend () -> Unit) -> Unit = { next, call ->
        val before = t
        t = next
        scope.launch { runCatching { call() }.onFailure { t = before; error = "Folevi couldn't save that change." } }
    }
    var pickDate by remember { mutableStateOf(false) }
    var pickTime by remember { mutableStateOf(false) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = sheetColor(),
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = { Box(Modifier.padding(top = 5.dp).size(36.dp, 5.dp).clip(CircleShape).background(c.ink(0.22f))) },
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Text("Task", style = PhoneType.headline, color = p.ink, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            Row(verticalAlignment = Alignment.CenterVertically) {
                TaskBox(done = t.status == "done", canceled = t.status == "canceled", label = t.title, onClick = {
                    val done = t.status != "done"
                    save(t.copy(status = if (done) "done" else "open")) { session.client.command(Commands.taskUpdate(id = t.id, checked = done)) }
                })
                Text(t.title.ifBlank { "Untitled task" }, style = PhoneType.body.copy(fontWeight = FontWeight.Medium), color = p.heading)
            }
            val status = when (t.status) { "done" -> TaskStatus.DONE; "canceled" -> TaskStatus.CANCELED; else -> TaskStatus.OPEN }
            Segmented(TaskStatus.entries.map { it.label }, status.ordinal) { i ->
                when (TaskStatus.entries[i]) {
                    TaskStatus.OPEN -> save(t.copy(status = "open")) { session.client.command(Commands.taskUpdate(id = t.id, checked = false, canceled = false)) }
                    TaskStatus.DONE -> save(t.copy(status = "done")) { session.client.command(Commands.taskUpdate(id = t.id, checked = true)) }
                    TaskStatus.CANCELED -> save(t.copy(status = "canceled")) { session.client.command(Commands.taskUpdate(id = t.id, canceled = true)) }
                }
            }
            // Dates.
            SheetGroup {
                val date = t.dueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
                val dateText = date?.let { d -> dueLabel(d, today).let { l -> if (l == "Today" || l == "Tomorrow") "$l, ${d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault())} ${d.month.getDisplayName(TextStyle.SHORT, Locale.getDefault())} ${d.dayOfMonth}" else l } } ?: "None"
                SheetRow(WebIcon.CALENDAR_DAYS, "Date", dateText, valueColor = if (t.overdue) p.destructive else p.inkMuted) { pickDate = true }
                if (date != null) {
                    SheetSeparator()
                    SheetRow(WebIcon.CLOCK, "Time", t.dueTime?.let { timeLabel(it) } ?: "All day") { pickTime = true }
                }
                SheetSeparator()
                Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((label, d) in listOf("Today" to today, "Tomorrow" to today.plusDays(1), "Next week" to today.with(java.time.temporal.TemporalAdjusters.next(DayOfWeek.MONDAY)))) {
                        val on = t.dueDate == d.toString()
                        Box(
                            Modifier.heightIn(min = 34.dp).clip(CircleShape).background(if (on) p.heading else c.ink(0.07f))
                                .clickable(role = Role.Button) { save(t.copy(dueDate = d.toString(), overdue = false)) { session.client.command(Commands.taskUpdate(id = t.id, dueDate = Patch.Set(d.toString()))) } }
                                .padding(horizontal = 14.dp, vertical = 7.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text(label, style = PhoneType.subheadline.copy(fontWeight = FontWeight.Medium), color = if (on) p.canvas else p.ink) }
                    }
                }
            }
            // Priority, assignee, repeats.
            SheetGroup {
                var priorityMenu by remember { mutableStateOf(false) }
                Box {
                    SheetRow(WebIcon.FLAG, "Priority", t.priority?.takeIf { it != "none" }?.replaceFirstChar { it.uppercase() } ?: "None") { priorityMenu = true }
                    PhoneMenu(priorityMenu, { priorityMenu = false }) {
                        for (pr in TaskUpdateArgs.Priority.entries) {
                            DropdownMenuItem(
                                text = { Text(pr.value.replaceFirstChar { it.uppercase() }) },
                                leadingIcon = { FoleviIcon(WebIcon.FLAG, null, tint = priorityColor(pr.value, p) ?: p.inkMuted) },
                                trailingIcon = { if ((t.priority ?: "none") == pr.value) FoleviIcon(WebIcon.CHECK, null) },
                                onClick = {
                                    priorityMenu = false
                                    save(t.copy(priority = pr.value.takeIf { it != "none" })) { session.client.command(Commands.taskUpdate(id = t.id, priority = pr)) }
                                },
                            )
                        }
                    }
                }
                val people = members.value?.members.orEmpty()
                if (people.size > 1) {
                    SheetSeparator()
                    var assignMenu by remember { mutableStateOf(false) }
                    Box {
                        SheetRow(WebIcon.USERS, "Assignee", t.assigneeName ?: "Nobody") { assignMenu = true }
                        PhoneMenu(assignMenu, { assignMenu = false }) {
                            DropdownMenuItem(text = { Text("Nobody") }, onClick = {
                                assignMenu = false
                                save(t.copy(assigneeId = null, assigneeName = null)) { session.client.command(Commands.taskUpdate(id = t.id, assigneeId = Patch.Clear)) }
                            })
                            for (m in people) {
                                DropdownMenuItem(
                                    text = { Text(if (m.isYou) "${m.name} (you)" else m.name) },
                                    trailingIcon = { if (t.assigneeId == m.id) FoleviIcon(WebIcon.CHECK, null) },
                                    onClick = {
                                        assignMenu = false
                                        save(t.copy(assigneeId = m.id, assigneeName = m.name)) { session.client.command(Commands.taskUpdate(id = t.id, assigneeId = Patch.Set(m.id))) }
                                    },
                                )
                            }
                        }
                    }
                }
                if (t.repeat != null) {
                    SheetSeparator()
                    SheetRow(WebIcon.REPEAT, "Repeats", t.repeat!!.replaceFirstChar { it.uppercase() }, chevron = false, onClick = null)
                }
            }
            if (t.noteTitle.isNotBlank()) {
                SheetGroup {
                    Column(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = openNote).padding(16.dp)) {
                        Text("In the note", style = PhoneType.footnote, color = p.inkMuted)
                        Text(t.noteTitle, style = PhoneType.body, color = p.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            error?.let { Text(it, style = PhoneType.subheadline, color = p.destructive) }
        }
    }
    if (pickDate) {
        DateDialog(t.dueDate, onDismiss = { pickDate = false }) { d ->
            pickDate = false
            save(t.copy(dueDate = d?.toString(), overdue = false, dueTime = if (d == null) null else t.dueTime)) {
                session.client.command(Commands.taskUpdate(id = t.id, dueDate = d?.let { Patch.Set(it.toString()) } ?: Patch.Clear, dueTime = if (d == null) Patch.Clear else Patch.Keep))
            }
        }
    }
    if (pickTime) {
        TimeDialog(t.dueTime, onDismiss = { pickTime = false }) { time ->
            pickTime = false
            save(t.copy(dueTime = time)) { session.client.command(Commands.taskUpdate(id = t.id, dueTime = time?.let { Patch.Set(it) } ?: Patch.Clear)) }
        }
    }
}

internal fun priorityColor(priority: String?, p: com.folevi.android.design.FoleviPalette = com.folevi.android.design.FoleviPalette.Light): Color? = when (priority) {
    "low" -> p.priorityLow
    "medium" -> p.priorityMedium
    "high" -> p.priorityHigh
    else -> null
}

/** The web's segmented control: a capsule track of ink 7%, the selected thumb on `canvas` with a soft shadow. */
@Composable
internal fun Segmented(labels: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    Row(Modifier.fillMaxWidth().heightIn(min = 36.dp).clip(CircleShape).background(c.ink(0.07f)).padding(2.dp)) {
        labels.forEachIndexed { i, label ->
            val on = i == selected
            Box(
                Modifier.weight(1f).heightIn(min = 32.dp)
                    .then(if (on) Modifier.dropShadowSoft().background(if (p == com.folevi.android.design.FoleviPalette.Dark) p.surfaceRaised else p.canvas, CircleShape) else Modifier)
                    .clip(CircleShape).clickable(role = Role.Tab) { onSelect(i) }
                    .semantics { contentDescription = label; this.selected = on },
                contentAlignment = Alignment.Center,
            ) {
                Text(label, style = PhoneType.subheadline.copy(fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium), color = if (on) p.heading else p.ink)
            }
        }
    }
}

/** The thumb's shadow: 0 3 8 black 12%. */
private fun Modifier.dropShadowSoft(): Modifier =
    this.dropShadow(CircleShape, androidx.compose.ui.graphics.shadow.Shadow(radius = 8.dp, offset = androidx.compose.ui.unit.DpOffset(0.dp, 3.dp), color = Color.Black.copy(alpha = 0.12f)))

/** A rounded group in a sheet (radius 18, ink 5%). */
@Composable
internal fun SheetGroup(content: @Composable () -> Unit) {
    val c = phoneColors()
    Column(Modifier.fillMaxWidth().clip(PhoneRadius.container).background(c.ink(0.05f))) { content() }
}

@Composable
internal fun SheetSeparator() {
    val c = phoneColors()
    Box(Modifier.fillMaxWidth().padding(start = 56.dp).height(0.5.dp).background(c.separator))
}

/** A sheet row: a 24-wide muted icon, the label, the value in muted, a chevron (52 tall, 16 inside). */
@Composable
internal fun SheetRow(icon: WebIcon, label: String, value: String?, valueColor: Color? = null, chevron: Boolean = true, onClick: (() -> Unit)?) {
    val p = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(24.dp), contentAlignment = Alignment.Center) { FoleviIcon(icon, null, size = 20.dp, tint = p.inkMuted) }
        Spacer(Modifier.width(16.dp))
        Text(label, style = PhoneType.body, color = p.ink, modifier = Modifier.weight(1f))
        if (value != null) Text(value, style = PhoneType.body, color = valueColor ?: p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (chevron && onClick != null) FoleviIcon(WebIcon.CHEVRON_RIGHT, null, size = 15.dp, tint = p.inkFaint, modifier = Modifier.padding(start = 6.dp))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DateDialog(current: String?, onDismiss: () -> Unit, onPick: (LocalDate?) -> Unit) {
    val p = LocalPalette.current
    val initial = current?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now()
    val state = rememberDatePickerState(initialSelectedDateMillis = epochDayMillis(initial))
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = { onPick(state.selectedDateMillis?.let(::dateOfMillis)) }) { Text("Set", color = p.heading) } },
        dismissButton = {
            Row {
                if (current != null) TextButton(onClick = { onPick(null) }) { Text("No date", color = p.destructive) }
                TextButton(onClick = onDismiss) { Text("Cancel", color = p.inkMuted) }
            }
        },
    ) { DatePicker(state, showModeToggle = false) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TimeDialog(current: String?, onDismiss: () -> Unit, onPick: (String?) -> Unit) {
    val p = LocalPalette.current
    val initial = current?.let { runCatching { LocalTime.parse(it) }.getOrNull() } ?: LocalTime.of(9, 0)
    val state = rememberTimePickerState(initialHour = initial.hour, initialMinute = initial.minute)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Time") },
        text = { TimePicker(state) },
        confirmButton = { TextButton(onClick = { onPick("%02d:%02d".format(state.hour, state.minute)) }) { Text("Set", color = p.heading) } },
        dismissButton = {
            Row {
                if (current != null) TextButton(onClick = { onPick(null) }) { Text("All day", color = p.inkMuted) }
                TextButton(onClick = onDismiss) { Text("Cancel", color = p.inkMuted) }
            }
        },
        containerColor = p.surfaceRaised,
    )
}

// ---------------------------------------------------------------- Quick add

/**
 * Quick add (QuickAddSheet.tsx): "What needs doing?", the send button, the engine's reading of dates and repeats
 * in the words (each with an × that keeps the words as text), and chips for the date, time, priority and where it
 * goes (the Inbox, or a note). [dueDate] starts the date (the calendar's per-day +).
 */
@OptIn(ExperimentalMaterial3Api::class, FlowPreview::class)
@Composable
fun QuickAddSheet(onDismiss: () -> Unit, dueDate: String? = null) {
    val p = LocalPalette.current
    val c = phoneColors()
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var text by rememberSaveable { mutableStateOf("") }
    var parsed by remember { mutableStateOf<TaskParseValue?>(null) }
    var keepText by remember { mutableStateOf(false) }
    var date by rememberSaveable { mutableStateOf(dueDate) }
    var time by rememberSaveable { mutableStateOf<String?>(null) }
    var priority by rememberSaveable { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf<Pair<String, String>?>(null) }
    var pickDate by remember { mutableStateOf(false) }
    var pickTime by remember { mutableStateOf(false) }
    var pickNote by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val today = LocalDate.now()
    LaunchedEffect(Unit) {
        runCatching { focus.requestFocus() }
        snapshotFlow { text }.debounce(150).collect { q ->
            parsed = if (q.isBlank()) null else runCatching { session.client.query(Views.taskParse(text = q)) }.getOrNull()
        }
    }
    val send: () -> Unit = {
        if (text.isNotBlank() && !sending) {
            sending = true
            scope.launch {
                runCatching {
                    session.client.command(
                        Commands.taskCreate(
                            text = text.trim(),
                            noteId = note?.first,
                            dueDate = date?.let { Patch.Set(it) } ?: Patch.Keep,
                            dueTime = time?.let { Patch.Set(it) } ?: Patch.Keep,
                            priority = priority?.let { TaskCreateArgs.Priority.of(it) },
                            keepText = keepText.takeIf { it },
                        ),
                    )
                }
                sending = false
                text = ""
                keepText = false
                onDismiss()
            }
        }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = sheetColor(),
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = { Box(Modifier.padding(top = 5.dp).size(36.dp, 5.dp).clip(CircleShape).background(c.ink(0.22f))) },
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 16.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f).heightIn(min = 44.dp), contentAlignment = Alignment.CenterStart) {
                    if (text.isEmpty()) Text("What needs doing?", style = PhoneType.body, color = p.inkFaint)
                    BasicTextField(
                        text,
                        { text = it; keepText = false },
                        textStyle = PhoneType.body.copy(color = p.ink),
                        cursorBrush = SolidColor(p.accent),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { send() }),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus).semantics { contentDescription = "What needs doing?" }.testTag("quick-add-field"),
                    )
                }
                Box(
                    Modifier.size(44.dp).clip(CircleShape).clickable(enabled = text.isNotBlank(), role = Role.Button, onClickLabel = "Add task", onClick = send).semantics { contentDescription = "Add task" },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(Modifier.size(34.dp).alpha(if (text.isNotBlank()) 1f else 0.3f).clip(CircleShape).background(p.heading), contentAlignment = Alignment.Center) {
                        FoleviIcon(WebIcon.ARROW_UP, null, size = 19.dp, tint = p.canvas)
                    }
                }
            }
            if (!keepText) {
                for (line in parsePreview(parsed, today)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(line, style = PhoneType.footnote, color = p.inkMuted, modifier = Modifier.weight(1f))
                        Box(Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Keep as text") { keepText = true }.semantics { contentDescription = "Keep as text" }, contentAlignment = Alignment.Center) {
                            FoleviIcon(WebIcon.X, null, size = 14.dp, tint = p.inkMuted)
                        }
                    }
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val shownDate = date ?: parsed?.dueDate?.takeIf { !keepText }
                QuickChip(WebIcon.CALENDAR_DAYS, shownDate?.let { runCatching { dueLabel(LocalDate.parse(it), today) }.getOrNull() } ?: "Date", muted = shownDate == null) { pickDate = true }
                if (shownDate != null) {
                    val shownTime = time ?: parsed?.dueTime?.takeIf { !keepText }
                    QuickChip(WebIcon.CLOCK, shownTime?.let { timeLabel(it) } ?: "Time", muted = shownTime == null) { pickTime = true }
                }
                var prMenu by remember { mutableStateOf(false) }
                Box {
                    QuickChip(WebIcon.FLAG, priority?.replaceFirstChar { it.uppercase() } ?: "Priority", muted = priority == null, tint = priorityColor(priority, p)) { prMenu = true }
                    PhoneMenu(prMenu, { prMenu = false }) {
                        for (pr in listOf("none", "low", "medium", "high")) {
                            DropdownMenuItem(
                                text = { Text(pr.replaceFirstChar { it.uppercase() }) },
                                leadingIcon = { FoleviIcon(WebIcon.FLAG, null, tint = priorityColor(pr, p) ?: p.inkMuted) },
                                onClick = { prMenu = false; priority = pr.takeIf { it != "none" } },
                            )
                        }
                    }
                }
                QuickChip(WebIcon.INBOX, note?.second ?: "Inbox", muted = false) { pickNote = true }
            }
        }
    }
    if (pickDate) DateDialog(date, onDismiss = { pickDate = false }) { d -> pickDate = false; date = d?.toString(); if (d == null) time = null }
    if (pickTime) TimeDialog(time, onDismiss = { pickTime = false }) { tm -> pickTime = false; time = tm }
    if (pickNote) NotePicker(onDismiss = { pickNote = false }) { picked -> pickNote = false; note = picked }
}

/** A quick-add chip: glass, 36 tall, capsule, 14 at the sides. */
@Composable
private fun QuickChip(icon: WebIcon, label: String, muted: Boolean, tint: Color? = null, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.heightIn(min = 36.dp).widthIn(max = 224.dp).background(phoneColors().ink(0.065f), CircleShape).clip(CircleShape).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        FoleviIcon(icon, null, size = 17.dp, tint = tint ?: if (muted) p.inkMuted else p.ink)
        Text(label, style = PhoneType.subheadline, color = if (muted) p.inkMuted else p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** "Add to": the Inbox, or a note found by its title (search). */
@OptIn(ExperimentalMaterial3Api::class, FlowPreview::class)
@Composable
private fun NotePicker(onDismiss: () -> Unit, onPick: (Pair<String, String>?) -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    val session = LocalSession.current
    var q by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    LaunchedEffect(Unit) {
        snapshotFlow { q }.debounce(200).collect { text ->
            hits = if (text.isBlank()) emptyList() else runCatching { session.client.query(Views.search(text = text, limit = 20)).hits.map { it.id to it.title.ifBlank { "Untitled" } } }.getOrDefault(emptyList())
        }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = sheetColor(),
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = { Box(Modifier.padding(top = 5.dp).size(36.dp, 5.dp).clip(CircleShape).background(c.ink(0.22f))) },
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Add to", style = PhoneType.headline, color = p.ink, modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            FilterField(q, { q = it }, "Find a note", icon = WebIcon.SEARCH)
            SheetGroup {
                SheetRow(WebIcon.INBOX, "Inbox", null, chevron = false) { onPick(null) }
                for ((id, title) in hits) {
                    SheetSeparator()
                    SheetRow(WebIcon.FILE_TEXT, title, null, chevron = false) { onPick(id to title) }
                }
            }
        }
    }
}
