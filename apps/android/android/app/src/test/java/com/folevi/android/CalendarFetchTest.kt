package com.folevi.android

import com.folevi.android.host.CalendarFetch
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress

class CalendarFetchTest {
    private val fetch = CalendarFetch(OkHttpClient(), "app.folevi.com")

    @Test
    fun theMacsAddressRules() {
        assertNull(fetch.addressProblem("https://calendar.example.com/basic.ics"))
        assertEquals("this phone only reads calendars from secure (https) links.", fetch.addressProblem("http://calendar.example.com/a.ics"))
        assertEquals("Folevi's own addresses can't be subscribed to.", fetch.addressProblem("https://app.folevi.com/api/calendar.ics"))
        assertEquals("Folevi's own addresses can't be subscribed to.", fetch.addressProblem("https://x.convex.site/feed"))
        for (bad in listOf("https://localhost/a.ics", "https://printer.local/a.ics", "https://10.0.0.2/a.ics", "https://192.168.1.4/a.ics", "https://169.254.1.1/a.ics", "https://[::1]/a.ics", "https://intranet/a.ics"))
            assertEquals(bad, "addresses on private or local networks can't be used.", fetch.addressProblem(bad))
        assertEquals("the address isn't a web link it can open.", fetch.addressProblem("https://user:pw@example.com/a.ics"))
        assertEquals("the address isn't a web link it can open.", fetch.addressProblem("https://example.com:8443/a.ics"))
    }

    @Test
    fun privateAddresses() {
        for (ip in listOf("127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "100.64.0.1", "169.254.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1"))
            assertTrue(ip, CalendarFetch.isPrivate(InetAddress.getByName(ip)))
        for (ip in listOf("8.8.8.8", "1.1.1.1", "2606:4700:4700::1111")) assertFalse(ip, CalendarFetch.isPrivate(InetAddress.getByName(ip)))
    }

    @Test
    fun aNameThatResolvesPrivatelyIsRefusedAtConnection() {
        val f = CalendarFetch(OkHttpClient(), "app.folevi.com") { listOf(InetAddress.getByName("192.168.1.10")) }
        val r = f.download("https://calendar.example.com/a.ics", null, null)
        assertEquals("error", r.getString("kind"))
        assertEquals("Couldn't load this calendar: addresses on private or local networks can't be used.", r.getString("message"))
    }
}
