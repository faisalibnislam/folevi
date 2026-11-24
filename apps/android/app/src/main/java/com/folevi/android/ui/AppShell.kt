// The app's frame, adaptive by window width (docs/ANDROID_NATIVE_PLAN.md section 3, owner layouts 2026-11-23):
//
// - Compact (phones, a folded foldable): Material navigation bar with Home, Tasks, Calendar and Foli AI, a
//   floating New note button, one pane; a note opens full screen (as on iPhone).
// - Medium and Expanded (tablets, an open foldable, a half-width Googlebook window): navigation rail, list and
//   note side by side (as on iPad).
// - Large and Extra-large (Googlebook, big tablets): a permanent sidebar with the tabs and the folders, list and
//   note side by side (as on the Mac).
//
// Each tab keeps its own Navigation 3 back stack; ListDetailSceneStrategy decides how many panes show.
package com.folevi.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.PermanentDrawerSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallExtendedFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.WebIcon
import com.folevi.android.design.folderColor
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.NotesListView
import com.folevi.engine.generated.Views
import kotlinx.coroutines.launch

/** Window width classes (developer.android.com window size classes, with the 2025 Large and Extra-large). */
enum class WidthClass { COMPACT, MEDIUM, EXPANDED, LARGE, EXTRA_LARGE;
    companion object {
        fun of(width: Dp) = when {
            width < 600.dp -> COMPACT
            width < 840.dp -> MEDIUM
            width < 1200.dp -> EXPANDED
            width < 1600.dp -> LARGE
            else -> EXTRA_LARGE
        }
    }
}

@Composable
fun AppShell() {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val width = WidthClass.of(maxWidth)
        var tab by rememberSaveable { mutableStateOf(Tab.HOME) }
        val stacks = Tab.entries.associateWith { rememberNavBackStack(it.root) }
        val stack = stacks.getValue(tab)
        val open: (Route) -> Unit = { r ->
            // A note (or page) replaces the one on screen rather than piling up behind it.
            if (r.isDetail() && stack.lastOrNull()?.let { it is Route && it.isDetail() } == true) stack.removeAt(stack.lastIndex)
            stack.add(r)
        }
        val pick: (Tab) -> Unit = { t ->
            if (t == tab) stacks.getValue(t).let { s -> while (s.size > 1) s.removeAt(s.lastIndex) } else tab = t
        }
        val session = LocalSession.current
        val context = androidx.compose.ui.platform.LocalContext.current
        val scope = rememberCoroutineScope()
        // A new window opened at a note starts there.
        androidx.compose.runtime.LaunchedEffect(Unit) {
            session.initialNote?.let { (id, title) -> session.initialNote = null; stacks.getValue(Tab.HOME).add(NoteRoute(id, title)) }
        }
        androidx.compose.runtime.DisposableEffect(stack, tab) {
            session.shortcuts = Shortcuts(
                newNote = { scope.launch { runCatching { session.client.command(Commands.noteCreate(open = false)) }.getOrNull()?.let { open(NoteRoute(it.id, "Untitled")) } } },
                search = { tab = Tab.HOME; stacks.getValue(Tab.HOME).add(SearchRoute) },
                settings = { tab = Tab.HOME; stacks.getValue(Tab.HOME).add(SettingsRoute) },
                tab = { pick(it) },
                back = { if (stack.size > 1) stack.removeAt(stack.lastIndex) },
                newWindow = { openWindow(context) },
            )
            onDispose { session.shortcuts = null }
        }
        // A fold or a resize changes the window in place (the manifest keeps the activity and its Page View): the
        // frame below starts over for the new window, and the tab and back stacks above it carry on, so an open
        // note stays open. (Kept across a fold, parts of the frame drew nothing until laid out again.)
        val window = androidx.compose.ui.platform.LocalConfiguration.current.let { "${it.screenWidthDp}x${it.screenHeightDp}@${it.densityDpi}" }
        androidx.compose.runtime.key(window) {
        if (width >= WidthClass.LARGE) {
            Row(Modifier.fillMaxSize()) {
                Sidebar(tab, pick, onFolder = { id, name -> pick(Tab.HOME); stacks.getValue(Tab.HOME).let { s -> while (s.size > 1) s.removeAt(s.lastIndex); s.add(NotesRoute(NotesListView.FOLDER.value, name, folderId = id)) }; tab = Tab.HOME })
                Content(stack, open, width, Modifier.weight(1f))
            }
        } else {
            NavigationSuiteScaffold(
                navigationSuiteItems = {
                    for (t in Tab.entries) {
                        item(selected = t == tab, onClick = { pick(t) }, icon = { FoleviIcon(t.icon, null) }, label = { Text(t.label) })
                    }
                },
                // On a phone the bar steps away while a note is open (as on iPhone).
                layoutType = when {
                    width != WidthClass.COMPACT -> NavigationSuiteType.NavigationRail
                    (stack.lastOrNull() as? Route)?.isDetail() == true -> NavigationSuiteType.None
                    else -> NavigationSuiteType.NavigationBar
                },
            ) {
                Content(stack, open, width, Modifier.fillMaxSize())
            }
        }
        }
    }
}

@OptIn(ExperimentalMaterial3AdaptiveApi::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun Content(stack: NavBackStack<NavKey>, open: (Route) -> Unit, width: WidthClass, modifier: Modifier) {
    val strategy = rememberListDetailSceneStrategy<NavKey>()
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val top = stack.lastOrNull()
    val showNew = ((top as? Route)?.isDetail() != true || width != WidthClass.COMPACT) && top !is AiRoute && top !is SettingsRoute && top !is VaultRoute
    val back: (() -> Unit)? = if (width == WidthClass.COMPACT && stack.size > 1) ({ stack.removeAt(stack.lastIndex) }) else null
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        floatingActionButton = {
            if (showNew) {
                SmallExtendedFloatingActionButton(
                    text = { Text("New note") },
                    icon = { FoleviIcon(WebIcon.PLUS, null) },
                    onClick = {
                        scope.launch {
                            val made = runCatching { session.client.command(Commands.noteCreate(open = false)) }.getOrNull()
                            if (made != null) open(NoteRoute(made.id, "Untitled"))
                        }
                    },
                )
            }
        },
    ) { padding ->
        NavDisplay(
            backStack = stack,
            onBack = { if (stack.size > 1) stack.removeAt(stack.lastIndex) },
            sceneStrategies = listOf(strategy),
            modifier = Modifier.padding(padding),
            entryProvider = entryProvider {
                entry<HomeRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { NotePlaceholder() })) { HomeScreen(open) }
                entry<NotesRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { NotePlaceholder() })) { NotesScreen(it, open) }
                entry<SearchRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { NotePlaceholder() })) { SearchScreen(open) }
                entry<TasksRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { NotePlaceholder() })) { TasksHome(open) }
                entry<CalendarRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { NotePlaceholder() })) { CalendarHome(open) }
                entry<AiRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { NotePlaceholder() })) { AiHome(open) }
                entry<AiChatRoute>(metadata = ListDetailSceneStrategy.detailPane()) { AiChatScreen(it, back) }
                entry<SettingsRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { NotePlaceholder() })) { SettingsScreen(open, back) }
                entry<VaultRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { NotePlaceholder() })) { VaultScreen(back) }
                entry<SharedRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { NotePlaceholder() })) { SharedScreen(open, back) }
                entry<ChangesRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { NotePlaceholder() })) { ChangesScreen(open, back) }
                entry<WebShowRoute>(metadata = ListDetailSceneStrategy.detailPane()) { WebShowScreen(it, back) }
                entry<NoteRoute>(metadata = ListDetailSceneStrategy.detailPane()) { NoteScreen(it, back) }
                entry<PageRoute>(metadata = ListDetailSceneStrategy.detailPane()) { WebPageScreen(it, back) }
            },
        )
    }
}

/** The Googlebook and big-tablet sidebar: the tabs, then the folders (as the Mac's sidebar). */
@Composable
private fun Sidebar(tab: Tab, pick: (Tab) -> Unit, onFolder: (String, String) -> Unit) {
    val tree by rememberView(Views.foldersTree())
    PermanentDrawerSheet(Modifier.width(280.dp).fillMaxHeight(), drawerContainerColor = LocalPalette.current.sidebar) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 16.dp)) {
            Text("Folevi", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 16.dp, bottom = 12.dp))
            for (t in Tab.entries) {
                NavigationDrawerItem(
                    label = { Text(t.label) },
                    icon = { FoleviIcon(t.icon, null) },
                    selected = t == tab,
                    onClick = { pick(t) },
                    colors = NavigationDrawerItemDefaults.colors(unselectedContainerColor = Color.Transparent),
                )
            }
            Spacer(Modifier.height(16.dp))
            Text("Folders", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 16.dp, bottom = 4.dp))
            for (f in tree.value?.folders.orEmpty()) {
                NavigationDrawerItem(
                    label = { Text(f.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    icon = { FoleviIcon(WebIcon.FOLDER, null, tint = folderColor(f.color)) },
                    selected = false,
                    onClick = { onFolder(f.id, f.name) },
                    modifier = Modifier.padding(start = (f.depth.toInt() * 16).dp),
                    colors = NavigationDrawerItemDefaults.colors(unselectedContainerColor = Color.Transparent),
                )
            }
        }
    }
}

/** The note pane before a note is picked (medium and wider windows). */
@Composable
private fun NotePlaceholder() {
    val p = LocalPalette.current
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = androidx.compose.ui.Alignment.Center) {
        Column(horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
            FoleviIcon(WebIcon.NOTEBOOK_TEXT, null, size = 36.dp, tint = p.inkFaint)
            Spacer(Modifier.height(12.dp))
            Text("Pick a note to open it here.", color = p.inkFaint, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier.padding(horizontal = 20.dp, vertical = 8.dp))
}

@Composable
fun EmptyBox(text: String) {
    Box(Modifier.fillMaxSize().padding(32.dp)) { Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant) }
}
