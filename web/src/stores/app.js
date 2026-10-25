import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { STORAGE_KEYS } from '@/utils/auth'

// 全局 UI 状态：深浅色、侧边栏折叠、站点名称
export const useAppStore = defineStore('app', () => {
  const dark = ref(localStorage.getItem(STORAGE_KEYS.dark) === '1')
  // 初始折叠状态：移动端由布局层接管抽屉，这里只记录桌面端折叠
  const collapsed = ref(localStorage.getItem('dsha_sidebar_collapsed') === '1')
  const siteName = ref(
    localStorage.getItem(STORAGE_KEYS.siteName) ||
      import.meta.env.VITE_SITE_NAME ||
      '远程安卓设备运维平台'
  )

  // 持久化（除折叠状态外都需要跨刷新保留）
  watch(dark, (value) => localStorage.setItem(STORAGE_KEYS.dark, value ? '1' : '0'))
  watch(collapsed, (value) =>
    localStorage.setItem('dsha_sidebar_collapsed', value ? '1' : '0')
  )
  watch(siteName, (value) => localStorage.setItem(STORAGE_KEYS.siteName, value))

  function toggleDark() {
    dark.value = !dark.value
  }

  function toggleCollapsed() {
    collapsed.value = !collapsed.value
  }

  function setSiteName(name) {
    if (name) siteName.value = name
  }

  return { dark, collapsed, siteName, toggleDark, toggleCollapsed, setSiteName }
})
