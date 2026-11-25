// Googlebook and keyboard-and-mouse tablets (docs/ANDROID_NATIVE_PLAN.md, owner layouts 2026-11-23: "Googlebook
// like the Mac app"): right-click and long-press menus on notes, opening a note in a new window, dragging a note
// out as a link, the pointer and hover cues, and the app's keyboard shortcuts (also listed in Android's keyboard
// shortcuts helper, MainActivity.onProvideKeyboardShortcuts).
package com.folevi.android.ui

import androidx.compose.material3.HorizontalDivider

import android.content.ClipData
import android.content.Intent
import android.view.KeyEvent as AndroidKeyEvent
import android.view.KeyboardShortcutGroup
import android.view.KeyboardShortcutInfo
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.draganddrop.dragAndDropSource
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draganddrop.DragAndDropTransferData
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerIcon
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerHoverIcon
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import com.folevi.android.MainActivity
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.WebIcon
import com.folevi.engine.generated.Commands
import com.folevi.engine.generated.NoteRow
import kotlinx.coroutines.launch

/** What the app's shortcuts do; AppShell supplies the actions. */
class Shortcuts(
    val newNote: () -> Unit,
    val search: () -> Unit,
    val settings: () -> Unit,
    val tab: (Tab) -> Unit,
    val back: () -> Unit,
    val newWindow: () -> Unit,
    /** Tablets and Googlebooks only (the tab strip); null on a phone. */
    val tabs: TabKeys? = null,
) {
    /** The tab strip's keys, as in a browser. */
    class TabKeys(val close: () -> Unit, val reopen: () -> Unit, val cycle: (Int) -> Unit, val forward: () -> Unit)

    /** Handles a key press; true when it was one of Folevi's. Ctrl on Android keyboards, Meta (the Googlebook key) too. */
    fun handle(e: KeyEvent): Boolean {
        if (e.type != KeyEventType.KeyDown || !(e.isCtrlPressed || e.isMetaPressed)) return false
        // A held key repeats: one press, one action (holding Ctrl+N made a note per repeat).
        if (e.nativeKeyEvent.repeatCount > 0) return e.key in HANDLED
        when {
            tabs != null && e.key == Key.W -> tabs.close()
            tabs != null && e.key == Key.T && e.isShiftPressed -> tabs.reopen()
            tabs != null && e.key == Key.Tab -> tabs.cycle(if (e.isShiftPressed) -1 else 1)
            tabs != null && e.key == Key.RightBracket -> tabs.forward()
            e.key == Key.N && e.isShiftPressed -> newWindow()
            e.key == Key.N -> newNote()
            e.key == Key.F || e.key == Key.K -> search()
            e.key == Key.Comma -> settings()
            e.key == Key.One -> tab(Tab.HOME)
            e.key == Key.Two -> tab(Tab.TASKS)
            e.key == Key.Three -> tab(Tab.CALENDAR)
            e.key == Key.Four -> tab(Tab.AI)
            e.key == Key.LeftBracket -> back()
            else -> return false
        }
        return true
    }

    companion object {
        /** Keys whose held repeats are swallowed (the first press acted). */
        private val HANDLED = setOf(Key.W, Key.T, Key.Tab, Key.RightBracket, Key.N, Key.F, Key.K, Key.Comma, Key.One, Key.Two, Key.Three, Key.Four, Key.LeftBracket)

        /** The same list for Android's keyboard shortcuts helper (Meta + /); the tab keys only where there are tabs. */
        fun helperGroup(tabs: Boolean): KeyboardShortcutGroup = KeyboardShortcutGroup(
            "Folevi",
            listOfNotNull(
                KeyboardShortcutInfo("New note", AndroidKeyEvent.KEYCODE_N, AndroidKeyEvent.META_CTRL_ON),
                KeyboardShortcutInfo("New window", AndroidKeyEvent.KEYCODE_N, AndroidKeyEvent.META_CTRL_ON or AndroidKeyEvent.META_SHIFT_ON),
                KeyboardShortcutInfo("Search", AndroidKeyEvent.KEYCODE_K, AndroidKeyEvent.META_CTRL_ON),
                KeyboardShortcutInfo("Search", AndroidKeyEvent.KEYCODE_F, AndroidKeyEvent.META_CTRL_ON),
                KeyboardShortcutInfo("Settings", AndroidKeyEvent.KEYCODE_COMMA, AndroidKeyEvent.META_CTRL_ON),
                KeyboardShortcutInfo("Home", AndroidKeyEvent.KEYCODE_1, AndroidKeyEvent.META_CTRL_ON),
                KeyboardShortcutInfo("Tasks", AndroidKeyEvent.KEYCODE_2, AndroidKeyEvent.META_CTRL_ON),
                KeyboardShortcutInfo("Calendar", AndroidKeyEvent.KEYCODE_3, AndroidKeyEvent.META_CTRL_ON),
                KeyboardShortcutInfo("Foli AI", AndroidKeyEvent.KEYCODE_4, AndroidKeyEvent.META_CTRL_ON),
                KeyboardShortcutInfo("Back", AndroidKeyEvent.KEYCODE_LEFT_BRACKET, AndroidKeyEvent.META_CTRL_ON),
                if (tabs) KeyboardShortcutInfo("Forward", AndroidKeyEvent.KEYCODE_RIGHT_BRACKET, AndroidKeyEvent.META_CTRL_ON) else null,
                if (tabs) KeyboardShortcutInfo("Close tab", AndroidKeyEvent.KEYCODE_W, AndroidKeyEvent.META_CTRL_ON) else null,
                if (tabs) KeyboardShortcutInfo("Reopen closed tab", AndroidKeyEvent.KEYCODE_T, AndroidKeyEvent.META_CTRL_ON or AndroidKeyEvent.META_SHIFT_ON) else null,
                if (tabs) KeyboardShortcutInfo("Next tab", AndroidKeyEvent.KEYCODE_TAB, AndroidKeyEvent.META_CTRL_ON) else null,
                if (tabs) KeyboardShortcutInfo("Previous tab", AndroidKeyEvent.KEYCODE_TAB, AndroidKeyEvent.META_CTRL_ON or AndroidKeyEvent.META_SHIFT_ON) else null,
            ),
        )
    }
}

/** Opens a new window of Folevi (Googlebooks and tablets put it beside this one), at a note when given. */
fun openWindow(context: android.content.Context, noteId: String? = null, title: String? = null) {
    val i = MainActivity.internalIntent(null, context)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT or Intent.FLAG_ACTIVITY_MULTIPLE_TASK or Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT)
    if (noteId != null) i.putExtra(MainActivity.EXTRA_NOTE, noteId).putExtra(MainActivity.EXTRA_TITLE, title ?: "")
    context.startActivity(i)
}

/**
 * A note's card with what a desktop expects: a click opens it, right-click or a long press opens its menu (Open,
 * Open in new window, Star, Archive, Move to Trash), it can be dragged out as a link, and the pointer is a hand.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NoteActions(row: NoteRow, open: (Route) -> Unit, content: @Composable (Modifier) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    Box {
        content(
            Modifier
                .pointerHoverIcon(PointerIcon.Hand)
                .pointerInput(row.id) {
                    awaitPointerEventScope {
                        while (true) {
                            val e = awaitPointerEvent()
                            if (e.type == PointerEventType.Press && e.buttons.isSecondaryPressed) {
                                e.changes.forEach { it.consume() }
                                menu = true
                            }
                        }
                    }
                }
                .dragAndDropSource { _ ->
                    DragAndDropTransferData(ClipData.newPlainText(row.title.ifEmpty { "Untitled" }, "folevi://d/${row.id}"), flags = android.view.View.DRAG_FLAG_GLOBAL)
                }
                .combinedClickable(onClick = { open(NoteRoute(row.id, row.title)) }, onLongClickLabel = "More actions", onLongClick = { menu = true }),
        )
        PhoneMenu(menu, { menu = false }) {
            MenuItem("Open", WebIcon.FILE_TEXT) { menu = false; open(NoteRoute(row.id, row.title)) }
            MenuItem("Open in new window", WebIcon.APP_WINDOW) { menu = false; openWindow(context, row.id, row.title) }
            MenuItem(if (row.starred) "Remove bookmark" else "Bookmark", if (row.starred) WebIcon.BOOKMARK_OFF else WebIcon.BOOKMARK) {
                menu = false; scope.launch { runCatching { session.client.command(Commands.noteStar(ids = listOf(row.id), starred = !row.starred)) } }
            }
            MenuItem(if (row.archived) "Unarchive" else "Archive", if (row.archived) WebIcon.ARCHIVE_RESTORE else WebIcon.ARCHIVE) {
                menu = false; scope.launch { runCatching { session.client.command(Commands.noteArchive(ids = listOf(row.id), archived = !row.archived)) } }
            }
            HorizontalDivider(color = com.folevi.android.design.phoneColors().separator)
            MenuItem("Move to Trash", WebIcon.TRASH, destructive = true) {
                menu = false; scope.launch { runCatching { session.client.command(Commands.noteTrash(ids = listOf(row.id))) } }
            }
        }
    }
}
