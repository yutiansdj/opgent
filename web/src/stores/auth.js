import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as authApi from '@/api/auth'
import {
  clearAuthStorage,
  getCachedUser,
  getToken,
  setCachedUser,
  setToken
} from '@/utils/auth'
import { ALL_PERMISSIONS, firstAccessiblePath } from '@/utils/permission'

// 登录态 / 当前用户 / 权限判定
export const useAuthStore = defineStore('auth', () => {
  const token = ref(getToken())
  const user = ref(getCachedUser())
  // 是否已通过 /auth/me 校验过登录态（避免每次路由跳转都请求）
  const initialized = ref(false)

  const isSuper = computed(() => user.value?.role === 'super')

  // super 拥有全部权限，其余用户按 permissions 数组
  const permissions = computed(() => {
    const current = user.value
    if (!current) return []
    if (current.role === 'super') return [...ALL_PERMISSIONS]
    return Array.isArray(current.permissions) ? current.permissions : []
  })

  function hasPerm(perm) {
    if (!perm) return true
    return permissions.value.includes(perm)
  }

  // 登录成功后持久化 token 与用户信息
  async function login(credentials) {
    const data = await authApi.login(credentials)
    token.value = data.token
    setToken(data.token)
    user.value = data.user
    setCachedUser(data.user)
    initialized.value = true
    return data
  }

  // 刷新页面后用 /auth/me 校正缓存的用户信息
  async function refreshMe() {
    if (!token.value) return null
    const data = await authApi.fetchMe()
    user.value = data
    setCachedUser(data)
    initialized.value = true
    return data
  }

  // 清空本地登录态（被 401 拦截器或退出登录调用）
  function reset() {
    token.value = ''
    user.value = null
    initialized.value = false
    clearAuthStorage()
  }

  async function logout() {
    try {
      if (token.value) await authApi.logout()
    } catch {
      // 后端登出失败不影响前端清理
    } finally {
      reset()
    }
  }

  async function changePassword(payload) {
    return authApi.changePassword(payload)
  }

  // 登录后默认落地页
  const homePath = computed(() => firstAccessiblePath(permissions.value))

  return {
    token,
    user,
    initialized,
    isSuper,
    permissions,
    homePath,
    hasPerm,
    login,
    logout,
    reset,
    refreshMe,
    changePassword
  }
})
