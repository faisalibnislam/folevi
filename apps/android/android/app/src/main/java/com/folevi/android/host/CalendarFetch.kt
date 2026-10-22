package com.folevi.android.host

import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

/**
 * Subscribed calendars in local mode (`foleviShell.http.calendar`, docs/LOCAL_MODE_PLAN.md WP14): the phone fetches
 * a calendar's text straight from its own site, never through Folevi. The Mac's rules (apps/desktop/src/
 * calendarFetch.ts) with the same words: https only (webcal:// read as https://), the standard port, no user or
 * password, never Folevi's hosts, never a private, loopback or link-local address (checked on every address DNS
 * gives, at connection time), at most 3 redirects each checked again, 10 seconds, 5 MB, no cookies. The address
 * can carry a secret, so it's never logged.
 */
class CalendarFetch(base: OkHttpClient, private val serviceHost: String, private val resolve: (String) -> List<InetAddress> = { InetAddress.getAllByName(it).toList() }) {
    private val client = base.newBuilder()
        .followRedirects(false)
        .followSslRedirects(false)
        .callTimeout(10, TimeUnit.SECONDS)
        .dns(object : Dns {
            override fun lookup(hostname: String): List<InetAddress> {
                val all = try {
                    resolve(hostname)
                } catch (e: UnknownHostException) {
                    throw UnknownHostException("not found")
                }
                if (all.isEmpty()) throw UnknownHostException("not found")
                if (all.any { isPrivate(it) }) throw PrivateAddress()
                return all
            }
        })
        .build()

    class PrivateAddress : UnknownHostException("private")

    private fun failed(why: String) = JSONObject().put("kind", "error").put("message", "Couldn't load this calendar: $why")

    fun download(raw: String, etag: String?, lastModified: String?): JSONObject {
        if (raw.length > 2000) return failed("the address isn't a web link it can open.")
        var current = raw.trim().replace(Regex("^webcals?://", RegexOption.IGNORE_CASE), "https://")
        for (hop in 0..MAX_REDIRECTS) {
            addressProblem(current)?.let { return failed(it) }
            val b = Request.Builder().url(current).get()
                .header("accept", "text/calendar, text/plain;q=0.9, */*;q=0.5")
                .header("user-agent", "Mozilla/5.0 (compatible; FoleviCalendar/1.0; +https://folevi.com)")
            if (hop == 0 && etag != null && etag.length <= 500) b.header("if-none-match", etag)
            if (hop == 0 && lastModified != null && lastModified.length <= 100) b.header("if-modified-since", lastModified)
            val res = try {
                client.newCall(b.build()).execute()
            } catch (e: PrivateAddress) {
                return failed("addresses on private or local networks can't be used.")
            } catch (e: UnknownHostException) {
                return failed("the address couldn't be found.")
            } catch (e: java.io.InterruptedIOException) {
                return failed("the address took too long to answer.")
            } catch (e: java.io.IOException) {
                return failed("the address couldn't be reached.")
            }
            res.use {
                if (it.code == 304) return JSONObject().put("kind", "notModified")
                if (it.code in 300..399) {
                    val location = it.header("location") ?: return failed("the address returned ${it.code}.")
                    current = (it.request.url.resolve(location)?.toString() ?: return failed("the address returned ${it.code}.")).replace(Regex("^webcals?://", RegexOption.IGNORE_CASE), "https://")
                    return@use
                }
                if (!it.isSuccessful) return failed("the address returned ${it.code}.")
                if ((it.header("content-length")?.toLongOrNull() ?: 0) > MAX_BYTES) return failed("it's larger than 5 MB.")
                val source = it.body.source()
                source.request(MAX_BYTES + 1L)
                val bytes = source.buffer.readByteArray(minOf(source.buffer.size, MAX_BYTES + 1L))
                if (bytes.size > MAX_BYTES) return failed("it's larger than 5 MB.")
                val text = String(bytes, Charsets.UTF_8).removePrefix("﻿")
                if (!Regex("BEGIN:VCALENDAR", RegexOption.IGNORE_CASE).containsMatchIn(text.take(4096))) return failed("the address didn't return a calendar.")
                return JSONObject().put("kind", "ok").put("text", text).put("etag", it.header("etag")).put("lastModified", it.header("last-modified"))
            }
        }
        return failed("the address redirected too many times.")
    }

    /** Why an address can't be fetched (before DNS), in the Mac's words, or null. */
    fun addressProblem(raw: String): String? {
        val scheme = raw.substringBefore(':', "").lowercase()
        if (scheme == "http") return "this phone only reads calendars from secure (https) links."
        val url = raw.toHttpUrlOrNull() ?: return "the address isn't a web link it can open."
        if (url.scheme != "https") return "the address isn't a web link it can open."
        if (url.username.isNotEmpty() || url.password.isNotEmpty() || url.port != 443) return "the address isn't a web link it can open."
        val host = url.host.lowercase().trimEnd('.')
        if (host == serviceHost.lowercase() || host == "folevi.com" || host.endsWith(".folevi.com") || host.endsWith(".convex.cloud") || host.endsWith(".convex.site")) return "Folevi's own addresses can't be subscribed to."
        if (IP_LITERAL.matches(host) || host.contains(':')) return if (runCatching { isPrivate(InetAddress.getByName(host)) }.getOrDefault(true)) "addresses on private or local networks can't be used." else null
        if (!host.contains('.') || host == "localhost" || INTERNAL.any { host.endsWith(it) } || Regex("^[\\d.]+$").matches(host)) return "addresses on private or local networks can't be used."
        return null
    }

    companion object {
        const val MAX_BYTES = 5 * 1024 * 1024
        const val MAX_REDIRECTS = 3
        private val IP_LITERAL = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")
        private val INTERNAL = listOf(".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".home.arpa", ".onion")

        /** Loopback, private, link-local, carrier-grade NAT, documentation, multicast and reserved ranges. */
        fun isPrivate(a: InetAddress): Boolean {
            if (a.isAnyLocalAddress || a.isLoopbackAddress || a.isLinkLocalAddress || a.isSiteLocalAddress || a.isMulticastAddress) return true
            val b = a.address.map { it.toInt() and 0xff }
            if (a is Inet4Address) {
                val (x, y, z) = Triple(b[0], b[1], b[2])
                return x == 0 || x == 10 || x == 127 || (x == 100 && y in 64..127) || (x == 169 && y == 254) || (x == 172 && y in 16..31) || (x == 192 && y == 168) ||
                    (x == 192 && y == 0 && (z == 0 || z == 2)) || (x == 198 && (y == 18 || y == 19)) || (x == 198 && y == 51 && z == 100) || (x == 203 && y == 0 && z == 113) || x >= 224
            }
            if (a is Inet6Address) {
                if ((b[0] and 0xfe) == 0xfc) return true
                if (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8) return true
                val mapped = b.subList(0, 10).all { it == 0 } && ((b[10] == 0xff && b[11] == 0xff) || (b[10] == 0 && b[11] == 0))
                val nat64 = b[0] == 0 && b[1] == 0x64 && b[2] == 0xff && b[3] == 0x9b && b.subList(4, 12).all { it == 0 }
                if (mapped || nat64) return isPrivate(InetAddress.getByAddress(b.subList(12, 16).map { it.toByte() }.toByteArray()))
            }
            return false
        }
    }
}
