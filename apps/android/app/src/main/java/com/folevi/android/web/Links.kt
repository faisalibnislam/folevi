package com.folevi.android.web

import java.net.URI

/**
 * Where a link the page follows goes (the Android twin of the Electron Mac app's urls.ts linkTarget):
 * - [Target.App]: one of the app's own pages, shown in the web view;
 * - [Target.Browser]: another site, in a Custom Tab over the app;
 * - [Target.System]: mail, phone and text links, to the app that handles them;
 * - [Target.DeepLink]: a folevi:// link, handed to the page (lib/deepLink.ts reads it);
 * - [Target.Ignore]: nowhere (javascript:, file:, intent:, other apps' schemes, Folevi's pricing page).
 * A link to one of the product's pages on the website (a note link someone pasted) opens in the app; the
 * website's other pages (sign-in, /s/ share links) open in a Custom Tab.
 */
object Links {
    sealed interface Target {
        data class App(val path: String) : Target
        data object Browser : Target
        data object System : Target
        data class DeepLink(val url: String) : Target
        data object Ignore : Target
    }

    /** The product's pages (the first part of the path), as in apps/web/src/lib/app/routes.ts APP_ROUTE_HEADS. */
    val APP_ROUTE_HEADS = setOf(
        "documents", "notes", "d", "ai", "graph", "tasks", "inbox", "calendar", "review", "changes", "daily", "shared", "templates",
        "starred", "archive", "trash", "drafts", "unsorted", "folders", "tags", "settings", "help", "onboarding", "quick-add", "foli-ai",
    )

    fun target(raw: String, appOrigin: String, serviceOrigin: String, marketingHosts: Set<String> = setOf("folevi.com", "www.folevi.com")): Target {
        if (raw.length > 8192) return Target.Ignore
        val uri = parse(raw) ?: return Target.Ignore
        val scheme = uri.scheme?.lowercase() ?: return Target.Ignore
        return when (scheme) {
            "folevi" -> Target.DeepLink(raw)
            "mailto", "tel", "sms" -> Target.System
            "http", "https" -> {
                val origin = originOf(uri)
                val path = buildString {
                    append(uri.rawPath?.takeIf { it.isNotEmpty() } ?: "/")
                    uri.rawQuery?.let { append('?').append(it) }
                    uri.rawFragment?.let { append('#').append(it) }
                }
                val head = segments(uri).firstOrNull().orEmpty()
                when {
                    origin == appOrigin -> Target.App(path)
                    isPricing(uri, serviceOrigin, marketingHosts) -> Target.Ignore
                    origin == serviceOrigin && head in APP_ROUTE_HEADS -> Target.App(path)
                    else -> Target.Browser
                }
            }
            else -> Target.Ignore
        }
    }

    /** Folevi's pricing page is never opened from the app (no buying in the app, docs/ANDROID_PLAN.md). */
    private fun isPricing(uri: URI, serviceOrigin: String, marketingHosts: Set<String>): Boolean {
        val first = segments(uri).firstOrNull()?.lowercase() ?: return false
        if (first != "pricing" && first != "checkout" && first != "billing") return false
        val host = uri.host?.lowercase() ?: return false
        return host in marketingHosts || originOf(uri) == serviceOrigin || host.endsWith(".folevi.com")
    }

    fun parse(raw: String): URI? = runCatching { URI(raw.trim()) }.getOrNull()

    fun segments(uri: URI): List<String> = (uri.rawPath ?: "").split('/').filter { it.isNotEmpty() }.map { java.net.URLDecoder.decode(it.replace("+", "%2B"), "UTF-8") }

    fun originOf(raw: String): String = parse(raw)?.let { originOf(it) } ?: ""

    fun originOf(uri: android.net.Uri): String = originOf(uri.toString())

    fun originOf(uri: URI): String {
        val scheme = uri.scheme?.lowercase() ?: return ""
        val host = uri.host?.lowercase() ?: return ""
        val port = uri.port
        val default = (scheme == "https" && port == 443) || (scheme == "http" && port == 80) || port == -1
        return if (default) "$scheme://$host" else "$scheme://$host:$port"
    }

    /**
     * An App Link or a link from another app as a folevi:// link the page understands: https://app.folevi.com/d/<id>
     * becomes folevi://d/<id> (the block or comment kept), other product pages folevi://<page>. Null for anything else.
     */
    fun asDeepLink(raw: String, serviceOrigin: String): String? {
        val uri = parse(raw) ?: return null
        val scheme = uri.scheme?.lowercase()
        if (scheme == "folevi") return raw.takeIf { it.length <= 600 }
        if (scheme != "https" && scheme != "http") return null
        if (originOf(uri) != serviceOrigin) return null
        val segments = segments(uri)
        if (segments.isEmpty() || segments.size > 3) return null
        if (segments.any { !Regex("^[A-Za-z0-9_-]{1,64}$").matches(it) }) return null
        if (segments[0] !in setOf("d", "documents", "tasks", "calendar", "inbox", "settings", "foli-ai", "trash", "templates", "help")) return null
        val hash = uri.rawFragment?.let { "#$it" }.orEmpty()
        return "folevi://" + segments.joinToString("/") + hash
    }
}
