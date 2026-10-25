import request from '@/utils/request'

// 用户管理（仅 super，契约 §7）
export function fetchUsers() {
  return request.get('/users')
}

export function createUser(payload) {
  return request.post('/users', payload)
}

export function updateUser(id, payload) {
  return request.put(`/users/${id}`, payload)
}

export function deleteUser(id) {
  return request.delete(`/users/${id}`)
}
