package com.bluey.app

import android.annotation.SuppressLint
import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * Find a Bluey PC on the network (_bluey._tcp via NSD) or connect by IP.
 * Saves the pairing so MainActivity auto-reconnects.
 */
class PairActivity : AppCompatActivity() {

    private data class Found(val name: String, var host: String?, var port: Int) {
        override fun toString(): String = "$name  (${host ?: "resolving…"})"
    }

    private val found = LinkedHashMap<String, Found>()
    private var adapter: ArrayAdapter<String>? = null
    private var nsd: NsdManager? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private var selected: Found? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pair)
        title = "Pair"

        val list = findViewById<ListView>(R.id.deviceList)
        val discoverStatus = findViewById<TextView>(R.id.discoverStatus)
        val etHost = findViewById<EditText>(R.id.etHost)
        val etPort = findViewById<EditText>(R.id.etPort)
        val etCode = findViewById<EditText>(R.id.etCode)
        val btnConnect = findViewById<Button>(R.id.btnConnect)
        val btnForget = findViewById<Button>(R.id.btnForget)
        val connectStatus = findViewById<TextView>(R.id.connectStatus)

        // prefill saved pairing
        val prefs = getSharedPreferences("bluey", Context.MODE_PRIVATE)
        prefs.getString("pairHost", null)?.let {
            etHost.setText(it)
            etPort.setText(prefs.getInt("pairPort", 8787).toString())
            etCode.setText(prefs.getString("pairCode", ""))
        } ?: run { btnForget.visibility = View.GONE }

        adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, ArrayList())
        list.adapter = adapter
        list.setOnItemClickListener { _, _, pos, _ ->
            val f = found.values.toList()[pos]
            selected = f
            etHost.setText(f.host ?: etHost.text.toString())
            etPort.setText(f.port.toString())
            connectStatus.text = "Selected: ${f.name}"
        }

        btnConnect.setOnClickListener {
            val host = etHost.text.toString().trim()
            val port = etPort.text.toString().toIntOrNull() ?: 8787
            val code = etCode.text.toString().trim()
            when {
                host.isEmpty() -> connectStatus.text = "Pick a PC above or type its IP."
                code.length !in 4..8 || !code.all { it.isDigit() } ->
                    connectStatus.text = "The pairing code is 6 digits (see PC Settings)."
                else -> {
                    connectStatus.text = "Connecting to $host:$port…"
                    testConnect(host, port, code, connectStatus)
                }
            }
        }

        btnForget.setOnClickListener {
            prefs.edit().clear().apply()
            etHost.setText(""); etCode.setText("")
            btnForget.visibility = View.GONE
            connectStatus.text = "Forgot saved PC."
        }

        startDiscovery(discoverStatus)
    }

    private fun startDiscovery(statusView: TextView) {
        nsd = (getSystemService(Context.NSD_SERVICE) as NsdManager)
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                statusView.text = "Searching for Bluey on your Wi-Fi…"
            }
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                runOnUiThread {
                    val f = Found(serviceInfo.serviceName, null, serviceInfo.port)
                    if (!found.containsKey(serviceInfo.serviceName)) {
                        found[serviceInfo.serviceName] = f
                        adapter!!.clear()
                        adapter!!.addAll(found.values.map { it.toString() })
                        adapter!!.notifyDataSetChanged()
                    }
                }
                nsd?.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {}
                    @Suppress("DEPRECATION")
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        runOnUiThread {
                            found[info.serviceName]?.let { f ->
                                f.host = info.host?.hostAddress
                                f.port = info.port
                                adapter?.notifyDataSetChanged()
                                adapter?.clear()
                                adapter?.addAll(found.values.map { it.toString() })
                            }
                        }
                    }
                })
            }
            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                runOnUiThread {
                    found.remove(serviceInfo.serviceName)
                    adapter?.clear()
                    adapter?.addAll(found.values.map { it.toString() })
                }
            }
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                runOnUiThread { statusView.text = "Discovery unavailable — type the PC IP manually." }
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        }
        discoveryListener = listener
        try {
            nsd?.discoverServices("_bluey._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            statusView.text = "Discovery unavailable — type the PC IP manually."
        }
    }

    private fun testConnect(host: String, port: Int, code: String, statusView: TextView) {
        val probe = PairClient(host, port, code, object : PairClient.Listener {
            override fun onWelcome(pcName: String, brain: String) {
                // save + return
                getSharedPreferences("bluey", Context.MODE_PRIVATE)
                    .edit()
                    .putString("pairHost", host)
                    .putInt("pairPort", port)
                    .putString("pairCode", code)
                    .putString("pairName", pcName)
                    .apply()
                runOnUiThread {
                    statusView.text = "Paired with $pcName!"
                    stopDiscovery()
                    setResult(RESULT_OK)
                    finish()
                }
            }
            override fun onReply(text: String) {}
            override fun onBubble(text: String) {}
            override fun onClosed(reason: String) {
                runOnUiThread {
                    statusView.text = "Failed: $reason (check IP, port, and the 6-digit code)"
                }
            }
        })
        probe.connect()
        // give it a few seconds, then drop the probe if nothing happened
        android.os.Handler(mainLooper).postDelayed({
            if (!probe.connected) { probe.close(); stopDiscovery() }
        }, 8000)
    }

    private fun stopDiscovery() {
        try {
            discoveryListener?.let { nsd?.stopServiceDiscovery(it) }
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        super.onDestroy()
        stopDiscovery()
    }
}
