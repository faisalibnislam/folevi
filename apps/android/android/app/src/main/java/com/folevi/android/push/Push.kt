package com.folevi.android.push

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.folevi.android.BuildConfig
import com.folevi.android.extras.FoleviApi
import com.folevi.android.host.Reminders
import com.getcapacitor.JSObject
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.time.Instant

/**
 * Notifications from Folevi on Android (docs/ANDROID_PLAN.md "Notifications"): Firebase Cloud Messaging, sent by
 * convex/fcmSend.ts. Never asked for at launch: Android asks when the person turns them on in Settings >
 * Notifications, or sets their first reminder in the app (lib/nativePush.ts). The page registers the token with
 * push.registerFcm. Firebase starts only when the build has the Firebase app's settings (BuildConfig.FIREBASE_*).
 *
 * A reminder shows "Reminder: <the to-do>" and its note, with Done (checks it off through the REST API with this
 * phone's token) and Snooze 1 hour (moves the reminder on Folevi; offline, the phone shows it again in an hour).
 * A mention or comment shows who and where, with Reply (opens the thread in the app) and Open.
 */
object Push {
    private const val PREFS = "folevi-push"

    fun configured(): Boolean = BuildConfig.FIREBASE_APP_ID.isNotEmpty() && BuildConfig.FIREBASE_API_KEY.isNotEmpty() && BuildConfig.FIREBASE_PROJECT_ID.isNotEmpty() && BuildConfig.FIREBASE_SENDER_ID.isNotEmpty()

    /** Starts Firebase with this build's settings (once); false when the build has none. */
    fun start(context: Context): Boolean {
        if (!configured()) return false
        if (FirebaseApp.getApps(context).isEmpty()) {
            FirebaseApp.initializeApp(
                context,
                FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build(),
            )
        }
        return true
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(context: Context) = prefs(context).getBoolean("enabled", false)

    fun permission(context: Context, asked: Boolean): String = when {
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED && NotificationManagerCompat.from(context).areNotificationsEnabled() -> "granted"
        asked -> "denied"
        else -> "notDetermined"
    }

    /** What lib/nativeApp.ts NativePushStatus says. Null when this build has no push at all. */
    fun status(context: Context): JSObject? {
        if (!configured()) return null
        val p = prefs(context)
        val asked = p.getBoolean("asked", false)
        val enabled = p.getBoolean("enabled", false)
        return JSObject()
            .put("permission", permission(context, asked))
            .put("enabled", enabled)
            .put("asked", asked)
            .put("token", if (enabled) p.getString("token", null) else null)
            .put("environment", "production")
            .put("bundleId", context.packageName)
    }

    fun markAsked(context: Context) = prefs(context).edit().putBoolean("asked", true).apply()

    /** Gets this phone's FCM token and keeps it; notifications are on from here. */
    suspend fun enable(context: Context): JSObject? {
        if (!start(context)) return null
        val token = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull()
        prefs(context).edit().putBoolean("enabled", token != null).putString("token", token).apply()
        return status(context)
    }

    suspend fun disable(context: Context) {
        prefs(context).edit().putBoolean("enabled", false).remove("token").apply()
        if (start(context)) runCatching { FirebaseMessaging.getInstance().deleteToken().await() }
        NotificationManagerCompat.from(context).cancelAll()
    }

    fun newToken(context: Context, token: String) {
        if (enabled(context)) prefs(context).edit().putString("token", token).apply()
    }

    // ---------------------------------------------------------------- showing one

    const val ACTION_DONE = "com.folevi.android.push.DONE"
    const val ACTION_SNOOZE = "com.folevi.android.push.SNOOZE"

    fun show(context: Context, data: Map<String, String>) {
        if (!enabled(context)) return
        val kind = data["kind"] ?: return
        val title = data["title"]?.take(120) ?: return
        val body = data["body"].orEmpty().take(240)
        val path = data["path"]?.takeIf { Regex("^/[A-Za-z0-9/_#-]{0,200}$").matches(it) } ?: "/documents"
        val id = (data["collapseId"] ?: "$kind:$path").hashCode()
        val reminder = kind == "reminder"
        Reminders.show(context, id, title, body, path, if (reminder) Reminders.CHANNEL_REMINDERS else Reminders.CHANNEL_ACTIVITY) { n ->
            data["threadId"]?.let { n.setGroup("note:$it") }
            val taskId = data["taskId"]
            if (reminder && taskId != null && Regex("^[A-Za-z0-9_-]{1,64}$").matches(taskId)) {
                n.addAction(0, "Done", action(context, ACTION_DONE, id, taskId, title, body, path))
                n.addAction(0, "Snooze 1 hour", action(context, ACTION_SNOOZE, id, taskId, title, body, path))
            } else if (kind == "mention") {
                // Reply opens the thread in the app (its #comment link), where the reply is written.
                n.addAction(0, "Reply", Reminders.openIntent(context, path, id + 1))
                n.addAction(0, "Open", Reminders.openIntent(context, path, id + 2))
            }
        }
    }

    private fun action(context: Context, action: String, id: Int, taskId: String, title: String, body: String, path: String): PendingIntent {
        val i = Intent(context, PushActionReceiver::class.java).setAction(action)
            .putExtra("id", id).putExtra("taskId", taskId).putExtra("title", title).putExtra("body", body).putExtra("path", path)
        return PendingIntent.getBroadcast(context, id * 2 + if (action == ACTION_DONE) 0 else 1, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}

class FoleviMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) = Push.show(this, message.data)

    override fun onNewToken(token: String) = Push.newToken(this, token)
}

/** Done and Snooze 1 hour on a reminder, without opening the app. */
class PushActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getStringExtra("taskId") ?: return
        val id = intent.getIntExtra("id", 0)
        NotificationManagerCompat.from(context).cancel(id)
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val api = FoleviApi.forDevice(context)
                when (intent.action) {
                    Push.ACTION_DONE -> runCatching { api?.setTask(taskId, true) }
                    Push.ACTION_SNOOZE -> {
                        val until = System.currentTimeMillis() + 60 * 60_000L
                        val moved = api != null && runCatching { api.snoozeTask(taskId, Instant.ofEpochMilli(until).toString(), until) }.isSuccess
                        // Offline: the phone shows the same reminder again itself in an hour.
                        if (!moved) Reminders(context).schedule(Reminders.Reminder("snooze:$taskId", until, intent.getStringExtra("title").orEmpty(), intent.getStringExtra("body").orEmpty(), intent.getStringExtra("path") ?: "/tasks/today"))
                    }
                }
            } finally {
                pending.finish()
            }
        }
    }
}
