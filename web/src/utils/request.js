import axios from 'axios'
import { getToken, getApiBase } from './auth'

// 统一的 axios 实例。baseURL 在请求拦截器里按运行时配置动态拼装，
// 这样「系统设置」里修改后端地址后无需刷新页面即可生效。
const service = axios.create({
  timeout: 60000
})

// 是否已派发过 401 事件，避免并发请求触发多次跳转
let unauthorizedNotified = false

// 把后端返回的错误对象转成 Error，并挂上 code/status，方便页面按错误码处理
function normalizeError(error, status) {
  const err = new Error(error?.message || '请求失败')
  err.code = error?.code || 'UNKNOWN'
  err.status = status
  return err
}

service.interceptors.request.use((config) => {
  // 允许调用方传 apiBase:false 来请求非 /api 路径
  const base = getApiBase()
  config.baseURL = `${base}/api`
  const token = getToken()
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

service.interceptors.response.use(
  (response) => {
    // 二进制下载（blob）直接返回原始响应，由调用方处理文件名
    if (response.config.responseType === 'blob') return response

    const body = response.data
    // 契约：成功 {"ok":true,"data":...}
    if (body && typeof body === 'object' && 'ok' in body) {
      if (body.ok) return body.data
      return Promise.reject(normalizeError(body.error, response.status))
    }
    // 非契约结构（例如某些静态资源）原样返回
    return body
  },
  async (error) => {
    const status = error.response?.status
    let payload = error.response?.data

    // blob 请求失败时后端返回的是 JSON blob，需要解析出错误信息
    if (payload instanceof Blob) {
      try {
        payload = JSON.parse(await payload.text())
      } catch {
        payload = null
      }
    }

    if (status === 401) {
      // 401 统一登出：清空本地登录态，派发事件由入口跳转登录页
      localStorage.removeItem('dsha_token')
      localStorage.removeItem('dsha_user')
      if (!unauthorizedNotified) {
        unauthorizedNotified = true
        window.dispatchEvent(new CustomEvent('app:unauthorized'))
        setTimeout(() => {
          unauthorizedNotified = false
        }, 1000)
      }
    }

    const body = payload && typeof payload === 'object' && 'ok' in payload ? payload : null
    if (body && body.ok === false) {
      return Promise.reject(normalizeError(body.error, status))
    }

    let message = payload?.message
    if (!message) {
      if (error.code === 'ECONNABORTED') message = '请求超时，请稍后重试'
      else if (!error.response) message = '网络异常，无法连接后端服务'
      else message = `请求失败（HTTP ${status}）`
    }
    const err = new Error(message)
    err.code = payload?.code || 'NETWORK_ERROR'
    err.status = status
    return Promise.reject(err)
  }
)

export default service
