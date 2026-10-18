package com.bluey.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Mic input for Bluey on Android, built on the system speech recognizer
 * (the same engine Google Now / Assistant keyboard dictation uses).
 *
 * Two modes:
 *  - tapListen()          : one-shot recognition. The berry is tapped, user talks,
 *                           final text comes back via [Delegate.onSpeechResult].
 *  - setWake(true)        : continuous "Hey Bluey" loop. The recognizer restarts
 *                           itself after every utterance, backs off on repeated
 *                           errors, and every final transcript is reported via
 *                           [Delegate.onWakeHeard] (matching against the wake
 *                           phrase happens in MainActivity via [Wake.strip]).
 *
 * Mic handover (SpeechRecognizer and WavRecorder cannot share the mic):
 *  - holdMic()   -> engine stops (Bluey speaks TTS, push-to-talk starts, app backgrounds)
 *  - releaseMic()-> engine restarts if wake mode is still enabled
 *
 * Everything must run on the main thread - all entry points are called from
 * Activity lifecycle / UI callbacks, which satisfies that.
 * Wake mode is foreground-only: MainActivity suspends it in onPause.
 */
class SpeechInput(private val context: Context) {

    interface Delegate {
        /** final transcript of a one-shot (tap-to-talk) session */
        fun onSpeechResult(text: String)
        /** final transcript heard while wake mode is on (may not contain the wake word) */
        fun onWakeHeard(text: String)
        /** engine state changed - update the toggle chip */
        fun onWakeStateChanged()
        /** human-readable complaint (no recognizer available, repeated failures...) */
        fun onMicProblem(note: String)
    }

    var delegate: Delegate? = null
    var wakePhrase: String = "hey bluey"

    private val handler = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var oneShot = false
    private var wakeOn = false
    private var suspended = false
    private var engineBusy = false
    private var consecutiveErrors = 0
    private var lastHeardAt = 0L

    fun available(): Boolean = SpeechRecognizer.isRecognitionAvailable(context)

    fun isWakeOn(): Boolean = wakeOn

    fun isListeningOnce(): Boolean = oneShot

    /* ---------------- one-shot (tap the berry, talk) ---------------- */

    fun tapListen() {
        if (!available()) {
            delegate?.onMicProblem("This phone has no speech recognition service, sorry!")
            return
        }
        stopEngine()
        oneShot = true
        startEngine()
    }

    fun cancelTap() {
        if (!oneShot) return
        oneShot = false
        stopEngine()
        restartWakeIfDue(300)
    }

    /* ---------------- wake word ("Hey Bluey") ---------------- */

    fun setWake(on: Boolean) {
        wakeOn = on
        if (on) startEngine() else stopEngine()
        delegate?.onWakeStateChanged()
    }

    /** Bluey is about to speak, or push-to-talk needs the mic */
    fun holdMic() {
        stopEngine()
    }

    /** mic is free again - resume wake listening if enabled */
    fun releaseMic() {
        restartWakeIfDue(350)
    }

    /** activity went to background - stop everything, remember state */
    fun background() {
        suspended = true
        stopEngine()
    }

    /** activity is visible again */
    fun foreground() {
        suspended = false
        restartWakeIfDue(300)
    }

    /** full stop without forgetting the wake preference */
    fun stopEngineOnly() {
        stopEngine()
    }

    /* ---------------- engine internals ---------------- */

    private fun startEngine() {
        if (suspended || recognizer != null) return
        if (!wakeOn && !oneShot) return
        val sr = SpeechRecognizer.createSpeechRecognizer(context)
        sr.setRecognitionListener(listener)
        sr.startListening(voiceIntent())
        recognizer = sr
        engineBusy = false
    }

    private fun stopEngine() {
        handler.removeCallbacksAndMessages(null)
        val sr = recognizer
        recognizer = null
        engineBusy = false
        if (sr != null) {
            try {
                sr.stopListening()
            } catch (_: Exception) {}
            try {
                sr.destroy()
            } catch (_: Exception) {}
        }
    }

    private fun restartWakeIfDue(delayMs: Long) {
        if (suspended || !wakeOn || oneShot) return
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ startEngine() }, delayMs)
    }

    private fun voiceIntent(): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        if (oneShot) {
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L)
        }
    }

    private val listener = object : RecognitionListener {

        override fun onReadyForSpeech(params: Bundle?) {
            engineBusy = true
            consecutiveErrors = 0
        }

        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}

        override fun onError(error: Int) {
            val wasOneShot = oneShot
            when (error) {
                SpeechRecognizer.ERROR_NO_MATCH,
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
                    // silence, nothing heard
                    if (wasOneShot) finishOneShot("") else restartWakeIfDue(250)

                SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
                    if (wasOneShot) finishOneShot("") else restartWakeIfDue(900)

                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
                    wakeOn = false
                    oneShot = false
                    stopEngine()
                    delegate?.onWakeStateChanged()
                    delegate?.onMicProblem("Bluey needs microphone permission for that!")
                }

                else -> {
                    // network / server / client hiccups
                    consecutiveErrors++
                    if (wasOneShot) {
                        finishOneShot("")
                    } else if (consecutiveErrors >= 4) {
                        wakeOn = false
                        stopEngine()
                        delegate?.onWakeStateChanged()
                        delegate?.onMicProblem("Speech recognition keeps failing, so I paused wake word. Tap the chip to retry.")
                    } else {
                        restartWakeIfDue(if (error == SpeechRecognizer.ERROR_NETWORK) 3000L else 1200L)
                    }
                }
            }
        }

        override fun onResults(results: Bundle?) {
            val text = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()?.trim().orEmpty()
            if (oneShot) {
                finishOneShot(text)
            } else {
                val now = System.currentTimeMillis()
                if (text.isNotEmpty() && now - lastHeardAt > 1500) {
                    lastHeardAt = now
                    delegate?.onWakeHeard(text)
                }
                restartWakeIfDue(250)
            }
        }

        override fun onPartialResults(partialResults: Bundle?) {
            // finals only - partials restart too aggressively to be useful here
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun finishOneShot(text: String) {
        oneShot = false
        stopEngine()
        if (text.isNotEmpty()) delegate?.onSpeechResult(text)
        else delegate?.onMicProblem("I didn't catch that - try again?")
        restartWakeIfDue(300)
    }
}
