// Compose helpers over the engine client: live views and lists tied to a screen's lifetime (closed when the
// screen leaves composition, as FoleviEngine's stores pause and close with their SwiftUI views).
package com.folevi.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import com.folevi.android.engine.AppSession
import com.folevi.engine.client.ListStoreState
import com.folevi.engine.client.ValueState
import com.folevi.engine.generated.ListSpec
import com.folevi.engine.generated.ViewSpec

val LocalSession = staticCompositionLocalOf<AppSession> { error("No session") }

/** A live value view for as long as the caller is on screen; restarts when `key` changes. */
@Composable
fun <A, V> rememberView(spec: ViewSpec<A, V>, key: Any? = spec.args): State<ValueState<V>> {
    val client = LocalSession.current.client
    val store = remember(spec.name, key) { client.watch(spec) }
    DisposableEffect(store) { onDispose { store.close() } }
    return store.state.collectAsState()
}

/** A live windowed list for as long as the caller is on screen. */
@Composable
fun <A, R> rememberList(spec: ListSpec<A, R>, key: Any? = spec.args): Pair<com.folevi.engine.client.ListStore<R>, State<ListStoreState<R>>> {
    val client = LocalSession.current.client
    val store = remember(spec.name, key) { client.watchList(spec) }
    DisposableEffect(store) { onDispose { store.close() } }
    return store to store.state.collectAsState()
}
