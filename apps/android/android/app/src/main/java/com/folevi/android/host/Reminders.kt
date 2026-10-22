package com.folevi.android.host

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.folevi.android.MainActivity
import com.folevi.android.R
import org.json.JSONObject
import java.io.File

/**
 * Local reminders (`foleviShell.notify`, docs/LOCAL_MODE_PLAN.md §3.12): the page keeps the phone's alarms in step
 * with the open to-dos that have a reminder. Kept in `reminders.json` so they survive a restart (BootReceiver puts
 * them back); each id and time shows once, and one whose time has passed (the phone was off) shows at once, at
 * most a day late. Tapping one opens Folevi at the to-do. Exact alarms where Android allows them, else within a
 * few minutes.
 */
class Reminders(private val context: Context) {
    private val file = File(context.noBackupFilesDir, "reminders.json")
    private val lock = Any()

    data class Reminder(val id: String, val at: Long, val title: String, val body: String, val path: String)

    private fun load(): MutableMap<String, Reminder> = synchronized(lock) {
        val out = LinkedHashMap<String, Reminder>()
        if (!file.isFile) return out
        runCatching {
            val o = JSONObject(file.readText())
            for (k in o.keys()) {
                val r = o.getJSONObject(k)
                out[k] = Reminder(k, r.getLong("at"), r.getString("title"), r.getString("body"), r.getString("path"))
            }
        }
        out
    }

    private fun save(all: Map<String, Reminder>) = synchronized(lock) {
        val o = JSONObject()
        for (r in all.values) o.put(r.id, JSONObject().put("at", r.at).put("title", r.title).put("body", r.body).put("path", r.path))
        com.folevi.android.library.MirrorStore.atomicWrite(file, o.toString().toByteArray())
    }

    fun schedule(r: Reminder) {
        val all = load()
        all[r.id] = r
        save(all)
        arm(r)
    }

    fun cancel(id: String) {
        val all = load()
        all.remove(id)
        save(all)
        alarms().cancel(pending(id, null, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE) ?: return)
    }

    /** After a restart: every reminder that's still ahead is armed again; one missed by less than a day shows now. */
    fun rearm() {
        val now = System.currentTimeMillis()
        val all = load()
        val keep = all.filterValues { it.at > now - DAY }
        if (keep.size != all.size) save(keep)
        keep.values.forEach { arm(it) }
    }

    private fun alarms() = context.getSystemService(AlarmManager::class.java)

    private fun pending(id: String, r: Reminder?, flags: Int): PendingIntent? {
        val intent = Intent(context, ReminderReceiver::class.java).setAction(ACTION).setData(Uri.parse("folevi-reminder:$id"))
        if (r != null) intent.putExtra("id", r.id).putExtra("at", r.at)
        return PendingIntent.getBroadcast(context, 0, intent, flags)
    }

    private fun arm(r: Reminder) {
        val pi = pending(r.id, r, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)!!
        val at = maxOf(r.at, System.currentTimeMillis() + 1000)
        val am = alarms()
        if (am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi) else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    /** The alarm went off: shows the reminder (once for this id and time). */
    fun fire(id: String, at: Long) {
        val all = load()
        val r = all[id] ?: return
        if (r.at != at) return
        all.remove(id)
        save(all)
        if (System.currentTimeMillis() - r.at > DAY) return
        show(context, id.hashCode(), r.title, r.body, r.path, CHANNEL_REMINDERS)
    }

    companion object {
        const val ACTION = "com.folevi.android.REMINDER"
        const val CHANNEL_REMINDERS = "reminders"
        const val CHANNEL_ACTIVITY = "activity"
        const val DAY = 24 * 60 * 60 * 1000L

        fun channels(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL_REMINDERS, context.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_HIGH).apply { description = context.getString(R.string.channel_reminders_about) })
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ACTIVITY, context.getString(R.string.channel_activity), NotificationManager.IMPORTANCE_DEFAULT).apply { description = context.getString(R.string.channel_activity_about) })
        }

        fun allowed(context: Context) = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

        /** Folevi at a page (a note's to-do), as the activity's deep link. */
        fun openIntent(context: Context, path: String, request: Int): PendingIntent {
            val link = "folevi://" + path.removePrefix("/")
            val i = Intent(Intent.ACTION_VIEW, Uri.parse(link), context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            return PendingIntent.getActivity(context, request, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }

        fun show(context: Context, notificationId: Int, title: String, body: String, path: String, channel: String, build: (NotificationCompat.Builder) -> Unit = {}) {
            if (!allowed(context)) return
            val n = NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_stat_folevi)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setCategory(if (channel == CHANNEL_REMINDERS) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_SOCIAL)
                .setContentIntent(openIntent(context, path, notificationId))
            build(n)
            runCatching { NotificationManagerCompat.from(context).notify(notificationId, n.build()) }
        }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Reminders.ACTION) return
        Reminders(context).fire(intent.getStringExtra("id") ?: return, intent.getLongExtra("at", 0))
    }
}

/** After a restart (or an app update), the reminders are armed again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) Reminders(context).rearm()
    }
}
