package com.folevi.android

import com.folevi.android.lock.AppLock
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** When coming back on screen leaves Folevi open (lock/AppLock.kt staysOpen). */
class AppLockTest {
    private fun stays(own: Boolean, awaySeconds: Long, lockAfter: Int, launch: Boolean = false, covered: Boolean = false) =
        AppLock.staysOpen(launch, covered, own, awaySeconds * 1000, lockAfter)

    @Test
    fun comingBackFromFolevisOwnScreenOnlySkipsTheLockForAWhile() {
        // A link opened in a Custom Tab, a picker, a consent screen: back within a minute, no lock.
        assertTrue(stays(own = true, awaySeconds = 5, lockAfter = 0))
        assertTrue(stays(own = true, awaySeconds = 59, lockAfter = 0))
        // Left open and come back to later: the lock asks, whatever was on top.
        assertFalse(stays(own = true, awaySeconds = 60, lockAfter = 0))
        assertFalse(stays(own = true, awaySeconds = 3 * 3600, lockAfter = 0))
        assertFalse(stays(own = true, awaySeconds = 3 * 3600, lockAfter = 900))
        // "Lock after" longer than a minute is what counts.
        assertTrue(stays(own = true, awaySeconds = 600, lockAfter = 900))
        assertFalse(stays(own = true, awaySeconds = 900, lockAfter = 900))
    }

    @Test
    fun withoutItOnlyLockAfterCounts() {
        assertFalse(stays(own = false, awaySeconds = 1, lockAfter = 0))
        assertTrue(stays(own = false, awaySeconds = 59, lockAfter = 60))
        assertFalse(stays(own = false, awaySeconds = 60, lockAfter = 60))
    }

    @Test
    fun aLaunchOrACoverAlreadyUpAlwaysAsks() {
        assertFalse(stays(own = true, awaySeconds = 0, lockAfter = 900, launch = true))
        assertFalse(stays(own = true, awaySeconds = 0, lockAfter = 900, covered = true))
    }
}
