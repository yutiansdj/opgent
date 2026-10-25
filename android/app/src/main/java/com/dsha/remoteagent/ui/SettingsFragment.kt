package com.dsha.remoteagent.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import com.dsha.remoteagent.App
import com.dsha.remoteagent.data.AppConfig
import com.dsha.remoteagent.databinding.FragmentSettingsBinding
import com.dsha.remoteagent.service.AgentService

/** 设置页：后端 WebSocket 地址、心跳间隔；保存后立即重连 */
class SettingsFragment : Fragment() {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val config = App.instance.config

        // 显示原始保存值：空字符串表示留空（此时用默认服务器，输入框显示默认地址占位提示）
        binding.editWsUrl.setText(config.savedWsUrl)
        binding.editHeartbeat.setText(config.heartbeatSec.toString())
        binding.tvSettingsUid.text = "deviceUid：${config.deviceUid}"
        binding.tvSettingsToken.text = "deviceToken：${config.deviceToken}"

        binding.btnSave.setOnClickListener { save() }
    }

    private fun save() {
        val ctx = requireContext()
        val config = App.instance.config
        val wsUrl = binding.editWsUrl.text?.toString()?.trim().orEmpty()
        val heartbeatText = binding.editHeartbeat.text?.toString()?.trim().orEmpty()
        val heartbeat = heartbeatText.toIntOrNull()

        if (wsUrl.isNotEmpty() &&
            !wsUrl.startsWith("ws://", true) &&
            !wsUrl.startsWith("wss://", true)
        ) {
            Toast.makeText(ctx, "地址需以 ws:// 或 wss:// 开头", Toast.LENGTH_LONG).show()
            return
        }
        if (heartbeat == null || heartbeat !in 5..600) {
            Toast.makeText(ctx, "心跳间隔需为 5~600 的整数秒", Toast.LENGTH_LONG).show()
            return
        }

        val changed = config.savedWsUrl != wsUrl || config.heartbeatSec != heartbeat
        config.wsUrl = wsUrl
        config.heartbeatSec = heartbeat
        val effective = wsUrl.ifBlank { AppConfig.DEFAULT_WS_URL }
        App.instance.logStore.insert(
            "设置",
            "ws=$effective, heartbeat=${heartbeat}s",
            "success",
            if (changed) "配置已更新" else "配置未变化",
            0
        )

        val suffix = if (wsUrl.isBlank()) "，将使用默认服务器" else ""
        if (AgentService.running && changed) {
            AgentService.reconnect(ctx)
            Toast.makeText(ctx, "已保存$suffix，正在用新配置重连…", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(ctx, "已保存$suffix", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }
}
