import request from '@/utils/request'

// 批量任务（契约 §5）
export function fetchTasks(params) {
  return request.get('/tasks', { params })
}

export function fetchTask(id) {
  return request.get(`/tasks/${id}`)
}

export function createTask(payload) {
  return request.post('/tasks', payload)
}
