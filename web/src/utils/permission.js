// 权限相关常量与工具，供路由守卫、菜单、用户表单复用
export const ALL_PERMISSIONS = [
  'dashboard',
  'devices',
  'templates',
  'tasks',
  'logs',
  'users',
  'settings'
]

// 每个权限点对应的默认落地路由
export const PERMISSION_HOME = {
  dashboard: '/',
  devices: '/devices',
  templates: '/templates',
  tasks: '/tasks',
  logs: '/logs',
  users: '/users',
  settings: '/settings'
}

// 根据权限计算登录后落地页：优先仪表盘，否则第一个有权限的页面
export function firstAccessiblePath(permissions = []) {
  for (const key of ALL_PERMISSIONS) {
    if (permissions.includes(key)) return PERMISSION_HOME[key]
  }
  return '/403'
}
