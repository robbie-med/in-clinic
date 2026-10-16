package org.robbiemed.clinic

import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import java.time.Instant
import java.time.ZoneId

const val BG = 0xFF0B0D10.toInt()
const val SURFACE = 0xFF161A20.toInt()
const val RAISED = 0xFF222832.toInt()
const val INK = 0xFFECEFF4.toInt()
const val DIM = 0xFF8A94A3.toInt()
const val FAINT = 0xFF5B6575.toInt()
const val ACCENT = 0xFF5B9CF5.toInt()
const val BAD = 0xFFE5484D.toInt()

fun Context.dp(v: Int) = (v * resources.displayMetrics.density).toInt()

fun Context.label(s: String, size: Float, color: Int = INK, bold: Boolean = false) = TextView(this).apply {
    text = s; textSize = size; setTextColor(color); if (bold) typeface = Typeface.create(Typeface.DEFAULT, 600, false)
}

/** Small caps section header. */
fun Context.header(s: String) = label(s.uppercase(), 12f, DIM, true).apply { letterSpacing = 0.12f; setPadding(dp(4), dp(16), 0, dp(6)) }

fun Context.rounded(color: Int, radius: Int) = GradientDrawable().apply { cornerRadius = dp(radius).toFloat(); setColor(color) }

fun Context.chip(s: String, fg: Int = INK, bg: Int = RAISED, onTap: () -> Unit) = label(s, 14f, fg, true).apply {
    setPadding(dp(14), dp(8), dp(14), dp(8))
    background = rounded(bg, 18)
    layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(8) }
    setOnClickListener { onTap() }
}

/** Selectable chip: filled accent when [on]. */
fun Context.pill(s: String, on: Boolean, onTap: () -> Unit) = chip(s, if (on) BG else INK, if (on) ACCENT else RAISED, onTap)

/** Wrapping row of chips (the framework has no flow layout). */
class Flow(c: Context, private val gap: Int) : ViewGroup(c) {
    override fun onMeasure(ws: Int, hs: Int) {
        val maxW = MeasureSpec.getSize(ws) - paddingLeft - paddingRight
        var x = 0; var y = 0; var rowH = 0
        for (i in 0 until childCount) {
            val v = getChildAt(i)
            if (v.visibility == GONE) continue
            measureChild(v, MeasureSpec.makeMeasureSpec(maxW, MeasureSpec.AT_MOST), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
            if (x > 0 && x + v.measuredWidth > maxW) { x = 0; y += rowH + gap; rowH = 0 }
            x += v.measuredWidth + gap; rowH = maxOf(rowH, v.measuredHeight)
        }
        setMeasuredDimension(MeasureSpec.getSize(ws), resolveSize(y + rowH + paddingTop + paddingBottom, hs))
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val maxW = r - l - paddingLeft - paddingRight
        var x = 0; var y = 0; var rowH = 0
        for (i in 0 until childCount) {
            val v = getChildAt(i)
            if (v.visibility == GONE) continue
            if (x > 0 && x + v.measuredWidth > maxW) { x = 0; y += rowH + gap; rowH = 0 }
            v.layout(paddingLeft + x, paddingTop + y, paddingLeft + x + v.measuredWidth, paddingTop + y + v.measuredHeight)
            x += v.measuredWidth + gap; rowH = maxOf(rowH, v.measuredHeight)
        }
    }
}

fun hm(ms: Long) = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).let { "%02d:%02d".format(it.hour, it.minute) }
