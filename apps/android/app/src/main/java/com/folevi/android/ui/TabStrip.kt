// The tab strip at the top of tablet, open-foldable and Googlebook windows (Tabs.kt has the rules), as the web draws
// it on a tablet (apps/web/src/components/app/TabStrip.tsx, data-ipad-tabs): a 52 glass capsule 8 from the edges
// holding Show sidebar (while it's hidden), Back and Forward, the tabs as 40 capsules in body text (Home first with
// its name, the one on screen on the row color in semibold with a soft shadow), then Foli AI and New note as round
// buttons. A tab closes with its ×, a middle click or Ctrl+W; a right click (or a long press) offers Close and Close
// other tabs.
package com.folevi.android.ui

import androidx.compose.foundation.layout.heightIn

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.DpOffset
import com.folevi.android.design.AiMark
import com.folevi.android.design.PhoneType
import com.folevi.android.design.foleviGlass
import com.folevi.android.design.phoneColors
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
fun TabStrip(
    tabs: TabsModel,
    onNewNote: () -> Unit,
    modifier: Modifier = Modifier,
    onShowSidebar: (() -> Unit)? = null,
    onAi: (() -> Unit)? = null,
) {
    val scroll = rememberScrollState()
    // The tab on screen stays in view when the strip is wider than the window.
    LaunchedEffect(tabs.activeId, tabs.tabs.size) {
        val i = tabs.tabs.indexOfFirst { it.id == tabs.activeId }
        if (i == tabs.tabs.lastIndex) scroll.animateScrollTo(scroll.maxValue)
    }
    Row(
        modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 8.dp).height(52.dp).foleviGlass(CircleShape).padding(horizontal = 6.dp).testTag("tab-strip"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (onShowSidebar != null) StripButton(WebIcon.PANEL_LEFT, "Show sidebar", onShowSidebar)
        StripButton(WebIcon.CHEVRON_LEFT, "Back", { tabs.goBack() }, enabled = tabs.canGoBack)
        StripButton(WebIcon.CHEVRON_RIGHT, "Forward", { tabs.goForward() }, enabled = tabs.canGoForward)
        Row(
            Modifier.weight(1f).horizontalScroll(scroll),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            for (t in tabs.tabs) key(t.id) {
                TabChip(t, active = t.id == tabs.activeId, tabs = tabs)
            }
        }
        if (onAi != null) StripButton(null, "Foli AI", onAi) { AiMark(20.dp) }
        StripButton(WebIcon.PLUS, "New note", onNewNote, iconSize = 22.dp)
    }
}

/** A round 44 button in the strip (the web's PillButton). */
@Composable
private fun StripButton(icon: WebIcon?, label: String, onClick: () -> Unit, enabled: Boolean = true, iconSize: androidx.compose.ui.unit.Dp = 20.dp, content: (@Composable () -> Unit)? = null) {
    val p = LocalPalette.current
    Box(
        Modifier.size(44.dp).clip(CircleShape).clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .pointerHoverIcon(PointerIcon.Hand).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        if (content != null) content() else FoleviIcon(icon!!, null, size = iconSize, tint = if (enabled) p.ink else p.inkFaint.copy(alpha = 0.5f))
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TabChip(t: FrameTab, active: Boolean, tabs: TabsModel) {
    val p = LocalPalette.current
    val hover = remember { MutableInteractionSource() }
    val hovered by hover.collectIsHoveredAsState()
    var menu by remember { mutableStateOf(false) }
    val c = phoneColors()
    val dark = p == com.folevi.android.design.FoleviPalette.Dark
    // The web's tablet tab: 40 tall, a capsule; the one on screen on the row color with a soft shadow and a hairline.
    val row = LocalPalette.current.groupedRow
    val container = when {
        active -> row
        hovered -> c.active
        else -> Color.Transparent
    }
    Box {
        Row(
            modifier = Modifier
                .heightIn(min = 40.dp)
                .then(if (active) Modifier.dropShadow(CircleShape, Shadow(radius = 4.dp, offset = DpOffset(0.dp, 1.dp), color = Color.Black.copy(alpha = 0.08f))) else Modifier)
                .clip(CircleShape)
                .background(container)
                .then(if (active) Modifier.border(0.5.dp, c.separator, CircleShape) else Modifier)
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
                }
                .padding(start = 14.dp, end = if (t.isHome) 14.dp else 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val ink = if (active) p.heading else p.inkMuted
            val text = PhoneType.body.copy(fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal)
            if (t.isHome) {
                FoleviIcon(WebIcon.HOUSE, null, size = 17.dp, tint = ink)
                Spacer(Modifier.width(8.dp))
                Text("Home", style = text, color = ink, maxLines = 1)
            } else {
                FoleviIcon(t.route.tabIcon(), null, size = 16.dp, tint = ink)
                Spacer(Modifier.width(8.dp))
                Text(t.name, style = text, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(min = 48.dp, max = 200.dp))
                // A finger closes only the tab on screen; a pointer sees every tab's × on hover.
                // The × is 28 to the eye and 40 to the finger (the tab's own height).
                Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                    if (active || hovered) {
                        Box(
                            Modifier.size(40.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Close ${t.name}") { tabs.close(t.id) }.semantics { contentDescription = "Close ${t.name}" },
                            contentAlignment = Alignment.Center,
                        ) { FoleviIcon(WebIcon.X, null, size = 15.dp, tint = p.inkMuted) }
                    }
                }
            }
        }
        PhoneMenu(menu, { menu = false }) {
            if (!t.isHome) DropdownMenuItem(text = { Text("Close tab") }, onClick = { menu = false; tabs.close(t.id) })
            DropdownMenuItem(text = { Text("Close other tabs") }, enabled = tabs.tabs.size > 2 || (tabs.tabs.size == 2 && t.isHome), onClick = { menu = false; tabs.closeOthers(t.id) })
            if (tabs.closed.isNotEmpty()) DropdownMenuItem(text = { Text("Reopen closed tab") }, onClick = { menu = false; tabs.reopenClosed() })
        }
    }
}
