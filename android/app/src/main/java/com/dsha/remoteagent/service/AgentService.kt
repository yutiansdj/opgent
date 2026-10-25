package com.dsha.remoteagent.service

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.dsha.remoteagent.App
import com.dsha.remoteagent.MainActivity
import com.dsha.remoteagent.R
import com.dsha.remoteagent.data.AppConfig
import com.dsha.remoteagent.data.LogStore
import com.dsha.remoteagent.net.AgentWebSocketClient

/**
 * 前台服务（specialUse）：WebSocket 长连接 + 心跳 + 远程指令执行 + 文件传输。
 * 不依赖 Activity，可由 BootReceiver 或守护脚本直接拉起。
 */
class AgentService : Service() {

    private lateinit var config: AppConfig
    private lateinit var logStore: LogStore
    private var client: AgentWebSocketClient? = null

    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        statusText = "正在启动…"
        config = App.instance.config
        logStore = App.instance.logStore

        createChannel()
        startForegroundCompat(buildNotification(statusText))

        registerNetworkCallback()

        client = AgentWebSocketClient(
            context = this,
            config = config,
            logStore = logStore,
            listener = object : AgentWebSocketClient.Listener {
                override fun onState(state: AgentWebSocketClient.State, detail: String) {
                    connected = state == AgentWebSocketClient.State.CONNECTED
                    statusText = detail
                    updateNotification(detail)
                }
            }
        ).also { it.start() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_RECONNECT -> {
                client?.forceReconnect("设置已更新，正在重连")
            }

            else -> Unit
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /**
     * 用户把 App 从「最近任务」里划掉时触发。
     * 服务本身因为 stopWithTask=false 不会因此停止，但进程可能被杀；
     * 这里用 AlarmManager 再请求一次启动，作为 root 守护脚本之外的第二道保险。
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        try {
            val restart = Intent(applicationContext, AgentService::class.java)
            val pi = PendingIntent.getService(
                applicationContext,
                1001,
                restart,
                PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
            )
            val am = getSystemService(AlarmManager::class.java)
            val triggerAt = SystemClock.elapsedRealtime() + 2000
            // Android 12+ 后台启动前台服务受限，这里尽力而为，失败由 root 守护兜底
            am?.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME, triggerAt, pi)
        } catch (_: Throwable) {
            // 忽略：root 守护脚本会负责拉起
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        client?.stop()
        client = null
        unregisterNetworkCallback()
        running = false
        connected = false
        statusText = "已停止"
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    // ------------------------------------------------------------ 网络监听

    /** 网络恢复立即重连（不等退避） */
    private fun registerNetworkCallback() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        connectivityManager = cm
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (running) {
                    client?.forceReconnect("网络已恢复，正在重连")
                }
            }

            override fun onLost(network: Network) {
                statusText = "网络已断开，等待恢复"
                updateNotification(statusText)
            }
        }
        networkCallback = callback
        runCatching { cm.registerNetworkCallback(request, callback) }
    }

    private fun unregisterNetworkCallback() {
        val cm = connectivityManager ?: return
        val callback = networkCallback ?: return
        runCatching { cm.unregisterNetworkCallback(callback) }
        networkCallback = null
    }

    // ------------------------------------------------------------ 通知

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "远程运维服务",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "保持与后端的 WebSocket 长连接并执行远程指令"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, AgentService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("远程运维 Agent")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openIntent)
            .addAction(0, "停止服务", stopIntent)
            .build()
    }

    private fun startForegroundCompat(notification: Notification) {
        // Android 14+ 必须传入与 manifest 一致的前台服务类型
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    }

    private fun updateNotification(text: String) {
        runCatching {
            val manager = getSystemService(NotificationManager::class.java) ?: return
            manager.notify(NOTIFICATION_ID, buildNotification(text))
        }
    }

    companion object {
        const val ACTION_START = "com.dsha.remoteagent.action.START"
        const val ACTION_STOP = "com.dsha.remoteagent.action.STOP"
        const val ACTION_RECONNECT = "com.dsha.remoteagent.action.RECONNECT"

        private const val CHANNEL_ID = "agent_service_channel"
        private const val NOTIFICATION_ID = 1001

        @Volatile
        var running: Boolean = false
            private set

        @Volatile
        var connected: Boolean = false
            private set

        @Volatile
        var statusText: String = "未启动"
            private set

        /** 启动前台服务（Activity / BootReceiver 共用） */
        fun start(context: Context) {
            val intent = Intent(context, AgentService::class.java).setAction(ACTION_START)
            ContextCompat.startForegroundService(context, intent)
        }

        /** 停止前台服务 */
        fun stop(context: Context) {
            val intent = Intent(context, AgentService::class.java).setAction(ACTION_STOP)
            runCatching { context.startService(intent) }
        }

        /** 设置变更后重连 */
        fun reconnect(context: Context) {
            val intent = Intent(context, AgentService::class.java).setAction(ACTION_RECONNECT)
            runCatching { context.startService(intent) }
        }
    }
}
