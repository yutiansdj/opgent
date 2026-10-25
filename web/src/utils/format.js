// 通用格式化 / 字典工具

// ISO 时间 -> 本地可读时间；空值返回占位符
export function formatDateTime(value, fallback = '—') {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// 只保留日期
export function formatDate(value, fallback = '—') {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// 将 NaiveUI 日期选择器的值转成契约要求的 YYYY-MM-DD
export function toDateOnly(timestamp) {
  if (!timestamp) return ''
  return formatDate(timestamp, '')
}

// 指令类型中文名
export const COMMAND_LABELS = {
  screen_on: '点亮屏幕',
  screen_off: '熄屏',
  reboot: '重启',
  shutdown: '关机',
  shell: 'Shell 命令',
  screenshot: '截图',
  open_app: '打开应用',
  uninstall_app: '卸载应用'
}

export function commandLabel(type) {
  return COMMAND_LABELS[type] || type || '—'
}

// 执行状态 -> NaiveUI tag 类型
export function statusTagType(status) {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
      return 'error'
    case 'timeout':
      return 'warning'
    case 'running':
      return 'info'
    case 'pending':
    case 'done':
      return 'default'
    default:
      return 'default'
  }
}

export function statusLabel(status) {
  switch (status) {
    case 'success':
      return '成功'
    case 'failed':
      return '失败'
    case 'timeout':
      return '超时'
    case 'running':
      return '执行中'
    case 'pending':
      return '等待中'
    case 'done':
      return '已完成'
    default:
      return status || '—'
  }
}

// 权限点中文名
export const PERMISSION_OPTIONS = [
  { label: '仪表盘', value: 'dashboard' },
  { label: '设备管理', value: 'devices' },
  { label: '命令模板', value: 'templates' },
  { label: '批量任务', value: 'tasks' },
  { label: '操作日志', value: 'logs' },
  // users / settings 是超管专属，不出现在运维账号的可选权限里
]

export function permissionLabel(key) {
  return PERMISSION_OPTIONS.find((item) => item.value === key)?.label || key
}

// 从 Content-Disposition 中解析文件名
export function filenameFromDisposition(disposition, fallback = 'download') {
  if (!disposition) return fallback
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  return match ? match[1] : fallback
}
