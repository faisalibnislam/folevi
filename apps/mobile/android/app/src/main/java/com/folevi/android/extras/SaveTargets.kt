package com.folevi.android.extras

import android.content.Context
import com.folevi.android.FoleviApp
import com.folevi.android.Places

/**
 * Where the share target and Quick add save to when this phone holds several places (docs/MULTI_ACCOUNT_PLAN.md
 * §6; the iPhone app's Shared/SaveTargets.swift): the library and each account (Places.kt), the one chosen last
 * first (Places' Quick Add place, shared with the app's own Quick add). An account is reached with its own REST
 * token (DeviceCredential.tokenFor); the library has no REST API, so what's saved to it waits in LocalActions or
 * the share queue, tagged with the place, for the library's page. One place: nothing here shows.
 */
object SaveTargets {
    data class Target(val id: String, val name: String, val detail: String) {
        val isLibrary get() = id == Places.LIBRARY
        val userId get() = Places.userIdOf(id)
    }

    private val places get() = FoleviApp.instance.places

    fun all(): List<Target> {
        val s = places.state
        val out = ArrayList<Target>()
        if (s.library) out.add(Target(Places.LIBRARY, "On this phone", "Kept on this device only"))
        for (a in s.accounts) out.add(Target(a.id, a.name.ifEmpty { a.email }, a.email))
        return out
    }

    fun several(): Boolean = all().size > 1

    fun target(id: String?): Target? = all().firstOrNull { it.id == id }

    /** What a picker starts on: the place chosen last, else the open one, else the first. */
    fun preferred(): Target? {
        val list = all()
        val s = places.state
        return list.firstOrNull { it.id == s.quickAdd } ?: list.firstOrNull { it.id == s.current } ?: list.firstOrNull()
    }

    fun remember(id: String) = places.setQuickAdd(id)

    fun isOpen(id: String): Boolean {
        val local = FoleviApp.instance.settings.mode == "local"
        return if (id == Places.LIBRARY) local else !local && places.state.current == id
    }

    /** The REST API with that account's own token; null for the library, or an account with no token here yet. */
    fun api(context: Context, target: Target): FoleviApi? {
        val user = target.userId ?: return null
        val c = DeviceCredential.get(context)
        val token = c.tokenFor(user) ?: (if (isOpen(target.id)) c.token() else null) ?: return null
        return FoleviApi(c.apiBase, token, com.folevi.android.net.Http.client)
    }
}
