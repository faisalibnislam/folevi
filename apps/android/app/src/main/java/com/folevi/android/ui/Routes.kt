// Where the app can go (Navigation 3 keys). Each tab keeps its own back stack; lists are list panes and notes
// detail panes, so medium and wider windows show them side by side (ListDetailSceneStrategy).
package com.folevi.android.ui

import androidx.navigation3.runtime.NavKey
import com.folevi.android.design.WebIcon
import kotlinx.serialization.Serializable

@Serializable
sealed interface Route : NavKey

@Serializable
data object HomeRoute : Route

@Serializable
data class NotesRoute(val view: String, val title: String, val folderId: String? = null, val tagId: String? = null) : Route

@Serializable
data class NoteRoute(val id: String, val title: String) : Route

@Serializable
data object TasksRoute : Route

@Serializable
data object CalendarRoute : Route

@Serializable
data object AiRoute : Route

@Serializable
data object SearchRoute : Route

/** The iPhone's tabs, with Foli AI as its own (owner decision 2026-11-23). */
enum class Tab(val label: String, val icon: WebIcon, val root: Route) {
    HOME("Home", WebIcon.HOUSE, HomeRoute),
    TASKS("Tasks", WebIcon.SQUARE_CHECK_BIG, TasksRoute),
    CALENDAR("Calendar", WebIcon.CALENDAR, CalendarRoute),
    AI("Foli AI", WebIcon.SPARKLES, AiRoute),
}
