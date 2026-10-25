import request from '@/utils/request'

// 认证相关接口（契约 §1）
export function login(payload) {
  return request.post('/auth/login', payload)
}

export function fetchMe() {
  return request.get('/auth/me')
}

export function logout() {
  return request.post('/auth/logout')
}

export function changePassword(payload) {
  return request.post('/auth/password', payload)
}
