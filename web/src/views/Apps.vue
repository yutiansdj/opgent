<script setup>
/**
 * 应用管理：查看手机上安装的应用
 *
 * 列表在手机侧取（pm list packages -f，秒出）；
 * 应用名和图标需要解析 APK，所以按需「拉一次 APK → 解析 → 缓存」，
 * 同一版本只拉一次，之后走服务器缓存。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { fetchDevice, runCommand } from '@/api/devices'
import { fetchApps, fetchAppMeta, fetchAppIcon, fetchAppsCache } from '@/api/apps'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const deviceId = route.params.id
const device = ref(null)
const loading = ref(false)
const apps = ref([])
const keyword = ref('')

// 图标/名称加载状态
const icons = ref({})
const iconFailed = ref({})
const iconLoading = ref({})
const autoLoadIcon = ref(true)
const showPath = ref(false)
const cacheInfo = ref(null)

const objectUrls = new Set()

const isOffline = computed(() => device.value && device.value.online === false)
const readOnly = computed(() => device.value && device.value.canControl === false)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return apps.value
  return apps.value.filter(
    (a) =>
      (a.label || '').toLowerCase().includes(kw) ||
      a.package.toLowerCase().includes(kw) ||
      (a.apk || '').toLowerCase().includes(kw)
  )
})

const loadedCount = computed(() => apps.value.filter((a) => a.hasIcon).length)

function track(url) {
  if (url) objectUrls.add(url)
  return url
}

function revokeAll() {
  for (const u of objectUrls) URL.revokeObjectURL(u)
  objectUrls.clear()
}

/** 没有可用图标时：按包名生成稳定的颜色 + 首字母 */
function avatarColor(pkg) {
  let h = 0
  for (let i = 0; i < pkg.length; i += 1) h = (h * 31 + pkg.charCodeAt(i)) % 360
  return `hsl(${h} 55% 52%)`
}

function avatarLetter(app) {
  const text = (app.label || app.package || '?').trim()
  return text.slice(0, 1).toUpperCase()
}

async function copyPath(app) {
  try {
    await navigator.clipboard.writeText(app.apk || '')
    message.success('路径已复制')
  } catch {
    message.warning('浏览器不允许复制，请手动选中')
  }
}

function formatSize(n) {
  const v = Number(n) || 0
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`
  return `${(v / 1024 / 1024).toFixed(1)} MB`
}

async function loadDevice() {
  try {
    device.value = await fetchDevice(deviceId)
  } catch {
    /* ignore */
  }
}

async function loadList() {
  loading.value = true
  icons.value = {}
  iconFailed.value = {}
  revokeAll()
  try {
    const data = await fetchApps(deviceId)
    apps.value = data?.list || []
    loading.value = false
    if (autoLoadIcon.value) loadMetaBatch(apps.value)
  } catch (error) {
    message.error(error.message || '读取应用列表失败')
    apps.value = []
    loading.value = false
  }
}

/** 并发加载名称与图标 */
async function loadMetaBatch(list) {
  const queue = list.filter((a) => !a.hasIcon || !a.label)
  const CONCURRENCY = 3
  const workers = []
  for (let i = 0; i < CONCURRENCY; i += 1) {
    workers.push(
      (async () => {
        while (queue.length) {
          const app = queue.shift()
          if (!app) break
          // eslint-disable-next-line no-await-in-loop
          await loadOne(app)
        }
      })()
    )
  }
  await Promise.all(workers)
}

async function loadOne(app) {
  if (iconLoading.value[app.package]) return
  iconLoading.value = { ...iconLoading.value, [app.package]: true }
  try {
    const meta = await fetchAppMeta(deviceId, app)
    if (meta?.label) {
      apps.value = apps.value.map((a) => (a.package === app.package ? { ...a, label: meta.label, version: meta.version || a.version } : a))
    }
    if (meta?.hasIcon) {
      const res = await fetchAppIcon(deviceId, app)
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data])
      icons.value = { ...icons.value, [app.package]: track(URL.createObjectURL(blob)) }
      cacheInfo.value = null
    }
  } catch {
    iconFailed.value = { ...iconFailed.value, [app.package]: true }
  } finally {
    iconLoading.value = { ...iconLoading.value, [app.package]: false }
  }
}

async function loadCacheInfo() {
  try {
    cacheInfo.value = await fetchAppsCache(deviceId)
  } catch {
    cacheInfo.value = null
  }
}

async function openApp(app) {
  if (readOnly.value) return
  try {
    await runCommand(deviceId, 'open_app', { packageName: app.package })
    message.success(`已尝试打开 ${app.label || app.package}`)
  } catch (e) {
    message.error(e.message || '打开失败')
  }
}

function confirmUninstall(app) {
  if (readOnly.value) return
  const name = app.label || app.package
  // 用 NaiveUI 的 dialog 不方便在 setup 外调用，这里用原生确认
  if (!window.confirm(`确定卸载「${name}」吗？\n\n注意：系统预装应用卸载会失败。`)) return
  runCommand(deviceId, 'uninstall_app', { packageName: app.package })
    .then((r) => {
      if (r?.status === 'success') message.success(`已卸载 ${name}`)
      else message.error(r?.stderr || '卸载失败')
    })
    .catch((e) => message.error(e.message || '卸载失败'))
}

onMounted(async () => {
  await loadDevice()
  await loadList()
  loadCacheInfo()
})

onBeforeUnmount(revokeAll)
</script>

<template>
  <div class="page-wrap">
    <n-card :bordered="false" class="!rounded-xl">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <n-button size="small" quaternary @click="router.push(`/devices/${deviceId}`)">
          <template #icon><span>←</span></template>
          返回设备
        </n-button>
        <div class="text-base font-semibold">应用</div>
        <n-tag v-if="device" size="small" :bordered="false" :type="device.online ? 'success' : 'default'">
          {{ device.online ? '在线' : '离线' }}
        </n-tag>
        <span v-if="device" class="text-xs opacity-55">{{ device.name }}</span>
        <div class="flex-1"></div>
        <span class="text-xs opacity-55">共 {{ apps.length }} 个</span>
        <n-button size="small" :loading="loading" @click="loadList">
          <template #icon><AppIcon name="refresh" :size="15" /></template>
          刷新
        </n-button>
      </div>

      <div class="flex flex-wrap items-center gap-3 mb-3">
        <n-input
          v-model:value="keyword"
          size="small"
          placeholder="搜索应用名称或包名"
          clearable
          class="w-[260px]"
        />
        <n-checkbox v-model:checked="autoLoadIcon">自动加载图标与名称</n-checkbox>
        <n-checkbox v-model:checked="showPath">显示安装路径</n-checkbox>
        <span class="text-xs opacity-50">
          已缓存 {{ loadedCount }} / {{ apps.length }}
          <template v-if="cacheInfo">（图标 {{ cacheInfo.icons }} 个，{{ formatSize(cacheInfo.bytes) }}）</template>
        </span>
      </div>

      <n-alert v-if="!autoLoadIcon" type="info" :bordered="false" class="mb-3">
        已关闭自动加载。开启后每个应用会从手机拉取一次 APK 来解析图标（较大应用较慢，只拉一次）。
      </n-alert>
      <n-alert v-if="isOffline" type="warning" :bordered="false" class="mb-3">
        设备离线，无法读取应用列表。
      </n-alert>

      <n-spin :show="loading">
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          <div
            v-for="app in filtered"
            :key="app.package"
            class="flex items-center gap-3 p-2.5 rounded-lg border border-black/[0.06] dark:border-white/[0.08] hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
          >
            <!-- 图标 -->
            <div class="w-11 h-11 shrink-0 rounded-lg overflow-hidden bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center">
              <img v-if="icons[app.package]" :src="icons[app.package]" :alt="app.label" class="w-full h-full object-contain" />
              <div
                v-else
                class="w-full h-full flex items-center justify-center text-white font-semibold text-base select-none"
                :style="{ backgroundColor: avatarColor(app.package) }"
              >
                {{ avatarLetter(app) }}
              </div>
            </div>

            <!-- 信息 -->
            <div class="min-w-0 flex-1">
              <div class="text-sm truncate flex items-center gap-1.5">
                <span class="truncate">{{ app.label || app.package }}</span>
                <n-tag v-if="app.version" size="tiny" :bordered="false">{{ app.version }}</n-tag>
              </div>
              <div class="text-[11px] opacity-50 truncate mono" :title="app.package">{{ app.package }}</div>
              <div class="text-[11px] opacity-40">{{ formatSize(app.size) }}</div>
              <div
                v-if="showPath"
                class="text-[11px] opacity-45 mono break-all cursor-pointer hover:text-[#2563eb] leading-snug mt-0.5"
                :title="`点击复制：${app.apk}`"
                @click.stop="copyPath(app)"
              >
                {{ app.apk }}
              </div>
            </div>

            <!-- 操作 -->
            <div class="shrink-0 flex flex-col gap-1">
              <n-button size="tiny" quaternary type="primary" :disabled="readOnly" @click="openApp(app)">打开</n-button>
              <n-button size="tiny" quaternary type="error" :disabled="readOnly" @click="confirmUninstall(app)">卸载</n-button>
            </div>
          </div>
        </div>

        <div v-if="!loading && filtered.length === 0" class="py-16 text-center text-sm opacity-45">
          {{ apps.length === 0 ? '没有读到应用（设备需在线）' : '没有匹配的应用' }}
        </div>
      </n-spin>
    </n-card>
  </div>
</template>
