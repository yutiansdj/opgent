package com.dsha.remoteagent.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import org.json.JSONObject
import java.net.NetworkInterface

/**
 * 设备信息采集：model / androidVersion / rootStatus / battery / network / ip。
 * 全部为真实系统数据，不做 mock。
 */
object DeviceInfo {

    fun model(): String = "${Build.MANUFACTURER} ${Build.MODEL}".trim().ifBlank { "Android" }

    fun androidVersion(): String = Build.VERSION.RELEASE ?: ""

    fun apiLevel(): Int = Build.VERSION.SDK_INT

    fun battery(context: Context): Int {
        val bm = context.getSystemService(BatteryManager::class.java) ?: return -1
        val capacity = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return if (capacity in 0..100) capacity else -1
    }

    /** wifi / cellular / ethernet / vpn / none */
    fun networkType(context: Context): String {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return "none"
        val network = cm.activeNetwork ?: return "none"
        val caps = cm.getNetworkCapabilities(network) ?: return "none"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            else -> "other"
        }
    }

    /** 当前活动的局域网 IPv4 地址（无则返回空串） */
    fun ipAddress(): String {
        return runCatching {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return@runCatching ""
            while (interfaces.hasMoreElements()) {
                val nif = interfaces.nextElement()
                if (!nif.isUp || nif.isLoopback) continue
                val addresses = nif.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (!addr.isLoopbackAddress && addr is java.net.Inet4Address) {
                        val host = addr.hostAddress ?: continue
                        if (!host.startsWith("169.254.")) return@runCatching host
                    }
                }
            }
            ""
        }.getOrDefault("")
    }

    /** hello 消息里的 device 字段（含 deviceUid） */
    fun helloObject(context: Context, deviceUid: String, rootStatus: String): JSONObject =
        baseObject(context, rootStatus).apply {
            put("deviceUid", deviceUid)
        }

    /** heartbeat 消息里的 device 字段（契约不含 deviceUid，但多带无碍，这里严格按契约不带） */
    fun heartbeatObject(context: Context, rootStatus: String): JSONObject =
        baseObject(context, rootStatus)

    private fun baseObject(context: Context, rootStatus: String): JSONObject = JSONObject().apply {
        put("model", model())
        put("androidVersion", androidVersion())
        put("rootStatus", rootStatus)
        put("battery", battery(context))
        put("network", networkType(context))
        put("ip", ipAddress())
    }
}
