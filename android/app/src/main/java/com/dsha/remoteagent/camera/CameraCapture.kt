package com.dsha.remoteagent.camera

import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.TotalCaptureResult
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * 用 Camera2 抓一张 JPEG（前置/后置），不需要第三方库。
 *
 * 相机 30 秒没拿到图就超时（有的 ROM 在息屏或后台会拒绝开相机）。
 * 注意：这里依赖 App 自己的相机权限，root 帮不上忙，所以必须是 App 版 Agent。
 */
object CameraCapture {

    private const val OPEN_TIMEOUT_MS = 30_000L
    private const val CAPTURE_TIMEOUT_MS = 30_000L

    class CameraException(message: String) : Exception(message)

    /** @param front true=前置 */
    suspend fun captureJpeg(context: Context, front: Boolean): ByteArray =
        suspendCancellableCoroutine { cont ->

            val manager =
                context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
                    ?: return@suspendCancellableCoroutine cont.resumeWithException(
                        CameraException("这台设备没有相机服务")
                    )

            val targetFacing =
                if (front) CameraCharacteristics.LENS_FACING_FRONT
                else CameraCharacteristics.LENS_FACING_BACK

            val cameraId = try {
                manager.cameraIdList.firstOrNull { id ->
                    manager.getCameraCharacteristics(id)
                        .get(CameraCharacteristics.LENS_FACING) == targetFacing
                }
            } catch (e: Exception) {
                null
            } ?: return@suspendCancellableCoroutine cont.resumeWithException(
                CameraException(if (front) "没有找到前置摄像头" else "没有找到后置摄像头")
            )

            val characteristics = manager.getCameraCharacteristics(cameraId)
            val sensorOrientation =
                characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90

            val thread = HandlerThread("camera-capture").also { it.start() }
            val handler = Handler(thread.looper)

            var device: CameraDevice? = null
            var session: CameraCaptureSession? = null
            var reader: ImageReader? = null
            val finished = AtomicBoolean(false)

            fun cleanup() {
                try { session?.close() } catch (_: Exception) {}
                try { device?.close() } catch (_: Exception) {}
                try { reader?.close() } catch (_: Exception) {}
                thread.quitSafely()
            }

            fun finishOk(bytes: ByteArray) {
                if (!finished.compareAndSet(false, true)) return
                cleanup()
                cont.resume(bytes)
            }

            fun finishErr(message: String) {
                if (!finished.compareAndSet(false, true)) return
                cleanup()
                cont.resumeWithException(CameraException(message))
            }

            // 超时兜底：相机被别的 App 占着时会一直不回调
            handler.postDelayed({
                finishErr("相机 30 秒没有响应（可能被其它 App 占用，或系统不允许后台开相机）")
            }, OPEN_TIMEOUT_MS + CAPTURE_TIMEOUT_MS)

            cont.invokeOnCancellation {
                if (finished.compareAndSet(false, true)) cleanup()
            }

            try {
                val best = characteristics.get(
                    CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP
                )?.getOutputSizes(ImageFormat.JPEG)?.maxByOrNull { it.width.toLong() * it.height }
                    ?: android.util.Size(1280, 720)

                // 13MP 已经够清楚，再大上传慢
                val size = characteristics.get(
                    CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP
                )?.getOutputSizes(ImageFormat.JPEG)
                    ?.filter { it.width.toLong() * it.height <= 16_000_000L }
                    ?.maxByOrNull { it.width.toLong() * it.height }
                    ?: best

                reader = ImageReader.newInstance(size.width, size.height, ImageFormat.JPEG, 1)
                reader?.setOnImageAvailableListener({ r ->
                    val image = try { r.acquireNextImage() } catch (e: Exception) { null } ?: return@setOnImageAvailableListener
                    try {
                        val buffer = image.planes[0].buffer
                        val bytes = ByteArray(buffer.remaining())
                        buffer.get(bytes)
                        finishOk(bytes)
                    } catch (e: Exception) {
                        finishErr("读取照片失败：${e.message}")
                    } finally {
                        image.close()
                    }
                }, handler)

                manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                    override fun onOpened(camera: CameraDevice) {
                        device = camera
                        try {
                            camera.createCaptureSession(
                                listOf(reader!!.surface),
                                object : CameraCaptureSession.StateCallback() {
                                    override fun onConfigured(s: CameraCaptureSession) {
                                        session = s
                                        try {
                                            val request = camera.createCaptureRequest(
                                                CameraDevice.TEMPLATE_STILL_CAPTURE
                                            ).apply {
                                                addTarget(reader!!.surface)
                                                set(
                                                    CaptureRequest.CONTROL_AF_MODE,
                                                    CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
                                                )
                                                // 竖屏自然方向：前置传感器一般 270，后置 90
                                                set(
                                                    CaptureRequest.JPEG_ORIENTATION,
                                                    sensorOrientation
                                                )
                                            }.build()
                                            s.capture(
                                                request,
                                                object : CameraCaptureSession.CaptureCallback() {
                                                    override fun onCaptureCompleted(
                                                        s2: CameraCaptureSession,
                                                        req: CaptureRequest,
                                                        result: TotalCaptureResult
                                                    ) { /* 图在 ImageReader 里取 */ }
                                                },
                                                handler
                                            )
                                        } catch (e: Exception) {
                                            finishErr("发起拍照失败：${e.message}")
                                        }
                                    }

                                    override fun onConfigureFailed(s: CameraCaptureSession) {
                                        finishErr("相机会话配置失败（可能被其它 App 占用）")
                                    }
                                },
                                handler
                            )
                        } catch (e: Exception) {
                            finishErr("创建相机会话失败：${e.message}")
                        }
                    }

                    override fun onDisconnected(camera: CameraDevice) {
                        finishErr("相机被系统断开（可能被其它 App 抢走）")
                    }

                    override fun onError(camera: CameraDevice, error: Int) {
                        finishErr("打开相机失败，错误码 $error")
                    }
                }, handler)
            } catch (e: SecurityException) {
                finishErr("没有相机权限：请在手机上打开「远程运维 Agent」App 并允许使用相机")
            } catch (e: Exception) {
                finishErr("打开相机异常：${e.message ?: e.javaClass.simpleName}")
            }
        }
}
