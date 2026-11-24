package com.folevi.android.extras

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.folevi.android.FoleviApp
import java.util.concurrent.TimeUnit

/**
 * What Folevi does for this phone's places while the app isn't open (docs/MULTI_ACCOUNT_PLAN.md §5.3). Android
 * doesn't keep the web view running in the background, and each place's notes, edits and encryption live in its
 * page, so a place that isn't open can't sync its notes until it opens. With each account's own REST token
 * (DeviceCredential.tokenFor) this sends what the share target saved to an account that isn't open
 * while the phone was offline. WorkManager runs it about every 15 minutes with a network (Android's shortest
 * period; Doze and battery saver can make it much rarer). The library's queue waits for the library's page.
 */
object PlaceOutbox {
    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<PlaceOutboxWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("place-outbox", ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** Sends what's waiting for each account that isn't open; how many went. */
    fun send(context: Context): Int {
        val places = FoleviApp.instance.places
        val open = places.state.current
        var sent = 0
        for (account in places.state.accounts) {
            if (account.id == open && FoleviApp.instance.settings.mode != "local") continue
            val api = SaveTargets.api(context, SaveTargets.Target(account.id, account.name, account.email)) ?: continue
            // Shares with files need the page's upload; text and links go now.
            val shares = ShareQueue.get(context)
            for (w in shares.waitingFor(account.id)) {
                if (w.hasFiles) continue
                val markdown = (if (w.text.contains(w.url)) listOf(w.text) else listOf(w.url, w.text)).filter { it.isNotEmpty() }.joinToString("\n\n")
                val failure = runCatching { api.createNote(w.title.ifEmpty { "Untitled" }, markdown, w.place, key = w.id) }.exceptionOrNull()
                if (failure is FoleviApi.Failure.Offline || failure is FoleviApi.Failure.RateLimited) return sent
                if (failure == null) {
                    shares.remove(w.id)
                    sent++
                }
            }
        }
        return sent
    }
}

class PlaceOutboxWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        // Only with several places is there anything for an account that isn't open.
        if (FoleviApp.instance.places.state.accounts.size + (if (FoleviApp.instance.places.state.library) 1 else 0) < 2) return Result.success()
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { PlaceOutbox.send(applicationContext) }
        return Result.success()
    }
}
