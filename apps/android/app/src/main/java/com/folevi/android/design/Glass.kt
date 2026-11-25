// Folevi's glass as the web draws it on Android (apps/web/src/app/globals.css, .ui-liquid under the Android
// marker): a solid fill (#F7F7F8 / #2C2C2E) with the bright rim, the hairline edge and the web's two-layer shadow,
// and no sheen or blur. Owner, 2026-11-25: Folevi's own colors and shadows, not Material's tonal tint and elevation.
package com.folevi.android.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp

private fun rgb(r: Int, g: Int, b: Int, a: Float) = Color(r, g, b, (a * 255).toInt())

/** The glass for [shape]. */
@Composable
fun Modifier.foleviGlass(shape: Shape): Modifier {
    val dark = LocalPalette.current == FoleviPalette.Dark
    // --liquid-shadow: 0 10px 30px -10px / 0.2, 0 2px 8px -2px / 0.08 (dark: 0 12px 34px -10px / 0.65, 0 2px 8px -2px / 0.4).
    val far = if (dark) Shadow(radius = 34.dp, spread = (-10).dp, offset = DpOffset(0.dp, 12.dp), color = rgb(0, 0, 0, 0.65f))
    else Shadow(radius = 30.dp, spread = (-10).dp, offset = DpOffset(0.dp, 10.dp), color = rgb(0, 0, 0, 0.2f))
    val near = Shadow(radius = 8.dp, spread = (-2).dp, offset = DpOffset(0.dp, 2.dp), color = rgb(0, 0, 0, if (dark) 0.4f else 0.08f))
    val base = LocalPalette.current.glassBase
    // --liquid-rim: a 1px light edge, brightest at the top left and the bottom right.
    val rim = if (dark) Brush.linearGradient(
        0f to rgb(255, 255, 255, 0.5f), 0.22f to rgb(255, 255, 255, 0.12f), 0.48f to rgb(255, 255, 255, 0.02f),
        0.76f to rgb(255, 255, 255, 0.06f), 1f to rgb(255, 255, 255, 0.3f),
    ) else Brush.linearGradient(
        0f to rgb(255, 255, 255, 1f), 0.2f to rgb(255, 255, 255, 0.4f), 0.46f to rgb(255, 255, 255, 0.05f),
        0.76f to rgb(255, 255, 255, 0.2f), 1f to rgb(255, 255, 255, 0.9f),
    )
    // --liquid-edge's hairline: 0 0 0 0.5px.
    val hairline = rgb(0, 0, 0, if (dark) 0.55f else 0.09f)
    return this
        .dropShadow(shape, far)
        .dropShadow(shape, near)
        .border(0.5.dp, hairline, shape)
        .background(base, shape)
        .border(1.dp, rim, shape)
}
