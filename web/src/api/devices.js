import request from '@/utils/request'

// 设备列表（契约 §3）
export function fetchDevices(params) {
  return request.get('/devices', { params })
}

export function fetchDevice(id) {
  return request.get(`/devices/${id}`)
}

// 仅允许改 name / note
export function updateDevice(id, payload) {
  return request.patch(`/devices/${id}`, payload)
}

export function deleteDevice(id) {
  return request.delete(`/devices/${id}`)
}

// 下发指令，同步等待 agent 结果（后端最长 35s，这里放宽到 45s）
export function runCommand(id, type, params = {}, opts = {}) {
  return request.post(
    `/devices/${id}/command`,
    { type, params },
    { timeout: opts.timeout || 45000 }
  )
}

// 上传文件到手机：multipart/form-data，字段 file + targetPath
export function uploadFileToDevice(id, file, targetPath, onUploadProgress) {
  const form = new FormData()
  form.append('file', file)
  form.append('targetPath', targetPath)
  return request.post(`/devices/${id}/upload`, form, {
    timeout: 180000,
    onUploadProgress
  })
}

// 安装 APK：multipart/form-data，字段 file
export function installApk(id, file, onUploadProgress) {
  const form = new FormData()
  form.append('file', file)
  return request.post(`/devices/${id}/install_apk`, form, {
    timeout: 300000,
    onUploadProgress
  })
}

// 从手机下载：先取 fileId，再走 /files/:fileId/download
export function requestDeviceDownload(id, path) {
  return request.get(`/devices/${id}/download`, { params: { path } })
}

// 设备指令历史日志（结构同全局日志）
export function fetchDeviceLogs(id, params) {
  return request.get(`/devices/${id}/logs`, { params })
}

/* ---------------- 文件管理（内置文件管理器） ---------------- */

// 列目录
export function fetchFsList(id, path) {
  return request.get(`/devices/${id}/fs/list`, { params: { path } })
}

// 新建文件夹
export function fsMkdir(id, path) {
  return request.post(`/devices/${id}/fs/mkdir`, { path })
}

// 新建文件（可带初始内容）
export function fsTouch(id, path, content = '') {
  return request.post(`/devices/${id}/fs/touch`, { path, content })
}

// 重命名 / 移动
export function fsRename(id, from, to) {
  return request.post(`/devices/${id}/fs/rename`, { from, to })
}

// 删除（目录会递归删除）
export function fsDelete(id, path) {
  return request.post(`/devices/${id}/fs/delete`, { path })
}

// 读取文本文件
export function fsRead(id, path) {
  return request.get(`/devices/${id}/fs/read`, { params: { path } })
}

// 系统自检（am/pm 是否可用）
export function runDeviceDiag(id) {
  return request.get(`/devices/${id}/diag`, { timeout: 60000 })
}

/* ---------------- 设备共享 ---------------- */

// 可共享的账号
export function fetchShareCandidates() {
  return request.get('/devices/share/candidates')
}

// 该设备的共享列表
export function fetchDeviceShares(id) {
  return request.get(`/devices/${id}/shares`)
}

// 添加/更新共享（level: view | control）
export function addDeviceShare(id, username, level) {
  return request.post(`/devices/${id}/shares`, { username, level })
}

// 取消共享
export function removeDeviceShare(id, userId) {
  return request.delete(`/devices/${id}/shares/${userId}`)
}
