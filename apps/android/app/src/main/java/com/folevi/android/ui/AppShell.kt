// The app's frame, adaptive by window width (docs/ANDROID_NATIVE_PLAN.md section 3; owner layouts 2026-11-23, tabs
// 2026-11-24):
//
// - Compact (phones, a folded foldable): the web's phone bar (PhoneBar.kt; owner 2026-11-25, "Today's UI, Material
//   3 native"): Home, Tasks and Calendar in one floating capsule, Foli AI and + in another; one page with Back; a
//   note opens full screen (as on iPhone). Each tab keeps its own Navigation 3 back stack.
// - Medium and wider (tablets, an open foldable, Googlebooks): the web's tablet layout. Its sidebar
//   (TabletSidebar.kt) sits beside the page on expanded and wider windows and slides over it on a medium one; the
//   tab strip (TabStrip.kt) floats at the top, with the web's rules (Tabs.kt): everything opened from a page gets
//   a tab that goes Back to it; the sidebar and New note open fresh tabs.
//
// A fold carries the page on screen between the two: unfolding opens it as a tab, folding puts the tab on screen
// on the phone's stack.
package com.folevi.android.ui

import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.PermanentDrawerSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.clickable
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import androidx.navigationevent.NavigationEventInfo
import androidx.navigationevent.compose.NavigationBackHandler
import androidx.navigationevent.compose.rememberNavigationEventState
import com.folevi.android.MainActivity
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.WebIcon
import com.folevi.android.design.folderColor
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.EngineEvent
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

/** The bar's section a page belongs to (the phone's tabs; the rail and sidebar's selection). */
private fun sectionOf(r: Route): Tab? = when (r) {
    HomeRoute -> Tab.HOME
    TasksRoute -> Tab.TASKS
    CalendarRoute -> Tab.CALENDAR
    AiRoute, is AiChatRoute -> Tab.AI
    else -> null
}

@Composable
fun AppShell() {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val width = WidthClass.of(maxWidth)
        val tabbed = width != WidthClass.COMPACT
        // Phones: a back stack per bar tab.
        var tab by rememberSaveable { mutableStateOf(Tab.HOME) }
        val stacks = Tab.entries.associateWith { rememberNavBackStack(it.root) }
        val stack = stacks.getValue(tab)
        // Tablets and Googlebooks: the tab strip.
        val tabs = rememberSaveable(saver = TabsModel.saver) { TabsModel() }
        val phoneOpen: (Route) -> Unit = { r ->
            // A note (or page) replaces the one on screen rather than piling up behind it.
            if (r.isDetail() && stack.lastOrNull()?.let { it is Route && it.isDetail() } == true) stack.removeAt(stack.lastIndex)
            stack.add(r)
        }
        val pick: (Tab) -> Unit = { t ->
            if (t == tab) stacks.getValue(t).let { s -> while (s.size > 1) s.removeAt(s.lastIndex) } else tab = t
        }
        val session = LocalSession.current
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        val isTabbed by rememberUpdatedState(tabbed)
        val openOnPhone by rememberUpdatedState(phoneOpen)
        val newNote: () -> Unit = {
            scope.launch {
                val made = runCatching { session.client.command(Commands.noteCreate(open = false)) }.getOrNull() ?: return@launch
                val r = NoteRoute(made.id, "Untitled")
                if (isTabbed) tabs.show(r, fromPage = false) else openOnPhone(r)
            }
        }
        // A fold or an unfold: the page on screen carries over.
        var wasTabbed by rememberSaveable { mutableStateOf<Boolean?>(null) }
        LaunchedEffect(tabbed) {
            val before = wasTabbed
            wasTabbed = tabbed
            if (before == null || before == tabbed) return@LaunchedEffect
            if (tabbed) {
                val top = stacks.getValue(tab).lastOrNull() as? Route ?: return@LaunchedEffect
                tabs.show(top, fromPage = false)
            } else {
                val r = tabs.activeRoute
                val t = sectionOf(r) ?: Tab.HOME
                tab = t
                val s = stacks.getValue(t)
                while (s.size > 1) s.removeAt(s.lastIndex)
                if (r != t.root) s.add(r)
            }
        }
        // A new window opened at a note starts there.
        LaunchedEffect(Unit) {
            session.initialNote?.let { (id, title) ->
                session.initialNote = null
                if (tabbed) tabs.show(NoteRoute(id, title), fromPage = false) else stacks.getValue(Tab.HOME).add(NoteRoute(id, title))
            }
        }
        // The page's own requests: a link inside a note replaces that note's tab (a new tab with a modifier click or
        // "Open in new tab"), a link to a screen opens its tab, a web address opens in the browser. Note titles name
        // their tabs.
        val navigate: (com.folevi.engine.generated.NavigateRequestEvent) -> Unit = { d ->
            if (d.external) {
                runCatching { (context as? MainActivity)?.openBrowser(Uri.parse(d.route)) }
            } else {
                val r = routeOfPath(d.route, d.noteId)
                when {
                    !isTabbed -> openOnPhone(r)
                    d.newTab -> tabs.addInBackground(r)
                    else -> tabs.show(r, if (r.isNote && tabs.activeRoute.isNote) TabsModel.Opening.REPLACE else TabsModel.Opening.NEW_TAB)
                }
            }
        }
        DisposableEffect(session) {
            session.shellListening = true
            // One the page sent before the frame was here (the end of onboarding).
            session.pendingNavigate?.let { session.pendingNavigate = null; navigate(it) }
            onDispose { session.shellListening = false }
        }
        LaunchedEffect(session) {
            session.client.events.collect { e ->
                when (e) {
                    is EngineEvent.NavigateRequest -> {
                        val d = e.data
                        if (d.external) {
                            runCatching { (context as? MainActivity)?.openBrowser(Uri.parse(d.route)) }
                        } else {
                            val r = routeOfPath(d.route, d.noteId)
                            when {
                                !isTabbed -> openOnPhone(r)
                                d.newTab -> tabs.addInBackground(r)
                                else -> tabs.show(r, if (r.isNote && tabs.activeRoute.isNote) TabsModel.Opening.REPLACE else TabsModel.Opening.NEW_TAB)
                            }
                        }
                    }
                    is EngineEvent.NoteMeta -> if (e.data.found && e.data.title.isNotEmpty()) tabs.named(e.data.id, e.data.title)
                    else -> Unit
                }
            }
        }
        DisposableEffect(stack, tab, tabbed) {
            session.shortcuts = if (tabbed) {
                Shortcuts(
                    newNote = newNote,
                    search = { tabs.show(SearchRoute, fromPage = false) },
                    settings = { tabs.show(SettingsRoute, fromPage = false) },
                    tab = { tabs.show(it.root, fromPage = false) },
                    back = { tabs.goBack() },
                    newWindow = { openWindow(context) },
                    tabs = Shortcuts.TabKeys(
                        close = { tabs.close(tabs.activeId) },
                        reopen = { tabs.reopenClosed() },
                        cycle = { tabs.cycle(it) },
                        forward = { tabs.goForward() },
                    ),
                )
            } else {
                Shortcuts(
                    newNote = newNote,
                    search = { tab = Tab.HOME; stacks.getValue(Tab.HOME).add(SearchRoute) },
                    settings = { tab = Tab.HOME; stacks.getValue(Tab.HOME).add(SettingsRoute) },
                    tab = { pick(it) },
                    back = { if (stack.size > 1) stack.removeAt(stack.lastIndex) },
                    newWindow = { openWindow(context) },
                )
            }
            onDispose { session.shortcuts = null }
        }
        // A fold, or a window moving to another width class, changes the window in place (the manifest keeps the
        // activity and its Page View): the frame below starts over for the new layout, and the stacks and tabs above
        // it carry on, so an open note stays open. (Kept across a fold, parts of the frame drew nothing until laid
        // out again.) Resizing within a class, as dragging a Googlebook window's edge does, keeps every screen's
        // state: it used to start over at every step.
        val window = "$width@${LocalConfiguration.current.densityDpi}"
        // The account sheet and New folder (Home's avatar and menus, the lists' empty states).
        var newFolderIn by remember { mutableStateOf<String?>(null) }
        var newFolderOpen by remember { mutableStateOf(false) }
        var accountOpen by remember { mutableStateOf(false) }
        val sheets = remember(tabbed) {
            PhoneSheets(
                account = { accountOpen = true },
                newFolder = { parent -> newFolderIn = parent; newFolderOpen = true },
            )
        }
        val openAnywhere: (Route) -> Unit = { r -> if (isTabbed) tabs.show(r, fromPage = false) else openOnPhone(r) }
        if (newFolderOpen) NewFolderSheet(onDismiss = { newFolderOpen = false }, open = openAnywhere, parentId = newFolderIn)
        if (accountOpen) AccountSheet(onDismiss = { accountOpen = false }, open = openAnywhere)
        CompositionLocalProvider(LocalPhoneSheets provides sheets) {
        key(window) {
            if (tabbed) {
                TabbedFrame(width, tabs, newNote)
            } else {
                // The web's phone bar: two floating capsules (PhoneBar.kt). It steps away while a note, a page or
                // Settings is open (as on iPhone).
                val top = stack.lastOrNull() as? Route
                val showBar = top != null && !top.isDetail() && top !is SettingsRoute && top !is VaultRoute && !PhoneChrome.selecting.value
                PhoneContent(stack, phoneOpen, Modifier.fillMaxSize()) {
                    AnimatedVisibility(
                        visible = showBar,
                        enter = slideInVertically(MaterialTheme.motionScheme.defaultSpatialSpec()) { it } + fadeIn(),
                        exit = slideOutVertically(MaterialTheme.motionScheme.fastSpatialSpec()) { it } + fadeOut(),
                    ) { PhoneBar(tab, pick, newNote) }
                }
                // Back at the root of Tasks, Calendar or Foli AI goes Home first, then leaves (Android's "exit through
                // home"); NavDisplay handles Back within a tab.
                NavigationBackHandler(
                    state = rememberNavigationEventState(currentInfo = NavigationEventInfo.None),
                    isBackEnabled = tab != Tab.HOME && stack.size == 1,
                    onBackCompleted = { tab = Tab.HOME },
                )
            }
        }
        }
    }
}

/** Tablets, open foldables and Googlebooks: the rail or the sidebar, the tab strip, and the tab on screen. */
@Composable
private fun TabbedFrame(width: WidthClass, tabs: TabsModel, newNote: () -> Unit) {
    val p = LocalPalette.current
    val route = tabs.activeRoute
    val section = sectionOf(route)
    // The rail and the sidebar open fresh tabs; anything opened from the page remembers this tab.
    val fresh: (Route) -> Unit = { tabs.show(it, fromPage = false) }
    val fromPage: (Route) -> Unit = { tabs.show(it) }
    val back: (() -> Unit)? = if (tabs.canGoBack) ({ tabs.goBack() }) else null
    // The system Back (and its predictive gesture): the tab's own Back, then its opener; with nowhere to go it
    // leaves the app as usual.
    NavigationBackHandler(
        state = rememberNavigationEventState(currentInfo = NavigationEventInfo.None),
        isBackEnabled = tabs.canGoBack,
        onBackCompleted = { tabs.goBack() },
    )
    val pages = rememberSaveableStateHolder()
    // The web's tablet sidebar (TabletSidebar.kt), 320 wide: beside the page on expanded and wider windows, over it
    // with a scrim on a medium one (an open foldable, a small tablet), where it starts hidden. Hide sidebar and Show
    // sidebar (the strip) fold it away; the choice holds for this window.
    val wide = width >= WidthClass.EXPANDED
    var sidebarChoice by rememberSaveable { mutableStateOf<Boolean?>(null) }
    val sidebarShown = sidebarChoice ?: wide
    val showSidebar: () -> Unit = { sidebarChoice = true }
    val hideSidebar: () -> Unit = { sidebarChoice = false }
    // From the sidebar a page opens fresh; on a medium window the sidebar goes again once it has.
    val fromSidebar: (Route) -> Unit = { r -> fresh(r); if (!wide) sidebarChoice = false }
    val ai = rememberView(Views.session()).value.value?.capabilities?.ai == true
    val bars = WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Start + WindowInsetsSides.Bottom)
    Box(Modifier.fillMaxSize().background(p.sidebar)) {
        Row(Modifier.fillMaxSize()) {
            AnimatedVisibility(
                visible = wide && sidebarShown,
                enter = expandHorizontally(expandFrom = Alignment.Start) + fadeIn(),
                exit = shrinkHorizontally(shrinkTowards = Alignment.Start) + fadeOut(),
            ) {
                TabletSidebar(route, fromSidebar, onHide = hideSidebar, modifier = Modifier.windowInsetsPadding(bars))
            }
            Column(Modifier.weight(1f).fillMaxHeight().background(MaterialTheme.colorScheme.background)) {
                TabStrip(
                    tabs,
                    newNote,
                    Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(if (sidebarShown && wide) WindowInsetsSides.Top + WindowInsetsSides.End else WindowInsetsSides.Top + WindowInsetsSides.End + WindowInsetsSides.Start)),
                    onShowSidebar = if (sidebarShown && wide) null else showSidebar,
                    onAi = if (ai) ({ fresh(AiRoute) }) else null,
                )
                // The strip above and the sidebar beside it already keep clear of the status bar and the cutout: the
                // page's own bars mustn't leave room for them again.
                Box(
                    Modifier.weight(1f).fillMaxSize()
                        .consumeWindowInsets(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Start))
                        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.End)),
                ) {
                    // Each tab keeps its own scroll positions and fields while another is on screen.
                    pages.SaveableStateProvider("${tabs.activeId}|${route.hashCode()}") {
                        TabPage(route, tabs.active.name, fromPage, back)
                    }
                }
            }
        }
        // A medium window: the sidebar slides in over the page, which dims; a tap on it, or Back, closes it.
        if (!wide) {
            AnimatedVisibility(visible = sidebarShown, enter = fadeIn(), exit = fadeOut()) {
                Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.25f)).clickable(onClickLabel = "Hide sidebar", indication = null, interactionSource = null, onClick = hideSidebar))
            }
            AnimatedVisibility(
                visible = sidebarShown,
                enter = slideInHorizontally { -it },
                exit = slideOutHorizontally { -it },
            ) {
                TabletSidebar(route, fromSidebar, onHide = hideSidebar, modifier = Modifier.windowInsetsPadding(bars))
            }
            NavigationBackHandler(
                state = rememberNavigationEventState(currentInfo = NavigationEventInfo.None),
                isBackEnabled = sidebarShown,
                onBackCompleted = hideSidebar,
            )
        }
    }
}

@Composable
private fun TabPage(route: Route, name: String, open: (Route) -> Unit, back: (() -> Unit)?) {
    when (route) {
        HomeRoute -> HomeScreen(open)
        is NotesRoute -> NotesScreen(route, open, back)
        SearchRoute -> SearchScreen(open, back)
        FoldersRoute -> FoldersScreen(open, back)
        NotificationsRoute -> NotificationsScreen(open, back)
        TasksRoute -> TasksHome(open)
        CalendarRoute -> CalendarHome(open)
        AiRoute -> AiHome(open)
        is AiChatRoute -> AiChatScreen(route, back)
        SettingsRoute -> SettingsScreen(open, back)
        is SettingsPageRoute -> SettingsPageScreen(route, open, back)
        VaultRoute -> VaultScreen(back)
        SharedRoute -> SharedScreen(open, back)
        ChangesRoute -> ChangesScreen(open, back)
        is WebShowRoute -> WebShowScreen(route, back)
        // The note's bar shows its title as the engine last named it.
        is NoteRoute -> NoteScreen(route.copy(title = name), back)
        is PageRoute -> WebPageScreen(route, back)
    }
}

@OptIn(ExperimentalMaterial3AdaptiveApi::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun PhoneContent(stack: NavBackStack<NavKey>, open: (Route) -> Unit, modifier: Modifier, bar: @Composable () -> Unit) {
    val strategy = rememberListDetailSceneStrategy<NavKey>()
    val back: (() -> Unit)? = if (stack.size > 1) ({ stack.removeAt(stack.lastIndex) }) else null
    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        // Clear of the status bar, the cutout and the keyboard (the bar below takes care of its own space).
        contentWindowInsets = WindowInsets.safeDrawing,
        bottomBar = bar,
    ) { padding ->
        NavDisplay(
            backStack = stack,
            onBack = { if (stack.size > 1) stack.removeAt(stack.lastIndex) },
            sceneStrategies = listOf(strategy),
            // The scaffold's padding already keeps clear of the bars: the screens' own app bars mustn't add it again.
            modifier = Modifier.padding(padding).consumeWindowInsets(padding),
            entryProvider = entryProvider {
                entry<HomeRoute>(metadata = ListDetailSceneStrategy.listPane()) { HomeScreen(open) }
                entry<NotesRoute>(metadata = ListDetailSceneStrategy.listPane()) { NotesScreen(it, open, back) }
                entry<SearchRoute>(metadata = ListDetailSceneStrategy.listPane()) { SearchScreen(open, back) }
                entry<FoldersRoute>(metadata = ListDetailSceneStrategy.listPane()) { FoldersScreen(open, back) }
                entry<NotificationsRoute>(metadata = ListDetailSceneStrategy.listPane()) { NotificationsScreen(open, back) }
                entry<TasksRoute>(metadata = ListDetailSceneStrategy.listPane()) { TasksHome(open) }
                entry<CalendarRoute>(metadata = ListDetailSceneStrategy.listPane()) { CalendarHome(open) }
                entry<AiRoute>(metadata = ListDetailSceneStrategy.listPane()) { AiHome(open) }
                entry<AiChatRoute>(metadata = ListDetailSceneStrategy.detailPane()) { AiChatScreen(it, back) }
                entry<SettingsRoute>(metadata = ListDetailSceneStrategy.listPane()) { SettingsScreen(open, back) }
                entry<SettingsPageRoute>(metadata = ListDetailSceneStrategy.listPane()) { SettingsPageScreen(it, open, back) }
                entry<VaultRoute>(metadata = ListDetailSceneStrategy.listPane()) { VaultScreen(back) }
                entry<SharedRoute>(metadata = ListDetailSceneStrategy.listPane()) { SharedScreen(open, back) }
                entry<ChangesRoute>(metadata = ListDetailSceneStrategy.listPane()) { ChangesScreen(open, back) }
                entry<WebShowRoute>(metadata = ListDetailSceneStrategy.detailPane()) { WebShowScreen(it, back) }
                entry<NoteRoute>(metadata = ListDetailSceneStrategy.detailPane()) { NoteScreen(it, back) }
                entry<PageRoute>(metadata = ListDetailSceneStrategy.detailPane()) { WebPageScreen(it, back) }
            },
        )
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
