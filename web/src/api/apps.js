import request from '@/utils/request'

// 应用列表（在手机上取，很快）
export function fetchApps(deviceId) {
  return request.get(`/apps/${deviceId}/apps`, { timeout: 120000 })
}

// 拉取并缓存某个应用的名称/版本（会从手机拉一次 APK）
export function fetchAppMeta(deviceId, app) {
  return request.get(`/apps/${deviceId}/apps/meta`, {
    params: { pkg: app.package, apk: app.apk, size: app.size },
    timeout: 180000
  })
}

// 图标 PNG（blob，需鉴权头）
export function fetchAppIcon(deviceId, app) {
  return request.get(`/apps/${deviceId}/apps/icon`, {
    params: { pkg: app.package, apk: app.apk, size: app.size },
    responseType: 'blob',
    timeout: 180000
  })
}

// 缓存占用
export function fetchAppsCache(deviceId) {
  return request.get(`/apps/${deviceId}/apps/cache`)
}
