// 本地存储键名集中管理，避免散落的魔法字符串
export const STORAGE_KEYS = {
  token: 'dsha_token',
  user: 'dsha_user',
  dark: 'dsha_dark',
  siteName: 'dsha_site_name',
  apiBase: 'dsha_api_base',
  rememberedUsername: 'dsha_remembered_username'
}

// 读取本地 JWT
export function getToken() {
  return localStorage.getItem(STORAGE_KEYS.token) || ''
}

export function setToken(token) {
  localStorage.setItem(STORAGE_KEYS.token, token)
}

// 读取本地缓存的用户信息（用于刷新页面后立即恢复权限）
export function getCachedUser() {
  const raw = localStorage.getItem(STORAGE_KEYS.user)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function setCachedUser(user) {
  if (!user) {
    localStorage.removeItem(STORAGE_KEYS.user)
    return
  }
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user))
}

// 清除登录态（登出 / 401 时调用）
export function clearAuthStorage() {
  localStorage.removeItem(STORAGE_KEYS.token)
  localStorage.removeItem(STORAGE_KEYS.user)
}

// 运行时配置的 API 基础地址：优先级 localStorage > .env
export function getApiBase() {
  const saved = localStorage.getItem(STORAGE_KEYS.apiBase)
  if (saved !== null) return saved.trim().replace(/\/+$/, '')
  return (import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '')
}

export function setApiBase(base) {
  localStorage.setItem(STORAGE_KEYS.apiBase, (base || '').trim().replace(/\/+$/, ''))
}
