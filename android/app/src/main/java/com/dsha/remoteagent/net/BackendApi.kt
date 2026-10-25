package com.dsha.remoteagent.net

import com.dsha.remoteagent.data.AppConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * 后端 HTTP 接口封装（仅 Agent 用到的几个）：
 * - POST /api/devices/register         首次注册
 * - POST /api/files/upload?token=...   agent 主动回传文件
 * - GET  /api/files/:fileId/raw?token= 拉取后端下发的文件
 *
 * 全部为同步调用，调用方需在 IO 线程执行。
 */
object BackendApi {

    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    private val OCTET_MEDIA = "application/octet-stream".toMediaType()

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    data class RegisterResult(val ok: Boolean, val message: String)

    data class UploadResult(val ok: Boolean, val fileId: String?, val message: String)

    data class DownloadResult(val ok: Boolean, val message: String)

    /** 首次注册设备；成功后若后端返回新 token 则回写本地 */
    fun register(config: AppConfig): RegisterResult {
        val base = config.httpBase() ?: return RegisterResult(false, "未配置 WebSocket 地址")
        val payload = JSONObject().apply {
            put("deviceUid", config.deviceUid)
            put("name", config.deviceName)
            put("token", config.deviceToken)
        }
        val request = Request.Builder()
            .url("$base/api/devices/register")
            .post(payload.toString().toRequestBody(JSON_MEDIA))
            .build()
        return runCatching {
            client.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return@use RegisterResult(false, "HTTP ${response.code}: ${text.take(200)}")
                }
                val obj = JSONObject(text)
                if (!obj.optBoolean("ok", false)) {
                    val error = obj.optJSONObject("error")
                    val msg = error?.optString("message").orEmpty().ifBlank { "注册失败" }
                    return@use RegisterResult(false, msg)
                }
                val data = obj.optJSONObject("data") ?: obj
                val token = data.optString("token")
                if (token.startsWith("dt_") && token != config.deviceToken) {
                    config.deviceToken = token
                }
                config.registered = true
                RegisterResult(true, "设备注册成功")
            }
        }.getOrElse { t -> RegisterResult(false, "注册请求异常：${t.message}") }
    }

    /** agent 主动回传文件：multipart 字段名 file */
    fun uploadFile(config: AppConfig, file: File, fileName: String): UploadResult {
        val base = config.httpBase() ?: return UploadResult(false, null, "未配置后端地址")
        if (!file.exists()) return UploadResult(false, null, "文件不存在：${file.absolutePath}")
        val token = URLEncoder.encode(config.deviceToken, "UTF-8")
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, file.asRequestBody(OCTET_MEDIA))
            .build()
        val request = Request.Builder()
            .url("$base/api/files/upload?token=$token")
            .post(body)
            .build()
        return runCatching {
            client.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return@use UploadResult(false, null, "HTTP ${response.code}: ${text.take(200)}")
                }
                val obj = JSONObject(text)
                if (!obj.optBoolean("ok", false)) {
                    val error = obj.optJSONObject("error")
                    val msg = error?.optString("message").orEmpty().ifBlank { "上传失败" }
                    return@use UploadResult(false, null, msg)
                }
                val data = obj.optJSONObject("data") ?: obj
                val fileId = data.optString("fileId").ifBlank { obj.optString("fileId") }
                if (fileId.isBlank()) {
                    UploadResult(false, null, "后端未返回 fileId")
                } else {
                    UploadResult(true, fileId, "上传成功")
                }
            }
        }.getOrElse { t -> UploadResult(false, null, "上传异常：${t.message}") }
    }

    /** 下载后端文件到 dest（覆盖） */
    fun downloadFile(config: AppConfig, fileId: String, dest: File): DownloadResult {
        val base = config.httpBase() ?: return DownloadResult(false, "未配置后端地址")
        if (fileId.isBlank()) return DownloadResult(false, "缺少 fileId")
        val token = URLEncoder.encode(config.deviceToken, "UTF-8")
        val encodedId = URLEncoder.encode(fileId, "UTF-8")
        val request = Request.Builder()
            .url("$base/api/files/$encodedId/raw?token=$token")
            .get()
            .build()
        return runCatching {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    val text = response.body?.string().orEmpty()
                    return@use DownloadResult(false, "HTTP ${response.code}: ${text.take(200)}")
                }
                val body = response.body ?: return@use DownloadResult(false, "响应体为空")
                dest.parentFile?.mkdirs()
                body.byteStream().use { input ->
                    dest.outputStream().use { output -> input.copyTo(output) }
                }
                DownloadResult(true, "下载完成（${dest.length()} 字节）")
            }
        }.getOrElse { t -> DownloadResult(false, "下载异常：${t.message}") }
    }
}
