// The Insert sheet's catalogue types and pictures (InsertCatalog.kt is generated from the web's InsertPanel and
// insertPreviews, as the iPhone's InsertCatalog.swift is). A picture is a list of marks on a 48 x 36 grid, each
// painted in the text colour, the paper (raised surface) colour or the accent, at an opacity (the iPhone's
// InsertPicture in apps/native-kit/Sources/FoleviDesign/Phone/PhoneInsertSheet.swift).
package com.folevi.android.design

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class InsertTileSpec(
    val kind: String,
    val label: String,
    /** The accessible name when it says more than the label (the divider styles). */
    val name: String?,
    /** The picture's kind (null: a divider, drawn as its line). */
    val preview: String?,
    /** The colour family ("moss", "ember", ...; null: the ink). The pictures draw every tile in grey, as the web's. */
    val hue: String?,
    val keywords: String,
)

data class InsertSectionSpec(val title: String, val tiles: List<InsertTileSpec>)

/** What a mark is painted with: the text colour, the paper (raised surface) or the accent. */
enum class InsertInk { CURRENT, PAPER, ACCENT }

data class InsertPaint(
    val fill: InsertInk?,
    val fillOpacity: Float,
    val stroke: InsertInk?,
    val strokeOpacity: Float,
    val strokeWidth: Float,
    val roundCap: Boolean,
    val roundJoin: Boolean,
    val dash: List<Float>,
)

data class InsertRotation(val degrees: Float, val cx: Float, val cy: Float)

/** A shape of a picture, in SVG terms. */
sealed interface InsertNode {
    data class Rect(val x: Float, val y: Float, val width: Float, val height: Float, val rx: Float, val ry: Float) : InsertNode
    data class Circle(val cx: Float, val cy: Float, val r: Float) : InsertNode
    data class PathData(val d: String) : InsertNode
    data class Line(val x1: Float, val y1: Float, val x2: Float, val y2: Float) : InsertNode
}

/** One mark of a picture. */
sealed interface InsertArt {
    data class Shape(val node: InsertNode, val paint: InsertPaint) : InsertArt
    data class Text(
        val text: String,
        val x: Float,
        val y: Float,
        val size: Float,
        val weight: Float,
        val italic: Boolean,
        val centered: Boolean,
        val serif: Boolean,
        val paint: InsertPaint,
    ) : InsertArt
    data class Group(val rotate: InsertRotation?, val clip: InsertNode?, val children: List<InsertArt>) : InsertArt
}

private val pathCache = HashMap<String, Path>()

private fun InsertNode.path(): Path = when (this) {
    is InsertNode.Rect -> Path().apply { addRoundRect(RoundRect(x, y, x + width, y + height, CornerRadius(rx, ry))) }
    is InsertNode.Circle -> Path().apply { addOval(androidx.compose.ui.geometry.Rect(cx - r, cy - r, cx + r, cy + r)) }
    is InsertNode.PathData -> pathCache.getOrPut(d) { PathParser().parsePathString(d).toPath() }
    is InsertNode.Line -> Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
}

/**
 * A tile's picture, 48 x 36: the marks in the ink, the paper in the raised surface, the accent in the muted ink (grey
 * on every tile, as the web's and the iPhone's pickers draw them).
 */
@Composable
fun InsertPicture(preview: String, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val art = InsertCatalog.pictures[preview].orEmpty()
    val measurer = rememberTextMeasurer()
    val color: (InsertInk) -> Color = { ink ->
        when (ink) {
            InsertInk.CURRENT -> p.ink
            InsertInk.PAPER -> p.surfaceRaised
            InsertInk.ACCENT -> p.inkMuted
        }
    }
    Canvas(modifier.size(48.dp, 36.dp).clearAndSetSemantics {}) {
        scale(size.width / 48f, size.height / 36f, pivot = Offset.Zero) { drawArt(art, color, measurer) }
    }
}

private fun DrawScope.drawArt(art: List<InsertArt>, color: (InsertInk) -> Color, measurer: TextMeasurer) {
    for (a in art) {
        when (a) {
            is InsertArt.Shape -> {
                val path = a.node.path()
                val paint = a.paint
                paint.fill?.let { if (a.node !is InsertNode.Line) drawPath(path, color(it).copy(alpha = color(it).alpha * paint.fillOpacity)) }
                paint.stroke?.let {
                    drawPath(
                        path,
                        color(it).copy(alpha = color(it).alpha * paint.strokeOpacity),
                        style = Stroke(
                            width = paint.strokeWidth,
                            cap = if (paint.roundCap) StrokeCap.Round else StrokeCap.Butt,
                            join = if (paint.roundJoin) StrokeJoin.Round else StrokeJoin.Miter,
                            pathEffect = if (paint.dash.isNotEmpty()) PathEffect.dashPathEffect(paint.dash.toFloatArray()) else null,
                        ),
                    )
                }
            }
            is InsertArt.Text -> {
                val ink = color(a.paint.fill ?: InsertInk.CURRENT)
                val layout = measurer.measure(
                    a.text,
                    TextStyle(
                        color = ink.copy(alpha = ink.alpha * a.paint.fillOpacity),
                        fontSize = a.size.sp,
                        fontWeight = FontWeight(a.weight.toInt().coerceIn(1, 1000)),
                        fontStyle = if (a.italic) FontStyle.Italic else FontStyle.Normal,
                        fontFamily = if (a.serif) Spectral else InstrumentSans,
                    ),
                )
                // SVG text sits on its baseline at y; the measured text's size is in pixels, the grid's are points of
                // a 48-wide picture, so it's drawn at the grid's scale (sp would be device pixels here).
                val k = 1f / density / fontScale
                translate(a.x, a.y) {
                    scale(k, k, pivot = Offset.Zero) {
                        val w = layout.size.width
                        drawText(layout, topLeft = Offset(if (a.centered) -w / 2f else 0f, -layout.firstBaseline))
                    }
                }
            }
            is InsertArt.Group -> {
                val inner: DrawScope.() -> Unit = {
                    val r = a.rotate
                    if (r != null) rotate(r.degrees, pivot = Offset(r.cx, r.cy)) { drawArt(a.children, color, measurer) }
                    else drawArt(a.children, color, measurer)
                }
                val clip = a.clip
                if (clip != null) clipPath(clip.path()) { inner() } else inner()
            }
        }
    }
}
