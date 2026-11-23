// The native side of the bridge on Android (docs/NATIVE_APP_PLAN.md section 3, docs/ANDROID_NATIVE_PLAN.md):
// one client per Page View. It mirrors FoleviEngine's EngineClient.swift:
//
// - request/response with ids and timeouts (hello, query, command, editor), replies decoded off the main thread
//   into each call's generated type;
// - live views: `watch` returns a ValueStore, `watchList` a windowed ListStore whose diffs are applied as they
//   arrive; a `rev` gap refetches; stores pause off screen and resume with a fresh value;
// - events as a SharedFlow of typed EngineEvents;
// - reconnection: when the page reloads or its renderer ends, stores keep their last values (marked
//   disconnected), the client says hello again once the engine is back (`engine.ready`, or retrying while it
//   boots) and resubscribes everything.
//
// Everything here runs on the main thread except decoding, which runs on Dispatchers.Default in arrival order.
package com.folevi.engine.client

import android.util.Log
import com.folevi.engine.generated.CommandSpec
import com.folevi.engine.generated.EditorSpec
import com.folevi.engine.generated.EngineContract
import com.folevi.engine.generated.EngineError
import com.folevi.engine.generated.EngineEvent
import com.folevi.engine.generated.HelloValue
import com.folevi.engine.generated.ListSpec
import com.folevi.engine.generated.ListWindow
import com.folevi.engine.generated.ViewSpec
import com.folevi.engine.protocol.AppIdentity
import com.folevi.engine.protocol.EngineFailure
import com.folevi.engine.protocol.FoleviJson
import com.folevi.engine.protocol.OutgoingKind
import com.folevi.engine.protocol.OutgoingMessage
import com.folevi.engine.protocol.RawInbound
import com.folevi.engine.protocol.ReplyEnvelope
import com.folevi.engine.protocol.RowDiff
import com.folevi.engine.protocol.encodeArgs
import com.folevi.engine.protocol.isNullOrJsonNull
import com.folevi.engine.transport.EngineTransport
import com.folevi.engine.transport.PageLifecycle
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

class EngineClient(
    private val transport: EngineTransport,
    /**
     * The place this client's Page View is bound to (`acct:<user id>` or `library`); every message names it. Empty:
     * the place the engine reports in hello (a page that picks its own place).
     */
    place: String,
    private val app: AppIdentity,
    /** A main-thread scope that lives as long as the Page View. */
    private val scope: CoroutineScope,
    /** Where batches and replies are decoded (a test passes its own). */
    private val decodeDispatcher: kotlinx.coroutines.CoroutineDispatcher = Dispatchers.Default,
) {
    sealed interface State {
        data object Idle : State
        data object Connecting : State
        data object Ready : State
        /** The engine is up but not ready (signed out, a gate, the store opening): waiting for `engine.ready`. */
        data object Waiting : State
        data object Disconnected : State
        data class Mismatch(val message: String) : State
    }

    var place: String = place
        private set

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()
    private val _hello = MutableStateFlow<HelloValue?>(null)
    /** The engine's hello reply (build, features, names, the current gate), once connected. */
    val hello: StateFlow<HelloValue?> = _hello.asStateFlow()
    /** Set when the engine's contract hash differs from this build's generated Kotlin (a stale export). */
    var contractWarning: String? = null
        private set

    var timeoutMs: Long = 10_000
    /** How long a command waits for the engine to become ready before failing (plan 4.6: at most 5 s). */
    var readyWaitMs: Long = 5_000

    private val _events = MutableSharedFlow<EngineEvent>(extraBufferCapacity = 64)
    /** Every event from the engine, typed. */
    val events: SharedFlow<EngineEvent> = _events.asSharedFlow()

    private var nextId = 0
    private val entries = LinkedHashMap<String, Entry>()
    private val decoders = ConcurrentHashMap<String, Decoder>()
    private val readyWaiters = ArrayList<CompletableDeferred<Unit>>()
    private var connectJob: Job? = null
    private val inbound = Channel<String>(Channel.UNLIMITED)

    /** Hooks the transport up and connects. Call once, after the Page View started loading. */
    fun start() {
        if (_state.value != State.Idle) return
        transport.onBatch = { json -> inbound.trySend(json) }
        transport.onLifecycle = { pageChanged(it) }
        scope.launch {
            for (json in inbound) {
                val items = withContext(decodeDispatcher) { decodeBatch(json) }
                apply(items)
            }
        }
        connect()
    }

    /** Ends the client's own work (its window closed). */
    fun stop() {
        connectJob?.cancel()
        connectJob = null
        failWaiters(EngineFailure.PageGone)
        inbound.close()
    }

    // ---- Live views ------------------------------------------------------------------------------------------

    fun <A, V> watch(view: ViewSpec<A, V>): ValueStore<V> {
        val sub = newId("v")
        val store = ValueStore<V>(sub, this)
        @Suppress("UNCHECKED_CAST")
        val entry = Entry(
            name = view.name,
            args = encodeArgs(view.argsSerializer, view.args),
            window = null,
            apply = { rev, item -> store.apply(rev, item.value as V?, item.hasValue, item.stale, item.error) },
            mark = { store.mark(it) },
        )
        register(sub, entry, Decoder.Value(view.resultSerializer))
        return store
    }

    fun <A, R> watchList(list: ListSpec<A, R>, window: ListWindow? = null, windowing: ListWindowing = ListWindowing()): ListStore<R> {
        val sub = newId("l")
        val win = window ?: ListWindow(0, (windowing.overscan * 2).toLong())
        val store = ListStore<R>(sub, this, win, windowing)
        @Suppress("UNCHECKED_CAST")
        val entry = Entry(
            name = list.name,
            args = encodeArgs(list.argsSerializer, list.args),
            window = win,
            apply = { rev, item -> store.apply(rev, item.diff as RowDiff<R>?, item.stale, item.error) },
            mark = { store.mark(it) },
        )
        register(sub, entry, Decoder.List { RowDiff.decode(it, list.resultSerializer) })
        return store
    }

    /** Reads a value view once (search, a sheet). */
    suspend fun <A, V> query(view: ViewSpec<A, V>): V {
        whenReady()
        return send(OutgoingMessage(newId("q"), OutgoingKind.QUERY, place = place, name = view.name, args = encodeArgs(view.argsSerializer, view.args)), view.resultSerializer)
    }

    /** Runs a command (a write). Replies once the change is applied on this device (queued if offline). */
    suspend fun <A, R> command(command: CommandSpec<A, R>): R {
        // A gate's buttons run while the engine is up but not ready: that's what the gate is waiting for.
        if (!(_state.value == State.Waiting && command.name in GATE_COMMANDS)) whenReady()
        return send(OutgoingMessage(newId("c"), OutgoingKind.COMMAND, place = place, name = command.name, args = encodeArgs(command.argsSerializer, command.args)), command.resultSerializer)
    }

    /** Drives the note page (keyboard toolbar, bars, menus, opening notes). */
    suspend fun <A, R> editor(command: EditorSpec<A, R>): R {
        whenReady()
        return send(OutgoingMessage(newId("e"), OutgoingKind.EDITOR, name = command.name, args = encodeArgs(command.argsSerializer, command.args)), command.resultSerializer)
    }

    // ---- Subscriptions (stores call these) -------------------------------------------------------------------

    internal fun unwatch(sub: String) {
        if (entries.remove(sub) == null) return
        decoders.remove(sub)
        if (_state.value != State.Ready) return
        fireAndForget(OutgoingMessage(newId("u"), OutgoingKind.UNWATCH, sub = sub))
    }

    internal fun pause(sub: String) {
        val entry = entries[sub] ?: return
        if (entry.paused) return
        entry.paused = true
        entry.mark(StoreStatus.PAUSED)
        if (_state.value != State.Ready) return
        fireAndForget(OutgoingMessage(newId("u"), OutgoingKind.UNWATCH, sub = sub))
    }

    internal fun resume(sub: String) {
        val entry = entries[sub] ?: return
        if (!entry.paused) return
        entry.paused = false
        if (_state.value == State.Ready) sendWatch(sub, entry)
    }

    internal fun moveWindow(sub: String, window: ListWindow) {
        val entry = entries[sub] ?: return
        entry.window = window
        if (_state.value != State.Ready || entry.paused) return
        fireAndForget(OutgoingMessage(newId("w"), OutgoingKind.WINDOW, sub = sub, window = window))
    }

    val subscriptionCount: Int get() = entries.size

    // ---- Inbound ---------------------------------------------------------------------------------------------

    private fun decodeBatch(json: String): List<Inbound> = try {
        RawInbound.parseBatch(json).mapNotNull { raw ->
            when (raw) {
                is RawInbound.Update -> {
                    val decoder = decoders[raw.sub] ?: return@mapNotNull null
                    try {
                        when (decoder) {
                            is Decoder.Value -> Inbound.Update(raw.sub, raw.rev, if (raw.value.isNullOrJsonNull()) null else FoleviJson.decodeFromJsonElement(decoder.serializer, raw.value!!), !raw.value.isNullOrJsonNull(), null, raw.stale, raw.error)
                            is Decoder.List -> Inbound.Update(raw.sub, raw.rev, null, false, raw.diff?.let { decoder.decode(it) }, raw.stale, raw.error)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "couldn't decode an update of ${raw.sub}", e)
                        Inbound.Update(raw.sub, raw.rev, null, false, null, raw.stale, EngineError("failed", "This view couldn't be read: ${e.message}"))
                    }
                }
                is RawInbound.Event -> try {
                    Inbound.Event(EngineEvent.decode(FoleviJson, raw.name, raw.data))
                } catch (e: Exception) {
                    Log.e(TAG, "couldn't decode event ${raw.name}", e)
                    Inbound.Event(EngineEvent.Unknown(raw.name, raw.data ?: kotlinx.serialization.json.JsonNull))
                }
            }
        }
    } catch (e: Exception) {
        Log.e(TAG, "couldn't decode a batch", e)
        emptyList()
    }

    private fun apply(items: List<Inbound>) {
        if (Log.isLoggable(TAG, Log.DEBUG)) Log.d(TAG, "applying ${items.size} items")
        for (item in items) {
            when (item) {
                is Inbound.Update -> {
                    val entry = entries[item.sub] ?: continue
                    if (entry.paused) continue
                    if (!entry.apply(item.rev, item)) {
                        // A gap in `rev` (or a list update native can't place): ask for the whole value again.
                        Log.i(TAG, "rev gap on ${item.sub}; refetching")
                        entry.mark(StoreStatus.DISCONNECTED)
                        sendWatch(item.sub, entry)
                    }
                }
                is Inbound.Event -> {
                    if (item.event is EngineEvent.EngineReady && _state.value != State.Ready) connect()
                    _events.tryEmit(item.event)
                }
            }
        }
    }

    private fun pageChanged(event: PageLifecycle) {
        _state.value = State.Disconnected
        _hello.value = null
        entries.values.filter { !it.paused }.forEach { it.mark(StoreStatus.DISCONNECTED) }
        connect(after = if (event == PageLifecycle.TERMINATED) 300 else 100)
    }

    // ---- Connecting ------------------------------------------------------------------------------------------

    private fun connect(after: Long = 0) {
        connectJob?.cancel()
        if (_state.value != State.Disconnected) _state.value = State.Connecting
        connectJob = scope.launch {
            if (after > 0) delay(after)
            var backoff = 150L
            while (isActive) {
                if (connectOnce()) return@launch
                delay(backoff)
                backoff = minOf(backoff * 2, 2_000)
            }
        }
    }

    /** One hello. True when connecting is over (connected, a protocol mismatch); false to try again. */
    private suspend fun connectOnce(): Boolean {
        val value = try {
            send(OutgoingMessage(newId("h"), OutgoingKind.HELLO, app = app), HelloValue.serializer())
        } catch (e: EngineFailure.Engine) {
            if (e.error.code == "protocol_mismatch") {
                _state.value = State.Mismatch(e.error.message)
                failWaiters(e)
                return true
            }
            return false
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            // (Expected while the page boots: no engine yet. Anything else is worth seeing.)
            if (e !is EngineFailure.NotReady && e !is EngineFailure.PageGone) Log.w(TAG, "hello failed: ${e.message}")
            if (_state.value != State.Disconnected) _state.value = State.Connecting
            return false
        }
        if (place.isEmpty()) value.place?.let { place = it }
        _hello.value = value
        if (value.protocol.toInt() != EngineContract.PROTOCOL_VERSION) {
            _state.value = State.Mismatch("The app speaks protocol ${EngineContract.PROTOCOL_VERSION}, the engine ${value.protocol}.")
            failWaiters(EngineFailure.ProtocolMismatch(EngineContract.PROTOCOL_VERSION, value.protocol.toInt()))
            return true
        }
        contractWarning = if (value.schemaHash == EngineContract.SCHEMA_HASH) null else
            "The engine's contract (${value.schemaHash}, revision ${value.revision}) differs from this build's (${EngineContract.SCHEMA_HASH}, revision ${EngineContract.REVISION}). Run pnpm engine:gen:kotlin and rebuild."
        contractWarning?.let { Log.w(TAG, it) }
        Log.i(TAG, "connected to ${value.place}: protocol ${value.protocol}, revision ${value.revision}, ready ${value.ready}")
        if (value.ready) becameReady() else _state.value = State.Waiting
        return true
    }

    private fun becameReady() {
        _state.value = State.Ready
        entries.filter { !it.value.paused }.forEach { (sub, entry) -> sendWatch(sub, entry) }
        val waiters = readyWaiters.toList()
        readyWaiters.clear()
        waiters.forEach { it.complete(Unit) }
    }

    private suspend fun whenReady() {
        when (val s = _state.value) {
            State.Ready -> return
            is State.Mismatch -> throw EngineFailure.Transport(s.message)
            State.Idle -> start()
            else -> Unit
        }
        val waiter = CompletableDeferred<Unit>()
        readyWaiters += waiter
        val done = withTimeoutOrNull(readyWaitMs) { waiter.await() }
        if (done == null) {
            readyWaiters.remove(waiter)
            throw EngineFailure.NotReady
        }
    }

    private fun failWaiters(e: Throwable) {
        val waiters = readyWaiters.toList()
        readyWaiters.clear()
        waiters.forEach { it.completeExceptionally(e) }
    }

    // ---- Sending ---------------------------------------------------------------------------------------------

    private fun register(sub: String, entry: Entry, decoder: Decoder) {
        entries[sub] = entry
        decoders[sub] = decoder
        if (_state.value == State.Idle) start()
        // Registered before sending: an update may arrive before the reply.
        if (_state.value == State.Ready) sendWatch(sub, entry)
    }

    private fun sendWatch(sub: String, entry: Entry) {
        if (Log.isLoggable(TAG, Log.DEBUG)) Log.d(TAG, "watch $sub ${entry.name}")
        val m = OutgoingMessage(newId("w"), OutgoingKind.WATCH, place = place, name = entry.name, args = entry.args, sub = sub, window = entry.window)
        scope.launch {
            try {
                send(m, JsonElement.serializer())
            } catch (e: EngineFailure.Engine) {
                entries[sub]?.apply?.invoke(1, Inbound.Update(sub, 1, null, false, null, false, e.error))
            } catch (_: Exception) {
            }
        }
    }

    private fun fireAndForget(m: OutgoingMessage) {
        scope.launch { runCatching { send(m, JsonElement.serializer()) } }
    }

    private suspend fun <T> send(message: OutgoingMessage, serializer: KSerializer<T>): T {
        val label = "${message.kind.wire} ${message.name ?: ""}".trim()
        val raw = try {
            withTimeout(timeoutMs) { transport.call(message.json()) }
        } catch (e: TimeoutCancellationException) {
            throw EngineFailure.Timeout(label)
        }
        return withContext(decodeDispatcher) {
            val reply = ReplyEnvelope.parse(raw)
            if (!reply.ok) throw EngineFailure.from(reply.error ?: EngineError("failed", "Something went wrong."))
            try {
                // An ok reply without a value: fine for results that read from nothing.
                FoleviJson.decodeFromJsonElement(serializer, if (reply.value.isNullOrJsonNull()) JsonObject(emptyMap()) else reply.value!!)
            } catch (e: Exception) {
                throw EngineFailure.Decoding("$label: ${e.message}")
            }
        }
    }

    private fun newId(prefix: String): String = "$prefix${++nextId}"

    private class Entry(
        val name: String,
        val args: JsonElement,
        var window: ListWindow?,
        val apply: (Int, Inbound.Update) -> Boolean,
        val mark: (StoreStatus) -> Unit,
    ) {
        var paused = false
    }

    private sealed interface Decoder {
        data class Value(val serializer: KSerializer<*>) : Decoder
        class List(val decode: (JsonObject) -> RowDiff<*>) : Decoder
    }

    internal sealed interface Inbound {
        data class Update(val sub: String, val rev: Int, val value: Any?, val hasValue: Boolean, val diff: RowDiff<*>?, val stale: Boolean, val error: EngineError?) : Inbound
        data class Event(val event: EngineEvent) : Inbound
    }

    companion object {
        private const val TAG = "FoleviEngine"
        /** Commands a gate screen sends before the engine is ready. */
        val GATE_COMMANDS = setOf("gate.act", "toast.action")
    }
}
