import request from '@/utils/request'

// 全局操作日志（契约 §6）
export function fetchLogs(params) {
  return request.get('/logs', { params })
}

// 导出 CSV：responseType blob
export function exportLogs(params) {
  return request.get('/logs/export', {
    params,
    responseType: 'blob',
    timeout: 120000
  })
}
