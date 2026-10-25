import request from '@/utils/request'

// 命令模板（契约 §4）
export function fetchTemplates() {
  return request.get('/templates')
}

export function createTemplate(payload) {
  return request.post('/templates', payload)
}

export function updateTemplate(id, payload) {
  return request.put(`/templates/${id}`, payload)
}

export function deleteTemplate(id) {
  return request.delete(`/templates/${id}`)
}

// 模板一键下发（后端会创建批量任务）
export function runTemplate(id, deviceIds) {
  return request.post(`/templates/${id}/run`, { deviceIds })
}
