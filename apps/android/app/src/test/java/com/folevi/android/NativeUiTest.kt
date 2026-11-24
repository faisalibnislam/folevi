package com.folevi.android

import com.folevi.android.extras.NativeUi
import com.folevi.android.web.Haptics
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The native UI layer's Android half (extras/NativeUi.kt): the actions an alert is built from, and haptic kinds. */
class NativeUiTest {
    @Test
    fun actionsKeepOrderAndStyles() {
        val actions = NativeUi.actions(JSONArray("""[{"id":"cancel","title":"Cancel","style":"cancel"},{"id":"delete","title":"Delete","style":"destructive"},{"id":"plain","title":"Archive","style":"odd"}]"""))!!
        assertEquals(listOf("cancel", "delete", "plain"), actions.map { it.id })
        assertEquals(listOf("cancel", "destructive", "default"), actions.map { it.style })
    }

    @Test
    fun unusableActionsMakeNoDialog() {
        assertNull(NativeUi.actions(null))
        assertNull(NativeUi.actions(JSONArray("[]")))
        assertNull(NativeUi.actions(JSONArray("""[{"id":"","title":"X"}]""")))
        assertNull(NativeUi.actions(JSONArray("""[{"id":"a"}]""")))
    }

    @Test
    fun newerHapticKindsHaveTheirOwnFeedback() {
        assertNotEquals(Haptics.constant("light"), Haptics.constant("soft"))
        assertEquals(Haptics.constant("light"), Haptics.constant("made-up"))
    }
}
