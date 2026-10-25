import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'

// 路由懒加载：每个页面单独分包
const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login.vue'),
    meta: { public: true, title: '登录' }
  },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      {
        path: '',
        name: 'dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '仪表盘', perm: 'dashboard' }
      },
      {
        path: 'devices',
        name: 'devices',
        component: () => import('@/views/Devices.vue'),
        meta: { title: '设备管理', perm: 'devices' }
      },
      {
        path: 'devices/:id',
        name: 'device-detail',
        component: () => import('@/views/DeviceDetail.vue'),
        meta: { title: '设备详情', perm: 'devices', activeMenu: '/devices' }
      },
      {
        // 远程触控（挂在设备下）
        path: 'devices/:id/control',
        name: 'device-control',
        component: () => import('@/views/Control.vue'),
        meta: { title: '远程触控', perm: 'devices', activeMenu: '/devices' }
      },
      {
        // 应用列表（挂在设备下）
        path: 'devices/:id/apps',
        name: 'device-apps',
        component: () => import('@/views/Apps.vue'),
        meta: { title: '应用', perm: 'devices', activeMenu: '/devices' }
      },
      {
        // 相册（挂在设备下）
        path: 'devices/:id/gallery',
        name: 'device-gallery',
        component: () => import('@/views/Gallery.vue'),
        meta: { title: '相册', perm: 'devices', activeMenu: '/devices' }
      },
      {
        // 内置文件管理器（挂在设备下，不占侧边菜单）
        path: 'devices/:id/files',
        name: 'device-files',
        component: () => import('@/views/FileManager.vue'),
        meta: { title: '文件管理', perm: 'devices', activeMenu: '/devices' }
      },
      {
        path: 'projects',
        name: 'projects',
        component: () => import('@/views/Projects.vue'),
        meta: { title: '项目管理', perm: 'devices' }
      },
      {
        path: 'templates',
        name: 'templates',
        component: () => import('@/views/Templates.vue'),
        meta: { title: '命令模板', perm: 'templates' }
      },
      {
        path: 'tasks',
        name: 'tasks',
        component: () => import('@/views/Tasks.vue'),
        meta: { title: '批量任务', perm: 'tasks' }
      },
      {
        path: 'logs',
        name: 'logs',
        component: () => import('@/views/Logs.vue'),
        meta: { title: '操作日志', perm: 'logs' }
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('@/views/Users.vue'),
        meta: { title: '用户管理', perm: 'users' }
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/views/Settings.vue'),
        meta: { title: '系统设置', perm: 'settings' }
      },
      {
        path: '403',
        name: 'forbidden',
        component: () => import('@/views/Forbidden.vue'),
        meta: { title: '无权限' }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFound.vue'),
    meta: { title: '页面不存在' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

// 全局前置守卫：登录校验 + 页面级权限校验
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  const appStore = useAppStore()
  const siteName = appStore.siteName || '远程安卓设备运维平台'
  document.title = to.meta.title ? `${to.meta.title} - ${siteName}` : siteName

  // 公开页面（登录页）
  if (to.meta.public) {
    if (auth.token && to.path === '/login') return auth.homePath
    return true
  }

  // 未登录统一跳登录页，并记录原始目标
  if (!auth.token) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  // 首次进入（刷新页面）时校验 token 是否仍有效
  if (!auth.initialized) {
    try {
      await auth.refreshMe()
    } catch {
      auth.reset()
      return { path: '/login', query: { redirect: to.fullPath } }
    }
  }

  // 无该页面权限 -> 403
  if (to.meta.perm && !auth.hasPerm(to.meta.perm)) {
    return { path: '/403' }
  }

  return true
})

export default router
