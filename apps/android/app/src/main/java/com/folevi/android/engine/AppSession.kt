// One window's connection to Folevi: its EngineClient over the Page View (or the demo engine in debug builds), the
// gate the engine reports, and where the note page should sit on screen.
package com.folevi.android.engine

import android.content.Context
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.geometry.Rect
import com.folevi.android.BuildConfig
import com.folevi.engine.client.EngineClient
import com.folevi.engine.generated.EngineEvent
import com.folevi.engine.generated.GateChangedEvent
import com.folevi.engine.protocol.AppIdentity
import com.folevi.engine.transport.EngineTransport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class AppSession(context: Context, private val scope: CoroutineScope, demo: Boolean) {
    /** Null in demo mode: there is no page, and the note pane says so. */
    val page: PageView? = if (demo) null else PageView(context, place = null)
    val isDemo: Boolean get() = page == null

    private val transport: EngineTransport = page?.transport ?: DemoEngine.transport(context, scope)

    // The place is the Page View's own (`acct:<id>` or `library`); until the host bridge picks one (plan phase 1)
    // the client asks for the place the page reports in hello.
    val client = EngineClient(transport, place = if (demo) "acct:demo" else "", AppIdentity("android", BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE.toString()), scope)

    private val _gate = MutableStateFlow<GateChangedEvent?>(null)
    /** The screen the engine wants instead of the app; null once the app itself is on screen. */
    val gate: StateFlow<GateChangedEvent?> = _gate.asStateFlow()

    /** Where the note page sits in the window (set by the note pane while it is on screen). */
    val noteSlot = mutableStateOf<Rect?>(null)

    fun start() {
        scope.launch { client.hello.collect { h -> if (h != null) _gate.value = h.gate.takeIf { it.gate != null } } }
        scope.launch {
            client.events.collect { e -> if (e is EngineEvent.GateChanged) _gate.value = e.data.takeIf { it.gate != null } }
        }
        client.start()
        page?.load()
    }

    fun stop() {
        client.stop()
        page?.destroy()
    }
}
