<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// 404 兜底页
const router = useRouter()
const auth = useAuthStore()

function goHome() {
  router.replace(auth.token ? auth.homePath : '/login')
}
</script>

<template>
  <div class="flex min-h-full items-center justify-center p-6">
    <n-result
      status="404"
      title="404 页面不存在"
      description="你访问的页面不存在或已被移除，请检查地址是否正确。"
    >
      <template #footer>
        <div class="flex justify-center gap-2">
          <n-button type="primary" @click="goHome">
            {{ auth.token ? '返回首页' : '前往登录' }}
          </n-button>
          <n-button @click="router.back()">返回上一页</n-button>
        </div>
      </template>
    </n-result>
  </div>
</template>
