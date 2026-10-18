package com.bluey.app

import android.animation.AnimatorInflater
import android.content.Context
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.min
import kotlin.random.Random

/**
 * Bluey the blueberry, drawn by hand on a Canvas.
 *  - googly pupils with spring physics that track your finger / idle wander
 *  - wobble impulses (used by the shake sensor)
 *  - speech bubbles with typewriter feel (simple: fade-in + wrap)
 */
class BlueyView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    // ---- geometry ----
    private var cx = 0f
    private var cy = 0f
    private var radius = 0f

    // ---- paints ----
    private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val glossPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; alpha = 70 }
    private val eyePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val pupilPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#101528") }
    private val sparkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val mouthPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#101528")
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeWidth = 0f
    }
    private val stemPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#2e7d4f") }
    private val leafPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#3f9d63") }
    private val blushPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#33479e"); alpha = 120 }
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#5470e8"); alpha = 46 }
    private val bubblePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val tailPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#1c2540")
        textSize = 44f
        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    }

    // ---- eye physics ----
    private data class Pupil(var x: Float = 0f, var y: Float = 0f, var vx: Float = 0f, var vy: Float = 0f)
    private val pupils = arrayOf(Pupil(), Pupil())

    // ---- state ----
    private var lookX = 0f
    private var lookY = 0f
    private var hasTouchLook = false
    private var lastTouchAt = 0L
    private var blinkUntil = 0L
    private var nextBlinkAt = System.currentTimeMillis() + 2000
    private var wobble = 0f          // body wobble impulse
    private var wobblePhase = 0f
    private var sleeping = false

    // ---- tap-the-berry detection ----
    var onBerryTap: (() -> Unit)? = null
    private var touchDownAt = 0L
    private var touchDownX = 0f
    private var touchDownY = 0f

    // ---- bubble ----
    private var bubbleText: String? = null
    private var bubbleUntil = 0L
    private var bubbleLayout: StaticLayout? = null
    private var bubbleAlpha = 0f

    private val tick = object : Runnable {
        override fun run() {
            step()
            postInvalidateOnAnimation()
        }
    }

    init {
        setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    lookX = e.x; lookY = e.y
                    hasTouchLook = true
                    lastTouchAt = System.currentTimeMillis()
                    touchDownAt = lastTouchAt
                    touchDownX = e.x; touchDownY = e.y
                    // poke the berry
                    wobble = 1f
                }
                MotionEvent.ACTION_MOVE -> {
                    lookX = e.x; lookY = e.y
                    hasTouchLook = true
                    lastTouchAt = System.currentTimeMillis()
                }
                MotionEvent.ACTION_UP -> {
                    lastTouchAt = System.currentTimeMillis()
                    // a quick, small touch that lands on the berry itself = talk to her
                    val moved = hypot(e.x - touchDownX, e.y - touchDownY)
                    val onBody = hypot(e.x - cx, e.y - cy) <= radius * 1.2f
                    if (onBody && moved < radius * 0.5f &&
                        System.currentTimeMillis() - touchDownAt < 600) {
                        onBerryTap?.invoke()
                    }
                }
            }
            false
        }
        post(tick)
        postDelayed(object : Runnable {
            override fun run() {
                // idle wander target
                if (System.currentTimeMillis() - lastTouchAt > 5000) {
                    lookX = Random.nextFloat() * width
                    lookY = Random.nextFloat() * height * 0.55f
                    hasTouchLook = false
                }
                postDelayed(this, 2600)
            }
        }, 2600)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        cx = w / 2f
        cy = h * 0.46f
        radius = min(w, h) * 0.26f
        mouthPaint.strokeWidth = radius * 0.055f
        if (lookX == 0f && lookY == 0f) { lookX = w / 2f; lookY = h / 3f }
    }

    /** external impulse: shake sensor etc. */
    fun poke(strength: Float = 1f) {
        wobble = min(2f, wobble + strength)
    }

    fun setSleeping(on: Boolean) { sleeping = on }

    /** show a speech bubble */
    fun say(text: String, holdMs: Long = 3200) {
        bubbleText = text
        bubbleUntil = System.currentTimeMillis() + holdMs + min(6000, text.length * 55L)
        val maxW = (width * 0.82f).toInt()
        bubbleLayout = StaticLayout.Builder
            .obtain(text, 0, text.length, textPaint, maxW.coerceAtLeast(200))
            .setAlignment(Layout.Alignment.ALIGN_CENTER)
            .setLineSpacing(4f, 1f)
            .build()
        bubbleAlpha = 0f
    }

    fun clearBubble() { bubbleText = null }

    private fun step() {
        val now = System.currentTimeMillis()

        // blink
        if (now >= nextBlinkAt && !sleeping) {
            blinkUntil = now + 130
            nextBlinkAt = now + 2200 + Random.nextLong(3400)
        }

        // wobble decay
        wobble *= 0.92f
        wobblePhase += 0.25f

        // pupil spring
        val eyeDx = radius * 0.42f
        val eyeDy = radius * 0.05f
        val maxR = radius * 0.16f
        for (i in 0..1) {
            val ecx = cx + if (i == 0) -eyeDx else eyeDx
            val ecy = cy + eyeDy
            val dx = lookX - ecx
            val dy = lookY - ecy
            val dist = hypot(dx, dy).coerceAtLeast(1f)
            val reach = min(1f, dist / (radius * 1.4f)) * maxR
            val tx = dx / dist * reach
            val ty = dy / dist * reach
            val p = pupils[i]
            p.vx += (tx - p.x) * 0.16f
            p.vy += (ty - p.y) * 0.16f
            p.vx *= 0.78f
            p.vy *= 0.78f
            p.x += p.vx
            p.y += p.vy
        }

        // bubble fade
        bubbleAlpha = when {
            bubbleText == null -> 0f
            now > bubbleUntil -> 0f.also { bubbleText = null }
            bubbleAlpha < 1f -> min(1f, bubbleAlpha + 0.09f)
            else -> 1f
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val now = System.currentTimeMillis()
        val squish = 1f + (wobble * 0.05f) * kotlin.math.sin(wobblePhase)
        val bob = if (sleeping) 0f else (kotlin.math.sin(wobblePhase * 0.35f) * radius * 0.02f)

        canvas.save()
        canvas.translate(0f, bob)
        canvas.scale(squish, 2f - squish, cx, cy + radius)

        // glow
        canvas.drawCircle(cx, cy, radius * 1.28f, glowPaint)

        // body
        if (bodyPaint.shader == null) {
            bodyPaint.shader = RadialGradient(
                cx - radius * 0.35f, cy - radius * 0.4f, radius * 1.35f,
                intArrayOf(Color.parseColor("#7f9bff"), Color.parseColor("#5470e8"), Color.parseColor("#2c3f9e")),
                floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP
            )
        }
        canvas.drawCircle(cx, cy, radius, bodyPaint)

        // gloss
        canvas.drawOval(
            cx - radius * 0.62f, cy - radius * 0.82f,
            cx - radius * 0.05f, cy - radius * 0.42f,
            glossPaint
        )

        // stem + leaf
        canvas.drawRoundRect(
            cx - radius * 0.05f, cy - radius * 1.16f,
            cx + radius * 0.05f, cy - radius * 0.96f,
            radius * 0.05f, radius * 0.05f, stemPaint
        )
        val leaf = Path().apply {
            moveTo(cx + radius * 0.02f, cy - radius * 1.12f)
            quadTo(cx + radius * 0.28f, cy - radius * 1.3f, cx + radius * 0.34f, cy - radius * 1.06f)
            quadTo(cx + radius * 0.18f, cy - radius * 1.02f, cx + radius * 0.02f, cy - radius * 1.12f)
            close()
        }
        canvas.drawPath(leaf, leafPaint)

        // eyes
        val eyeDx = radius * 0.42f
        val eyeDy = radius * 0.05f
        val blink = now < blinkUntil || sleeping
        val erx = radius * 0.2f
        val ery = if (blink) radius * 0.025f else radius * 0.235f
        val pr = radius * 0.095f
        for (i in 0..1) {
            val ecx = cx + if (i == 0) -eyeDx else eyeDx
            val ecy = cy + eyeDy
            canvas.drawOval(ecx - erx, ecy - ery, ecx + erx, ecy + ery, eyePaint)
            if (!blink) {
                val p = pupils[i]
                val px = ecx + p.x
                val py = ecy + p.y
                canvas.drawCircle(px, py, pr, pupilPaint)
                canvas.drawCircle(px + pr * 0.3f, py - pr * 0.35f, pr * 0.32f, sparkPaint)
            }
        }

        // blush
        for (sx in intArrayOf(-1, 1)) {
            canvas.drawOval(
                cx + sx * radius * 0.52f - radius * 0.12f, cy + radius * 0.34f - radius * 0.05f,
                cx + sx * radius * 0.52f + radius * 0.12f, cy + radius * 0.34f + radius * 0.05f,
                blushPaint
            )
        }

        // mouth (mood)
        val my = cy + radius * 0.42f
        val mouth = Path()
        if (sleeping) {
            mouth.moveTo(cx - radius * 0.09f, my)
            mouth.lineTo(cx + radius * 0.09f, my)
            mouthPaint.style = Paint.Style.STROKE
            canvas.drawPath(mouth, mouthPaint)
        } else {
            mouth.moveTo(cx - radius * 0.16f, my - radius * 0.04f)
            mouth.quadTo(cx, my + radius * 0.12f, cx + radius * 0.16f, my - radius * 0.04f)
            mouthPaint.style = Paint.Style.STROKE
            canvas.drawPath(mouth, mouthPaint)
        }

        // Zzz when sleeping
        if (sleeping) {
            val tp = TextPaint(textPaint).apply { color = Color.parseColor("#cfe0ff"); textSize = radius * 0.22f }
            canvas.drawText("z", cx + radius * 0.72f, cy - radius * 0.7f, tp)
            tp.textSize = radius * 0.16f
            canvas.drawText("z", cx + radius * 0.95f, cy - radius * 0.95f, tp)
        }

        canvas.restore()

        // bubble (not squished)
        bubbleText?.let { text ->
            layoutBubble()?.let { (bx, by, bw, bh) ->
                val a = (bubbleAlpha * 255).toInt()
                bubblePaint.alpha = a
                tailPaint.alpha = a
                // tail
                val tail = Path().apply {
                    moveTo(cx - radius * 0.08f, by + bh)
                    lineTo(cx + radius * 0.08f, by + bh)
                    lineTo(cx, by + bh + radius * 0.14f)
                    close()
                }
                canvas.drawPath(tail, tailPaint)
                // rounded rect
                val rect = RectF(bx, by, bx + bw, by + bh)
                canvas.drawRoundRect(rect, radius * 0.14f, radius * 0.14f, bubblePaint)
                // text
                textPaint.alpha = a
                canvas.save()
                canvas.translate(bx + radius * 0.1f, by + radius * 0.09f)
                bubbleLayout?.draw(canvas)
                canvas.restore()
            }
        }
    }

    private fun layoutBubble(): FloatArray? {
        val l = bubbleLayout ?: return null
        val padX = radius * 0.1f
        val padY = radius * 0.09f
        val bw = l.width + padX * 2
        val bh = l.height + padY * 2
        var bx = cx - bw / 2f
        bx = bx.coerceIn(16f, width - bw - 16f)
        val by = cy - radius - bh - radius * 0.34f
        return floatArrayOf(bx, by.coerceAtLeast(30f), bw, bh)
    }

    /** hook for activity: expose last look point for debugging/meters */
    fun lookDistanceFromTouch(x: Float, y: Float): Float = hypot(x - lookX, y - lookY)

    fun squishIntensity(): Float = abs(wobble)
}
