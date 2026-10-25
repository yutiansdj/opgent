<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// 403 无权限页（登录后在主布局内展示）
const router = useRouter()
const auth = useAuthStore()

function goHome() {
  // 无任何页面权限时回登录页，避免在 403 上循环
  router.replace(auth.homePath === '/403' ? '/login' : auth.homePath)
}
</script>

<template>
  <div class="flex min-h-[60vh] items-center justify-center">
    <n-result status="403" title="403 无访问权限" description="当前账号没有该页面的访问权限，请联系超级管理员分配。">
      <template #footer>
        <div class="flex justify-center gap-2">
          <n-button type="primary" @click="goHome">返回首页</n-button>
          <n-button @click="router.back()">返回上一页</n-button>
        </div>
      </template>
    </n-result>
  </div>
</template>
