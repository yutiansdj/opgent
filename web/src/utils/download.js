import request from './request'
import { filenameFromDisposition } from './format'

// 触发浏览器保存 Blob
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || 'download'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 稍后释放，避免 Safari 下载中断
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// 带鉴权的二进制下载：GET /api/files/:fileId/download 等接口
export async function downloadWithAuth(url, options = {}) {
  const { params = {}, fallbackName = 'download', timeout = 180000 } = options
  const response = await request.get(url, {
    params,
    responseType: 'blob',
    timeout
  })
  const blob = response.data instanceof Blob ? response.data : new Blob([response.data])
  // 若后端以 JSON 形式返回错误（HTTP 200 时不会发生，这里做兜底提示）
  if (blob.type && blob.type.includes('application/json')) {
    const text = await blob.text()
    let message = '下载失败'
    try {
      message = JSON.parse(text)?.error?.message || message
    } catch {
      /* 忽略解析异常 */
    }
    throw new Error(message)
  }
  const disposition = response.headers?.['content-disposition']
  const filename = filenameFromDisposition(disposition, fallbackName)
  saveBlob(blob, filename)
  return filename
}

// 把截图接口返回的 base64（可能带 data:image/png;base64, 前缀）下载为 png
export function downloadBase64Image(base64, filename = 'screenshot.png') {
  if (!base64) return false
  const pure = base64.includes(',') ? base64.split(',')[1] : base64
  const binary = atob(pure)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  saveBlob(new Blob([bytes], { type: 'image/png' }), filename)
  return true
}
