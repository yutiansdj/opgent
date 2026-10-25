import request from '@/utils/request'

// 公开脚本目录（/app/）：仅超级管理员可管理
export function fetchAppFiles() {
  return request.get('/appfiles')
}

export function fetchAppFile(name) {
  return request.get(`/appfiles/${encodeURIComponent(name)}`)
}

export function saveAppFile(name, content) {
  return request.put(`/appfiles/${encodeURIComponent(name)}`, { content }, { timeout: 30000 })
}

export function deleteAppFile(name) {
  return request.delete(`/appfiles/${encodeURIComponent(name)}`)
}
