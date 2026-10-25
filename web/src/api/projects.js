import request from '@/utils/request'

// 项目列表（普通账号只看自己的）
export function fetchProjects() {
  return request.get('/projects')
}

export function createProject(payload) {
  return request.post('/projects', payload)
}

export function updateProject(id, payload) {
  return request.put(`/projects/${id}`, payload)
}

export function deleteProject(id) {
  return request.delete(`/projects/${id}`)
}

export function resetProjectToken(id) {
  return request.post(`/projects/${id}/reset-token`)
}

// 下载注入脚本（业务脚本 + 末尾对接段）
export function downloadProjectScript(id) {
  return request.get(`/projects/${id}/script`, { responseType: 'blob', timeout: 60000 })
}

// 一键注入到设备
export function injectProject(id, deviceIds) {
  return request.post(`/projects/${id}/inject`, { deviceIds }, { timeout: 180000 })
}
