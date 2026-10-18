package com.bluey.app

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder

/**
 * Minimal push-to-talk recorder: 16 kHz mono PCM16 -> WAV bytes.
 * Exposes live RMS for mic metering.
 */
class WavRecorder {

    private val sampleRate = 16000
    private var record: AudioRecord? = null
    private var thread: Thread? = null

    @Volatile private var running = false
    @Volatile private var amplitude = 0f
    private val pcm = ArrayList<ByteArray>()

    val isRunning: Boolean get() = running
    fun currentAmplitude(): Float = amplitude

    @SuppressLint("MissingPermission")
    fun start(): Boolean {
        if (running) return true
        val minBuf = AudioRecord.getMinBufferSize(
            sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBuf <= 0) return false
        val rec = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC, sampleRate,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                minBuf * 4
            )
        } catch (e: Exception) { return false }
        if (rec.state != AudioRecord.STATE_INITIALIZED) return false

        record = rec
        pcm.clear()
        running = true
        rec.startRecording()

        thread = Thread {
            val buf = ByteArray(3200) // 100ms @16k mono 16bit
            while (running) {
                val n = rec.read(buf, 0, buf.size)
                if (n > 0) {
                    synchronized(pcm) { pcm.add(buf.copyOf(n)) }
                    // rms
                    var sum = 0.0
                    var i = 0
                    while (i + 1 < n) {
                        val v = ((buf[i].toInt() and 0xFF) or (buf[i + 1].toInt() shl 8)).toShort()
                        sum += (v.toDouble() / 32768.0) * (v.toDouble() / 32768.0)
                        i += 2
                    }
                    amplitude = kotlin.math.sqrt(sum / (n / 2).coerceAtLeast(1)).toFloat()
                }
            }
        }.also { it.start() }
        return true
    }

    /** stop and return WAV bytes + duration + avg rms */
    fun stop(): Clip? {
        if (!running) return null
        running = false
        try { record?.stop() } catch (_: Exception) {}
        try { thread?.join(800) } catch (_: Exception) {}
        try { record?.release() } catch (_: Exception) {}
        record = null
        thread = null

        val chunks = synchronized(pcm) { val c = ArrayList(pcm); pcm.clear(); c }
        if (chunks.isEmpty()) return null

        var total = 0
        var rmsSum = 0.0
        for (c in chunks) { total += c.size; rmsSum += amplitude }
        val durationMs = (total / 2 * 1000L) / sampleRate
        val avgRms = if (chunks.isEmpty()) 0.05f else (rmsSum / chunks.size).toFloat()

        val wav = ByteArray(44 + total)
        writeWavHeader(wav, total, sampleRate, 1, 16)
        var off = 44
        for (c in chunks) {
            System.arraycopy(c, 0, wav, off, c.size)
            off += c.size
        }
        return Clip(wav, durationMs, avgRms)
    }

    data class Clip(val wav: ByteArray, val durationMs: Long, val rms: Float)

    private fun writeWavHeader(out: ByteArray, dataLen: Int, sampleRate: Int, channels: Int, bits: Int) {
        val blockAlign = channels * bits / 8
        val byteRate = sampleRate * blockAlign
        fun le32(off: Int, v: Int) { out[off] = (v and 0xff).toByte(); out[off+1] = ((v shr 8) and 0xff).toByte(); out[off+2] = ((v shr 16) and 0xff).toByte(); out[off+3] = ((v shr 24) and 0xff).toByte() }
        fun le16(off: Int, v: Int) { out[off] = (v and 0xff).toByte(); out[off+1] = ((v shr 8) and 0xff).toByte() }
        "RIFF".toByteArray().copyInto(out, 0)
        le32(4, 36 + dataLen)
        "WAVE".toByteArray().copyInto(out, 8)
        "fmt ".toByteArray().copyInto(out, 12)
        le32(16, 16)
        le16(20, 1) // PCM
        le16(22, channels)
        le32(24, sampleRate)
        le32(28, byteRate)
        le16(32, blockAlign)
        le16(34, bits)
        "data".toByteArray().copyInto(out, 36)
        le32(40, dataLen)
    }
}
