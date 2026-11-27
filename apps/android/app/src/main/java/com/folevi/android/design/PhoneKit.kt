// The web's phone layout parts (apps/web/src/components/iphone: Screen, Glass, Rows, Swipe), drawn natively with the
// web's sizes, type, colors and shadows (owner 2026-11-25: the Capacitor app's UX, Folevi's styling, Android's
// ripple). Sizes are the web's px as dp; type is tokens.css's phone scale.
package com.folevi.android.design

import androidx.compose.ui.semantics.customActions

import androidx.compose.ui.semantics.CustomAccessibilityAction

import androidx.compose.ui.platform.LocalConfiguration

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

// ---------------------------------------------------------------- tokens

/** tokens.css's phone type scale (`:root[data-iphone]`). */
object PhoneType {
    val largeTitle = TextStyle(fontFamily = Spectral, fontWeight = FontWeight.SemiBold, fontSize = 34.sp, lineHeight = 38.sp, letterSpacing = (-0.02).em)
    val title2Serif = TextStyle(fontFamily = Spectral, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp, letterSpacing = (-0.01).em)
    val title2 = TextStyle(fontFamily = InstrumentSans, fontSize = 22.sp, lineHeight = 28.sp)
    val title3 = TextStyle(fontFamily = InstrumentSans, fontSize = 20.sp, lineHeight = 25.sp)
    val body = TextStyle(fontFamily = InstrumentSans, fontSize = 17.sp, lineHeight = 22.sp)
    val headline = TextStyle(fontFamily = InstrumentSans, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 22.sp)
    val callout = TextStyle(fontFamily = InstrumentSans, fontSize = 16.sp, lineHeight = 21.sp)
    val subheadline = TextStyle(fontFamily = InstrumentSans, fontSize = 15.sp, lineHeight = 20.sp)
    val footnote = TextStyle(fontFamily = InstrumentSans, fontSize = 13.sp, lineHeight = 18.sp)
    val caption2 = TextStyle(fontFamily = InstrumentSans, fontSize = 11.sp, lineHeight = 13.sp)
    /** The eyebrow over a large title: footnote, 600, 0.04em, caps. */
    val eyebrow = TextStyle(fontFamily = InstrumentSans, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 18.sp, letterSpacing = 0.04.em)
    val emptySerif = TextStyle(fontFamily = Spectral, fontStyle = FontStyle.Italic, fontSize = 15.sp, lineHeight = 20.sp)
}

/** The web's radii. */
object PhoneRadius {
    val chip = RoundedCornerShape(6.dp)
    val small = RoundedCornerShape(8.dp)
    val control = RoundedCornerShape(10.dp)
    val panel = RoundedCornerShape(14.dp)
    val container = RoundedCornerShape(18.dp)
}

/** The phone-only colors (globals.css :root[data-iphone]), light and dark. */
class PhoneColors(dark: Boolean, p: FoleviPalette) {
    val card = if (dark) Color.White.copy(alpha = 0.055f) else Color.Black.copy(alpha = 0.03f)
    val separator = if (dark) Color(84, 84, 88).copy(alpha = 0.5f) else Color(60, 60, 67).copy(alpha = 0.16f)
    val press = if (dark) Color.White.copy(alpha = 0.16f) else Color.Black.copy(alpha = 0.10f)
    val active = if (dark) Color.White.copy(alpha = 0.12f) else Color.Black.copy(alpha = 0.075f)
    val solid = p.glassBase
    /** ink at a percentage over nothing (`color-mix(ink N%, transparent)`). */
    private val ink = p.ink
    fun ink(fraction: Float) = ink.copy(alpha = fraction)
}

@Composable
fun phoneColors(): PhoneColors {
    val p = LocalPalette.current
    return remember(p) { PhoneColors(p == FoleviPalette.Dark, p) }
}

// ---------------------------------------------------------------- the screen

/**
 * On a phone turned sideways (a short, wide window) a list keeps to 640 in the middle instead of running edge to
 * edge: the side inset that centers it, or 0.
 */
@Composable
fun landscapeInset(): Dp {
    val cfg = LocalConfiguration.current
    return if (cfg.screenHeightDp < 480 && cfg.screenWidthDp > 600) ((cfg.screenWidthDp - 640) / 2).coerceAtLeast(0).dp else 0.dp
}

/** Whether the window is short (a phone turned sideways): big top spacing gives way. */
@Composable
fun shortWindow(): Boolean = LocalConfiguration.current.screenHeightDp < 480

/**
 * A phone screen (Screen.tsx): a floating bar (leading and trailing glass controls), the eyebrow and large title
 * that scroll with the content, the small title that fades in once the large one has gone, and the canvas fade
 * behind the bar once scrolled. [content] adds the rest of the list.
 */
@Composable
fun PhoneScreen(
    title: String,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
    state: LazyListState = rememberLazyListState(),
    leading: (@Composable RowScope.() -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    bottomPadding: Dp = 24.dp,
    header: (@Composable ColumnScope.() -> Unit)? = null,
    content: LazyListScope.() -> Unit,
) {
    val p = LocalPalette.current
    // The frame (AppShell's scaffold, the tab strip) already keeps clear of the status bar and the tab bar.
    val top = 0.dp
    val nav = 0.dp
    val density = LocalDensity.current
    // How far the large title has scrolled away (0 to 1), and whether anything has scrolled at all.
    val titleGone by remember(state) {
        derivedStateOf {
            if (state.firstVisibleItemIndex > 0) 1f
            else with(density) { (state.firstVisibleItemScrollOffset / 56.dp.toPx()).coerceIn(0f, 1f) }
        }
    }
    val scrolled by remember(state) { derivedStateOf { state.firstVisibleItemIndex > 0 || state.firstVisibleItemScrollOffset > with(density) { 4.dp.toPx() } } }
    Box(modifier.fillMaxSize().background(p.canvas)) {
        LazyColumn(
            state = state,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = landscapeInset(), end = landscapeInset(), top = top + 60.dp, bottom = maxOf(10.dp, nav) + bottomPadding),
        ) {
            item(key = "_title", contentType = "title") {
                Column(Modifier.fillMaxWidth().alpha(1f - titleGone)) {
                    if (!eyebrow.isNullOrBlank()) {
                        Text(eyebrow.uppercase(), style = PhoneType.eyebrow, color = p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 20.dp))
                    }
                    Text(
                        title,
                        style = PhoneType.largeTitle,
                        color = p.heading,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 6.dp).semantics { heading() },
                    )
                    header?.invoke(this)
                }
            }
            content()
        }
        // The fade behind the bar: canvas, opaque to safe+60, then fading out over 32 (no blur, no hairline).
        val fade by animateFloatAsState(if (scrolled) 1f else 0f, Motion.fastEffects(), label = "bar-fade")
        Box(
            Modifier.fillMaxWidth().height(top + 92.dp).alpha(fade).drawBehind {
                val solidTo = (top + 60.dp).toPx() / size.height
                drawRect(Brush.verticalGradient(0f to p.canvas, solidTo to p.canvas, 1f to p.canvas.copy(alpha = 0f)))
            },
        )
        Row(
            Modifier.fillMaxWidth().padding(top = top + 8.dp, start = 16.dp, end = 16.dp).height(44.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            leading?.invoke(this)
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                val small by animateFloatAsState(if (titleGone >= 1f) 1f else 0f, Motion.fastEffects(), label = "small-title")
                Text(title, style = PhoneType.headline, color = p.heading, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.alpha(small))
            }
            trailing?.invoke(this)
        }
    }
}

// ---------------------------------------------------------------- glass controls

/** A 44 glass circle with one icon (GlassCircle). */
@Composable
fun GlassCircle(icon: WebIcon, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, iconSize: Dp = 24.dp) {
    val p = LocalPalette.current
    Box(
        modifier.size(44.dp).foleviGlass(CircleShape).clip(CircleShape).clickable(role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { FoleviIcon(icon, null, size = iconSize, tint = p.ink) }
}

/** A 44 glass capsule holding pill buttons (GlassPill, 2 inside). */
@Composable
fun GlassPill(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(modifier.height(44.dp).foleviGlass(CircleShape).padding(2.dp), verticalAlignment = Alignment.CenterVertically, content = content)
}

/** One button in a [GlassPill]: at least 44 wide, 10 at the sides. */
@Composable
fun PillButton(label: String, onClick: () -> Unit, content: @Composable BoxScope.() -> Unit) {
    Box(
        Modifier.heightIn(min = 44.dp).widthIn(min = 44.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = label, onClick = onClick)
            .padding(horizontal = 8.dp).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
        content = content,
    )
}

/** A glass text button (GlassTextButton: 44 tall, 16 at the sides, headline medium); `strong` is Done's. */
@Composable
fun GlassTextButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, strong: Boolean = false, enabled: Boolean = true) {
    val p = LocalPalette.current
    val shape = CircleShape
    val base = if (strong) modifier.heightIn(min = 44.dp).dropShadowLiquid(shape).background(p.heading, shape) else modifier.heightIn(min = 44.dp).foleviGlass(shape)
    Box(
        base.clip(shape).clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 16.dp).alpha(if (enabled) 1f else 0.35f),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = PhoneType.headline.copy(fontWeight = if (strong) FontWeight.SemiBold else FontWeight.Medium), color = if (strong) p.canvas else p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The person's avatar (34 in a 44 target, a 0.5 ring): their picture's first letter on the accent. */
@Composable
fun AvatarButton(name: String, onClick: () -> Unit, imageUrl: String? = null) {
    val p = LocalPalette.current
    Box(Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Account", onClick = onClick).semantics { contentDescription = "Account" }, contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(34.dp).clip(CircleShape).background(p.accentSoft).border(0.5.dp, phoneColors().separator, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(name.trim().firstOrNull()?.uppercase() ?: "F", style = PhoneType.subheadline.copy(fontWeight = FontWeight.SemiBold), color = p.accentSoftInk)
        }
    }
}

// ---------------------------------------------------------------- fields

/** The search pill under a title (44, radius 14, ink 6.5%): a button that opens search. */
@Composable
fun SearchPill(placeholder: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val c = phoneColors()
    Row(
        modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 4.dp).heightIn(min = 44.dp).clip(PhoneRadius.panel).background(c.ink(0.065f))
            .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FoleviIcon(WebIcon.SEARCH, null, size = 19.dp, tint = p.inkMuted)
        Text(placeholder, style = PhoneType.body, color = p.inkFaint, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A filter field in the same pill ("Filter notes", "Filter by task or note"). */
@Composable
fun FilterField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, icon: WebIcon = WebIcon.FUNNEL) {
    val p = LocalPalette.current
    val c = phoneColors()
    Row(
        modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 4.dp).heightIn(min = 44.dp).clip(PhoneRadius.panel).background(c.ink(0.065f)).padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FoleviIcon(icon, null, size = 19.dp, tint = p.inkMuted)
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, style = PhoneType.body, color = p.inkFaint, maxLines = 1, overflow = TextOverflow.Ellipsis)
            BasicTextField(value, onChange, singleLine = true, textStyle = PhoneType.body.copy(color = p.ink), cursorBrush = SolidColor(p.accent), modifier = Modifier.fillMaxWidth().semantics { contentDescription = placeholder })
        }
        if (value.isNotEmpty()) {
            Box(Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Clear") { onChange("") }.semantics { contentDescription = "Clear" }, contentAlignment = Alignment.Center) {
                FoleviIcon(WebIcon.CIRCLE_X, null, size = 17.dp, tint = p.inkFaint)
            }
        } else {
            Spacer(Modifier.width(12.dp))
        }
    }
}

// ---------------------------------------------------------------- sections and rows

/**
 * A Home section's header (HomeSection): Spectral title2 in the heading color, a chevron when the title links,
 * then "See all" and a "…" when given.
 */
@Composable
fun SectionHeader(title: String, onTitle: (() -> Unit)? = null, seeAll: (() -> Unit)? = null, more: (@Composable () -> Unit)? = null, chevronTurned: Boolean = false) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().padding(top = 28.dp, start = 20.dp, end = 5.dp).heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.weight(1f).then(if (onTitle != null) Modifier.clickable(role = Role.Button, onClick = onTitle) else Modifier),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, style = PhoneType.title2Serif, color = p.heading, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false).semantics { heading() })
            if (onTitle != null) {
                val turn by animateFloatAsState(if (chevronTurned) 90f else 0f, Motion.fastSpatial(), label = "chevron")
                FoleviIcon(WebIcon.CHEVRON_RIGHT, null, size = 20.dp, tint = p.inkFaint, modifier = Modifier.padding(start = 2.dp).graphicsLayer { rotationZ = turn })
            }
        }
        if (seeAll != null) {
            Text("See all", style = PhoneType.body, color = p.inkMuted, modifier = Modifier.clip(CircleShape).clickable(role = Role.Button, onClick = seeAll).padding(horizontal = 15.dp, vertical = 10.dp))
        }
        more?.invoke()
    }
}

/** A rounded group of rows (RowGroup: 16 margin, radius 18, the card fill, 4 inside, no hairlines). */
@Composable
fun RowGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val c = phoneColors()
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(PhoneRadius.container).background(c.card).padding(vertical = 4.dp), content = content)
}

/**
 * A row (ListRow). In a [RowGroup] (`grouped`): 14/12 inside, at least 48; on its own: 20/16, at least 52, with
 * a hairline under the text running to the edge. Icon 22 in a 28 box, label body, detail muted, chevron 20.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ListRow(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: WebIcon? = null,
    iconTint: Color? = null,
    leading: (@Composable () -> Unit)? = null,
    detail: String? = null,
    chevron: Boolean = true,
    grouped: Boolean = true,
    destructive: Boolean = false,
    onLongClick: (() -> Unit)? = null,
) {
    val p = LocalPalette.current
    val c = phoneColors()
    Row(
        modifier.fillMaxWidth().heightIn(min = if (grouped) 48.dp else 52.dp)
            .combinedClickable(role = Role.Button, onClick = onClick, onLongClickLabel = if (onLongClick != null) "More actions" else null, onLongClick = onLongClick)
            .padding(start = if (grouped) 14.dp else 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null || icon != null) {
            Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) {
                if (leading != null) leading() else FoleviIcon(icon!!, null, size = 22.dp, tint = iconTint ?: p.inkMuted)
            }
            Spacer(Modifier.width(12.dp))
        }
        Row(
            Modifier.weight(1f).heightIn(min = if (grouped) 48.dp else 52.dp)
                .then(if (!grouped) Modifier.drawBehind { drawLine(c.separator, Offset(0f, size.height), Offset(size.width, size.height), 0.5.dp.toPx()) } else Modifier)
                .padding(end = if (grouped) 12.dp else 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = PhoneType.body, color = if (destructive) p.destructive else p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (detail != null) Text(detail, style = PhoneType.body.copy(fontFeatureSettings = "tnum"), color = p.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 8.dp))
            if (chevron) FoleviIcon(WebIcon.CHEVRON_RIGHT, null, size = 20.dp, tint = p.inkFaint, modifier = Modifier.offset(x = 4.dp))
        }
    }
}

/** A quiet placeholder for an empty section (EmptyBox: ink 4%, radius 18, italic Spectral). */
@Composable
fun EmptyNote(text: String, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val c = phoneColors()
    Box(
        modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 56.dp).clip(PhoneRadius.container).background(c.ink(0.04f)).padding(horizontal = 20.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = PhoneType.emptySerif, color = p.inkMuted, textAlign = TextAlign.Center) }
}

/** A whole screen with nothing in it (ScreenEmpty): icon 40, a title, a line, an action. */
@Composable
fun ScreenEmpty(icon: WebIcon, title: String, body: String? = null, action: (@Composable () -> Unit)? = null, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    Box(modifier.fillMaxWidth().padding(top = if (shortWindow()) 24.dp else 120.dp), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.width(280.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            FoleviIcon(icon, null, size = 40.dp, tint = p.inkFaint)
            Spacer(Modifier.height(6.dp))
            Text(title, style = PhoneType.headline, color = p.heading, textAlign = TextAlign.Center)
            if (body != null) Text(body, style = PhoneType.subheadline, color = p.inkMuted, textAlign = TextAlign.Center)
            if (action != null) { Spacer(Modifier.height(14.dp)); action() }
        }
    }
}

/** A loading placeholder bar in the sunken color. */
@Composable
fun Placeholder(height: Dp, modifier: Modifier = Modifier, shape: RoundedCornerShape = PhoneRadius.control) {
    val p = LocalPalette.current
    Box(modifier.fillMaxWidth().height(height).clip(shape).background(p.surfaceSunken))
}

// ---------------------------------------------------------------- chips

/** A view chip (Tasks): icon, label, count; `heading` fill when selected, ink 6.5% otherwise. */
@Composable
fun ViewChip(label: String, selected: Boolean, onClick: () -> Unit, icon: WebIcon? = null, count: Long? = null) {
    val p = LocalPalette.current
    val c = phoneColors()
    val fill = if (selected) p.heading else c.ink(0.065f)
    val ink = if (selected) p.canvas else p.ink
    val muted = if (selected) p.canvas.copy(alpha = 0.7f) else p.inkMuted
    Box(Modifier.heightIn(min = 44.dp).clip(CircleShape).clickable(role = Role.Tab, onClick = onClick).semantics { contentDescription = label; this.selected = selected }, contentAlignment = Alignment.Center) {
        Row(
            Modifier.heightIn(min = 34.dp).clip(CircleShape).background(fill).padding(start = 12.dp, end = 14.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (icon != null) FoleviIcon(icon, null, size = 17.dp, tint = if (selected) p.canvas else p.inkMuted)
            Text(label, style = PhoneType.subheadline.copy(fontWeight = FontWeight.Medium), color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (count != null) Text("$count", style = PhoneType.subheadline.copy(fontFeatureSettings = "tnum"), color = muted)
        }
    }
}

// ---------------------------------------------------------------- swipe rows

/** One swipe action (Swipe.tsx): 76 wide, white icon and label on its color. */
data class SwipeAction(val label: String, val icon: WebIcon, val color: Color, val run: () -> Unit)

/**
 * A row with swipe actions (Swipe.tsx): [leading] show when swiping right, [trailing] (outermost first) when
 * swiping left. It opens past 40, and a full swipe past 60% of the row runs the first action, with a haptic each
 * time that point is crossed. Settles on the web's spring (response 0.3, damping 0.86).
 */
@Composable
fun SwipeRow(leading: List<SwipeAction> = emptyList(), trailing: List<SwipeAction> = emptyList(), modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    if (leading.isEmpty() && trailing.isEmpty()) { Box(modifier) { content() }; return }
    val density = LocalDensity.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    var width = remember { floatArrayOf(1f) }
    val action = with(density) { 76.dp.toPx() }
    // The web's spring (response 0.3, damping 0.86); a snap when animations are off.
    val settle: androidx.compose.animation.core.AnimationSpec<Float> = if (rememberReducedMotion()) androidx.compose.animation.core.snap() else spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)
    var armed = remember { booleanArrayOf(false) }
    Box(
        modifier.fillMaxWidth().onSizeChanged { width[0] = it.width.toFloat().coerceAtLeast(1f) }
            .semantics { customActions = swipeAccessibilityActions(leading, trailing) },
    ) {
        // The actions under the row.
        val x = offset.value
        if (x > 0 && leading.isNotEmpty()) {
            Row(Modifier.matchParentSize()) {
                leading.forEach { a -> SwipeButton(a, Modifier.width(with(density) { (x / leading.size).toDp() }).fillMaxHeight()) { scope.launch { offset.animateTo(0f, settle) }; a.run() } }
            }
        } else if (x < 0 && trailing.isNotEmpty()) {
            Row(Modifier.matchParentSize(), horizontalArrangement = Arrangement.End) {
                trailing.reversed().forEach { a -> SwipeButton(a, Modifier.width(with(density) { (-x / trailing.size).toDp() }).fillMaxHeight()) { scope.launch { offset.animateTo(0f, settle) }; a.run() } }
            }
        }
        Box(
            Modifier.offset { IntOffset(offset.value.roundToInt(), 0) }
                .background(LocalPalette.current.canvas)
                .draggable(
                    orientation = Orientation.Horizontal,
                    state = rememberDraggableState { d ->
                        val next = (offset.value + d).let { v -> when { v > 0 && leading.isEmpty() -> 0f; v < 0 && trailing.isEmpty() -> 0f; else -> v } }
                        scope.launch { offset.snapTo(next) }
                        val full = abs(next) > width[0] * 0.6f
                        if (full != armed[0]) { armed[0] = full; haptics.performHapticFeedback(HapticFeedbackType.LongPress) }
                    },
                    onDragStopped = {
                        val v = offset.value
                        val full = abs(v) > width[0] * 0.6f
                        armed[0] = false
                        when {
                            full && v > 0 -> { offset.animateTo(0f, settle); leading.first().run() }
                            full && v < 0 -> { offset.animateTo(0f, settle); trailing.first().run() }
                            v > with(density) { 40.dp.toPx() } -> offset.animateTo(action * leading.size, settle)
                            v < -with(density) { 40.dp.toPx() } -> offset.animateTo(-action * trailing.size, settle)
                            else -> offset.animateTo(0f, settle)
                        }
                    },
                ),
        ) {
            content()
            // An open row closes on a tap anywhere on it (and the tap does nothing else).
            if (abs(offset.value) > 1f) Box(Modifier.matchParentSize().clickable(indication = null, interactionSource = null) { scope.launch { offset.animateTo(0f, settle) } })
        }
    }
}

/** The swipe actions as accessibility actions, leading first, so they can be run without swiping. */
fun swipeAccessibilityActions(leading: List<SwipeAction>, trailing: List<SwipeAction>): List<CustomAccessibilityAction> =
    (leading + trailing).map { a -> CustomAccessibilityAction(a.label) { a.run(); true } }

@Composable
private fun SwipeButton(a: SwipeAction, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.background(a.color).clickable(role = Role.Button, onClickLabel = a.label, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        FoleviIcon(a.icon, null, size = 20.dp, tint = Color.White)
        Text(a.label, style = PhoneType.footnote.copy(fontWeight = FontWeight.Medium), color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
    }
}

/** The web's liquid shadow alone (Done's strong button). */
@Composable
fun Modifier.dropShadowLiquid(shape: androidx.compose.ui.graphics.Shape): Modifier {
    val dark = LocalPalette.current == FoleviPalette.Dark
    return this
        .dropShadow(shape, androidx.compose.ui.graphics.shadow.Shadow(radius = 30.dp, spread = (-10).dp, offset = androidx.compose.ui.unit.DpOffset(0.dp, 10.dp), color = Color.Black.copy(alpha = if (dark) 0.65f else 0.2f)))
        .dropShadow(shape, androidx.compose.ui.graphics.shadow.Shadow(radius = 8.dp, spread = (-2).dp, offset = androidx.compose.ui.unit.DpOffset(0.dp, 2.dp), color = Color.Black.copy(alpha = if (dark) 0.4f else 0.08f)))
}
