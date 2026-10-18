package com.bluey.app

import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * WebSocket link to a Bluey-on-Windows PC.
 * Protocol matches windows-app/src/server.js.
 */
class PairClient(
    private val host: String,
    private val port: Int,
    private val code: String,
    private val listener: Listener
) : WebSocketListener() {

    interface Listener {
        fun onWelcome(pcName: String, brain: String)
        fun onReply(text: String)
        fun onBubble(text: String)
        fun onClosed(reason: String)
    }

    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(6, TimeUnit.SECONDS)
        .build()
    private var ws: WebSocket? = null
    @Volatile var connected = false
        private set

    fun connect() {
        val req = Request.Builder().url("ws://$host:$port/ws").build()
        ws = client.newWebSocket(req, this)
    }

    fun sendAudio(wav: ByteArray, durationMs: Long) {
        val json = JSONObject()
            .put("type", "ptt")
            .put("wav", Base64.encodeToString(wav, Base64.NO_WRAP))
            .put("durationMs", durationMs)
        ws?.send(json.toString())
    }

    fun sendText(message: String) {
        ws?.send(JSONObject().put("type", "text").put("message", message).toString())
    }

    fun sendCmd(action: String) {
        ws?.send(JSONObject().put("type", "cmd").put("action", action).toString())
    }

    fun sendVolume(level: Int) {
        ws?.send(JSONObject().put("type", "volume").put("level", level).toString())
    }

    fun close() {
        try { ws?.close(1000, "bye") } catch (_: Exception) {}
        connected = false
    }

    override fun onOpen(webSocket: WebSocket, response: Response) {
        val hello = JSONObject()
            .put("type", "hello")
            .put("code", code)
            .put("device", "phone")
        webSocket.send(hello.toString())
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        try {
            val msg = JSONObject(text)
            when (msg.optString("type")) {
                "welcome" -> {
                    connected = true
                    listener.onWelcome(msg.optString("name", "PC"), msg.optString("brain", "scripted"))
                }
                "reply" -> listener.onReply(msg.optString("text", ""))
                "bubble" -> listener.onBubble(msg.optString("text", ""))
                "error" -> listener.onClosed("PC said: ${msg.optString("msg", "error")}")
            }
        } catch (_: Exception) {}
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        connected = false
        listener.onClosed(t.message ?: "connection failed")
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        connected = false
        listener.onClosed("closed: ${reason.ifEmpty { code.toString() }}")
    }
}
