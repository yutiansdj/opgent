package com.dsha.remoteagent.service

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.util.Base64
import androidx.core.content.ContextCompat
import com.dsha.remoteagent.camera.CameraCapture
import com.dsha.remoteagent.data.AppConfig
import com.dsha.remoteagent.net.BackendApi
import com.dsha.remoteagent.root.RootShell
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/** 单条指令的执行结果，字段与契约 §9 result 对应 */
data class ExecResult(
    val ok: Boolean,
    val stdout: String = "",
    val stderr: String = "",
    val exitCode: Int = 0,
    val image: String? = null,
    val fileId: String? = null
) {
    val status: String get() = if (ok) "success" else "failed"

    companion object {
        fun fail(message: String, exitCode: Int = 1): ExecResult =
            ExecResult(false, "", message, exitCode)
    }
}

/**
 * 远程指令执行器（全部走 root）：
 * screen_on / screen_off / shell / screenshot / open_app / uninstall_app /
 * download（agent 主动上传回后端）
 *
 * reboot / shutdown 由 WebSocket 客户端先回 result 再执行（见 AgentWebSocketClient）。
 */
object CommandExecutor {

    private const val MAX_DOWNLOAD_BYTES = 200L * 1024 * 1024

    suspend fun execute(
        context: Context,
        config: AppConfig,
        cmd: String,
        params: JSONObject
    ): ExecResult = withContext(Dispatchers.IO) {
        when (cmd) {
            "screen_on" -> shellOf(
                RootShell.exec("input keyevent KEYCODE_WAKEUP", 20),
                successMessage = "已点亮屏幕"
            )

            "screen_off" -> shellOf(
                RootShell.exec("input keyevent 223", 20),
                successMessage = "已熄屏"
            )

            "shell" -> {
                val command = params.optString("command")
                if (command.isBlank()) {
                    ExecResult.fail("缺少参数 params.command")
                } else {
                    val result = RootShell.exec(command, 180)
                    shellOf(result, successMessage = "")
                }
            }

            "screenshot" -> screenshot(context)

            "camera" -> camera(context, params)

            "open_app" -> openApp(params)

            "uninstall_app" -> uninstallApp(params)

            "download" -> downloadToBackend(context, config, params)

            else -> ExecResult.fail("不支持的指令：$cmd")
        }
    }

    /** 后端通过 WS 下发 pull_file：下载后写入 targetPath 或安装 APK */
    suspend fun pullFile(
        context: Context,
        config: AppConfig,
        fileId: String,
        targetPath: String,
        mode: String
    ): ExecResult = withContext(Dispatchers.IO) {
        if (fileId.isBlank()) return@withContext ExecResult.fail("缺少 fileId")
        val temp = File(context.cacheDir, "pull_${System.currentTimeMillis()}.bin")
        val download = BackendApi.downloadFile(config, fileId, temp)
        if (!download.ok) {
            temp.delete()
            return@withContext ExecResult.fail(download.message)
        }

        if (mode == "install") {
            if (temp.length() == 0L) {
                temp.delete()
                return@withContext ExecResult.fail("下载文件为空，无法安装")
            }
            val remote = "/data/local/tmp/remoteagent_${System.currentTimeMillis()}.apk"
            val copy = RootShell.exec(
                "cp ${RootShell.quote(temp.absolutePath)} ${RootShell.quote(remote)}" +
                    " && chmod 644 ${RootShell.quote(remote)}",
                120
            )
            if (!copy.ok) {
                temp.delete()
                return@withContext ExecResult(
                    false,
                    copy.stdout,
                    copy.stderr.ifBlank { "复制 APK 到 $remote 失败" },
                    copy.exitCode
                )
            }
            val install = RootShell.exec("pm install -r ${RootShell.quote(remote)}", 300)
            RootShell.exec("rm -f ${RootShell.quote(remote)}", 30)
            temp.delete()
            val ok = install.exitCode == 0 && !install.stdout.contains("Failure")
            return@withContext ExecResult(
                ok,
                install.stdout,
                install.stderr,
                install.exitCode
            )
        }

        // mode = save：写入指定路径
        if (targetPath.isBlank()) {
            temp.delete()
            return@withContext ExecResult.fail("缺少 targetPath")
        }
        if (!targetPath.startsWith("/")) {
            temp.delete()
            return@withContext ExecResult.fail("targetPath 必须是绝对路径：$targetPath")
        }
        if (temp.length() > MAX_DOWNLOAD_BYTES) {
            temp.delete()
            return@withContext ExecResult.fail("文件超过 ${MAX_DOWNLOAD_BYTES / 1024 / 1024}MB，拒绝写入")
        }
        val parent = File(targetPath).parent ?: "/sdcard"
        val copy = RootShell.exec(
            "mkdir -p ${RootShell.quote(parent)}" +
                " && cp ${RootShell.quote(temp.absolutePath)} ${RootShell.quote(targetPath)}" +
                " && chmod 644 ${RootShell.quote(targetPath)}",
            180
        )
        temp.delete()
        return@withContext ExecResult(
            copy.ok,
            copy.stdout.ifBlank { if (copy.ok) "已保存到 $targetPath" else "" },
            copy.stderr,
            copy.exitCode
        )
    }

    // ---------------------------------------------------------------- 子指令

    private fun screenshot(context: Context): ExecResult {
        val file = File(context.cacheDir, "screenshot_${System.currentTimeMillis()}.png")
        val capture = RootShell.exec(
            "screencap -p ${RootShell.quote(file.absolutePath)}",
            40
        )
        if (!capture.ok || !file.exists() || file.length() == 0L) {
            file.delete()
            return ExecResult(
                false,
                capture.stdout,
                capture.stderr.ifBlank { "截图失败（需要 root 权限）" },
                capture.exitCode
            )
        }
        val bytes = file.readBytes()
        file.delete()
        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        return ExecResult(
            ok = true,
            stdout = "截图成功，${bytes.size} 字节",
            stderr = "",
            exitCode = 0,
            image = base64
        )
    }

    /** 远程拍照：前置 / 后置，返回 JPEG 的 base64（与截图同一条回传路径） */
    private suspend fun camera(context: Context, params: JSONObject): ExecResult {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return ExecResult.fail("没有相机权限：请在手机上打开「远程运维 Agent」App，允许使用相机后重试")
        }
        val front = params.optString("facing", "front").lowercase() != "back"
        return try {
            val bytes = CameraCapture.captureJpeg(context, front)
            ExecResult(
                ok = true,
                stdout = "拍照成功（${if (front) "前置" else "后置"}），${bytes.size} 字节",
                stderr = "",
                exitCode = 0,
                // 直接给 data URL：后端只对裸 base64 补 png 前缀，JPEG 得自己标对
                image = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
            )
        } catch (e: Exception) {
            ExecResult.fail("拍照失败：${e.message ?: e.javaClass.simpleName}")
        }
    }

    private fun openApp(params: JSONObject): ExecResult {
        val pkg = params.optString("packageName").ifBlank { params.optString("package") }
        if (pkg.isBlank()) return ExecResult.fail("缺少参数 params.packageName")
        val quoted = RootShell.quote(pkg)

        var result = RootShell.exec(
            "monkey -p $quoted -c android.intent.category.LAUNCHER 1",
            40
        )
        val monkeyFailed = result.exitCode != 0 ||
            result.stdout.contains("No activities found") ||
            result.stdout.contains("aborted") ||
            result.stderr.contains("No activities found")

        if (monkeyFailed) {
            // 兜底：解析入口 Activity 后用 am start 拉起
            val resolve = RootShell.exec("cmd package resolve-activity --brief $quoted", 20)
            val component = resolve.stdout.lineSequence()
                .map { it.trim() }
                .lastOrNull { it.contains("/") && !it.startsWith("priority") }
            if (!component.isNullOrBlank()) {
                result = RootShell.exec("am start -n ${RootShell.quote(component)}", 40)
            } else {
                return ExecResult(
                    false,
                    result.stdout,
                    result.stderr.ifBlank { "未找到应用入口：$pkg" },
                    result.exitCode
                )
            }
        }

        val ok = result.exitCode == 0 &&
            !result.stdout.contains("Error") &&
            !result.stderr.contains("Error")
        return ExecResult(
            ok,
            result.stdout,
            result.stderr,
            result.exitCode
        )
    }

    private fun uninstallApp(params: JSONObject): ExecResult {
        val pkg = params.optString("packageName").ifBlank { params.optString("package") }
        if (pkg.isBlank()) return ExecResult.fail("缺少参数 params.packageName")
        val result = RootShell.exec("pm uninstall ${RootShell.quote(pkg)}", 180)
        val ok = result.exitCode == 0 && !result.stdout.contains("Failure")
        return ExecResult(ok, result.stdout, result.stderr, result.exitCode)
    }

    /**
     * download 指令：root 复制到 app cache → multipart 上传到
     * POST /api/files/upload?token=<deviceToken> → result 带回 fileId。
     */
    private fun downloadToBackend(
        context: Context,
        config: AppConfig,
        params: JSONObject
    ): ExecResult {
        val path = params.optString("path")
        if (path.isBlank()) return ExecResult.fail("缺少参数 params.path")
        if (!path.startsWith("/")) return ExecResult.fail("path 必须是绝对路径：$path")

        val temp = File(context.cacheDir, "upload_${System.currentTimeMillis()}.bin")
        val copy = RootShell.exec(
            "cp ${RootShell.quote(path)} ${RootShell.quote(temp.absolutePath)}" +
                " && chmod 600 ${RootShell.quote(temp.absolutePath)}",
            180
        )
        if (!copy.ok) {
            temp.delete()
            return ExecResult(
                false,
                copy.stdout,
                copy.stderr.ifBlank { "读取文件失败：$path" },
                copy.exitCode
            )
        }
        if (temp.length() > MAX_DOWNLOAD_BYTES) {
            temp.delete()
            return ExecResult.fail("文件超过 ${MAX_DOWNLOAD_BYTES / 1024 / 1024}MB，拒绝上传")
        }

        val name = File(path).name.ifBlank { "file.bin" }
        val size = temp.length()
        val upload = BackendApi.uploadFile(config, temp, name)
        temp.delete()
        return if (upload.ok) {
            ExecResult(
                true,
                "已上传 $name（$size 字节）",
                "",
                0,
                fileId = upload.fileId
            )
        } else {
            ExecResult.fail(upload.message)
        }
    }

    private fun shellOf(result: com.dsha.remoteagent.root.ShellResult, successMessage: String): ExecResult {
        val stdout = if (result.ok && successMessage.isNotBlank() && result.stdout.isBlank()) {
            successMessage
        } else {
            result.stdout
        }
        return ExecResult(result.ok, stdout, result.stderr, result.exitCode)
    }
}
