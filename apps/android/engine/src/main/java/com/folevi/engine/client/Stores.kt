// What screens observe: a live value view's latest value, and a windowed list's rows (protocol.ts `ListDiff`,
// diff.ts `applyDiff`), as StateFlows. The Android twin of FoleviEngine's Stores.swift and ListState.swift.
package com.folevi.engine.client

import com.folevi.engine.generated.EngineContract
import com.folevi.engine.generated.EngineError
import com.folevi.engine.generated.ListWindow
import com.folevi.engine.protocol.RowDiff
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class StoreStatus {
    /** Waiting for the first update. */
    LOADING,
    /** Up to date with the engine. */
    LIVE,
    /** The page reloads; the last value stays on screen. */
    DISCONNECTED,
    /** Off screen: unwatched until it shows again. */
    PAUSED,
    /** The view failed (see [ValueState.error]); a later update may recover. */
    FAILED,
}

data class ValueState<V>(val value: V? = null, val status: StoreStatus = StoreStatus.LOADING, val stale: Boolean = false, val error: EngineError? = null)

/** A live value view. Call [close] when the screen goes; [pause] and [resume] when it hides and shows. */
class ValueStore<V> internal constructor(val sub: String, private val client: EngineClient) : AutoCloseable {
    private val _state = MutableStateFlow(ValueState<V>())
    val state: StateFlow<ValueState<V>> = _state.asStateFlow()
    val value: V? get() = _state.value.value
    internal var lastRev = 0

    internal fun apply(rev: Int, value: V?, hasValue: Boolean, stale: Boolean, error: EngineError?): Boolean {
        if (rev != lastRev + 1 && rev != 1) return false
        lastRev = rev
        _state.update {
            when {
                error != null -> it.copy(status = StoreStatus.FAILED, error = error, stale = stale)
                hasValue -> ValueState(value, StoreStatus.LIVE, stale, null)
                else -> it.copy(status = StoreStatus.LIVE, stale = stale)
            }
        }
        return true
    }

    internal fun mark(status: StoreStatus) {
        lastRev = 0
        _state.update { it.copy(status = status) }
    }

    fun pause() = client.pause(sub)
    fun resume() = client.resume(sub)
    override fun close() = client.unwatch(sub)
}

/** What native holds of a windowed list: the window's rows in order, at `start until start + order.size` of `total`. */
data class ListState<R>(
    val total: Int = 0,
    val complete: Boolean = false,
    val start: Int = 0,
    val order: List<String> = emptyList(),
    val rowsById: Map<String, R> = emptyMap(),
) {
    /** The window's rows, in order (a hole, which a correct diff never leaves, is skipped). */
    val rows: List<R> get() = order.mapNotNull { rowsById[it] }

    /** The row at a position of the whole list, or null outside the window (draw a placeholder, move the window). */
    fun rowAt(index: Int): R? {
        val i = index - start
        if (i < 0 || i >= order.size) return null
        return rowsById[order[i]]
    }

    /** Applies a diff as the engine expects: reset, remove, upsert, then order; rows that left the window go. */
    fun apply(diff: RowDiff<R>): ListState<R> {
        val rows = if (diff.reset) HashMap() else HashMap(rowsById)
        var order = if (diff.reset) emptyList() else order
        diff.remove?.forEach { rows.remove(it) }
        diff.upsert?.let { rows.putAll(it) }
        diff.order?.let { order = it }
        if (rows.size > order.size || diff.order != null || diff.reset) {
            val keep = order.toHashSet()
            rows.keys.retainAll(keep)
        }
        return ListState(diff.total, diff.complete, diff.start, order, rows)
    }
}

data class ListStoreState<R>(val list: ListState<R> = ListState(), val status: StoreStatus = StoreStatus.LOADING, val stale: Boolean = false, val error: EngineError? = null)

/** Window arithmetic: what to ask for around the visible rows, and when to move. */
data class ListWindowing(val overscan: Int = EngineContract.RECOMMENDED_OVERSCAN) {
    fun window(visible: IntRange): ListWindow {
        val start = maxOf(0, visible.first - overscan)
        val count = minOf(EngineContract.MAX_WINDOW_ROWS, (visible.last - visible.first + 1) + overscan * 2)
        return ListWindow(start.toLong(), count.toLong())
    }

    /** Whether the visible rows have come within a quarter of the overscan of the current window's edges. */
    fun needsMove(current: ListWindow, visible: IntRange, total: Int, complete: Boolean): Boolean {
        val margin = maxOf(1, overscan / 4)
        val lowEdge = current.start > 0 && visible.first < current.start + margin
        val end = current.start + current.count
        val moreBelow = end < total || !complete
        val highEdge = moreBelow && visible.last + 1 > end - margin
        return lowEdge || highEdge
    }
}

/** A live windowed list. Call [visibleRows] as the person scrolls; the store moves its window when needed. */
class ListStore<R> internal constructor(val sub: String, private val client: EngineClient, window: ListWindow, private val windowing: ListWindowing) : AutoCloseable {
    private val _state = MutableStateFlow(ListStoreState<R>())
    val state: StateFlow<ListStoreState<R>> = _state.asStateFlow()
    var window: ListWindow = window
        private set
    internal var lastRev = 0

    internal fun apply(rev: Int, diff: RowDiff<R>?, stale: Boolean, error: EngineError?): Boolean {
        if (rev != lastRev + 1 && rev != 1) return false
        // The first update of a subscription must reset what native holds.
        if (rev == 1 && diff != null && !diff.reset && _state.value.list.order.isNotEmpty()) return false
        lastRev = rev
        _state.update {
            when {
                error != null -> it.copy(status = StoreStatus.FAILED, error = error, stale = stale)
                diff != null -> ListStoreState(it.list.apply(diff), StoreStatus.LIVE, stale, null)
                else -> it.copy(status = StoreStatus.LIVE, stale = stale)
            }
        }
        return true
    }

    internal fun mark(status: StoreStatus) {
        lastRev = 0
        _state.update { it.copy(status = status) }
    }

    /** Tell the store which rows are on screen; it asks the engine for a new window when they near its edges. */
    fun visibleRows(visible: IntRange) {
        val s = _state.value.list
        if (!windowing.needsMove(window, visible, s.total, s.complete)) return
        window = windowing.window(visible)
        client.moveWindow(sub, window)
    }

    fun pause() = client.pause(sub)
    fun resume() = client.resume(sub)
    override fun close() = client.unwatch(sub)
}
