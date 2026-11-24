package com.folevi.android.net

import com.folevi.android.BuildConfig
import okhttp3.Dns
import okhttp3.OkHttpClient
import java.net.InetAddress
import java.util.concurrent.TimeUnit

/** The app's HTTP client: no cookies, no cache, short timeouts. */
object Http {
    /**
     * Development: `app.localhost` (the dev server's name, docs/LOCAL_MODE.md) is this device's loopback, which
     * `adb reverse tcp:3002 tcp:3002` connects to the Mac. Browsers resolve every *.localhost name that way; the
     * system resolver doesn't. Release builds never talk to a local host.
     */
    private val dns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> =
            if (BuildConfig.DEBUG && (hostname == "localhost" || hostname.endsWith(".localhost"))) listOf(InetAddress.getByName("127.0.0.1"))
            else Dns.SYSTEM.lookup(hostname)
    }

    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .dns(dns)
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}
