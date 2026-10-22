package com.folevi.android.extras

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.util.UUID

/**
 * Folevi's REST API (/api/v1, convex/restApiServer.ts) as the app's native parts use it with this phone's token
 * (DeviceCredential.kt): places, recent notes, today's tasks, a note or task in the Inbox, checking a task off,
 * moving a reminder. The same calls as the iPhone app's Shared/FoleviAPI.swift. Writes send an Idempotency-Key.
 */
class FoleviApi(private val base: String, private val token: String, private val http: OkHttpClient) {
    sealed class Failure(message: String) : Exception(message) {
        /** 401: the token was revoked, or the account can't be used. */
        class SignedOut : Failure("signed out")
        class RateLimited(val retryAfterSeconds: Long) : Failure("rate limited")
        class Offline : Failure("offline")
        class Refused(val status: Int, val code: String, message: String) : Failure(message)
    }

    data class Place(val id: String, val name: String)
    data class Note(val id: String, val title: String, val place: String, val updatedAt: String)
    data class Task(val id: String, val text: String, val dueDate: String?, val dueTime: String?, val priority: String?, val noteId: String, val noteTitle: String)

    private fun url(path: String, query: Map<String, String> = emptyMap()) = "${base.trimEnd('/')}/$path".toHttpUrl().newBuilder().apply { query.toSortedMap().forEach { (k, v) -> addQueryParameter(k, v) } }.build()

    private fun run(r: Request): JSONObject {
        val res = try {
            http.newCall(r).execute()
        } catch (e: java.io.IOException) {
            throw Failure.Offline()
        }
        res.use {
            val text = it.body.string()
            if (it.code == 401) throw Failure.SignedOut()
            if (it.code == 429) throw Failure.RateLimited(it.header("retry-after")?.toLongOrNull() ?: 60)
            if (!it.isSuccessful) {
                val e = runCatching { JSONObject(text).getJSONObject("error") }.getOrNull()
                throw Failure.Refused(it.code, e?.optString("code").orEmpty(), e?.optString("message") ?: "HTTP ${it.code}")
            }
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    private fun get(path: String, query: Map<String, String> = emptyMap()) =
        run(Request.Builder().url(url(path, query)).header("authorization", "Bearer $token").header("accept", "application/json").get().build())

    private fun send(method: String, path: String, body: JSONObject, key: String) =
        run(Request.Builder().url(url(path)).header("authorization", "Bearer $token").header("accept", "application/json").header("idempotency-key", key).method(method, body.toString().toRequestBody("application/json".toMediaType())).build())

    private fun <T> list(o: JSONObject, map: (JSONObject) -> T?): List<T> {
        val a = o.optJSONArray("data") ?: JSONArray()
        return (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(map) }
    }

    fun places(): List<Place> = list(get("places")) { Place(it.getString("id"), it.getString("name")) }

    fun recentNotes(limit: Int = 10): List<Note> = list(get("notes", mapOf("limit" to limit.toString()))) {
        Note(it.getString("id"), it.optString("title"), it.optJSONObject("place")?.optString("name").orEmpty(), it.optString("updatedAt"))
    }

    /** Open tasks due on or before `dueBefore` (YYYY-MM-DD). */
    fun openTasks(dueBefore: LocalDate): List<Task> = list(get("tasks", mapOf("status" to "open", "due_before" to dueBefore.toString(), "limit" to "200"))) {
        val note = it.optJSONObject("note") ?: JSONObject()
        Task(it.getString("id"), it.optString("text"), it.optString("dueDate").ifEmpty { null }, it.optString("dueTime").ifEmpty { null }, it.optString("priority").ifEmpty { null }, note.optString("id"), note.optString("title"))
    }

    /** A note in the Inbox of `place` ("personal" or a workspace id; null: Personal). */
    fun createNote(title: String, markdown: String, place: String?, key: String = UUID.randomUUID().toString()): String =
        send("POST", "notes", JSONObject().put("title", title.take(200)).put("markdown", markdown).put("inInbox", true).apply { if (place != null) put("place", place) }, key).optString("id")

    fun createTask(text: String, dueDate: String?, key: String = UUID.randomUUID().toString()): String =
        send("POST", "tasks", JSONObject().put("text", text.take(500)).apply { if (dueDate != null) put("dueDate", dueDate) }, key).optString("id")

    fun setTask(id: String, completed: Boolean) {
        send("PATCH", "tasks/$id", JSONObject().put("completed", completed), "complete-$id-$completed-${System.currentTimeMillis() / 60_000}")
    }

    /** Moves a task's reminder (a notification's Snooze): it rings again at `untilIso`. */
    fun snoozeTask(id: String, untilIso: String, untilMs: Long) {
        send("PATCH", "tasks/$id", JSONObject().put("remindAt", untilIso), "snooze-$id-${untilMs / 60_000}")
    }

    companion object {
        /** The API with this phone's token, or null when it holds none. */
        fun forDevice(context: android.content.Context): FoleviApi? {
            val c = DeviceCredential.get(context)
            val token = c.token() ?: return null
            return FoleviApi(c.apiBase, token, com.folevi.android.net.Http.client)
        }
    }
}
