<script setup>
/**
 * 远程触控
 *
 * 在截图上直接点/滑：
 *   - 单击 → input tap
 *   - 拖动 → input swipe
 *   - 下方按钮 → input keyevent
 *
 * 坐标换算：截图是设备原生分辨率，显示时会缩放，
 * 所以要把页面坐标乘回 naturalWidth / 显示宽度 的比例。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { fetchDevice, runCommand } from '@/api/devices'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const deviceId = route.params.id
const device = ref(null)

const loading = ref(false)
const shot = ref('')
const shotAt = ref('')
const autoRefresh = ref(false)
const refreshEvery = ref(5)
let timer = null

const imgEl = ref(null)
const busy = ref(false)
const lastAction = ref('')
const resolution = ref('')

// 拖动状态
let dragStart = null

const readOnly = computed(() => device.value && device.value.canControl === false)
const isOffline = computed(() => device.value && device.value.online === false)

async function loadDevice() {
  try {
    device.value = await fetchDevice(deviceId)
  } catch {
    /* ignore */
  }
}

async function grabScreen(silent = false) {
  if (loading.value || isOffline.value) return
  loading.value = true
  try {
    const r = await runCommand(deviceId, 'screenshot', {})
    if (r?.status === 'success' && r.image) {
      shot.value = r.image
      shotAt.value = new Date().toLocaleTimeString()
      if (!resolution.value && imgEl.value) {
        resolution.value = `${imgEl.value.naturalWidth} × ${imgEl.value.naturalHeight}`
      }
    } else if (!silent) {
      message.error(r?.stderr || '截图失败')
    }
  } catch (e) {
    if (!silent) message.error(e.message || '截图失败')
  } finally {
    loading.value = false
  }
}

function schedule() {
  clearTimer()
  if (!autoRefresh.value) return
  timer = setInterval(() => {
    if (!loading.value) grabScreen(true)
  }, Math.max(2, refreshEvery.value) * 1000)
}

function clearTimer() {
  if (timer) clearInterval(timer)
  timer = null
}

function onImgReady() {
  if (imgEl.value) resolution.value = `${imgEl.value.naturalWidth} × ${imgEl.value.naturalHeight}`
}

/** 页面坐标 → 设备坐标 */
function toDevice(clientX, clientY) {
  const el = imgEl.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const sx = el.naturalWidth / rect.width
  const sy = el.naturalHeight / rect.height
  const x = Math.round((clientX - rect.left) * sx)
  const y = Math.round((clientY - rect.top) * sy)
  if (x < 0 || y < 0 || x > el.naturalWidth || y > el.naturalHeight) return null
  return { x, y }
}

function onPointerDown(e) {
  if (readOnly.value || !shot.value) return
  dragStart = { x: e.clientX, y: e.clientY, t: Date.now() }
}

async function onPointerUp(e) {
  if (!dragStart || readOnly.value) return
  const start = dragStart
  dragStart = null
  const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
  const p1 = toDevice(start.x, start.y)
  const p2 = toDevice(e.clientX, e.clientY)
  if (!p1 || !p2) return

  busy.value = true
  try {
    if (dist < 12) {
      lastAction.value = `点击 (${p1.x}, ${p1.y})`
      await runCommand(deviceId, 'tap', { x: p1.x, y: p1.y })
    } else {
      const dur = Math.min(2000, Math.max(100, Date.now() - start.t))
      lastAction.value = `滑动 (${p1.x},${p1.y}) → (${p2.x},${p2.y}) ${dur}ms`
      await runCommand(deviceId, 'swipe', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, duration: dur })
    }
    await new Promise((r) => setTimeout(r, 350))
    await grabScreen(true)
  } catch (err) {
    message.error(err.message || '操作失败')
  } finally {
    busy.value = false
  }
}

async function sendKey(code, label) {
  if (readOnly.value) return
  busy.value = true
  try {
    await runCommand(deviceId, 'key', { code })
    lastAction.value = `按键 ${label}`
    await new Promise((r) => setTimeout(r, 400))
    await grabScreen(true)
  } catch (e) {
    message.error(e.message || '按键失败')
  } finally {
    busy.value = false
  }
}

const inputValue = ref('')
async function sendText() {
  const text = inputValue.value
  if (!text.trim()) return
  busy.value = true
  try {
    await runCommand(deviceId, 'input_text', { text })
    lastAction.value = `输入：${text}`
    inputValue.value = ''
    await grabScreen(true)
  } catch (e) {
    message.error(e.message || '输入失败')
  } finally {
    busy.value = false
  }
}

const keys = [
  { code: 'KEYCODE_BACK', label: '返回' },
  { code: 'KEYCODE_HOME', label: '桌面' },
  { code: 'KEYCODE_APP_SWITCH', label: '最近' },
  { code: 'KEYCODE_VOLUME_UP', label: '音量+' },
  { code: 'KEYCODE_VOLUME_DOWN', label: '音量−' },
  { code: 'KEYCODE_POWER', label: '电源' },
  { code: 'KEYCODE_WAKEUP', label: '点亮' },
  { code: 'KEYCODE_SLEEP', label: '熄屏' }
]

onMounted(async () => {
  await loadDevice()
  await grabScreen(true)
})

onBeforeUnmount(clearTimer)
</script>

<template>
  <div class="page-wrap">
    <n-card :bordered="false" class="!rounded-xl">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <n-button size="small" quaternary @click="router.push(`/devices/${deviceId}`)">
          <template #icon><span>←</span></template>
          返回设备
        </n-button>
        <div class="text-base font-semibold">远程触控</div>
        <n-tag v-if="device" size="small" :bordered="false" :type="device.online ? 'success' : 'default'">
          {{ device.online ? '在线' : '离线' }}
        </n-tag>
        <span v-if="resolution" class="text-xs opacity-50">{{ resolution }}</span>
        <div class="flex-1"></div>
        <span v-if="shotAt" class="text-xs opacity-45">截图于 {{ shotAt }}</span>
        <n-button size="small" :loading="loading" @click="grabScreen(false)">
          <template #icon><AppIcon name="refresh" :size="15" /></template>
          刷新
        </n-button>
      </div>

      <div class="flex flex-wrap items-center gap-3 mb-3">
        <n-checkbox v-model:checked="autoRefresh" @update:checked="schedule">自动刷新</n-checkbox>
        <n-input-number v-model:value="refreshEvery" size="small" :min="2" :max="30" class="w-[110px]" :disabled="!autoRefresh">
          <template #suffix>秒</template>
        </n-input-number>
        <span class="text-xs opacity-45">在屏幕上单击 = 点击，按住拖动 = 滑动</span>
      </div>

      <n-alert v-if="readOnly" type="info" :bordered="false" class="mb-3">
        只读共享设备，不能操作画面。
      </n-alert>
      <n-alert v-if="isOffline" type="warning" :bordered="false" class="mb-3">
        设备离线，无法触控。
      </n-alert>

      <!-- 画面 -->
      <div class="flex justify-center">
        <div
          class="relative rounded-lg overflow-hidden border border-black/[0.08] dark:border-white/[0.1] bg-black/5 max-w-full"
          :class="readOnly ? 'opacity-60' : 'cursor-crosshair'"
          @pointerdown="onPointerDown"
          @pointerup="onPointerUp"
          @pointerleave="dragStart = null"
        >
          <img
            v-if="shot"
            ref="imgEl"
            :src="shot"
            alt="设备屏幕"
            class="block max-h-[68vh] max-w-full select-none touch-none"
            draggable="false"
            @load="onImgReady"
          />
          <div v-else class="w-[300px] h-[520px] flex items-center justify-center text-sm opacity-45">
            正在获取画面…
          </div>
          <div v-if="busy" class="absolute inset-0 bg-white/30 dark:bg-black/30 flex items-center justify-center">
            <n-spin size="small" />
          </div>
        </div>
      </div>

      <!-- 按键 -->
      <div class="flex flex-wrap justify-center gap-2 mt-4">
        <n-button
          v-for="k in keys"
          :key="k.code"
          size="small"
          :disabled="readOnly || isOffline"
          @click="sendKey(k.code, k.label)"
        >
          {{ k.label }}
        </n-button>
      </div>

      <!-- 文本输入 -->
      <div class="flex flex-wrap items-center gap-2 mt-3 justify-center">
        <n-input
          v-model:value="inputValue"
          size="small"
          placeholder="输入文本（只支持英文/数字）"
          class="w-[320px] max-w-full"
          @keyup.enter="sendText"
        />
        <n-button size="small" type="primary" :disabled="readOnly || isOffline" @click="sendText">发送</n-button>
      </div>

      <div v-if="lastAction" class="text-xs opacity-45 text-center mt-3">最近操作：{{ lastAction }}</div>
    </n-card>
  </div>
</template>
