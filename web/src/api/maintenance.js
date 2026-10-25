import request from '@/utils/request'

// 缓存占用
export function fetchCacheUsage() {
  return request.get('/maintenance')
}

// 清理缓存：type = photos | uploads | icons | all；days<=0 表示全清
export function cleanCache(type = 'all', days = 7) {
  return request.post('/maintenance/clean', { type, days }, { timeout: 120000 })
}
