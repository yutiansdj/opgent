package com.dsha.remoteagent

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.dsha.remoteagent.databinding.ActivityMainBinding
import com.dsha.remoteagent.ui.HomeFragment
import com.dsha.remoteagent.ui.LogsFragment
import com.dsha.remoteagent.ui.PermissionsFragment
import com.dsha.remoteagent.ui.SettingsFragment

/**
 * 单 Activity + BottomNavigationView + Fragment：
 * 主页 / 日志 / 设置 / 权限。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* 结果不影响服务运行 */ }

    private val cameraPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* 拒绝就只是拍不了照 */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // targetSdk 35+ 强制 edge-to-edge：手动加上系统栏内边距，避免内容被状态栏/导航栏遮挡
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        val initialTab = savedInstanceState?.getInt(KEY_TAB) ?: R.id.nav_home

        binding.bottomNav.setOnItemSelectedListener { item ->
            switchTo(item.itemId)
            true
        }

        if (supportFragmentManager.findFragmentById(R.id.fragment_container) == null) {
            switchTo(initialTab)
        }
        binding.bottomNav.selectedItemId = initialTab

        requestNotificationPermissionIfNeeded()
        requestCameraPermissionIfNeeded()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt(KEY_TAB, binding.bottomNav.selectedItemId)
        super.onSaveInstanceState(outState)
    }

    private fun switchTo(itemId: Int) {
        val fragment = when (itemId) {
            R.id.nav_logs -> LogsFragment()
            R.id.nav_settings -> SettingsFragment()
            R.id.nav_permissions -> PermissionsFragment()
            else -> HomeFragment()
        }
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragment_container, fragment)
            .commit()
    }

    /** Android 13+ 通知权限（前台服务通知需要） */
    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    /** 远程拍照需要相机权限：装好后打开一次 App 就会弹窗，允许即可 */
    private fun requestCameraPermissionIfNeeded() {
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
    }

    companion object {
        private const val KEY_TAB = "selected_tab"
    }
}
