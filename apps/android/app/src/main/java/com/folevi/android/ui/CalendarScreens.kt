// The Calendar tab as the web's phone layout draws it (apps/web/src/components/iphone/Agenda.tsx, WeekStrip.tsx,
// calendarMenu.tsx): the month as the title, "Today" when another day is picked, the "…" menu (Agenda, Week,
// Month, Subscribe, Calendars), the week strip that pages by week and pulls down into the month, and the agenda:
// the picked day and the 30 after it, tasks and calendar events, a + per day for Quick add.
package com.folevi.android.ui

import androidx.compose.ui.semantics.heading

import androidx.compose.foundation.layout.defaultMinSize

import androidx.compose.foundation.selection.toggleable

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.design.AvatarButton
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.FoleviPalette
import com.folevi.android.design.GlassPill
import com.folevi.android.design.GlassTextButton
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.PhoneScreen
import com.folevi.android.design.PhoneType
import com.folevi.android.design.PillButton
import com.folevi.android.design.Spectral
import com.folevi.android.design.WebIcon
import com.folevi.android.design.phoneColors
import com.folevi.engine.generated.CalendarEvent
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.TaskRow
import com.folevi.engine.generated.TaskViewName
import com.folevi.engine.generated.Views
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.util.Locale
import kotlinx.coroutines.launch

// ---------------------------------------------------------------- words (pure, unit-tested)

/** The title: the picked day's month ("November"), with the year when it isn't this year's. */
internal fun calendarTitle(day: LocalDate, today: LocalDate, locale: Locale = Locale.getDefault()): String {
    val m = day.month.getDisplayName(TextStyle.FULL, locale)
    return if (day.year == today.year) m else "$m ${day.year}"
}

/** An agenda day's header: "Today", "Tomorrow", "Yesterday" or the weekday, then " · Wednesday, Nov 25" (or "Nov 25"). */
internal fun agendaHeader(day: LocalDate, today: LocalDate, locale: Locale = Locale.getDefault()): Pair<String, String> {
    val days = ChronoUnit.DAYS.between(today, day)
    val short = "${day.month.getDisplayName(TextStyle.SHORT, locale)} ${day.dayOfMonth}" + if (day.year != today.year) ", ${day.year}" else ""
    return when (days) {
        0L, 1L, -1L -> (if (days == 0L) "Today" else if (days == 1L) "Tomorrow" else "Yesterday") to "${day.dayOfWeek.getDisplayName(TextStyle.FULL, locale)}, $short"
        else -> day.dayOfWeek.getDisplayName(TextStyle.FULL, locale) to short
    }
}

/** The day an event starts on, in this zone (start and end are epoch milliseconds). */
internal fun eventDay(e: CalendarEvent, zone: ZoneId = ZoneId.systemDefault()): LocalDate =
    if (e.allDay) Instant.ofEpochMilli(e.start).atZone(java.time.ZoneOffset.UTC).toLocalDate() else Instant.ofEpochMilli(e.start).atZone(zone).toLocalDate()

/** An event's "when": "All day", or "9:00 AM to 10:00 AM". */
internal fun eventWhen(e: CalendarEvent, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String {
    if (e.allDay) return "All day"
    val f = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale)
    val a = Instant.ofEpochMilli(e.start).atZone(zone).toLocalTime().format(f)
    val b = Instant.ofEpochMilli(e.end).atZone(zone).toLocalTime().format(f)
    return if (e.end > e.start) "$a to $b" else a
}

/** A calendar's color key (accent, moss, marigold, plum, coral, muted) as Folevi's color. */
@Composable
internal fun calendarColor(key: String): Color {
    val p = LocalPalette.current
    return when (key) {
        "moss", "green" -> p.moss
        "marigold", "orange", "yellow" -> p.marigold
        "plum", "purple" -> p.plum
        "coral", "red", "pink" -> p.coral
        "muted", "gray", "grey" -> p.inkMuted
        else -> if (key.startsWith("#")) runCatching { Color(android.graphics.Color.parseColor(key)) }.getOrDefault(p.accent) else p.accent
    }
}

/** The week (Monday first) that holds [day]. */
internal fun weekStart(day: LocalDate): LocalDate = day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

private const val WEEKS = 104
private const val MONTHS = 24

private enum class CalendarShow { AGENDA, WEEK, MONTH }

// ---------------------------------------------------------------- Calendar

@Composable
fun CalendarHome(open: (Route) -> Unit) {
    val p = LocalPalette.current
    val today = LocalDate.now()
    var picked by rememberSaveable { mutableStateOf(today.toString()) }
    val day = LocalDate.parse(picked)
    var monthOpen by rememberSaveable { mutableStateOf(false) }
    var show by rememberSaveable { mutableStateOf(CalendarShow.AGENDA) }
    var menu by remember { mutableStateOf(false) }
    var quickAddFor by remember { mutableStateOf<String?>(null) }
    var calendars by remember { mutableStateOf(false) }
    var subscribe by remember { mutableStateOf(false) }
    var event by remember { mutableStateOf<CalendarEvent?>(null) }
    var sheet by remember { mutableStateOf<TaskRow?>(null) }
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    // Swipe and menu actions on a task (as on Tasks).
    val runTask: (String, TaskRow) -> Unit = { what, t ->
        scope.launch {
            runCatching {
                when (what) {
                    "done" -> session.client.command(Commands.taskUpdate(id = t.id, checked = true))
                    "reopen" -> session.client.command(Commands.taskUpdate(id = t.id, checked = false, canceled = false))
                    "tomorrow" -> session.client.command(Commands.taskUpdate(id = t.id, dueDate = com.folevi.engine.protocol.Patch.Set(today.plusDays(1).toString())))
                }
            }
        }
    }

    // The agenda's span (the picked day and the 30 after it), and the month around it for the dots.
    val last = day.plusDays(30)
    val ym = YearMonth.from(day)
    val dotsFrom = ym.atDay(1).minusDays(7)
    val dotsTo = ym.atEndOfMonth().plusDays(7)
    val from = minOf(day, dotsFrom)
    val to = maxOf(last, dotsTo)
    val range by rememberView(Views.tasksRange(from = from.toString(), to = to.toString()), key = "$from|$to")
    val zone = ZoneId.systemDefault()
    val events by rememberView(
        Views.calendarsEvents(from = from.atStartOfDay(zone).toInstant().toEpochMilli(), to = to.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()),
        key = "$from|$to",
    )
    // Overdue tasks lead the day when the picked day is today.
    val todayTasks by rememberView(Views.tasksList(view = TaskViewName.TODAY))
    val tasksByDay = range.value?.tasks.orEmpty().groupBy { it.dueDate }
    val eventsByDay = events.value?.events.orEmpty().groupBy { eventDay(it) }
    val busy: (LocalDate) -> Boolean = { d -> !tasksByDay[d.toString()].isNullOrEmpty() || !eventsByDay[d].isNullOrEmpty() }

    PhoneScreen(
        title = calendarTitle(day, today),
        leading = { AvatarButton(rememberView(com.folevi.engine.generated.Views.session()).value.value?.profile?.name ?: "", onClick = LocalPhoneSheets.current.account) },
        trailing = {
            if (day != today) GlassTextButton("Today", onClick = { picked = today.toString() })
            Box {
                GlassPill { PillButton("More", onClick = { menu = true }) { FoleviIcon(WebIcon.ELLIPSIS, null, size = 24.dp, tint = p.ink) } }
                PhoneMenu(menu, { menu = false }) {
                    Text("Show", style = PhoneType.footnote.copy(fontWeight = FontWeight.SemiBold), color = p.inkMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                    for ((s, label) in listOf(CalendarShow.AGENDA to "Agenda", CalendarShow.WEEK to "Week", CalendarShow.MONTH to "Month")) {
                        DropdownMenuItem(
                            text = { Text(label) },
                            trailingIcon = { if (show == s) FoleviIcon(WebIcon.CHECK, null) },
                            onClick = { menu = false; show = s; monthOpen = s == CalendarShow.MONTH },
                        )
                    }
                    HorizontalDivider(color = phoneColors().separator)
                    DropdownMenuItem(text = { Text("Subscribe") }, leadingIcon = { FoleviIcon(WebIcon.RSS, null) }, onClick = { menu = false; subscribe = true })
                    DropdownMenuItem(text = { Text("Calendars") }, leadingIcon = { FoleviIcon(WebIcon.CALENDAR_DAYS, null) }, onClick = { menu = false; calendars = true })
                }
            }
        },
        header = {
            WeekStrip(
                day = day,
                today = today,
                busy = busy,
                monthOpen = monthOpen,
                onPick = { d -> picked = d.toString(); if (monthOpen && show != CalendarShow.MONTH) monthOpen = false },
                onMonth = { monthOpen = it; if (!it && show == CalendarShow.MONTH) show = CalendarShow.AGENDA },
            )
        },
    ) {
        val days = if (show == CalendarShow.WEEK) (0L..6L).map { weekStart(day).plusDays(it) }.filter { !it.isBefore(day) } else (0L..30L).map { day.plusDays(it) }
        val loading = range.value == null
        var shownAny = false
        days.forEachIndexed { i, d ->
            val dayTasks = buildList {
                if (d == today) addAll(todayTasks.value?.groups.orEmpty().flatMap { it.tasks }.filter { it.overdue && !isClosed(it) })
                addAll(tasksByDay[d.toString()].orEmpty().filter { it.overdue.not() || d != today })
            }.distinctBy { it.id }
            val dayEvents = eventsByDay[d].orEmpty().sortedWith(compareBy({ !it.allDay }, { it.start }))
            if (d != day && dayTasks.isEmpty() && dayEvents.isEmpty()) return@forEachIndexed
            shownAny = shownAny || d != day
            item(key = "d$d") {
                AgendaHeader(d, today, first = i == 0) { quickAddFor = d.toString() }
            }
            when {
                loading && d == day -> item(key = "l$d") { Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp).height(40.dp).clip(RoundedCornerShape(10.dp)).background(p.surfaceSunken)) }
                dayTasks.isEmpty() && dayEvents.isEmpty() -> item(key = "e$d") {
                    Box(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 20.dp), contentAlignment = Alignment.CenterStart) {
                        Text("Nothing planned", style = PhoneType.subheadline.copy(fontFamily = Spectral, fontStyle = FontStyle.Italic), color = p.inkFaint)
                    }
                }
                else -> {
                    for (e in dayEvents) item(key = "ev${e.id}$d") { EventRow(e) { event = e } }
                    for (t in dayTasks) item(key = "t${t.id}$d") {
                        TaskSwipeLine(
                            t,
                            timeOnly = !t.overdue,
                            showNote = true,
                            today = today,
                            onOpen = { sheet = t },
                            onAction = { what -> if (what == "date") sheet = t else runTask(what, t) },
                            onOpenNote = { open(NoteRoute(t.noteId, t.noteTitle)) },
                        )
                    }
                }
            }
        }
        if (!shownAny && !loading) item(key = "footer") {
            Text("Nothing else in the next 30 days.", style = PhoneType.subheadline, color = p.inkMuted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp))
        }
    }
    quickAddFor?.let { d -> QuickAddSheet(onDismiss = { quickAddFor = null }, dueDate = d) }
    sheet?.let { t -> TaskSheet(t, onDismiss = { sheet = null }, openNote = { sheet = null; open(NoteRoute(t.noteId, t.noteTitle)) }) }
    event?.let { e -> EventDialog(e) { event = null } }
    if (calendars) CalendarsSheet(onDismiss = { calendars = false }, onSubscribe = { calendars = false; subscribe = true })
    if (subscribe) SubscribeDialog { subscribe = false }
}

@Composable
private fun AgendaHeader(day: LocalDate, today: LocalDate, first: Boolean, onAdd: () -> Unit) {
    val p = LocalPalette.current
    val (main, rest) = agendaHeader(day, today)
    Row(Modifier.fillMaxWidth().padding(top = if (first) 8.dp else 20.dp, start = 20.dp, end = 8.dp).heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(main, style = PhoneType.headline, color = p.heading, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
        Text(" · $rest", style = PhoneType.body, color = p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Box(
            Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Add a task", onClick = onAdd).semantics { contentDescription = "Add a task on $main" },
            contentAlignment = Alignment.Center,
        ) { FoleviIcon(WebIcon.PLUS, null, size = 20.dp, tint = p.inkMuted) }
    }
}

@Composable
private fun EventRow(e: CalendarEvent, onClick: () -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    val color = calendarColor(e.color)
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(start = 20.dp).testTag("event-${e.id}"), verticalAlignment = Alignment.CenterVertically) {
        // In the check box's place, a 4 by 22 capsule in the calendar's color.
        Box(Modifier.width(22.dp), contentAlignment = Alignment.Center) { Box(Modifier.size(4.dp, 22.dp).clip(CircleShape).background(color)) }
        Spacer(Modifier.width(12.dp))
        Column(
            Modifier.weight(1f).heightIn(min = 64.dp)
                .drawBehind { drawLine(c.separator, Offset(0f, size.height), Offset(size.width, size.height), 0.5.dp.toPx()) }
                .padding(end = 16.dp, top = 10.dp, bottom = 10.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(e.title.ifBlank { "Untitled event" }, style = PhoneType.body, color = p.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("${eventWhen(e)} · ${e.calendarName}", style = PhoneType.subheadline, color = p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

@Composable
private fun EventDialog(e: CalendarEvent, onDismiss: () -> Unit) {
    val p = LocalPalette.current
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = p.surfaceRaised,
        title = { Text(e.title.ifBlank { "Untitled event" }, style = PhoneType.headline, color = p.heading) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("${agendaHeader(eventDay(e), LocalDate.now()).let { "${it.first}, ${it.second}" }} · ${eventWhen(e)}", style = PhoneType.subheadline, color = p.inkMuted)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(calendarColor(e.color)))
                    Text(e.calendarName, style = PhoneType.subheadline, color = p.inkMuted, modifier = Modifier.padding(start = 6.dp))
                }
                if (e.location.isNotBlank()) Text(e.location, style = PhoneType.body, color = p.ink)
                if (e.description.isNotBlank()) Text(e.description, style = PhoneType.subheadline, color = p.ink, maxLines = 8, overflow = TextOverflow.Ellipsis)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done", color = p.heading) } },
    )
}

// ---------------------------------------------------------------- week strip and month

/**
 * The week strip (WeekStrip.tsx): weekday letters, 48-tall day cells with a 34 date circle and a 5 dot on busy
 * days; swiping sideways pages by week and keeps the weekday. Pulling it down, or tapping the grabber, opens the
 * month (paging by month); picking a day there folds it back.
 */
@Composable
private fun WeekStrip(day: LocalDate, today: LocalDate, busy: (LocalDate) -> Boolean, monthOpen: Boolean, onPick: (LocalDate) -> Unit, onMonth: (Boolean) -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    val density = LocalDensity.current
    val pull = remember { floatArrayOf(0f) }
    Column(
        Modifier.fillMaxWidth().background(p.canvas).padding(start = 10.dp, end = 10.dp, top = 6.dp)
            .draggable(
                orientation = Orientation.Vertical,
                state = rememberDraggableState { d -> pull[0] += d },
                onDragStarted = { pull[0] = 0f },
                onDragStopped = { v ->
                    val far = with(density) { 40.dp.toPx() }
                    if (pull[0] > far || v > 800f) onMonth(true) else if (pull[0] < -far || v < -800f) onMonth(false)
                },
            )
            .testTag("week-strip"),
    ) {
        Row(Modifier.fillMaxWidth()) {
            for (i in 0..6) {
                val dow = DayOfWeek.MONDAY.plus(i.toLong())
                Text(
                    dow.getDisplayName(TextStyle.NARROW, Locale.getDefault()),
                    style = PhoneType.footnote.copy(fontWeight = FontWeight.SemiBold),
                    color = if (dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY) p.inkFaint else p.inkMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        AnimatedVisibility(!monthOpen, enter = fadeIn(com.folevi.android.design.Motion.defaultEffects()) + expandVertically(com.folevi.android.design.Motion.defaultSpatial()), exit = fadeOut(com.folevi.android.design.Motion.defaultEffects()) + shrinkVertically(com.folevi.android.design.Motion.defaultSpatial())) {
            val base = weekStart(today)
            val pager = rememberPagerState(initialPage = WEEKS + ChronoUnit.WEEKS.between(base, weekStart(day)).toInt().coerceIn(-WEEKS, WEEKS)) { WEEKS * 2 + 1 }
            // Paging keeps the same weekday picked; a pick elsewhere moves the pager to its week.
            LaunchedEffect(day) {
                val target = WEEKS + ChronoUnit.WEEKS.between(base, weekStart(day)).toInt()
                if (target != pager.currentPage && target in 0 until pager.pageCount) pager.animateScrollToPage(target)
            }
            LaunchedEffect(pager) {
                snapshotFlow { pager.settledPage }.collect { page ->
                    val ws = base.plusWeeks((page - WEEKS).toLong())
                    if (weekStart(day) != ws) onPick(ws.plusDays((day.dayOfWeek.value - 1).toLong()))
                }
            }
            HorizontalPager(pager, modifier = Modifier.fillMaxWidth()) { page ->
                val ws = base.plusWeeks((page - WEEKS).toLong())
                Row(Modifier.fillMaxWidth()) {
                    for (i in 0..6) {
                        val d = ws.plusDays(i.toLong())
                        DayCell(d, today, selected = d == day, outside = false, dot = busy(d), modifier = Modifier.weight(1f)) { onPick(d) }
                    }
                }
            }
        }
        AnimatedVisibility(monthOpen, enter = fadeIn(com.folevi.android.design.Motion.defaultEffects()) + expandVertically(com.folevi.android.design.Motion.defaultSpatial()), exit = fadeOut(com.folevi.android.design.Motion.defaultEffects()) + shrinkVertically(com.folevi.android.design.Motion.defaultSpatial())) {
            val base = YearMonth.from(today)
            val pager = rememberPagerState(initialPage = MONTHS + ChronoUnit.MONTHS.between(base, YearMonth.from(day)).toInt().coerceIn(-MONTHS, MONTHS)) { MONTHS * 2 + 1 }
            HorizontalPager(pager, modifier = Modifier.fillMaxWidth()) { page ->
                val ym = base.plusMonths((page - MONTHS).toLong())
                val first = weekStart(ym.atDay(1))
                val rows = ((ChronoUnit.DAYS.between(first, ym.atEndOfMonth()) / 7) + 1).toInt()
                Column {
                    for (r in 0 until rows) {
                        Row(Modifier.fillMaxWidth()) {
                            for (i in 0..6) {
                                val d = first.plusDays((r * 7 + i).toLong())
                                DayCell(d, today, selected = d == day, outside = YearMonth.from(d) != ym, dot = busy(d), modifier = Modifier.weight(1f)) { onPick(d); onMonth(false) }
                            }
                        }
                    }
                }
            }
        }
        // The grabber: a 36 by 5 capsule; a tap opens or folds the month.
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Box(
                Modifier.size(64.dp, 44.dp).clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button, onClickLabel = if (monthOpen) "Show week" else "Show month") { onMonth(!monthOpen) }
                    .semantics { contentDescription = if (monthOpen) "Show week" else "Show month" },
                contentAlignment = Alignment.TopCenter,
            ) { Box(Modifier.padding(top = 8.dp).size(36.dp, 5.dp).clip(CircleShape).background(c.ink(0.2f))) }
        }
    }
}

@Composable
private fun DayCell(d: LocalDate, today: LocalDate, selected: Boolean, outside: Boolean, dot: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    val isToday = d == today
    Column(
        modifier.heightIn(min = 48.dp).padding(top = 2.dp).alpha(if (outside) 0.4f else 1f).clip(RoundedCornerShape(10.dp)).clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = d.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL)); this.selected = selected },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.defaultMinSize(34.dp, 34.dp).clip(CircleShape).background(if (selected) p.heading else if (isToday) c.ink(0.09f) else Color.Transparent),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "${d.dayOfMonth}",
                style = PhoneType.body.copy(fontFeatureSettings = "tnum", fontWeight = if (selected || isToday) FontWeight.SemiBold else FontWeight.Normal),
                color = if (selected) p.canvas else if (isToday) p.heading else p.ink,
            )
        }
        Spacer(Modifier.height(6.dp))
        Box(Modifier.size(5.dp).clip(CircleShape).background(if (dot) c.ink(0.38f) else Color.Transparent))
    }
}

// ---------------------------------------------------------------- calendars

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CalendarsSheet(onDismiss: () -> Unit, onSubscribe: () -> Unit) {
    val p = LocalPalette.current
    val c = phoneColors()
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val list by rememberView(Views.calendarsList())
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = sheetColor(),
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = { Box(Modifier.padding(top = 5.dp).size(36.dp, 5.dp).clip(CircleShape).background(c.ink(0.22f))) },
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Calendars", style = PhoneType.headline, color = p.ink, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            val cals = list.value?.calendars.orEmpty()
            if (cals.isEmpty()) {
                Text("Subscribe to a calendar's address to see its events beside your tasks.", style = PhoneType.subheadline, color = p.inkMuted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            } else SheetGroup {
                cals.forEachIndexed { i, cal ->
                    if (i > 0) SheetSeparator()
                    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                      Row(
                        Modifier.weight(1f).heightIn(min = 52.dp)
                            .toggleable(value = cal.visible, role = Role.Switch) { on -> scope.launch { runCatching { session.client.command(Commands.calendarUpdate(id = cal.id, visible = on)) } } }
                            .padding(start = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                      ) {
                        Box(Modifier.size(12.dp).clip(CircleShape).background(calendarColor(cal.color)))
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(cal.name, style = PhoneType.body, color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            val detail = cal.lastError ?: cal.eventCount?.let { "$it events" }
                            if (detail != null) Text(detail, style = PhoneType.footnote, color = if (cal.lastError != null) p.destructive else p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Switch(
                            checked = cal.visible,
                            onCheckedChange = null,
                            colors = SwitchDefaults.colors(checkedTrackColor = p.heading, checkedThumbColor = p.canvas),
                        )
                      }
                        Box(
                            Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Remove") { scope.launch { runCatching { session.client.command(Commands.calendarRemove(id = cal.id)) } } }
                                .semantics { contentDescription = "Remove ${cal.name}" },
                            contentAlignment = Alignment.Center,
                        ) { FoleviIcon(WebIcon.X, null, size = 18.dp, tint = p.inkMuted) }
                    }
                }
            }
            SheetGroup { SheetRow(WebIcon.RSS, "Subscribe to a calendar", null, onClick = onSubscribe) }
        }
    }
}

@Composable
private fun SubscribeDialog(onDismiss: () -> Unit) {
    val p = LocalPalette.current
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = p.surfaceRaised,
        title = { Text("Subscribe to a calendar", style = PhoneType.headline, color = p.heading) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Paste the calendar's address (it usually ends in .ics).", style = PhoneType.subheadline, color = p.inkMuted)
                OutlinedTextField(url, { url = it; error = null }, singleLine = true, placeholder = { Text("https://…") }, isError = error != null, supportingText = error?.let { { Text(it) } })
            }
        },
        confirmButton = {
            TextButton(enabled = url.isNotBlank() && !busy, onClick = {
                busy = true
                scope.launch {
                    val ok = runCatching { session.client.command(Commands.calendarAdd(url = url.trim())) }
                    busy = false
                    if (ok.isSuccess) onDismiss() else error = ok.exceptionOrNull()?.message ?: "Folevi couldn't add that calendar."
                }
            }) { Text("Subscribe", color = p.heading) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = p.inkMuted) } },
    )
}
