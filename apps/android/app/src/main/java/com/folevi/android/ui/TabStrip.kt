// The tab strip at the top of tablet, open-foldable and Googlebook windows (Tabs.kt has the rules): Home first as an
// icon, then a tab per page, the one on screen raised. A tab closes with its ×, a middle click or Ctrl+W; a right
// click (or a long press) offers Close and Close other tabs; + starts a new note in a fresh tab.
package com.folevi.android.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerIcon
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.isTertiaryPressed
import androidx.compose.ui.input.pointer.pointerHoverIcon
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folevi.android.design.FoleviIcon
import com.folevi.android.design.LocalPalette
import com.folevi.android.design.WebIcon

@Composable
fun TabStrip(tabs: TabsModel, onNewNote: () -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val scroll = rememberScrollState()
    // The tab on screen stays in view when the strip is wider than the window.
    LaunchedEffect(tabs.activeId, tabs.tabs.size) {
        val i = tabs.tabs.indexOfFirst { it.id == tabs.activeId }
        if (i == tabs.tabs.lastIndex) scroll.animateScrollTo(scroll.maxValue)
    }
    Row(
        modifier.fillMaxWidth().height(48.dp).background(p.sidebar).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f, fill = false).horizontalScroll(scroll),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            for (t in tabs.tabs) key(t.id) {
                TabChip(t, active = t.id == tabs.activeId, tabs = tabs)
            }
        }
        IconButton(onClick = onNewNote, modifier = Modifier.size(40.dp).pointerHoverIcon(PointerIcon.Hand)) {
            FoleviIcon(WebIcon.PLUS, "New note", size = 18.dp, tint = p.inkMuted)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TabChip(t: FrameTab, active: Boolean, tabs: TabsModel) {
    val p = LocalPalette.current
    val hover = remember { MutableInteractionSource() }
    val hovered by hover.collectIsHoveredAsState()
    var menu by remember { mutableStateOf(false) }
    val container = when {
        active -> p.surface
        hovered -> p.surfaceSunken
        else -> Color.Transparent
    }
    Box {
        Surface(
            color = container,
            shape = RoundedCornerShape(10.dp),
            shadowElevation = if (active) 1.dp else 0.dp,
            modifier = Modifier
                .height(36.dp)
                .clip(RoundedCornerShape(10.dp))
                .hoverable(hover)
                .pointerHoverIcon(PointerIcon.Hand)
                .pointerInput(t.id) {
                    awaitPointerEventScope {
                        while (true) {
                            val e = awaitPointerEvent()
                            if (e.type != PointerEventType.Press) continue
                            when {
                                e.buttons.isTertiaryPressed -> tabs.close(t.id)
                                e.buttons.isSecondaryPressed -> menu = true
                            }
                        }
                    }
                }
                .combinedClickable(
                    role = Role.Tab,
                    onClick = { tabs.select(t.id) },
                    onLongClick = { menu = true },
                )
                .semantics {
                    selected = active
                    contentDescription = t.name
                },
        ) {
            if (t.isHome) {
                Box(Modifier.width(44.dp), contentAlignment = Alignment.Center) {
                    FoleviIcon(WebIcon.HOUSE, null, size = 18.dp, tint = if (active) p.ink else p.inkMuted)
                }
            } else {
                Row(Modifier.padding(start = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    FoleviIcon(t.route.tabIcon(), null, size = 16.dp, tint = if (active) p.ink else p.inkMuted)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        t.name,
                        style = MaterialTheme.typography.labelLarge,
                        color = if (active) p.ink else p.inkMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.widthIn(min = 48.dp, max = 180.dp),
                    )
                    // The × shows on the tab on screen and under the pointer (always reachable by touch on the active one).
                    Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
                        if (active || hovered) {
                            IconButton(onClick = { tabs.close(t.id) }, modifier = Modifier.size(28.dp)) {
                                FoleviIcon(WebIcon.X, "Close ${t.name}", size = 14.dp, tint = p.inkMuted)
                            }
                        }
                    }
                }
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            if (!t.isHome) DropdownMenuItem(text = { Text("Close tab") }, onClick = { menu = false; tabs.close(t.id) })
            DropdownMenuItem(text = { Text("Close other tabs") }, enabled = tabs.tabs.size > 2 || (tabs.tabs.size == 2 && t.isHome), onClick = { menu = false; tabs.closeOthers(t.id) })
            if (tabs.closed.isNotEmpty()) DropdownMenuItem(text = { Text("Reopen closed tab") }, onClick = { menu = false; tabs.reopenClosed() })
        }
    }
}
