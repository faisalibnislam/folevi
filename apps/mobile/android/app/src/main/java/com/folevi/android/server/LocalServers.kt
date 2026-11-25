package com.folevi.android.server

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.net.Inet6Address
import java.net.InetAddress
import kotlin.coroutines.resume

/**
 * Folevi servers on this network (DNS-SD `_folevi._tcp`, CONTRACT §6.1), for the sign-in screen's "found on your
 * home network": the Android twin of iOS's LocalServers (Bonjour). Each server says its TXT `id` (Folevi Connect's
 * server id), `name`, `v` (version) and `url` (the https origin to use, when it has a certificate); without `url`
 * the app uses `http://<address>:<port>`, a home address. Browsing runs only while the screen asks.
 */
class LocalServers(context: Context) {
    private val nsd = context.applicationContext.getSystemService(NsdManager::class.java)

    /** What's found within `waitMs`: [{ name, origin, serverId, version }]. */
    suspend fun list(waitMs: Long = 2_000): List<JSONObject> {
        val found = LinkedHashMap<String, NsdServiceInfo>()
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                synchronized(found) { found[info.serviceName] = info }
            }
            override fun onServiceLost(info: NsdServiceInfo) {
                synchronized(found) { found.remove(info.serviceName) }
            }
        }
        val started = runCatching { nsd.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, listener) }.isSuccess
        if (!started) return emptyList()
        try {
            delay(waitMs)
        } finally {
            runCatching { nsd.stopServiceDiscovery(listener) }
        }
        val services = synchronized(found) { found.values.toList() }.take(20)
        val out = ArrayList<JSONObject>()
        val seen = HashSet<String>()
        // One resolve at a time (NsdManager refuses a second while one runs).
        for (s in services) {
            val r = resolve(s) ?: continue
            val txt = r.attributes.mapValues { (_, v) -> v?.toString(Charsets.UTF_8) }
            @Suppress("DEPRECATION")
            val entry = entry(r.serviceName, txt, r.host, r.port) ?: continue
            if (seen.add(entry.getString("origin"))) out += entry
        }
        return out
    }

    @Suppress("DEPRECATION")
    private suspend fun resolve(info: NsdServiceInfo): NsdServiceInfo? = withTimeoutOrNull(3_000) {
        suspendCancellableCoroutine { cont ->
            val l = object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                    if (cont.isActive) cont.resume(null)
                }
                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                    if (cont.isActive) cont.resume(serviceInfo)
                }
            }
            runCatching { nsd.resolveService(info, l) }.onFailure { if (cont.isActive) cont.resume(null) }
        }
    }

    companion object {
        const val TYPE = "_folevi._tcp"

        /**
         * One found server as the page lists it, or null when it gives no address Folevi uses. `url` (TXT) wins;
         * otherwise the resolved address and port, over http (a home address, so http is allowed).
         */
        fun entry(serviceName: String, txt: Map<String, String?>, host: InetAddress?, port: Int): JSONObject? {
            val origin = txt["url"]?.let(ShellServer::normalizeOrigin) ?: run {
                if (host == null || port !in 1..65535) return null
                val address = host.hostAddress?.substringBefore('%') ?: return null
                val shown = if (host is Inet6Address) "[$address]" else address
                ShellServer.normalizeOrigin("http://$shown:$port")
            } ?: return null
            return JSONObject()
                .put("name", (txt["name"]?.takeIf { it.isNotBlank() } ?: serviceName).take(120))
                .put("origin", origin)
                .put("serverId", txt["id"]?.takeIf { Regex("^[a-z0-9]{1,32}$").matches(it) } ?: JSONObject.NULL)
                .put("version", txt["v"]?.take(40) ?: JSONObject.NULL)
        }
    }
}
