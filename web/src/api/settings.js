import request from '@/utils/request'

// 系统设置（契约 §8）
export function fetchSettings() {
  return request.get('/settings')
}

// 允许只传变更项
export function updateSettings(payload) {
  return request.put('/settings', payload)
}
