package com.dsha.remoteagent.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.dsha.remoteagent.R
import com.dsha.remoteagent.data.LogEntry
import com.dsha.remoteagent.databinding.ItemLogBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 本地指令日志列表适配器 */
class LogAdapter : RecyclerView.Adapter<LogAdapter.ViewHolder>() {

    private val items = ArrayList<LogEntry>()
    private val timeFormat = SimpleDateFormat("MM-dd HH:mm:ss", Locale.getDefault())

    fun submit(list: List<LogEntry>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemLogBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(items[position])
    }

    inner class ViewHolder(private val binding: ItemLogBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(item: LogEntry) {
            val ctx = binding.root.context
            binding.tvLogTitle.text = item.cmd
            binding.tvLogStatus.text = item.status
            binding.tvLogStatus.setTextColor(
                ContextCompat.getColor(
                    ctx,
                    if (item.status == "success") R.color.ok_green else R.color.warn_red
                )
            )
            binding.tvLogTime.text = buildString {
                append(timeFormat.format(Date(item.createdAt)))
                if (item.durationMs > 0) append("  ·  ${item.durationMs}ms")
            }
            binding.tvLogCommand.text = item.params.ifBlank { "（无参数）" }
            binding.tvLogResult.text = item.result.ifBlank { "（无输出）" }
        }
    }
}
