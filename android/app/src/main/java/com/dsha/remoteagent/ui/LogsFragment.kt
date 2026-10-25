package com.dsha.remoteagent.ui

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.dsha.remoteagent.App
import com.dsha.remoteagent.databinding.FragmentLogsBinding
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 日志页：RecyclerView 展示本地指令执行记录，2 秒轮询刷新 */
class LogsFragment : Fragment() {

    private var _binding: FragmentLogsBinding? = null
    private val binding get() = _binding!!
    private val adapter = LogAdapter()
    private val uiHandler = Handler(Looper.getMainLooper())

    private val refreshTask = object : Runnable {
        override fun run() {
            loadLogs()
            uiHandler.postDelayed(this, 2000L)
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentLogsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.recyclerLogs.layoutManager = LinearLayoutManager(requireContext())
        binding.recyclerLogs.adapter = adapter
        binding.btnClearLogs.setOnClickListener {
            MaterialAlertDialogBuilder(requireContext())
                .setTitle("清空本地日志？")
                .setMessage("仅清除本机 SQLite 中的指令日志，不影响后端记录。")
                .setNegativeButton("取消", null)
                .setPositiveButton("清空") { _, _ ->
                    App.instance.logStore.clear()
                    loadLogs()
                }
                .show()
        }
    }

    override fun onStart() {
        super.onStart()
        uiHandler.post(refreshTask)
    }

    override fun onStop() {
        super.onStop()
        uiHandler.removeCallbacks(refreshTask)
    }

    override fun onDestroyView() {
        uiHandler.removeCallbacks(refreshTask)
        _binding = null
        super.onDestroyView()
    }

    private fun loadLogs() {
        viewLifecycleOwner.lifecycleScope.launch {
            val logs = withContext(Dispatchers.IO) { App.instance.logStore.recent(300) }
            if (!isAdded) return@launch
            adapter.submit(logs)
            binding.tvEmpty.visibility = if (logs.isEmpty()) View.VISIBLE else View.GONE
            binding.recyclerLogs.visibility = if (logs.isEmpty()) View.GONE else View.VISIBLE
        }
    }
}
