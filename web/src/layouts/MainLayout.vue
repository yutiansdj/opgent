<script setup>
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import { NIcon, useMessage } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useIsMobile } from '@/composables/useIsMobile'
import { fetchOverview } from '@/api/dashboard'
import { formatDateTime, statusTagType } from '@/utils/format'
import { passwordRule, requiredRule } from '@/utils/validate'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const auth = useAuthStore()
const appStore = useAppStore()
const isMobile = useIsMobile()

// 移动端抽屉开关
const drawerVisible = ref(false)

// ------- 侧边菜单（分组 + 按权限过滤） -------
function renderIcon(name) {
  return () => h(NIcon, null, { default: () => h(AppIcon, { name }) })
}

const menuGroups = computed(() => [
  {
    key: 'overview',
    label: '概览',
    items: [{ key: '/', label: '仪表盘', icon: 'dashboard', perm: 'dashboard' }]
  },
  {
    key: 'ops',
    label: '运维管理',
    items: [
      { key: '/devices', label: '设备管理', icon: 'devices', perm: 'devices' },
      { key: '/projects', label: '项目管理', icon: 'tasks', perm: 'devices' },
      { key: '/templates', label: '命令模板', icon: 'templates', perm: 'templates' },
      { key: '/tasks', label: '批量任务', icon: 'tasks', perm: 'tasks' }
    ]
  },
  {
    key: 'system',
    label: '系统',
    items: [
      { key: '/logs', label: '操作日志', icon: 'logs', perm: 'logs' },
      { key: '/users', label: '用户管理', icon: 'users', perm: 'users' },
      { key: '/settings', label: '系统设置', icon: 'settings', perm: 'settings' }
    ]
  }
])

const menuOptions = computed(() => {
  const groups = menuGroups.value
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => auth.hasPerm(item.perm))
    }))
    .filter((group) => group.items.length > 0)

  const toOption = (item) => ({
    key: item.key,
    label: item.label,
    icon: renderIcon(item.icon)
  })

  // 折叠状态下拍平分组，只留图标
  if (!isMobile.value && appStore.collapsed) {
    return groups.flatMap((group) => group.items.map(toOption))
  }

  return groups.map((group) => ({
    type: 'group',
    key: `group-${group.key}`,
    label: group.label,
    children: group.items.map(toOption)
  }))
})

const activeKey = computed(() => route.meta.activeMenu || route.path)

function handleMenuSelect(key) {
  if (key !== route.path) router.push(key)
  drawerVisible.value = false
}

// ------- 全局消息通知（取仪表盘最近日志，真实接口数据） -------
const overview = ref(null)
const notifyLoading = ref(false)
let notifyTimer = null

async function loadNotifications() {
  // 无仪表盘权限时不请求该接口，避免无谓的 403
  if (!auth.hasPerm('dashboard')) return
  notifyLoading.value = true
  try {
    overview.value = await fetchOverview()
  } catch (error) {
    // 通知属于辅助信息，失败不打断主流程，保留上一次数据
    console.warn('加载通知失败：', error.message)
  } finally {
    notifyLoading.value = false
  }
}

const recentLogs = computed(() => overview.value?.recentLogs || [])
const failedCount = computed(
  () => recentLogs.value.filter((item) => item.status === 'failed').length
)

function goLogs() {
  if (auth.hasPerm('logs')) router.push('/logs')
}

onMounted(() => {
  loadNotifications()
  // 每 60 秒刷新一次通知
  notifyTimer = window.setInterval(loadNotifications, 60000)
})

onBeforeUnmount(() => {
  if (notifyTimer) window.clearInterval(notifyTimer)
})

// ------- 头像下拉：修改密码 / 退出登录 -------
const dropdownOptions = [
  { label: '修改密码', key: 'password', icon: () => h(NIcon, null, { default: () => h(AppIcon, { name: 'key' }) }) },
  { type: 'divider', key: 'divider' },
  { label: '退出登录', key: 'logout', icon: () => h(NIcon, null, { default: () => h(AppIcon, { name: 'logout' }) }) }
]

const avatarText = computed(() => (auth.user?.username || 'A').slice(0, 1).toUpperCase())
const roleLabel = computed(() => (auth.user?.role === 'super' ? '超级管理员' : '运维人员'))

async function handleDropdown(key) {
  if (key === 'password') {
    passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
    passwordVisible.value = true
    return
  }
  if (key === 'logout') {
    await auth.logout()
    message.success('已退出登录')
    router.replace('/login')
  }
}

// ------- 修改密码弹窗 -------
const passwordVisible = ref(false)
const passwordSubmitting = ref(false)
const passwordFormRef = ref(null)
const passwordForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })

const passwordRules = {
  oldPassword: requiredRule('请输入原密码'),
  newPassword: passwordRule(),
  confirmPassword: [
    requiredRule('请再次输入新密码'),
    {
      validator: (_rule, value) => {
        if (value !== passwordForm.value.newPassword) return new Error('两次输入的密码不一致')
        return true
      },
      trigger: ['input', 'blur']
    }
  ]
}

async function submitPassword() {
  try {
    await passwordFormRef.value?.validate()
  } catch {
    return
  }
  passwordSubmitting.value = true
  try {
    await auth.changePassword({
      oldPassword: passwordForm.value.oldPassword,
      newPassword: passwordForm.value.newPassword
    })
    message.success('密码修改成功')
    passwordVisible.value = false
  } catch (error) {
    message.error(error.message || '密码修改失败')
  } finally {
    passwordSubmitting.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶部导航栏 -->
    <header
      class="flex h-14 flex-none items-center gap-2 border-b border-[rgba(128,128,128,0.16)] px-3 sm:px-4"
    >
      <!-- 移动端汉堡按钮 / 桌面端折叠按钮 -->
      <n-button
        quaternary
        circle
        :aria-label="isMobile ? '打开菜单' : '折叠菜单'"
        @click="isMobile ? (drawerVisible = true) : appStore.toggleCollapsed()"
      >
        <template #icon>
          <AppIcon name="menu" :size="20" />
        </template>
      </n-button>

      <!-- 系统名称 -->
      <div class="flex min-w-0 items-center gap-2">
        <div
          class="hidden h-8 w-8 flex-none items-center justify-center rounded-md bg-primary text-sm font-bold text-white sm:flex"
        >
          A
        </div>
        <span class="truncate text-base font-semibold">{{ appStore.siteName }}</span>
      </div>

      <div class="flex-1" />

      <!-- 全局消息通知 -->
      <n-popover trigger="click" placement="bottom-end" :width="340">
        <template #trigger>
          <n-badge :value="recentLogs.length" :max="99" :show="recentLogs.length > 0" :offset="[-2, 2]">
            <n-button quaternary circle aria-label="消息通知">
              <template #icon>
                <AppIcon name="bell" :size="19" />
              </template>
            </n-button>
          </n-badge>
        </template>
        <div class="w-[300px] overflow-hidden">
          <div
            class="flex items-center justify-between border-b border-[rgba(128,128,128,0.15)] px-4 py-3"
          >
            <span class="text-sm font-semibold">最近动态</span>
            <n-tag v-if="failedCount" type="error" size="small" round>{{ failedCount }} 条失败</n-tag>
          </div>
          <n-spin :show="notifyLoading && !recentLogs.length">
            <div v-if="recentLogs.length" class="max-h-[320px] overflow-y-auto">
              <div
                v-for="item in recentLogs"
                :key="item.id"
                class="border-b border-[rgba(128,128,128,0.1)] px-4 py-2.5 last:border-b-0"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-[13px] font-medium">{{ item.command || '—' }}</span>
                  <n-tag :type="statusTagType(item.status)" size="small" :bordered="false">
                    {{ item.status === 'success' ? '成功' : item.status === 'failed' ? '失败' : '超时' }}
                  </n-tag>
                </div>
                <div class="mt-1 flex items-center justify-between text-[11px] opacity-55">
                  <span class="truncate">{{ item.username }} · {{ item.deviceName }}</span>
                  <span class="flex-none">{{ formatDateTime(item.createdAt) }}</span>
                </div>
              </div>
            </div>
            <div v-else class="px-4 py-8 text-center text-xs opacity-55">暂无新消息</div>
          </n-spin>
          <div
            v-if="auth.hasPerm('logs')"
            class="cursor-pointer px-4 py-2.5 text-center text-xs text-primary hover:opacity-80"
            @click="goLogs"
          >
            查看全部操作日志
          </div>
        </div>
      </n-popover>

      <!-- 深浅色切换 -->
      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button quaternary circle aria-label="切换深浅色" @click="appStore.toggleDark()">
            <template #icon>
              <AppIcon :name="appStore.dark ? 'sun' : 'moon'" :size="19" />
            </template>
          </n-button>
        </template>
        {{ appStore.dark ? '切换到浅色' : '切换到深色' }}
      </n-tooltip>

      <!-- 管理员头像下拉 -->
      <n-dropdown :options="dropdownOptions" trigger="click" @select="handleDropdown">
        <div class="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[rgba(128,128,128,0.1)]">
          <n-avatar round size="small" class="bg-primary text-xs font-semibold">
            {{ avatarText }}
          </n-avatar>
          <div class="hidden leading-tight sm:block">
            <div class="text-[13px] font-medium">{{ auth.user?.username || '未登录' }}</div>
            <div class="text-[11px] opacity-55">{{ roleLabel }}</div>
          </div>
        </div>
      </n-dropdown>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- 桌面端侧边栏（可折叠） -->
      <n-layout-sider
        v-if="!isMobile"
        bordered
        collapse-mode="width"
        :width="220"
        :collapsed-width="64"
        :collapsed="appStore.collapsed"
        :native-scrollbar="false"
        show-trigger
        @collapse="appStore.collapsed = true"
        @expand="appStore.collapsed = false"
      >
        <div class="py-2">
          <n-menu
            :value="activeKey"
            :options="menuOptions"
            :collapsed="appStore.collapsed"
            :collapsed-width="64"
            :collapsed-icon-size="20"
            :indent="20"
            @update:value="handleMenuSelect"
          />
        </div>
      </n-layout-sider>

      <!-- 主内容区 -->
      <main class="min-w-0 flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-[1600px] p-3 sm:p-5">
          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </div>
      </main>
    </div>

    <!-- 移动端抽屉菜单 -->
    <n-drawer v-model:show="drawerVisible" placement="left" :width="250">
      <n-drawer-content :native-scrollbar="false" closable>
        <template #header>
          <div class="flex items-center gap-2">
            <div class="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-white">
              A
            </div>
            <span class="text-sm font-semibold">{{ appStore.siteName }}</span>
          </div>
        </template>
        <n-menu
          :value="activeKey"
          :options="menuOptions"
          :indent="20"
          @update:value="handleMenuSelect"
        />
      </n-drawer-content>
    </n-drawer>

    <!-- 修改密码弹窗 -->
    <n-modal
      v-model:show="passwordVisible"
      preset="card"
      title="修改密码"
      class="w-[92vw] max-w-[440px]"
      :mask-closable="false"
      @after-enter="() => passwordFormRef?.restoreValidation()"
    >
      <n-form
        ref="passwordFormRef"
        :model="passwordForm"
        :rules="passwordRules"
        label-placement="top"
        require-mark-placement="right-hanging"
      >
        <n-form-item label="原密码" path="oldPassword">
          <n-input
            v-model:value="passwordForm.oldPassword"
            type="password"
            show-password-on="click"
            placeholder="请输入原密码"
          />
        </n-form-item>
        <n-form-item label="新密码" path="newPassword">
          <n-input
            v-model:value="passwordForm.newPassword"
            type="password"
            show-password-on="click"
            placeholder="至少 6 位"
          />
        </n-form-item>
        <n-form-item label="确认新密码" path="confirmPassword">
          <n-input
            v-model:value="passwordForm.confirmPassword"
            type="password"
            show-password-on="click"
            placeholder="请再次输入新密码"
            @keyup.enter="submitPassword"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="passwordVisible = false">取消</n-button>
          <n-button type="primary" :loading="passwordSubmitting" @click="submitPassword">
            确认修改
          </n-button>
        </div>
      </template>
    </n-modal>

    <!-- 供各页面使用的全局提示入口（保持 useMessage 上下文） -->
    <n-back-top :right="24" :bottom="24" />
  </div>
</template>
