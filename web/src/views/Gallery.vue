<script setup>
/**
 * 相册：浏览手机里的照片
 * 缩略图由服务器生成并缓存，原图只在点开或生成缩略图时从手机拉取一次。
 * 图片需要鉴权头，所以统一用 blob 拉取后转 objectURL，不能直接写 <img src>。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import { fetchDevice } from '@/api/devices'
import { fetchGallery, fetchGalleryDirs, fetchThumb, fetchPhoto } from '@/api/gallery'
import { saveBlob } from '@/utils/download'
import { formatDateTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const message = useMessage()

const deviceId = route.params.id
const device = ref(null)
const dirs = ref([])
const currentPath = ref('/sdcard/DCIM/Camera')
const customPath = ref('')

const loading = ref(false)
const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(24)

// 缩略图：path -> objectURL
const thumbs = ref({})
const thumbErrors = ref({})
const objectUrls = new Set()

// 大图预览
const viewerVisible = ref(false)
const viewerItem = ref(null)
const viewerUrl = ref('')
const viewerLoading = ref(false)

const isOffline = computed(() => device.value && device.value.online === false)
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

function trackUrl(url) {
  if (!url) return url
  objectUrls.add(url)
  return url
}

function revokeAll() {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls.clear()
}

async function loadDevice() {
  try {
    device.value = await fetchDevice(deviceId)
  } catch {
    /* 忽略：不影响相册浏览 */
  }
}

async function loadDirs() {
  try {
    const data = await fetchGalleryDirs(deviceId)
    dirs.value = data?.list || []
  } catch {
    dirs.value = []
  }
}

/** 分批加载缩略图，避免一次性发几十个请求 */
async function loadThumbs(list) {
  const queue = [...list]
  const workers = []
  const CONCURRENCY = 4
  for (let i = 0; i < CONCURRENCY; i += 1) {
    workers.push(
      (async () => {
        while (queue.length) {
          const item = queue.shift()
          if (!item) break
          try {
            const res = await fetchThumb(deviceId, item, 360)
            const blob = res.data instanceof Blob ? res.data : new Blob([res.data])
            thumbs.value = { ...thumbs.value, [item.path]: trackUrl(URL.createObjectURL(blob)) }
          } catch {
            thumbErrors.value = { ...thumbErrors.value, [item.path]: true }
          }
        }
      })()
    )
  }
  await Promise.all(workers)
}

async function loadList() {
  loading.value = true
  thumbs.value = {}
  thumbErrors.value = {}
  revokeAll()
  try {
    const data = await fetchGallery(deviceId, {
      path: currentPath.value,
      page: page.value,
      pageSize: pageSize.value
    })
    items.value = data?.items || []
    total.value = data?.total || 0
    loading.value = false
    loadThumbs(items.value)
  } catch (error) {
    message.error(error.message || '读取相册失败')
    items.value = []
    total.value = 0
    loading.value = false
  }
}

function switchDir(path) {
  if (!path) return
  currentPath.value = path
  page.value = 1
  loadList()
}

function applyCustomPath() {
  const p = customPath.value.trim()
  if (!p) return
  switchDir(p)
}

function goto(p) {
  if (p < 1 || p > pages.value) return
  page.value = p
  loadList()
}

async function openViewer(item) {
  viewerItem.value = item
  viewerVisible.value = true
  viewerLoading.value = true
  viewerUrl.value = thumbs.value[item.path] || ''
  try {
    const res = await fetchPhoto(deviceId, item)
    const blob = res.data instanceof Blob ? res.data : new Blob([res.data])
    const url = trackUrl(URL.createObjectURL(blob))
    viewerUrl.value = url
  } catch (error) {
    message.error(error.message || '原图加载失败')
  } finally {
    viewerLoading.value = false
  }
}

function stepViewer(delta) {
  const idx = items.value.findIndex((i) => i.path === viewerItem.value?.path)
  const next = items.value[idx + delta]
  if (next) openViewer(next)
}

async function downloadCurrent(item) {
  try {
    const res = await fetchPhoto(deviceId, item)
    const blob = res.data instanceof Blob ? res.data : new Blob([res.data])
    saveBlob(blob, item.name)
  } catch (error) {
    message.error(error.message || '下载失败')
  }
}

watch(page, () => loadList())

onMounted(async () => {
  await loadDevice()
  await loadDirs()
  await loadList()
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
        <div class="text-base font-semibold">相册</div>
        <n-tag v-if="device" size="small" :bordered="false" :type="device.online ? 'success' : 'default'">
          {{ device.online ? '在线' : '离线' }}
        </n-tag>
        <span v-if="device" class="text-xs opacity-55">{{ device.name || device.id }}</span>
        <div class="flex-1"></div>
        <n-button size="small" :loading="loading" @click="loadList">刷新</n-button>
      </div>

      <div class="flex flex-wrap items-center gap-2 mb-4">
        <n-select
          :value="currentPath"
          :options="dirs.map((d) => ({ label: d.label, value: d.path }))"
          class="w-[180px]"
          size="small"
          @update:value="switchDir"
        />
        <n-input
          v-model:value="customPath"
          size="small"
          placeholder="或直接输入目录，如 /sdcard/DCIM/Camera"
          class="w-[320px] max-w-full"
          @keyup.enter="applyCustomPath"
        />
        <n-button size="small" @click="applyCustomPath">打开</n-button>
        <span class="text-xs opacity-55">共 {{ total }} 张</span>
      </div>

      <n-alert v-if="isOffline" type="warning" :bordered="false" class="mb-3">
        设备离线，相册需要设备在线。
      </n-alert>

      <n-spin :show="loading">
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
          <div
            v-for="item in items"
            :key="item.path"
            class="cursor-pointer rounded-lg overflow-hidden border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.04] hover:shadow-md transition"
            @click="openViewer(item)"
          >
            <div class="aspect-square flex items-center justify-center bg-black/[0.04] dark:bg-white/[0.06] overflow-hidden">
              <img
                v-if="thumbs[item.path]"
                :src="thumbs[item.path]"
                :alt="item.name"
                class="w-full h-full object-cover"
                loading="lazy"
              />
              <span v-else-if="thumbErrors[item.path]" class="text-[11px] opacity-40 text-center px-2">
                无法预览<br />（可能是 HEIC）
              </span>
              <span v-else class="text-[11px] opacity-40">加载中…</span>
            </div>
            <div class="px-2 py-1.5">
              <div class="text-[11px] truncate" :title="item.name">{{ item.name }}</div>
              <div class="text-[10px] opacity-45">{{ formatDateTime(new Date(item.mtime * 1000).toISOString()) }}</div>
            </div>
          </div>
        </div>

        <div v-if="!loading && items.length === 0" class="py-16 text-center text-sm opacity-45">
          这个目录里没有图片，换个目录试试（相机照片一般在 /sdcard/DCIM/Camera）
        </div>
      </n-spin>

      <div v-if="pages > 1" class="flex items-center justify-center gap-3 mt-4">
        <n-button size="small" :disabled="page <= 1" @click="goto(page - 1)">上一页</n-button>
        <span class="text-xs opacity-60">{{ page }} / {{ pages }}</span>
        <n-button size="small" :disabled="page >= pages" @click="goto(page + 1)">下一页</n-button>
      </div>
    </n-card>

    <!-- 大图查看 -->
    <n-modal v-model:show="viewerVisible" preset="card" :title="viewerItem?.name || '照片'" class="w-[900px] max-w-[96vw]">
      <div class="relative">
        <div class="flex items-center justify-center bg-black rounded-lg overflow-hidden min-h-[300px]">
          <img v-if="viewerUrl" :src="viewerUrl" :alt="viewerItem?.name" class="max-h-[70vh] max-w-full object-contain" />
          <span v-else class="text-white/60 text-sm py-16">加载中…</span>
        </div>
        <div v-if="items.length > 1" class="absolute inset-y-0 left-0 flex items-center">
          <n-button circle quaternary class="!bg-black/40 !text-white" @click.stop="stepViewer(-1)">‹</n-button>
        </div>
        <div v-if="items.length > 1" class="absolute inset-y-0 right-0 flex items-center">
          <n-button circle quaternary class="!bg-black/40 !text-white" @click.stop="stepViewer(1)">›</n-button>
        </div>
      </div>
      <template #footer>
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs opacity-55 truncate">{{ viewerItem?.path }}</span>
          <div class="flex gap-2">
            <n-button size="small" :loading="viewerLoading" @click="downloadCurrent(viewerItem)">下载原图</n-button>
            <n-button size="small" @click="viewerVisible = false">关闭</n-button>
          </div>
        </div>
      </template>
    </n-modal>
  </div>
</template>
