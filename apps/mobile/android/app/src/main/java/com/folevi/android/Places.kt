package com.folevi.android

import android.content.Context
import com.folevi.android.server.ShellServer
import org.json.JSONArray
import org.json.JSONObject

/**
 * Several places on Android (docs/MULTI_ACCOUNT_PLAN.md §2.2; the twin of the Electron Mac app's places.ts):
 * the library on this phone and any number of Folevi accounts, each with its own session (AuthBridge,
 * `auth.session.<user id>`), encryption keys (DeviceKeys under e2ee/accounts/<user id>) and data. This keeps the
 * list: which place the app shows, the accounts (what each account's own page last said of itself, for the
 * switcher) and Quick Add's last place. Nothing here is secret. The app has one web view: the open place is the
 * page's place. Pure logic over a [Store], so the JVM tests run it without Android.
 *
 * An account can be on a Folevi Server ([ShellServer], docs/self-hosting/CONTRACT.md §6): it keeps its server's
 * addresses with it; one without is Folevi Cloud's, as every account was before (older files read unchanged).
 */
class Places(private val store: Store, private val onChange: (State) -> Unit = {}) {
    interface Store {
        fun read(): String?
        fun write(json: String)
    }

    data class Workspace(val id: String, val name: String, val logoUrl: String?)

    data class Account(
        val userId: String,
        val profileId: String? = null,
        val name: String = "",
        val email: String = "",
        val avatarUrl: String? = null,
        val workspaces: List<Workspace> = emptyList(),
        val unread: Int = 0,
        val reminders: Int = 0,
        val waiting: Int = 0,
        /** The Folevi Server this account is on; null: Folevi Cloud. */
        val server: ShellServer? = null,
    ) {
        val id get() = "acct:$userId"
    }

    data class State(
        val current: String? = null,
        val library: Boolean = false,
        val accounts: List<Account> = emptyList(),
        val quickAdd: String? = null,
        val lastAdded: String? = null,
    )

    @Volatile var state: State = parse(store.read())
        private set

    /** Account mode with no account yet (the sign-in screen). For this run only. */
    @Volatile var pendingAccount = false

    /** The server that sign-in screen is for (addServerPlace); null: Folevi Cloud's. For this run only. */
    @Volatile var pendingServer: ShellServer? = null
        private set

    /**
     * The server a place is on: an account's own, or, for the sign-in screen (null), the server it signs in to.
     * Null: Folevi Cloud (or the library).
     */
    fun serverOf(place: String?): ShellServer? =
        if (place == null) pendingServer.takeIf { pendingAccount } else state.accounts.firstOrNull { it.id == place }?.server

    /** The server of the open place (or its sign-in screen): where AuthBridge signs in and sends /api/auth. */
    val actingServer: ShellServer? get() = serverOf(state.current)

    /**
     * Whether an account with this user id is already here from another server than the acting one (the open
     * sign-in screen's; null is Folevi Cloud): a sign-in that comes back with such an id is refused (AuthBridge).
     */
    fun belongsElsewhere(userId: String): Boolean {
        val existing = state.accounts.firstOrNull { it.userId == userId } ?: return false
        return !ShellServer.same(existing.server, actingServer)
    }

    /** The server an account is on, by its user id. */
    fun serverOfUser(userId: String?): ShellServer? = userId?.let { u -> state.accounts.firstOrNull { it.userId == u }?.server }

    val exists: Boolean get() = store.read() != null

    fun has(place: String?): Boolean = place != null && ((place == LIBRARY && state.library) || state.accounts.any { it.id == place })

    val currentUserId: String? get() = userIdOf(state.current)

    fun modeOf(place: String?): String = when {
        place == LIBRARY -> "local"
        userIdOf(place) != null -> "account"
        pendingAccount -> "account"
        else -> "unset"
    }

    @Synchronized
    private fun commit(next: State) {
        state = clean(next)
        store.write(serialize(state))
        onChange(state)
    }

    /** `server`: with `pending`, the sign-in screen is that server's (null: Folevi Cloud's). */
    @Synchronized
    fun setCurrent(place: String?, pending: Boolean = false, server: ShellServer? = null) {
        if (place != null && !has(place)) return
        pendingAccount = place == null && pending
        pendingServer = if (pendingAccount) server else null
        commit(state.copy(current = place))
    }

    /** The origin a server place uses now (the page's best connection); one of its names only. True when it changed. */
    @Synchronized
    fun setActiveOrigin(place: String, origin: String): Boolean {
        val s = state
        val a = s.accounts.firstOrNull { it.id == place } ?: return false
        val server = a.server ?: return false
        if (origin !in server.candidates) return false
        val active = origin.takeIf { it != server.origin }
        if (server.active == active) return false
        commit(s.copy(accounts = s.accounts.map { if (it.id == place) it.copy(server = server.copy(active = active)) else it }))
        return true
    }

    @Synchronized
    fun setLibrary(on: Boolean) {
        val s = state
        commit(s.copy(library = on, current = if (!on && s.current == LIBRARY) null else s.current, quickAdd = if (!on && s.quickAdd == LIBRARY) null else s.quickAdd))
    }

    /**
     * A new account is on the server the sign-in went to ([actingServer]), unless `server` is given. An account
     * already here keeps its own.
     */
    @Synchronized
    fun addAccount(userId: String, name: String, email: String, avatarUrl: String?, server: ShellServer? = actingServer): Account? {
        if (!ID.matches(userId)) return null
        val s = state
        val existing = s.accounts.firstOrNull { it.userId == userId }
        val next = (existing ?: Account(userId, server = server)).copy(
            name = name.ifEmpty { existing?.name ?: "" }.take(120),
            email = email.ifEmpty { existing?.email ?: "" }.take(254),
            avatarUrl = avatarUrl ?: existing?.avatarUrl,
        )
        val accounts = if (existing != null) s.accounts.map { if (it.userId == userId) next else it } else s.accounts + next
        commit(s.copy(accounts = accounts, lastAdded = next.id))
        return state.accounts.firstOrNull { it.userId == userId }
    }

    /** What the open account's page says of itself. */
    @Synchronized
    fun describe(place: String, d: JSONObject) {
        val s = state
        val a = s.accounts.firstOrNull { it.id == place } ?: return
        val ws = d.optJSONArray("workspaces")?.let { arr ->
            (0 until minOf(arr.length(), 50)).mapNotNull { i ->
                val w = arr.optJSONObject(i) ?: return@mapNotNull null
                val id = w.optString("id")
                if (!ID.matches(id) || !w.has("name")) null else Workspace(id, w.optString("name").take(120), w.optString("logoUrl").takeIf { it.startsWith("https://") })
            }
        }
        fun count(k: String, was: Int) = if (d.has(k)) d.optInt(k, was).coerceIn(0, 1_000_000) else was
        val next = a.copy(
            profileId = d.optString("profileId").takeIf { ID.matches(it) } ?: a.profileId,
            name = d.optString("name").ifEmpty { a.name }.take(120),
            email = d.optString("email").ifEmpty { a.email }.take(254),
            avatarUrl = if (d.has("avatarUrl")) d.optString("avatarUrl").takeIf { it.startsWith("https://") } else a.avatarUrl,
            workspaces = ws ?: a.workspaces,
            unread = count("unread", a.unread),
            reminders = count("reminders", a.reminders),
            waiting = count("waiting", a.waiting),
        )
        if (next == a) return
        commit(s.copy(accounts = s.accounts.map { if (it.id == place) next else it }))
    }

    /** Removes an account; returns the place the app opens next when it was the open one. */
    @Synchronized
    fun removeAccount(place: String): String? {
        val s = state
        val accounts = s.accounts.filter { it.id != place }
        val current = if (s.current == place) accounts.firstOrNull()?.id ?: (if (s.library) LIBRARY else null) else s.current
        commit(s.copy(accounts = accounts, current = current, quickAdd = s.quickAdd.takeIf { it != place }, lastAdded = s.lastAdded.takeIf { it != place }))
        return state.current
    }

    @Synchronized
    fun setQuickAdd(place: String) {
        if (has(place)) commit(state.copy(quickAdd = place))
    }

    /** The places as the page lists them (apps/web/src/lib/shell/types.ts ShellPlace). */
    fun list(libraryKind: String?, displayPath: String, configured: Boolean): JSONArray {
        val out = JSONArray()
        val s = state
        if (s.library) {
            out.put(JSONObject().put("kind", "library").put("id", LIBRARY).put("configured", configured).put("syncs", libraryKind ?: JSONObject.NULL).put("displayPath", displayPath).put("unread", 0).put("reminders", 0).put("waiting", 0))
        }
        for (a in s.accounts) {
            val ws = JSONArray()
            for (w in a.workspaces) ws.put(JSONObject().put("id", w.id).put("name", w.name).put("logoUrl", w.logoUrl ?: JSONObject.NULL))
            out.put(
                JSONObject().put("kind", "account").put("id", a.id).put("userId", a.userId).put("profileId", a.profileId ?: JSONObject.NULL).put("name", a.name).put("email", a.email)
                    .put("avatarUrl", a.avatarUrl ?: JSONObject.NULL).put("workspaces", ws).put("unread", a.unread).put("reminders", a.reminders).put("waiting", a.waiting)
                    // Folevi Server places (CONTRACT §6.1): the server's name and addresses; null: Folevi Cloud.
                    .put("server", a.server?.json() ?: JSONObject.NULL),
            )
        }
        return out
    }

    /** A first run of this version: where the app was (its mode) becomes the places. */
    @Synchronized
    fun migrate(mode: String, libraryConfigured: Boolean) {
        if (exists) return
        pendingAccount = mode == "account"
        commit(State(current = if (mode == "local") LIBRARY else null, library = libraryConfigured || mode == "local"))
    }

    companion object {
        const val LIBRARY = "library"
        private val ID = Regex("^[A-Za-z0-9_-]{1,64}$")

        fun userIdOf(place: String?): String? = place?.takeIf { it.startsWith("acct:") }?.removePrefix("acct:")?.takeIf { ID.matches(it) }

        private fun clean(s: State): State {
            val seen = HashSet<String>()
            val accounts = s.accounts.filter { ID.matches(it.userId) && seen.add(it.userId) }
            fun valid(p: String?) = p != null && ((p == LIBRARY && s.library) || accounts.any { it.id == p })
            return s.copy(accounts = accounts, current = s.current.takeIf(::valid), quickAdd = s.quickAdd.takeIf(::valid), lastAdded = s.lastAdded.takeIf(::valid))
        }

        fun parse(raw: String?): State {
            if (raw == null) return State()
            val o = runCatching { JSONObject(raw) }.getOrNull() ?: return State()
            val accounts = ArrayList<Account>()
            val arr = o.optJSONArray("accounts") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val a = arr.optJSONObject(i) ?: continue
                val ws = a.optJSONArray("workspaces") ?: JSONArray()
                accounts.add(
                    Account(
                        userId = a.optString("userId"),
                        profileId = a.optString("profileId").takeIf { ID.matches(it) },
                        name = a.optString("name"),
                        email = a.optString("email"),
                        avatarUrl = a.optString("avatarUrl").takeIf { it.startsWith("https://") },
                        workspaces = (0 until ws.length()).mapNotNull { j -> ws.optJSONObject(j)?.let { w -> Workspace(w.optString("id"), w.optString("name"), w.optString("logoUrl").takeIf { it.startsWith("https://") }) } }.filter { ID.matches(it.id) },
                        unread = a.optInt("unread"),
                        reminders = a.optInt("reminders"),
                        waiting = a.optInt("waiting"),
                        server = ShellServer.fromStore(a.optJSONObject("server")),
                    ),
                )
            }
            fun str(k: String) = if (o.isNull(k)) null else o.optString(k).ifEmpty { null }
            return clean(State(current = str("current"), library = o.optBoolean("library"), accounts = accounts, quickAdd = str("quickAdd"), lastAdded = str("lastAdded")))
        }

        fun serialize(s: State): String {
            val arr = JSONArray()
            for (a in s.accounts) {
                val ws = JSONArray()
                for (w in a.workspaces) ws.put(JSONObject().put("id", w.id).put("name", w.name).put("logoUrl", w.logoUrl ?: JSONObject.NULL))
                val o = JSONObject().put("userId", a.userId).put("profileId", a.profileId ?: JSONObject.NULL).put("name", a.name).put("email", a.email).put("avatarUrl", a.avatarUrl ?: JSONObject.NULL)
                    .put("workspaces", ws).put("unread", a.unread).put("reminders", a.reminders).put("waiting", a.waiting)
                // Only a server's account has the key: a file from before servers writes back unchanged.
                a.server?.let { o.put("server", it.store()) }
                arr.put(o)
            }
            return JSONObject().put("v", 1).put("current", s.current ?: JSONObject.NULL).put("library", s.library).put("accounts", arr).put("quickAdd", s.quickAdd ?: JSONObject.NULL).put("lastAdded", s.lastAdded ?: JSONObject.NULL).toString()
        }

        /** The app's own store: shared preferences that never leave the phone. */
        fun preferences(context: Context): Store {
            val prefs = context.applicationContext.getSharedPreferences("folevi-places", Context.MODE_PRIVATE)
            return object : Store {
                override fun read() = prefs.getString("places", null)
                override fun write(json: String) {
                    prefs.edit().putString("places", json).commit()
                }
            }
        }
    }
}
