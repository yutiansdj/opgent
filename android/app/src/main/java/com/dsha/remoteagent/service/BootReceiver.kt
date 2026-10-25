package com.dsha.remoteagent.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * 开机 / 应用更新后拉起前台服务。
 * 守护脚本（/data/adb/service.d）是 Root 场景下的第二层保障。
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                runCatching { AgentService.start(context) }
                    .onFailure { Log.w(TAG, "开机拉起服务失败：${it.message}") }
            }
        }
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
