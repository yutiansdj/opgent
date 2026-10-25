<script setup>
import { computed, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { STORAGE_KEYS } from '@/utils/auth'
import { passwordRule, requiredRule } from '@/utils/validate'
import AppIcon from '@/components/AppIcon.vue'

const router = useRouter()
const route = useRoute()
const message = useMessage()
const auth = useAuthStore()
const appStore = useAppStore()

const formRef = ref(null)
const submitting = ref(false)
const errorText = ref('')

const remembered = localStorage.getItem(STORAGE_KEYS.rememberedUsername) || ''
const form = ref({
  username: remembered,
  password: ''
})
const remember = ref(Boolean(remembered))

const rules = {
  username: requiredRule('请输入账号'),
  password: passwordRule('请输入密码')
}

const siteName = computed(() => appStore.siteName)

// 登录成功后回到来源页（排除登录页自身），否则进入权限内首页
function resolveRedirect() {
  const target = route.query.redirect
  if (typeof target === 'string' && target.startsWith('/') && !target.startsWith('/login')) {
    return target
  }
  return auth.homePath
}

async function submit() {
  errorText.value = ''
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    await auth.login({
      username: form.value.username.trim(),
      password: form.value.password
    })
    if (remember.value) {
      localStorage.setItem(STORAGE_KEYS.rememberedUsername, form.value.username.trim())
    } else {
      localStorage.removeItem(STORAGE_KEYS.rememberedUsername)
    }
    message.success('登录成功')
    router.replace(resolveRedirect())
  } catch (error) {
    // 契约明确 BAD_CREDENTIALS / ACCOUNT_DISABLED，直接展示后端 message
    errorText.value = error.message || '登录失败，请检查账号密码'
    message.error(errorText.value)
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  // 已登录用户访问登录页由路由守卫处理，这里无需额外逻辑
})
</script>

<template>
  <div
    class="flex min-h-full items-center justify-center p-4"
    :class="appStore.dark ? 'login-bg-dark' : 'login-bg'"
  >
    <div
      class="grid w-full max-w-[900px] overflow-hidden rounded-xl border border-[rgba(128,128,128,0.18)] shadow-sm md:grid-cols-2"
      :class="appStore.dark ? 'bg-[#18181c]' : 'bg-white'"
    >
      <!-- 左侧品牌介绍（小屏隐藏） -->
      <div class="hidden flex-col justify-between bg-[#0f172a] p-8 text-white md:flex">
        <div>
          <div class="flex items-center gap-2">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-bold">
              A
            </div>
            <span class="text-lg font-semibold">{{ siteName }}</span>
          </div>
          <p class="mt-6 text-sm leading-relaxed opacity-70">
            统一管理远程安卓设备：实时在线状态、远程指令、批量任务与操作审计，一个后台全部搞定。
          </p>
        </div>
        <ul class="mt-8 space-y-3 text-sm opacity-80">
          <li class="flex items-center gap-2">
            <AppIcon name="devices" :size="16" /> 设备在线监控与远程控制
          </li>
          <li class="flex items-center gap-2">
            <AppIcon name="tasks" :size="16" /> 命令模板与批量下发
          </li>
          <li class="flex items-center gap-2">
            <AppIcon name="logs" :size="16" /> 全量操作日志与审计导出
          </li>
        </ul>
        <div class="text-xs opacity-40">{{ siteName }} · Web 管理后台</div>
      </div>

      <!-- 右侧登录表单 -->
      <div class="p-6 sm:p-8">
        <div class="mb-6 flex items-center justify-between">
          <div>
            <h1
              class="m-0 text-xl font-semibold"
              :class="appStore.dark ? 'text-white' : 'text-[#1f2937]'"
            >
              管理员登录
            </h1>
            <p class="mt-1 text-xs" :class="appStore.dark ? 'text-[#a3a3a3]' : 'text-[#6b7280]'">
              请输入账号密码访问运维后台
            </p>
          </div>
          <n-button quaternary circle aria-label="切换深浅色" @click="appStore.toggleDark()">
            <template #icon>
              <AppIcon :name="appStore.dark ? 'sun' : 'moon'" :size="18" />
            </template>
          </n-button>
        </div>

        <n-alert v-if="errorText" type="error" :bordered="false" class="mb-4" closable @close="errorText = ''">
          {{ errorText }}
        </n-alert>

        <n-form ref="formRef" :model="form" :rules="rules" label-placement="top" size="large">
          <n-form-item label="账号" path="username">
            <n-input
              v-model:value="form.username"
              placeholder="请输入管理员账号"
              autocomplete="username"
              :input-props="{ autocomplete: 'username' }"
            />
          </n-form-item>
          <n-form-item label="密码" path="password">
            <n-input
              v-model:value="form.password"
              type="password"
              show-password-on="click"
              placeholder="请输入密码"
              :input-props="{ autocomplete: 'current-password' }"
              @keyup.enter="submit"
            />
          </n-form-item>
          <div class="mb-4 flex items-center justify-between">
            <n-checkbox v-model:checked="remember">记住账号</n-checkbox>
            <span class="text-xs" :class="appStore.dark ? 'text-[#8a8a8a]' : 'text-[#9ca3af]'">
              登录状态将自动保持
            </span>
          </div>
          <n-button type="primary" block size="large" :loading="submitting" @click="submit">
            登录
          </n-button>
        </n-form>

        <p class="mt-6 text-center text-[11px]" :class="appStore.dark ? 'text-[#8a8a8a]' : 'text-[#9ca3af]'">
          账号由超级管理员在「用户管理」中分配
        </p>
      </div>
    </div>
  </div>
</template>
