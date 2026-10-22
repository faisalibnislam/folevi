package com.folevi.android.extras

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.launch
import com.folevi.android.MainActivity
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/**
 * Home screen widgets (docs/ANDROID_PLAN.md "Native v1"), drawn with Glance from the phone's copy of what they show
 * (widgets.json), so they draw at once and offline: Today (today's and overdue to-dos, a circle checks one off),
 * Recent notes, and Quick add. The copy is refreshed from the REST API with this phone's token every 30 minutes
 * (WorkManager), when the app comes and goes, and after a check-off. In local mode there's no account and no REST
 * API: the page that holds the library hands over the copy whenever it changes (setSnapshot, from
 * components/app/LocalExtensions.tsx), and a check-off waits in LocalActions until the page puts it in. Signed
 * out: "Open Folevi". Neutral colours that follow the phone's light and dark theme.
 */
object Widgets {
    private fun file(context: Context) = File(context.noBackupFilesDir, "widgets.json")

    fun read(context: Context): JSONObject = runCatching { JSONObject(file(context).readText()) }.getOrDefault(JSONObject())

    fun write(context: Context, o: JSONObject) = com.folevi.android.library.MirrorStore.atomicWrite(file(context), o.toString().toByteArray())

    /** Fetches the copy now (in the background) and redraws every widget. */
    fun refreshSoon(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork("widgets-now", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<WidgetWorker>().build())
    }

    fun schedule(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("widgets", ExistingPeriodicWorkPolicy.KEEP, PeriodicWorkRequestBuilder<WidgetWorker>(30, TimeUnit.MINUTES).build())
    }

    /** Signing out: the copy goes, and the widgets say "Open Folevi". */
    fun clear(context: Context) {
        file(context).delete()
        redraw(context)
    }

    fun redraw(context: Context) {
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Default).launchSafely {
            TodayWidget().updateAll(context)
            RecentNotesWidget().updateAll(context)
            QuickAddWidget().updateAll(context)
        }
    }

    /** A string field, "" when it's missing or null (org.json's optString says "null" for null). */
    private fun JSONObject.text(k: String): String = if (isNull(k)) "" else optString(k)

    private fun localMode() = runCatching { com.folevi.android.FoleviApp.instance.settings.mode == "local" }.getOrDefault(false)

    /**
     * Local mode: the page's copy (NativeWidgetSnapshot in apps/web lib/nativeApp.ts): today's and overdue open
     * tasks and the recent notes, in the same shape the REST API's copy is kept in. Tasks checked off here that
     * the page hasn't put in yet stay hidden.
     */
    fun setSnapshot(context: Context, snapshot: JSONObject) {
        val day = snapshot.text("day").takeIf { Regex("\\d{4}-\\d{2}-\\d{2}").matches(it) } ?: LocalDate.now().toString()
        val done = LocalActions.get(context).doneTaskIds()
        val tasks = snapshot.optJSONArray("tasks") ?: JSONArray()
        val t = JSONArray()
        (0 until tasks.length()).map { tasks.getJSONObject(it) }
            .filter { it.text("id").isNotEmpty() && it.text("id") !in done && it.text("dueDate").let { d -> d.isNotEmpty() && d <= day } }
            .sortedWith(compareBy({ it.text("dueDate") }, { it.text("dueTime").ifEmpty { "99" } }))
            .take(100)
            .forEach {
                val note = it.optJSONObject("note") ?: JSONObject()
                t.put(JSONObject().put("id", it.text("id")).put("text", it.text("text").take(300)).put("due", it.text("dueDate")).put("time", it.text("dueTime").ifEmpty { null }).put("noteId", note.text("id")).put("noteTitle", note.text("title").take(200)).put("overdue", it.text("dueDate") < day))
            }
        val notes = snapshot.optJSONArray("notes") ?: JSONArray()
        val n = JSONArray()
        (0 until minOf(notes.length(), 10)).map { notes.getJSONObject(it) }.filter { it.text("id").isNotEmpty() }.forEach {
            n.put(JSONObject().put("id", it.text("id")).put("title", it.text("title").take(200)).put("place", (it.optJSONObject("place")?.text("name") ?: "").take(100)).put("updatedAt", it.text("updatedAt")))
        }
        write(context, JSONObject().put("signedIn", true).put("local", true).put("updatedAt", System.currentTimeMillis()).put("tasks", t).put("notes", n))
        redraw(context)
    }

    /** Refreshes the copy from the REST API. False when the phone isn't signed in (or the token was revoked). */
    suspend fun refresh(context: Context): Boolean {
        // Local mode: the page keeps the copy (setSnapshot); there's nothing to ask.
        if (localMode()) return read(context).optBoolean("local", false)
        val api = FoleviApi.forDevice(context)
        if (api == null) {
            write(context, JSONObject().put("signedIn", false))
            return false
        }
        val today = LocalDate.now()
        return try {
            val tasks = api.openTasks(today.plusDays(1))
            val notes = api.recentNotes(10)
            val t = JSONArray()
            tasks.filter { it.dueDate != null && it.dueDate <= today.toString() }
                .sortedWith(compareBy({ it.dueDate }, { it.dueTime ?: "99" }))
                .forEach { t.put(JSONObject().put("id", it.id).put("text", it.text).put("due", it.dueDate).put("time", it.dueTime).put("noteId", it.noteId).put("noteTitle", it.noteTitle).put("overdue", it.dueDate!! < today.toString())) }
            val n = JSONArray()
            notes.forEach { n.put(JSONObject().put("id", it.id).put("title", it.title).put("place", it.place).put("updatedAt", it.updatedAt)) }
            write(context, JSONObject().put("signedIn", true).put("updatedAt", System.currentTimeMillis()).put("tasks", t).put("notes", n))
            true
        } catch (e: FoleviApi.Failure.SignedOut) {
            DeviceCredential.get(context).clear()
            write(context, JSONObject().put("signedIn", false))
            false
        } catch (e: FoleviApi.Failure) {
            // Offline or busy: the copy stays as it was.
            true
        }
    }

    fun open(context: Context, link: String): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse(link), context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
}

private fun kotlinx.coroutines.CoroutineScope.launchSafely(block: suspend () -> Unit) {
    launch { runCatching { block() } }
}

class WidgetWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        Widgets.refresh(applicationContext)
        TodayWidget().updateAll(applicationContext)
        RecentNotesWidget().updateAll(applicationContext)
        QuickAddWidget().updateAll(applicationContext)
        return Result.success()
    }
}

// ---------------------------------------------------------------- the look

private object Look {
    val canvas = ColorProvider(day = Color(0xFFFFFFFF), night = Color(0xFF101011))
    val ink = ColorProvider(day = Color(0xFF101011), night = Color(0xFFFFFFFF))
    val muted = ColorProvider(day = Color(0x99101011), night = Color(0x99FFFFFF))
    val overdue = ColorProvider(day = Color(0xFFC4302B), night = Color(0xFFFF6B63))
    val line = ColorProvider(day = Color(0x1F101011), night = Color(0x29FFFFFF))
    val title = TextStyle(color = ink, fontSize = 17.sp, fontWeight = FontWeight.Medium, fontFamily = FontFamily.Serif)
    val row = TextStyle(color = ink, fontSize = 14.sp)
    val small = TextStyle(color = muted, fontSize = 12.sp)
}

@Composable
private fun Frame(content: @Composable () -> Unit) {
    Box(GlanceModifier.fillMaxSize().background(Look.canvas).cornerRadius(20.dp).padding(14.dp)) { content() }
}

@Composable
private fun SignedOut(context: Context) {
    Frame {
        Column(GlanceModifier.fillMaxSize().clickable(actionStartActivity(Widgets.open(context, "folevi://documents"))), verticalAlignment = Alignment.CenterVertically, horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Folevi", style = Look.title)
            Spacer(GlanceModifier.height(4.dp))
            Text("Open Folevi to sign in", style = Look.small)
        }
    }
}

// ---------------------------------------------------------------- Today

class TodayWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val data = Widgets.read(context)
        provideContent { GlanceTheme { Today(context, data) } }
    }

    @Composable
    private fun Today(context: Context, data: JSONObject) {
        if (!data.optBoolean("signedIn", false)) return SignedOut(context)
        val tasks = data.optJSONArray("tasks") ?: JSONArray()
        Frame {
            Column(GlanceModifier.fillMaxSize()) {
                Row(GlanceModifier.fillMaxWidth().clickable(actionStartActivity(Widgets.open(context, "folevi://tasks/today"))), verticalAlignment = Alignment.CenterVertically) {
                    Text("Today", style = Look.title, modifier = GlanceModifier.defaultWeight())
                    Text("+", style = TextStyle(color = Look.ink, fontSize = 22.sp), modifier = GlanceModifier.size(36.dp).clickable(actionStartActivity(Widgets.open(context, "folevi://quick-add"))))
                }
                Spacer(GlanceModifier.height(6.dp))
                if (tasks.length() == 0) {
                    Text("Nothing due today", style = Look.small)
                } else {
                    LazyColumn {
                        items((0 until tasks.length()).map { tasks.getJSONObject(it) }, itemId = { it.optString("id").hashCode().toLong() }) { t ->
                            Row(GlanceModifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    GlanceModifier.size(22.dp).cornerRadius(11.dp).background(Look.line).clickable(actionRunCallback<CompleteTask>(actionParametersOf(TASK_ID to t.optString("id")))),
                                    contentAlignment = Alignment.Center,
                                ) { Box(GlanceModifier.size(18.dp).cornerRadius(9.dp).background(Look.canvas)) {} }
                                Spacer(GlanceModifier.width(10.dp))
                                Column(GlanceModifier.defaultWeight().clickable(actionStartActivity(Widgets.open(context, "folevi://d/${t.optString("noteId")}")))) {
                                    Text(t.optString("text"), style = Look.row, maxLines = 1)
                                    if (t.optBoolean("overdue")) Text("Overdue", style = TextStyle(color = Look.overdue, fontSize = 12.sp), maxLines = 1)
                                    else t.optString("noteTitle").takeIf { it.isNotEmpty() }?.let { Text(it, style = Look.small, maxLines = 1) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    companion object {
        val TASK_ID = ActionParameters.Key<String>("taskId")
    }
}

/**
 * The circle on a to-do: it goes from the widget at once, and Folevi hears of it through the REST API, or in
 * local mode from the page, which takes it from LocalActions (now, if the app is open).
 */
class CompleteTask : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val id = parameters[TodayWidget.TASK_ID] ?: return
        val data = Widgets.read(context)
        if (data.optBoolean("local", false)) {
            LocalActions.get(context).toggleTask(id, true)
            MainActivity.current?.get()?.event("local-actions", JSONObject())
        }
        val tasks = data.optJSONArray("tasks") ?: JSONArray()
        val kept = JSONArray()
        for (i in 0 until tasks.length()) if (tasks.getJSONObject(i).optString("id") != id) kept.put(tasks.getJSONObject(i))
        data.put("tasks", kept)
        val pending = data.optJSONArray("pendingDone") ?: JSONArray()
        pending.put(id)
        data.put("pendingDone", pending)
        Widgets.write(context, data)
        TodayWidget().update(context, glanceId)
        if (data.optBoolean("local", false)) return
        val api = FoleviApi.forDevice(context) ?: return
        val sent = runCatching { api.setTask(id, true) }.isSuccess
        if (sent) {
            val now = Widgets.read(context)
            val left = JSONArray()
            val p = now.optJSONArray("pendingDone") ?: JSONArray()
            for (i in 0 until p.length()) if (p.getString(i) != id) left.put(p.getString(i))
            Widgets.write(context, now.put("pendingDone", left))
        }
    }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}

// ---------------------------------------------------------------- Recent notes

class RecentNotesWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val data = Widgets.read(context)
        provideContent { GlanceTheme { Recent(context, data) } }
    }

    @Composable
    private fun Recent(context: Context, data: JSONObject) {
        if (!data.optBoolean("signedIn", false)) return SignedOut(context)
        val notes = data.optJSONArray("notes") ?: JSONArray()
        Frame {
            Column(GlanceModifier.fillMaxSize()) {
                Text("Recent notes", style = Look.title, modifier = GlanceModifier.clickable(actionStartActivity(Widgets.open(context, "folevi://documents"))))
                Spacer(GlanceModifier.height(6.dp))
                if (notes.length() == 0) Text("No notes yet", style = Look.small)
                else LazyColumn {
                    items((0 until notes.length()).map { notes.getJSONObject(it) }, itemId = { it.optString("id").hashCode().toLong() }) { n ->
                        Column(GlanceModifier.fillMaxWidth().padding(vertical = 4.dp).clickable(actionStartActivity(Widgets.open(context, "folevi://d/${n.optString("id")}")))) {
                            Text(n.optString("title").ifEmpty { "Untitled" }, style = Look.row, maxLines = 1)
                            Text(n.optString("place"), style = Look.small, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}

class RecentNotesWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = RecentNotesWidget()
}

// ---------------------------------------------------------------- Quick add

class QuickAddWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            GlanceTheme {
                Frame {
                    Column(GlanceModifier.fillMaxSize().clickable(actionStartActivity(Widgets.open(context, "folevi://quick-add"))), verticalAlignment = Alignment.CenterVertically, horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("+", style = TextStyle(color = Look.ink, fontSize = 34.sp))
                        Text("Quick add", style = Look.small)
                    }
                }
            }
        }
    }
}

class QuickAddWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = QuickAddWidget()
}

/** Every widget of a kind on the home screen (for checks and screenshots). */
suspend fun widgetCount(context: Context): Int = GlanceAppWidgetManager(context).let { m ->
    m.getGlanceIds(TodayWidget::class.java).size + m.getGlanceIds(RecentNotesWidget::class.java).size + m.getGlanceIds(QuickAddWidget::class.java).size
}
