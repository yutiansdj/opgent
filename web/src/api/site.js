import request from '@/utils/request'

// 公开接口：站点名称（登录页也要用，不要求登录）
export function fetchSiteInfo() {
  return request.get('/site', { timeout: 8000 })
}
