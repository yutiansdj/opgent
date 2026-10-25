package com.dsha.remoteagent.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.dsha.remoteagent.R
import com.dsha.remoteagent.databinding.FragmentPermissionsBinding
import com.dsha.remoteagent.root.RootShell
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 权限页：Root / 通知 / 电池优化白名单三项状态 + 去授权按钮。
 */
class PermissionsFragment : Fragment() {

    private var _binding: FragmentPermissionsBinding? = null
    private val binding get() = _binding!!

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (isAdded) {
                if (granted) {
                    Toast.makeText(requireContext(), "通知权限已授权", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(requireContext(), "通知权限被拒绝，后台服务通知可能不可见", Toast.LENGTH_LONG).show()
                }
                refreshNotificationStatus()
            }
        }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentPermissionsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.btnRootRequest.setOnClickListener { checkRoot(force = true) }
        binding.btnNotif.setOnClickListener { requestNotification() }
        binding.btnBattery.setOnClickListener { requestIgnoreBatteryOptimization() }

        refreshNotificationStatus()
        refreshBatteryStatus()
        checkRoot(force = false)
    }

    override fun onResume() {
        super.onResume()
        refreshNotificationStatus()
        refreshBatteryStatus()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    // ------------------------------------------------------------ Root

    private fun checkRoot(force: Boolean) {
        val ctx = requireContext()
        binding.tvRootStatus.text = "检测中…"
        viewLifecycleOwner.lifecycleScope.launch {
            val status = withContext(Dispatchers.IO) { RootShell.rootStatus(force) }
            if (!isAdded) return@launch
            val granted = status == "granted"
            binding.tvRootStatus.text =
                if (granted) "已授权：su 返回 uid=0" else "未授权：未检测到可用的 su（Magisk / KernelSU / APatch）"
            binding.tvRootStatus.setTextColor(
                ContextCompat.getColor(ctx, if (granted) R.color.ok_green else R.color.warn_red)
            )
            if (force && !granted) {
                MaterialAlertDialogBuilder(ctx)
                    .setTitle("未获得 Root 权限")
                    .setMessage("请打开 Magisk / KernelSU / APatch 管理器中为本应用授予 Root，然后重新点击「去授权」。\n\n没有 Root 时，shell、截图、文件读写、守护脚本等能力不可用。")
                    .setPositiveButton("知道了", null)
                    .show()
            }
        }
    }

    // ------------------------------------------------------------ 通知

    private fun refreshNotificationStatus() {
        val ctx = context ?: return
        val enabled = NotificationManagerCompat.from(ctx).areNotificationsEnabled()
        binding.tvNotifStatus.text = if (enabled) "已授权：可显示前台服务通知" else "未授权：通知被系统关闭"
        binding.tvNotifStatus.setTextColor(
            ContextCompat.getColor(ctx, if (enabled) R.color.ok_green else R.color.warn_red)
        )
    }

    private fun requestNotification() {
        val ctx = requireContext()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                ctx,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                return
            }
        }
        openNotificationSettings()
    }

    private fun openNotificationSettings() {
        val ctx = requireContext()
        runCatching {
            startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
            )
        }.onFailure {
            Toast.makeText(ctx, "无法打开通知设置：${it.message}", Toast.LENGTH_LONG).show()
        }
    }

    // ------------------------------------------------------------ 电池优化

    private fun refreshBatteryStatus() {
        val ctx = context ?: return
        val pm = ctx.getSystemService(PowerManager::class.java)
        val ignoring = pm?.isIgnoringBatteryOptimizations(ctx.packageName) == true
        binding.tvBatteryStatus.text =
            if (ignoring) "已加入白名单：不受电池优化限制" else "未加入白名单：长连接可能被系统限制"
        binding.tvBatteryStatus.setTextColor(
            ContextCompat.getColor(ctx, if (ignoring) R.color.ok_green else R.color.warn_red)
        )
    }

    private fun requestIgnoreBatteryOptimization() {
        val ctx = requireContext()
        val requested = runCatching {
            startActivity(
                Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:${ctx.packageName}")
                )
            )
        }.isSuccess
        if (!requested) {
            runCatching {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }.onFailure {
                Toast.makeText(ctx, "无法打开电池优化设置：${it.message}", Toast.LENGTH_LONG).show()
            }
        }
    }
}
