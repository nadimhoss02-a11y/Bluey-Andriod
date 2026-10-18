package com.bluey.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.text.InputType
import android.view.MotionEvent
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.util.Locale
import kotlin.math.sqrt

/**
 * Bluey on Android.
 *  - Standalone: the berry lives on your phone, chats via the offline brain, talks with TTS.
 *  - Companion: pairs with Bluey-on-Windows; hold-to-talk or tap-to-talk sends your
 *    words to the PC, replies bubble here (and on the PC) + TTS.
 *
 * Talking to her:
 *  - TAP THE BERRY -> she listens once (like the original Bluey app), then answers.
 *  - "Hey Bluey"   -> enable the wake-word chip; she listens continuously while the
 *    app is open and answers to her name. Foreground-only by design (battery + privacy).
 *  - Hold mic button -> WAV capture straight to the PC (Whisper path).
 */
class MainActivity : AppCompatActivity(), SensorEventListener, PairClient.Listener {

    private lateinit var bluey: BlueyView
    private lateinit var statusChip: TextView
    private lateinit var btnTalk: Button
    private lateinit var btnChat: Button
    private lateinit var btnPair: Button
    private lateinit var btnWake: TextView

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsOn = true

    private val speech = SpeechInput(this)
    private val recorder = WavRecorder()
    private var client: PairClient? = null

    private var sensorManager: SensorManager? = null
    private var shakeCooldown = 0L
    private var idleCounter = 0L
    private var lastWakeAt = 0L
    private var pendingWake = false

    private val prefs by lazy { getSharedPreferences("bluey", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        bluey = findViewById(R.id.blueyView)
        statusChip = findViewById(R.id.statusChip)
        btnTalk = findViewById(R.id.btnTalk)
        btnChat = findViewById(R.id.btnChat)
        btnPair = findViewById(R.id.btnPair)
        btnWake = findViewById(R.id.btnWake)

        // TTS
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true
                tts?.language = Locale.US
            }
        }
        // while she speaks, wake listening holds the mic; resume when done
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) { runOnUiThread { speech.releaseMic() } }
            override fun onError(utteranceId: String?) { runOnUiThread { speech.releaseMic() } }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?, errorCode: Int) {
                runOnUiThread { speech.releaseMic() }
            }
        })

        // tap the berry itself = talk to her (original Bluey style)
        bluey.onBerryTap = { onTapBerry() }

        // push-to-talk (WAV -> PC when paired)
        btnTalk.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> startTalking()
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> stopTalking()
            }
            true
        }

        btnChat.setOnClickListener { showChatDialog() }
        btnPair.setOnClickListener { startActivity(android.content.Intent(this, PairActivity::class.java)) }
        btnWake.setOnClickListener { onWakeChipTapped() }

        // speech engine
        speech.delegate = object : SpeechInput.Delegate {
            override fun onSpeechResult(text: String) { runOnUiThread { handleText(text) } }
            override fun onWakeHeard(text: String) { runOnUiThread { handleWakeHeard(text) } }
            override fun onWakeStateChanged() {
                runOnUiThread {
                    prefs.edit().putBoolean("wakeOn", speech.isWakeOn()).apply()
                    updateWakeChip()
                }
            }
            override fun onMicProblem(note: String) { runOnUiThread { bluey.say(note); speak(note) } }
        }
        speech.wakePhrase = prefs.getString("wakePhrase", "hey bluey") ?: "hey bluey"

        askMicPermission()

        // shake = googly eye chaos
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let {
            sensorManager?.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
        }

        // first-run hint
        if (!prefs.getBoolean("hintShown", false)) {
            bluey.say("Tap me and talk! Or turn on \"Hey Bluey\" below for hands-free.", 5200)
            prefs.edit().putBoolean("hintShown", true).apply()
        }

        // idle chatter
        val h = android.os.Handler(mainLooper)
        h.postDelayed(object : Runnable {
            override fun run() {
                idleCounter++
                if (idleCounter % 6 == 0L && (client?.connected != true)) {
                    bluey.say(Brain.idleLine())
                }
                h.postDelayed(this, 45000)
            }
        }, 45000)
    }

    override fun onResume() {
        super.onResume()
        tryAutoConnect()
        speech.foreground()   // clear the background flag first
        if (prefs.getBoolean("wakeOn", false)) {
            speech.setWake(true)   // re-arms the engine (also verifies availability)
        }
        updateWakeChip()
    }

    override fun onPause() {
        super.onPause()
        speech.background()   // wake word is foreground-only (battery + privacy)
        if (recorder.isRunning) stopTalking()
    }

    override fun onDestroy() {
        super.onDestroy()
        client?.close()
        speech.background()
        tts?.shutdown()
        sensorManager?.unregisterListener(this)
    }

    /* ---------- pairing ---------- */

    private fun tryAutoConnect() {
        val host = prefs.getString("pairHost", null) ?: return
        if (client?.connected == true) return
        client?.close()
        statusChip.text = "Reconnecting to ${prefs.getString("pairName", "PC")}…"
        client = PairClient(host, prefs.getInt("pairPort", 8787), prefs.getString("pairCode", "") ?: "", this)
        client?.connect()
    }

    override fun onWelcome(pcName: String, brain: String) {
        runOnUiThread {
            statusChip.text = "Paired: $pcName"
            bluey.say("Hi! I'm on your PC now. Tap me, hold the mic, or just say \"Hey Bluey\"!")
            speak("Paired with your PC!")
        }
    }
    override fun onReply(text: String) {
        runOnUiThread { bluey.say(text); speak(text) }
    }
    override fun onBubble(text: String) {
        runOnUiThread { bluey.say(text) }
    }
    override fun onClosed(reason: String) {
        runOnUiThread {
            statusChip.text = getString(R.string.standalone_mode)
        }
    }

    /* ---------- tap the berry to talk ---------- */

    private fun onTapBerry() {
        if (speech.isListeningOnce()) {          // second tap cancels
            speech.cancelTap()
            return
        }
        if (!micGranted()) { askMicPermission(); return }
        if (!speech.available()) {
            val note = "This phone has no speech recognition service, sorry!"
            bluey.say(note); speak(note)
            return
        }
        speech.holdMic()          // hand the mic over from wake mode
        bluey.poke(0.8f)
        bluey.say(getString(R.string.listening), 2200)
        speech.tapListen()
    }

    /* ---------- wake word chip ---------- */

    private fun onWakeChipTapped() {
        if (speech.isWakeOn()) {
            speech.setWake(false)
            prefs.edit().putBoolean("wakeOn", false).apply()
            updateWakeChip()
            return
        }
        if (!speech.available()) {
            val note = "This phone has no speech recognition service, sorry!"
            bluey.say(note); speak(note)
            return
        }
        if (!micGranted()) {
            pendingWake = true
            askMicPermission()
            return
        }
        enableWake()
    }

    private fun enableWake() {
        speech.wakePhrase = prefs.getString("wakePhrase", "hey bluey") ?: "hey bluey"
        speech.setWake(true)
        prefs.edit().putBoolean("wakeOn", true).apply()
        updateWakeChip()
        val note = "Always listening! Say \"Hey Bluey\" and I'm yours."
        bluey.say(note)
        speak(note)
    }

    private fun updateWakeChip() {
        btnWake.text = if (speech.isWakeOn()) getString(R.string.wake_on) else getString(R.string.wake_off)
    }

    /* ---------- wake word heard ---------- */

    private fun handleWakeHeard(text: String) {
        val now = System.currentTimeMillis()
        if (now - lastWakeAt < 2000) return
        val m = Wake.strip(text, speech.wakePhrase)
        if (!m.matched) return          // not for us - stay quiet
        lastWakeAt = now
        bluey.poke(1f)
        if (m.bare) {
            val reply = Brain.attendLine()
            bluey.say(reply)
            speak(reply)
            return
        }
        handleText(m.rest)
    }

    /* ---------- push-to-talk ---------- */

    private fun startTalking() {
        if (!micGranted()) {
            askMicPermission()
            return
        }
        if (recorder.isRunning) return
        speech.holdMic()   // mic belongs to the recorder now
        if (!recorder.start()) {
            bluey.say("My microphone didn't start. Check the mic permission!")
            speech.releaseMic()
            return
        }
        btnTalk.text = getString(R.string.listening)
        bluey.poke(0.6f)
    }

    private fun stopTalking() {
        btnTalk.text = getString(R.string.talk_hint)
        val clip = recorder.stop() ?: run { speech.releaseMic(); return }
        val connected = client?.connected == true
        if (connected) {
            client?.sendAudio(clip.wav, clip.durationMs)
            bluey.say("Sending that over to the PC…")
            speech.releaseMic()
        } else {
            // standalone canned response
            val reply = Brain.respondToAudio(clip.rms, clip.durationMs)
            bluey.say(reply)
            speak(reply)
        }
    }

    /* ---------- text chat ---------- */

    private fun showChatDialog() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT
            hint = "Say something to Bluey…"
            setPadding(48, 36, 48, 36)
        }
        AlertDialog.Builder(this)
            .setTitle("Chat with Bluey")
            .setView(FrameLayout(this).apply {
                addView(input, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
            })
            .setPositiveButton("Send") { _, _ ->
                val text = input.text.toString().trim()
                if (text.isNotEmpty()) handleText(text)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /** shared dispatch for chat text, tap-to-talk and wake word commands */
    private fun handleText(text: String) {
        val connected = client?.connected == true
        if (connected) {
            client?.sendText(text)
            bluey.say("Hmm… let me think on the big screen…")
            speech.releaseMic()   // no local TTS here - resume listening now
        } else {
            val reply = Brain.respond(text)
            bluey.say(reply)
            speak(reply)          // speak() handles hold/release of the mic
        }
    }

    /* ---------- tts ---------- */

    private fun speak(text: String) {
        if (!ttsOn || !ttsReady) {
            speech.releaseMic()
            return
        }
        try {
            speech.holdMic()   // don't hear ourselves
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "bluey-${System.nanoTime()}")
        } catch (_: Exception) {
            speech.releaseMic()
        }
    }

    /* ---------- shake ---------- */

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ACCELEROMETER) return
        val (x, y, z) = event.values
        val g = sqrt(x * x + y * y + z * z)
        val now = System.currentTimeMillis()
        if (g > 24 && now - shakeCooldown > 2500) {
            shakeCooldown = now
            bluey.poke(2f)
            bluey.say(Brain.idleLine())
        }
    }
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    /* ---------- permission ---------- */

    private fun micGranted(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    private fun askMicPermission() {
        if (!micGranted()) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 42)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 42) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                if (pendingWake) {
                    pendingWake = false
                    enableWake()
                }
            } else {
                pendingWake = false
                Toast.makeText(this, "Bluey needs the mic to hear you!", Toast.LENGTH_LONG).show()
            }
        }
    }
}
