import { createApp } from 'vue'
import { createPinia } from 'pinia'
import naive from 'naive-ui'
import App from './App.vue'
import router from './router'
import { useAppStore } from './stores/app'
import { fetchSiteInfo } from './api/site'
import './styles/index.css'

const app = createApp(App)
const pinia = createPinia()

// Pinia 必须先于路由安装：路由守卫内会使用 auth store
app.use(pinia)
// 全局注册 NaiveUI 组件，页面中可直接使用 n-xxx
app.use(naive)
app.use(router)

// 拉一次站点名称（公开接口）：保证没登录时登录页也显示「系统设置」里的名字
fetchSiteInfo()
  .then((data) => {
    const name = data?.siteName
    if (!name) return
    useAppStore(pinia).setSiteName(name)
    const cur = router.currentRoute.value
    document.title = cur?.meta?.title ? `${cur.meta.title} - ${name}` : name
  })
  .catch(() => {
    /* 拉不到就用默认名，不影响使用 */
  })

// axios 拦截器在 401 时派发该事件：统一登出并跳转登录页
window.addEventListener('app:unauthorized', () => {
  const current = router.currentRoute.value
  if (current.path === '/login') return
  router.replace({
    path: '/login',
    query: current.fullPath && current.fullPath !== '/' ? { redirect: current.fullPath } : {}
  })
})

// 兜底捕获未处理的渲染错误，避免白屏无提示
app.config.errorHandler = (err, _instance, info) => {
  console.error('[app error]', info, err)
}

app.mount('#app')
