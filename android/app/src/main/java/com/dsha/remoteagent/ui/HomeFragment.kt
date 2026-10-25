package com.dsha.remoteagent.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.dsha.remoteagent.App
import com.dsha.remoteagent.R
import com.dsha.remoteagent.daemon.DaemonInstaller
import com.dsha.remoteagent.data.DeviceInfo
import com.dsha.remoteagent.databinding.DialogShellBinding
import com.dsha.remoteagent.databinding.FragmentHomeBinding
import com.dsha.remoteagent.root.RootShell
import com.dsha.remoteagent.service.AgentService
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 主页：设备状态、服务开关、守护启停、Token 复制、本地 root Shell、高危操作二次确认。
 */
class HomeFragment : Fragment() {

    private var _binding: FragmentHomeBinding? = null
    private val binding get() = _binding!!

    private val uiHandler = Handler(Looper.getMainLooper())
    private var rootText = "检测中…"

    private val refreshTask = object : Runnable {
        override fun run() {
            refreshState()
            uiHandler.postDelayed(this, 1000L)
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentHomeBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.btnServiceToggle.setOnClickListener { toggleService() }
        binding.btnDaemonStart.setOnClickListener {
            val ctx = requireContext().applicationContext
            runDaemonAction("安装并启动守护") { DaemonInstaller.startGuard(ctx) }
        }
        binding.btnDaemonStop.setOnClickListener {
            runDaemonAction("停止守护") { DaemonInstaller.stopDaemon() }
        }
        binding.btnDaemonUninstall.setOnClickListener {
            MaterialAlertDialogBuilder(requireContext())
                .setTitle("卸载守护脚本？")
                .setMessage("将停止 guard/daemon 进程，并删除 /data/adb/remoteagent 与开机自启脚本。")
                .setNegativeButton("取消", null)
                .setPositiveButton("卸载") { _, _ ->
                    runDaemonAction("卸载守护") { DaemonInstaller.uninstall() }
                }
                .show()
        }
        binding.btnCopyToken.setOnClickListener { copyToken() }
        binding.btnShellTest.setOnClickListener { showShellDialog() }
        binding.btnReboot.setOnClickListener {
            confirmPower(
                "确认重启设备？",
                "设备将立即重启，WebSocket 连接会中断，重启后由守护脚本/开机广播重新拉起。",
                "reboot"
            )
        }
        binding.btnShutdown.setOnClickListener {
            confirmPower(
                "确认关机？",
                "设备将立即关机，开机后由守护脚本/开机广播重新拉起。",
                "reboot -p"
            )
        }

        binding.tvUid.text = "deviceUid：${App.instance.config.deviceUid}"
        binding.tvToken.text = "deviceToken：${App.instance.config.deviceToken}"

        refreshRootAsync(force = false)
    }

    override fun onResume() {
        super.onResume()
        uiHandler.post(refreshTask)
        refreshRootAsync(force = false)
    }

    override fun onPause() {
        super.onPause()
        uiHandler.removeCallbacks(refreshTask)
    }

    override fun onDestroyView() {
        uiHandler.removeCallbacks(refreshTask)
        _binding = null
        super.onDestroyView()
    }

    // ------------------------------------------------------------ 状态刷新

    private fun refreshState() {
        val ctx = context ?: return
        val running = AgentService.running
        binding.tvServiceState.text = if (running) "前台服务：运行中" else "前台服务：已停止"
        binding.tvServiceState.setTextColor(
            ContextCompat.getColor(ctx, if (running) R.color.ok_green else R.color.warn_red)
        )
        binding.btnServiceToggle.text = if (running) "停止前台服务" else "启动前台服务"
        binding.tvConnState.text = "连接状态：${AgentService.statusText}"
        binding.tvBattery.text = "电量：${DeviceInfo.battery(ctx)}%"
        binding.tvAndroid.text =
            "系统：Android ${DeviceInfo.androidVersion()}（API ${DeviceInfo.apiLevel()}）"
        binding.tvRoot.text = "Root：$rootText"
        binding.tvToken.text = "deviceToken：${App.instance.config.deviceToken}"
    }

    private fun refreshRootAsync(force: Boolean) {
        viewLifecycleOwner.lifecycleScope.launch {
            val status = withContext(Dispatchers.IO) { RootShell.rootStatus(force) }
            if (!isAdded) return@launch
            rootText = if (status == "granted") "已授权（uid=0）" else "未授权"
            _binding?.tvRoot?.text = "Root：$rootText"
        }
    }

    // ------------------------------------------------------------ 服务 / 守护

    private fun toggleService() {
        val ctx = requireContext()
        if (AgentService.running) {
            AgentService.stop(ctx)
            Toast.makeText(ctx, "正在停止前台服务…", Toast.LENGTH_SHORT).show()
            return
        }
        if (App.instance.config.wsUrl.isBlank()) {
            Toast.makeText(ctx, "请先在「设置」页填写后端地址", Toast.LENGTH_LONG).show()
            return
        }
        runCatching { AgentService.start(ctx) }
            .onFailure { Toast.makeText(ctx, "启动失败：${it.message}", Toast.LENGTH_LONG).show() }
    }

    private fun runDaemonAction(label: String, action: () -> DaemonInstaller.Result) {
        val ctx = requireContext()
        binding.btnDaemonStart.isEnabled = false
        binding.btnDaemonStop.isEnabled = false
        Toast.makeText(ctx, "$label…", Toast.LENGTH_SHORT).show()
        viewLifecycleOwner.lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { action() }
                .getOrElse { DaemonInstaller.Result(false, "执行异常：${it.message}") } }
            if (!isAdded) return@launch
            _binding?.btnDaemonStart?.isEnabled = true
            _binding?.btnDaemonStop?.isEnabled = true
            Toast.makeText(requireContext(), result.message, Toast.LENGTH_LONG).show()
            App.instance.logStore.insert(
                "守护脚本",
                label,
                if (result.ok) "success" else "failed",
                result.message,
                0
            )
        }
    }

    private fun copyToken() {
        val ctx = requireContext()
        val token = App.instance.config.deviceToken
        val manager = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        manager.setPrimaryClip(ClipData.newPlainText("deviceToken", token))
        Toast.makeText(ctx, "deviceToken 已复制", Toast.LENGTH_SHORT).show()
    }

    // ------------------------------------------------------------ 高危操作

    private fun confirmPower(title: String, message: String, command: String) {
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(title)
            .setMessage(message)
            .setNegativeButton("取消", null)
            .setPositiveButton("确认执行") { _, _ ->
                viewLifecycleOwner.lifecycleScope.launch {
                    val ctx = requireContext()
                    withContext(Dispatchers.IO) { RootShell.exec(command, 20) }
                    App.instance.logStore.insert(
                        "本地${if (command.contains("-p")) "关机" else "重启"}",
                        command,
                        "success",
                        "已下发 $command",
                        0
                    )
                    if (isAdded) {
                        Toast.makeText(ctx, "指令已执行", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .show()
    }

    // ------------------------------------------------------------ 本地 Shell

    private fun showShellDialog() {
        val dialogBinding = DialogShellBinding.inflate(layoutInflater)
        dialogBinding.inputCommand.setText("id")
        dialogBinding.inputCommand.setSelection(dialogBinding.inputCommand.text?.length ?: 0)

        val dialog = MaterialAlertDialogBuilder(requireContext())
            .setTitle("本地 Shell（root）")
            .setView(dialogBinding.root)
            .setNegativeButton("关闭", null)
            .setPositiveButton("执行", null)
            .create()

        dialog.setOnShowListener {
            val positive = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            positive.setOnClickListener {
                val command = dialogBinding.inputCommand.text?.toString()?.trim().orEmpty()
                if (command.isEmpty()) {
                    Toast.makeText(requireContext(), "请输入命令", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                if (isPowerCommand(command)) {
                    // 本地触发的高危命令二次确认
                    MaterialAlertDialogBuilder(requireContext())
                        .setTitle("确认高危命令？")
                        .setMessage("即将执行：\n$command\n设备可能立刻重启或关机。")
                        .setNegativeButton("取消", null)
                        .setPositiveButton("继续执行") { _, _ ->
                            runLocalShell(command, dialogBinding, positive)
                        }
                        .show()
                } else {
                    runLocalShell(command, dialogBinding, positive)
                }
            }
        }
        dialog.show()
    }

    private fun runLocalShell(
        command: String,
        dialogBinding: DialogShellBinding,
        positive: android.widget.Button
    ) {
        positive.isEnabled = false
        dialogBinding.tvShellResult.text = "执行中…"
        viewLifecycleOwner.lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { RootShell.exec(command, 120) }
            if (!isAdded) return@launch
            positive.isEnabled = true
            val output = buildString {
                append("exitCode: ").append(result.exitCode)
                if (result.stdout.isNotBlank()) {
                    append("\n\n[stdout]\n").append(result.stdout)
                }
                if (result.stderr.isNotBlank()) {
                    append("\n\n[stderr]\n").append(result.stderr)
                }
            }
            dialogBinding.tvShellResult.text = output
            App.instance.logStore.insert(
                "本地Shell",
                command,
                if (result.ok) "success" else "failed",
                result.stdout + result.stderr,
                0
            )
        }
    }

    private fun isPowerCommand(command: String): Boolean {
        val first = command.trim().substringBefore(' ').substringAfterLast('/')
        return first == "reboot" || first == "shutdown" || first == "poweroff"
    }
}
