package com.dsha.remoteagent.daemon

import android.content.Context
import com.dsha.remoteagent.root.RootShell
import java.io.File

/**
 * 守护脚本安装 / 启停。
 *
 * 落盘位置（双层守护 + 开机自启）：
 * - /data/adb/remoteagent/daemon.sh   检测并拉起前台服务
 * - /data/adb/remoteagent/guard.sh    守护 daemon.sh
 * - /data/adb/service.d/remoteagent.sh 开机由 Magisk / KernelSU 执行，拉起 guard.sh
 *
 * 脚本内容放在 assets 中（daemon.sh / guard.sh / remoteagent.sh），
 * 安装时先写进 app cacheDir，再由 root 复制到目标目录并 chmod 755。
 */
object DaemonInstaller {

    private const val DIR = "/data/adb/remoteagent"
    private const val SERVICE_D_DIR = "/data/adb/service.d"
    private const val GUARD = "$DIR/guard.sh"

    data class Result(val ok: Boolean, val message: String)

    /** 安装（或覆盖更新）三个脚本 */
    fun install(context: Context): Result {
        // 用户可能刚在授权管理器里放行，这里强制复核一次，避免 60s 缓存误判
        if (!RootShell.isRootAvailable(force = true)) {
            return Result(false, "未获得 Root 权限，无法安装守护脚本")
        }
        val cacheDir = File(context.cacheDir, "daemon_scripts").apply { mkdirs() }
        val scripts = listOf(
            "daemon.sh" to "$DIR/daemon.sh",
            "guard.sh" to "$DIR/guard.sh",
            "remoteagent.sh" to "$SERVICE_D_DIR/remoteagent.sh"
        )
        try {
            for ((asset, _) in scripts) {
                val out = File(cacheDir, asset)
                context.assets.open(asset).use { input ->
                    out.outputStream().use { output -> input.copyTo(output) }
                }
            }
        } catch (t: Throwable) {
            return Result(false, "释放脚本失败：${t.message}")
        }

        val cmd = buildString {
            append("mkdir -p ").append(RootShell.quote(DIR))
            append(" && mkdir -p ").append(RootShell.quote(SERVICE_D_DIR))
            for ((asset, dest) in scripts) {
                append(" && cp ").append(RootShell.quote(File(cacheDir, asset).absolutePath))
                append(" ").append(RootShell.quote(dest))
                append(" && chmod 755 ").append(RootShell.quote(dest))
            }
            append(" && echo installed")
        }
        val result = RootShell.exec(cmd, 60)
        return if (result.ok) {
            Result(true, "守护脚本已安装到 $DIR，开机自启已写入 $SERVICE_D_DIR/remoteagent.sh")
        } else {
            Result(false, "安装失败：${result.stderr.ifBlank { result.stdout }.take(300)}")
        }
    }

    /** 手动启动 guard.sh（先确保脚本已安装） */
    fun startGuard(context: Context): Result {
        if (!RootShell.isRootAvailable()) {
            return Result(false, "未获得 Root 权限，无法启动守护")
        }
        val installed = install(context)
        if (!installed.ok) return installed
        // 只拉起 guard，daemon 由 guard 负责。
        // 关键：不能用 nohup —— 部分 Android 系统里没有该命令，会静默失败。
        // 改用 subshell + 忽略 SIGHUP + 全部重定向，保证 su 会话退出后子进程仍存活。
        val result = RootShell.exec(
            "( trap '' HUP; exec sh $GUARD ) >/dev/null 2>&1 < /dev/null & echo started",
            30
        )
        return if (result.ok) {
            Result(true, "守护已启动（guard.sh → daemon.sh，每 5 秒巡检一次）")
        } else {
            Result(false, "启动守护失败：${result.stderr.ifBlank { result.stdout }.take(300)}")
        }
    }

    /** 停止 guard 与 daemon（通过 pidfile，避免误杀） */
    fun stopDaemon(): Result {
        if (!RootShell.isRootAvailable()) {
            return Result(false, "未获得 Root 权限")
        }
        // 按 pidfile 停止，但必须校验 /proc/<pid>/cmdline 确实是本脚本，
        // 否则 pid 被系统复用后会误杀无关进程。
        val cmd = "for f in guard daemon; do " +
            "p=\$(tr -d ' \\n' < $DIR/\$f.lock 2>/dev/null); " +
            "if [ -n \"\$p\" ] && grep -q \"\$f.sh\" /proc/\$p/cmdline 2>/dev/null; then kill -9 \"\$p\" 2>/dev/null; fi; " +
            "done; " +
            "rm -f $DIR/guard.lock $DIR/daemon.lock; echo stopped"
        val result = RootShell.exec(cmd, 30)
        return if (result.ok) Result(true, "守护进程已停止") else {
            Result(false, "停止失败：${result.stderr.ifBlank { result.stdout }.take(300)}")
        }
    }

    /** 停止并删除守护脚本（含开机自启） */
    fun uninstall(): Result {
        if (!RootShell.isRootAvailable()) {
            return Result(false, "未获得 Root 权限")
        }
        stopDaemon()
        val cmd = "rm -rf $DIR " +
            "&& rm -f $SERVICE_D_DIR/remoteagent.sh " +
            "&& echo removed"
        val result = RootShell.exec(cmd, 30)
        return if (result.ok) Result(true, "守护脚本已卸载（含开机自启）") else {
            Result(false, "卸载失败：${result.stderr.ifBlank { result.stdout }.take(300)}")
        }
    }
}
