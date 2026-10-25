package com.dsha.remoteagent.root

import java.util.concurrent.TimeUnit

/** root 命令执行结果 */
data class ShellResult(
    val stdout: String,
    val stderr: String,
    val exitCode: Int
) {
    val ok: Boolean get() = exitCode == 0
}

/**
 * Root 执行封装：
 * - `su -c id` 校验 uid=0
 * - 通过 ProcessBuilder 启动 su，stdout / stderr 分别由独立线程读取，避免管道写满死锁
 * - 带超时，超时强制 destroy
 */
object RootShell {

    @Volatile
    private var cachedRoot: Boolean? = null

    @Volatile
    private var cachedAt = 0L

    private const val CACHE_MS = 60_000L

    /** 返回契约里的 rootStatus：granted / denied */
    fun rootStatus(force: Boolean = false): String {
        val now = System.currentTimeMillis()
        val cached = cachedRoot
        if (!force && cached != null && now - cachedAt < CACHE_MS) {
            return if (cached) "granted" else "denied"
        }
        val granted = checkRootNow()
        cachedRoot = granted
        cachedAt = now
        return if (granted) "granted" else "denied"
    }

    fun isRootAvailable(force: Boolean = false): Boolean = rootStatus(force) == "granted"

    private fun checkRootNow(): Boolean {
        return try {
            val result = exec("id", 20)
            result.stdout.contains("uid=0") || result.stderr.contains("uid=0")
        } catch (t: Throwable) {
            false
        }
    }

    /** 以 root 执行 shell 命令，命令字符串原样交给 su -c */
    fun exec(command: String, timeoutSec: Long = 60): ShellResult {
        val process = try {
            ProcessBuilder("su", "-c", command)
                .redirectErrorStream(false)
                .start()
        } catch (t: Throwable) {
            return ShellResult("", "无法执行 su：${t.message}", 127)
        }

        val stdout = StringBuilder()
        val stderr = StringBuilder()

        val outThread = Thread {
            runCatching {
                process.inputStream.bufferedReader().use { reader ->
                    stdout.append(reader.readText())
                }
            }
        }
        val errThread = Thread {
            runCatching {
                process.errorStream.bufferedReader().use { reader ->
                    stderr.append(reader.readText())
                }
            }
        }
        outThread.start()
        errThread.start()

        val finished = try {
            process.waitFor(timeoutSec, TimeUnit.SECONDS)
        } catch (t: InterruptedException) {
            Thread.currentThread().interrupt()
            false
        }

        if (!finished) {
            runCatching { process.destroy() }
            runCatching { process.waitFor(2, TimeUnit.SECONDS) }
            outThread.join(1000)
            errThread.join(1000)
            return ShellResult(
                stdout.toString(),
                stderr.toString().ifBlank { "执行超时（${timeoutSec}s）" },
                -1
            )
        }

        outThread.join(2000)
        errThread.join(2000)
        val code = runCatching { process.exitValue() }.getOrDefault(-1)
        return ShellResult(stdout.toString(), stderr.toString(), code)
    }

    /** POSIX 单引号转义，供拼接到 shell 命令里的路径/参数使用 */
    fun quote(value: String): String = "'" + value.replace("'", "'\\''") + "'"
}
