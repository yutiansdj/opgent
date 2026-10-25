package com.dsha.remoteagent.data

import android.content.Context
import android.provider.Settings
import java.util.UUID

/**
 * 本地配置（SharedPreferences）。
 *
 * - deviceUid：优先使用 Settings.Secure.ANDROID_ID，取不到时生成随机值并持久化
 * - deviceToken：首次运行生成 `dt_` + UUID，持久化后不再变化
 * - wsUrl / heartbeatSec：设置页可改，服务重连后生效
 */
class AppConfig(context: Context) {

    private val appContext = context.applicationContext
    private val sp = appContext.getSharedPreferences(SP_NAME, Context.MODE_PRIVATE)
    private val lock = Any()

    /**
     * WebSocket 后端地址，例如 ws://192.168.1.10:8787（可带 /ws/agent）。
     * 未配置或留空时回落到默认后端，方便装好即连。
     */
    var wsUrl: String
        get() = sp.getString(KEY_WS_URL, DEFAULT_WS_URL)
            .orEmpty()
            .trim()
            .ifBlank { DEFAULT_WS_URL }
        set(value) {
            val trimmed = value.trim()
            val old = wsUrl
            sp.edit().putString(KEY_WS_URL, trimmed).apply()
            // 换了后端就重新注册（新后端不一定认识旧 token）
            if (old != trimmed) {
                sp.edit().putBoolean(KEY_REGISTERED, false).apply()
            }
        }

    /** 设置页编辑用：原始保存值（空字符串表示「留空，使用默认服务器」） */
    val savedWsUrl: String
        get() = sp.getString(KEY_WS_URL, "").orEmpty().trim()

    /** 心跳间隔（秒），限制 5~600 */
    var heartbeatSec: Int
        get() = sp.getInt(KEY_HEARTBEAT, 15).coerceIn(5, 600)
        set(value) = sp.edit().putInt(KEY_HEARTBEAT, value.coerceIn(5, 600)).apply()

    /** 设备令牌：dt_ + 32 位 UUID */
    var deviceToken: String
        get() {
            val existing = sp.getString(KEY_TOKEN, null)
            if (!existing.isNullOrBlank()) return existing
            synchronized(lock) {
                val again = sp.getString(KEY_TOKEN, null)
                if (!again.isNullOrBlank()) return again
                val token = "dt_" + UUID.randomUUID().toString().replace("-", "")
                sp.edit().putString(KEY_TOKEN, token).apply()
                return token
            }
            @Suppress("UNREACHABLE_CODE")
            return "dt_" + UUID.randomUUID().toString().replace("-", "")
        }
        set(value) = sp.edit().putString(KEY_TOKEN, value).apply()

    /** 设备唯一标识：ANDROID_ID，兜底随机值 */
    val deviceUid: String
        get() {
            val existing = sp.getString(KEY_UID, null)
            if (!existing.isNullOrBlank()) return existing
            synchronized(lock) {
                val again = sp.getString(KEY_UID, null)
                if (!again.isNullOrBlank()) return again
                val androidId = runCatching {
                    Settings.Secure.getString(
                        appContext.contentResolver,
                        Settings.Secure.ANDROID_ID
                    )
                }.getOrNull()
                val uid = if (!androidId.isNullOrBlank()) {
                    androidId
                } else {
                    "uid_" + UUID.randomUUID().toString().replace("-", "").take(16)
                }
                sp.edit().putString(KEY_UID, uid).apply()
                return uid
            }
            @Suppress("UNREACHABLE_CODE")
            return "uid_" + UUID.randomUUID().toString().replace("-", "").take(16)
        }

    /** 是否已成功调用过 /api/devices/register */
    var registered: Boolean
        get() = sp.getBoolean(KEY_REGISTERED, false)
        set(value) = sp.edit().putBoolean(KEY_REGISTERED, value).apply()

    /** 注册时上报的设备名 */
    var deviceName: String
        get() = sp.getString(KEY_NAME, "").orEmpty().ifBlank { defaultDeviceName() }
        set(value) = sp.edit().putString(KEY_NAME, value.trim()).apply()

    /** 重置令牌（同时标记未注册，重连时会重新注册） */
    fun resetToken(): String {
        val token = "dt_" + UUID.randomUUID().toString().replace("-", "")
        sp.edit().putString(KEY_TOKEN, token).putBoolean(KEY_REGISTERED, false).apply()
        return token
    }

    /** 从 ws 地址推导 HTTP base：ws->http、wss->https，仅保留 scheme://host:port */
    fun httpBase(): String? {
        val raw = wsUrl.trim()
        if (raw.isEmpty()) return null
        val http = when {
            raw.startsWith("ws://", ignoreCase = true) -> "http://" + raw.substring(5)
            raw.startsWith("wss://", ignoreCase = true) -> "https://" + raw.substring(6)
            raw.startsWith("http://", ignoreCase = true) || raw.startsWith("https://", ignoreCase = true) -> raw
            else -> return null
        }
        return runCatching {
            val uri = java.net.URI(http)
            val host = uri.host ?: return null
            val port = if (uri.port > 0) ":${uri.port}" else ""
            "${uri.scheme}://$host$port"
        }.getOrNull()
    }

    /** 完整 WebSocket 端点：未配置返回 null；自动补 /ws/agent 与 token */
    fun wsEndpoint(): String? {
        val raw = wsUrl.trim()
        if (raw.isEmpty()) return null
        if (!raw.startsWith("ws://", true) && !raw.startsWith("wss://", true)) return null
        val base = if (raw.trimEnd('/').endsWith("/ws/agent")) {
            raw.trimEnd('/')
        } else {
            raw.trimEnd('/') + "/ws/agent"
        }
        val sep = if (base.contains("?")) "&" else "?"
        return "$base${sep}token=$deviceToken"
    }

    private fun defaultDeviceName(): String {
        val model = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim()
        return model.ifBlank { "远程运维设备" }
    }

    companion object {
        /** 默认后端地址：装好 App 后无需手输即可连接 */
        const val DEFAULT_WS_URL = "ws://43.251.226.134"

        private const val SP_NAME = "remote_agent_config"
        private const val KEY_WS_URL = "ws_url"
        private const val KEY_HEARTBEAT = "heartbeat_sec"
        private const val KEY_TOKEN = "device_token"
        private const val KEY_UID = "device_uid"
        private const val KEY_REGISTERED = "registered"
        private const val KEY_NAME = "device_name"
    }
}
