import request from '@/utils/request'

// 相册列表（按修改时间倒序，服务端分页）
export function fetchGallery(deviceId, params) {
  return request.get(`/gallery/${deviceId}/gallery`, { params, timeout: 60000 })
}

// 常见相册目录
export function fetchGalleryDirs(deviceId) {
  return request.get(`/gallery/${deviceId}/gallery/dirs`)
}

// 缩略图（blob，需要带鉴权头，所以不能用 <img src>）
export function fetchThumb(deviceId, item, w = 360) {
  return request.get(`/gallery/${deviceId}/thumb`, {
    params: { path: item.path, size: item.size, mtime: item.mtime, w },
    responseType: 'blob',
    timeout: 120000
  })
}

// 原图
export function fetchPhoto(deviceId, item) {
  return request.get(`/gallery/${deviceId}/photo`, {
    params: { path: item.path, size: item.size, mtime: item.mtime },
    responseType: 'blob',
    timeout: 180000
  })
}
