package com.dsha.remoteagent.net

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.dsha.remoteagent.data.AppConfig
import com.dsha.remoteagent.data.DeviceInfo
import com.dsha.remoteagent.data.LogStore
import com.dsha.remoteagent.root.RootShell
import com.dsha.remoteagent.service.CommandExecutor
import com.dsha.remoteagent.service.ExecResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/**
 * Agent 专用 WebSocket 客户端，严格按契约 §9：
 * - 连接 ws://<host>/ws/agent?token=<deviceToken>
 * - 连上立即发 hello
 * - 定时 heartbeat（默认 15s，可配）
 * - 收到 command 执行后回 result
 * - 收到 pull_file 下载文件后回 result
 * - 断线指数退避重连：1s→2s→4s…上限 60s，带随机抖动
 */
class AgentWebSocketClient(
    private val context: Context,
    private val config: AppConfig,
    private val logStore: LogStore,
    private val listener: Listener
) {

    enum class State { CONNECTING, CONNECTED, DISCONNECTED }

    interface Listener {
        fun onState(state: State, detail: String)
    }

    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private var socket: WebSocket? = null
    private var heartbeatRunnable: Runnable? = null
    private var reconnectRunnable: Runnable? = null

    @Volatile
    private var stopped = true

    @Volatile
    private var connecting = false

    private var attempt = 0

    /** 连接序号：设置变更 / 网络恢复时递增，用于丢弃过期的异步连接请求 */
    private var connectSeq = 0

    /** 服务启动时调用 */
    fun start() {
        stopped = false
        attempt = 0
        main.post { connect() }
        // 预热 root 状态，保证 hello 能尽快带上 rootStatus
        scope.launch { RootShell.rootStatus(force = true) }
    }

    /** 服务销毁时调用 */
    fun stop() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        heartbeatRunnable?.let { main.removeCallbacks(it) }
        reconnectRunnable?.let { main.removeCallbacks(it) }
        heartbeatRunnable = null
        reconnectRunnable = null
        val old = socket
        socket = null
        old?.close(1000, "agent stopped")
        scope.cancel()
        listener.onState(State.DISCONNECTED, "服务已停止")
    }

    /** 网络恢复 / 设置变更时立即重连（重置退避） */
    fun forceReconnect(reason: String) {
        if (stopped) return
        main.post {
            if (stopped) return@post
            attempt = 0
            connecting = false
            connectSeq++
            reconnectRunnable?.let { main.removeCallbacks(it) }
            reconnectRunnable = null
            stopHeartbeat()
            val old = socket
            socket = null
            old?.close(1000, "reconnect")
            listener.onState(State.CONNECTING, reason)
            scheduleReconnect(300)
        }
    }

    // ------------------------------------------------------------ 连接流程

    private fun connect() {
        if (stopped || connecting) return
        val endpoint = config.wsEndpoint()
        if (endpoint == null) {
            val reason = if (config.wsUrl.isBlank()) "未配置 WebSocket 后端地址" else "WebSocket 地址无效"
            listener.onState(State.DISCONNECTED, reason)
            return
        }
        connecting = true
        val seq = ++connectSeq
        listener.onState(State.CONNECTING, "正在连接 ${config.wsUrl}")
        scope.launch {
            // 首次运行先注册设备（失败也继续尝试连接，后续重连会再试）
            if (!config.registered) {
                val reg = BackendApi.register(config)
                logStore.insert("系统", "", if (reg.ok) "success" else "failed", reg.message, 0)
            }
            main.post {
                if (!stopped && seq == connectSeq) {
                    openSocket()
                } else {
                    connecting = false
                }
            }
        }
    }

    private fun openSocket() {
        if (stopped) {
            connecting = false
            return
        }
        val endpoint = config.wsEndpoint()
        if (endpoint == null) {
            connecting = false
            listener.onState(State.DISCONNECTED, "WebSocket 地址无效")
            return
        }
        val request = try {
            Request.Builder().url(endpoint).build()
        } catch (t: Throwable) {
            connecting = false
            listener.onState(State.DISCONNECTED, "地址解析失败：${t.message}")
            scheduleReconnect()
            return
        }
        // 关闭可能残留的旧连接，保证同一时刻只有一个 socket
        val old = socket
        socket = null
        old?.close(1000, "replace")
        socket = httpClient.newWebSocket(request, socketListener)
    }

    private val socketListener = object : WebSocketListener() {

        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (webSocket !== socket) {
                webSocket.close(1000, "stale")
                return
            }
            connecting = false
            attempt = 0
            listener.onState(State.CONNECTED, "已连接 ${config.wsUrl}")
            sendHello(webSocket)
            startHeartbeat()
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (webSocket !== socket) return
            handleMessage(text)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (webSocket !== socket) return
            socket = null
            connecting = false
            stopHeartbeat()
            listener.onState(State.DISCONNECTED, "连接已关闭（$code）")
            scheduleReconnect()
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (webSocket !== socket) return
            socket = null
            connecting = false
            stopHeartbeat()
            listener.onState(State.DISCONNECTED, "连接失败：${t.message ?: t.javaClass.simpleName}")
            scheduleReconnect()
        }
    }

    /** 断线重连：指数退避 + 随机抖动，上限 60s */
    private fun scheduleReconnect(fixedDelayMs: Long? = null) {
        if (stopped) return
        reconnectRunnable?.let { main.removeCallbacks(it) }
        val waitMs: Long = if (fixedDelayMs != null) {
            fixedDelayMs
        } else {
            val exp = 1000L shl minOf(attempt, 6)          // 1s,2s,4s,...,64s
            val base = minOf(60_000L, exp)
            attempt = minOf(attempt + 1, 10)
            base + Random.nextLong(0, (base / 3).coerceAtLeast(1))
        }
        val seconds = (waitMs + 999) / 1000
        listener.onState(State.DISCONNECTED, "连接断开，${seconds}s 后重连")
        val runnable = Runnable { connect() }
        reconnectRunnable = runnable
        main.postDelayed(runnable, waitMs)
    }

    // ------------------------------------------------------------ 消息处理

    private fun sendHello(webSocket: WebSocket) {
        scope.launch {
            val root = RootShell.rootStatus()
            val device = DeviceInfo.helloObject(context, config.deviceUid, root)
            val message = JSONObject().apply {
                put("type", "hello")
                put("device", device)
            }
            runCatching { webSocket.send(message.toString()) }
        }
    }

    private fun startHeartbeat() {
        stopHeartbeat()
        val runnable = object : Runnable {
            override fun run() {
                if (stopped || socket == null) return
                scope.launch {
                    val root = RootShell.rootStatus()
                    val device = DeviceInfo.heartbeatObject(context, root)
                    val message = JSONObject().apply {
                        put("type", "heartbeat")
                        put("device", device)
                    }
                    runCatching { socket?.send(message.toString()) }
                }
                main.postDelayed(this, config.heartbeatSec * 1000L)
            }
        }
        heartbeatRunnable = runnable
        main.postDelayed(runnable, config.heartbeatSec * 1000L)
    }

    private fun stopHeartbeat() {
        heartbeatRunnable?.let { main.removeCallbacks(it) }
        heartbeatRunnable = null
    }

    private fun handleMessage(text: String) {
        val obj = runCatching { JSONObject(text) }.getOrNull() ?: return
        when (obj.optString("type")) {
            "command" -> handleCommand(obj)
            "pull_file" -> handlePullFile(obj)
            "ping" -> socket?.send("""{"type":"pong"}""")
            else -> Unit
        }
    }

    private fun handleCommand(obj: JSONObject) {
        val requestId = obj.optString("requestId")
        val cmd = obj.optString("cmd")
        val params = obj.optJSONObject("params") ?: JSONObject()
        scope.launch {
            val started = SystemClock.elapsedRealtime()

            // 高危指令：先回 result 再执行
            if (cmd == "reboot" || cmd == "shutdown") {
                val text = if (cmd == "reboot") {
                    "重启指令已接收，设备即将重启"
                } else {
                    "关机指令已接收，设备即将关机"
                }
                sendResult(ExecResult(true, text, "", 0), requestId, 0)
                logStore.insert(cmd, params.toString(), "success", text, 0)
                delay(600)
                RootShell.exec(if (cmd == "reboot") "reboot" else "reboot -p", 20)
                return@launch
            }

            val result = CommandExecutor.execute(context, config, cmd, params)
            val duration = SystemClock.elapsedRealtime() - started
            sendResult(result, requestId, duration)
            logStore.insert(cmd, params.toString(), result.status, summaryOf(result), duration)
        }
    }

    private fun handlePullFile(obj: JSONObject) {
        val requestId = obj.optString("requestId")
        val fileId = obj.optString("fileId")
        val targetPath = obj.optString("targetPath")
        val mode = obj.optString("mode").ifBlank { "save" }
        scope.launch {
            val started = SystemClock.elapsedRealtime()
            val result = CommandExecutor.pullFile(context, config, fileId, targetPath, mode)
            val duration = SystemClock.elapsedRealtime() - started
            sendResult(result, requestId, duration)
            logStore.insert(
                "pull_file",
                "fileId=$fileId, target=$targetPath, mode=$mode",
                result.status,
                summaryOf(result),
                duration
            )
        }
    }

    private fun sendResult(result: ExecResult, requestId: String, durationMs: Long) {
        val ws = socket ?: return
        val obj = JSONObject().apply {
            put("type", "result")
            put("requestId", requestId)
            put("ok", result.ok)
            put("stdout", result.stdout)
            put("stderr", result.stderr)
            put("exitCode", result.exitCode)
            put("durationMs", durationMs)
            result.image?.let { put("image", it) }
            result.fileId?.let { put("fileId", it) }
        }
        runCatching { ws.send(obj.toString()) }
    }

    private fun summaryOf(result: ExecResult): String {
        return buildString {
            append(result.stdout)
            if (result.stderr.isNotBlank()) {
                if (isNotEmpty()) append('\n')
                append(result.stderr)
            }
        }.ifBlank { result.status }
    }
}
