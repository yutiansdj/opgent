import { ref, onMounted, onBeforeUnmount } from 'vue'

// 响应式断点：<768px 视为移动端（与需求一致）
export function useIsMobile() {
  const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth < 768 : false)
  const update = () => {
    isMobile.value = window.innerWidth < 768
  }
  onMounted(() => window.addEventListener('resize', update))
  onBeforeUnmount(() => window.removeEventListener('resize', update))
  return isMobile
}
