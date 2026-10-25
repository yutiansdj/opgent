<script setup>
/**
 * 设备文件管理器
 * 通过后端下发 fs_* 指令，在手机上列目录 / 建文件夹 / 建文件 / 重命名 / 删除 / 预览文本。
 */
import { computed, onMounted, ref } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import {
  fetchDevice,
  fetchFsList,
  fsMkdir,
  fsTouch,
  fsRename,
  fsDelete,
  fsRead,
  requestDeviceDownload
} from '@/api/devices'
import { formatDateTime } from '@/utils/format'
import AppIcon from '@/components/AppIcon.vue'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const deviceId = route.params.id
const device = ref(null)
const loading = ref(false)
const entries = ref([])
const currentPath = ref('/sdcard')

// 新建/重命名弹窗
const editVisible = ref(false)
const editMode = ref('mkdir') // mkdir | touch | rename
const editValue = ref('')
const editValue2 = ref('')
const editSubmitting = ref(false)

// 文本预览
const previewVisible = ref(false)
const previewContent = ref('')
const previewPath = ref('')

const isOffline = computed(() => device.value && device.value.online === false)

/** 面包屑：把路径拆成可点击的段 */
const crumbs = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean)
  const list = [{ name: '/', path: '/' }]
  let acc = ''
  for (const p of parts) {
    acc += `/${p}`
    list.push({ name: p, path: acc })
  }
  return list
})

function formatSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function joinPath(base, name) {
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`
}

async function loadDevice() {
  try {
    device.value = await fetchDevice(deviceId)
  } catch {
    // 设备信息失败不影响文件浏览
  }
}

async function loadList(path = currentPath.value) {
  loading.value = true
  try {
    const data = await fetchFsList(deviceId, path)
    currentPath.value = data?.path || path
    entries.value = data?.entries || []
  } catch (error) {
    message.error(error.message || '读取目录失败')
    entries.value = []
  } finally {
    loading.value = false
  }
}

function enter(row) {
  if (row.type === 'dir') {
    loadList(joinPath(currentPath.value, row.name))
  } else if (row.type === 'file') {
    openPreview(row)
  }
}

function goUp() {
  if (currentPath.value === '/') return
  const idx = currentPath.value.lastIndexOf('/')
  loadList(idx <= 0 ? '/' : currentPath.value.slice(0, idx))
}

/* ---------------- 新建 / 重命名 ---------------- */

function openCreate(mode) {
  editMode.value = mode
  editValue.value = ''
  editValue2.value = ''
  editVisible.value = true
}

function openRename(row) {
  editMode.value = 'rename'
  editValue.value = row.name
  editValue2.value = row.name
  editVisible.value = true
}

const editTitle = computed(() => {
  if (editMode.value === 'mkdir') return '新建文件夹'
  if (editMode.value === 'touch') return '新建文件'
  return '重命名'
})

async function submitEdit() {
  const name = String(editValue.value || '').trim()
  if (!name) {
    message.warning('名称不能为空')
    return
  }
  if (name.includes('/')) {
    message.warning('名称不能包含 /')
    return
  }
  editSubmitting.value = true
  try {
    if (editMode.value === 'mkdir') {
      await fsMkdir(deviceId, joinPath(currentPath.value, name))
      message.success('文件夹已创建')
    } else if (editMode.value === 'touch') {
      await fsTouch(deviceId, joinPath(currentPath.value, name), editValue2.value || '')
      message.success('文件已创建')
    } else {
      const target = String(editValue2.value || '').trim()
      if (!target) {
        message.warning('新名称不能为空')
        return
      }
      await fsRename(deviceId, joinPath(currentPath.value, editValue.value), joinPath(currentPath.value, target))
      message.success('已重命名')
    }
    editVisible.value = false
    await loadList()
  } catch (error) {
    message.error(error.message || '操作失败')
  } finally {
    editSubmitting.value = false
  }
}

/* ---------------- 删除 ---------------- */

function confirmDelete(row) {
  const target = joinPath(currentPath.value, row.name)
  dialog.warning({
    title: '确认删除',
    content: row.type === 'dir' ? `目录「${row.name}」及其全部内容将被永久删除，确定吗？` : `文件「${row.name}」将被永久删除，确定吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await fsDelete(deviceId, target)
        message.success('已删除')
        await loadList()
      } catch (error) {
        message.error(error.message || '删除失败')
      }
    }
  })
}

/* ---------------- 下载 / 预览 ---------------- */

async function download(row) {
  const target = joinPath(currentPath.value, row.name)
  const hide = message.loading('正在从手机传输…', { duration: 0 })
  try {
    const data = await requestDeviceDownload(deviceId, target)
    // 复用统一下载工具：先拿 fileId，再带 token 取二进制
    const { downloadWithAuth } = await import('@/utils/download')
    await downloadWithAuth(`/files/${data.fileId}/download`, { fallbackName: data.name || row.name })
    message.success('下载完成')
  } catch (error) {
    message.error(error.message || '下载失败')
  } finally {
    hide.destroy()
  }
}

async function openPreview(row) {
  const target = joinPath(currentPath.value, row.name)
  previewPath.value = target
  previewContent.value = ''
  previewVisible.value = true
  try {
    const data = await fsRead(deviceId, target)
    previewContent.value = data?.content ?? ''
  } catch (error) {
    previewContent.value = `读取失败：${error.message || '未知错误'}`
  }
}

onMounted(async () => {
  await loadDevice()
  await loadList()
})
</script>

<template>
  <div class="page-wrap">
    <n-card :bordered="false" class="!rounded-xl">
      <!-- 顶部：返回 + 设备名 -->
      <div class="flex flex-wrap items-center gap-3 mb-3">
        <n-button size="small" quaternary @click="router.push(`/devices/${deviceId}`)">
          <template #icon><span>←</span></template>
          返回设备
        </n-button>
        <div class="text-base font-semibold">文件管理</div>
        <n-tag v-if="device" size="small" :bordered="false" :type="device.online ? 'success' : 'default'">
          {{ device.online ? '在线' : '离线' }}
        </n-tag>
        <span v-if="device" class="text-xs opacity-55">{{ device.name || device.id }}</span>
      </div>

      <!-- 路径 + 工具栏 -->
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <n-button size="small" :disabled="currentPath === '/'" @click="goUp">上级</n-button>
        <div class="flex flex-wrap items-center gap-1 text-xs px-2 py-1 rounded bg-black/[0.03] dark:bg-white/[0.06] max-w-full overflow-x-auto">
          <template v-for="(c, i) in crumbs" :key="c.path">
            <span v-if="i > 0" class="opacity-35">/</span>
            <a class="cursor-pointer text-[#2563eb] whitespace-nowrap" @click="loadList(c.path)">{{ c.name }}</a>
          </template>
        </div>
        <div class="flex-1"></div>
        <n-button size="small" :loading="loading" @click="loadList()">刷新</n-button>
        <n-button size="small" type="primary" :disabled="isOffline" @click="openCreate('mkdir')">新建文件夹</n-button>
        <n-button size="small" type="primary" :disabled="isOffline" @click="openCreate('touch')">新建文件</n-button>
      </div>

      <n-alert v-if="isOffline" type="warning" :bordered="false" class="mb-3">
        设备当前离线，文件操作需要设备在线。
      </n-alert>

      <!-- 文件列表 -->
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[720px]">
          <thead>
            <tr class="text-left text-xs opacity-60 border-b border-black/[0.06] dark:border-white/[0.08]">
              <th class="py-2 pr-3 font-medium">名称</th>
              <th class="py-2 pr-3 font-medium w-[90px]">类型</th>
              <th class="py-2 pr-3 font-medium w-[100px]">大小</th>
              <th class="py-2 pr-3 font-medium w-[170px]">修改时间</th>
              <th class="py-2 pr-3 font-medium w-[130px]">权限</th>
              <th class="py-2 font-medium w-[190px]">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in entries"
              :key="row.name"
              class="border-b border-black/[0.04] dark:border-white/[0.05] hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
            >
              <td class="py-2 pr-3">
                <a
                  class="cursor-pointer text-[#2563eb] inline-flex items-center gap-1.5 max-w-full"
                  @click="enter(row)"
                >
                  <AppIcon
                    :name="row.type === 'dir' ? 'folder' : row.type === 'link' ? 'link' : 'file'"
                    :size="15"
                    class="shrink-0 opacity-85"
                  />
                  <span class="break-all">{{ row.name }}</span>
                </a>
              </td>
              <td class="py-2 pr-3">
                <n-tag size="small" :bordered="false" :type="row.type === 'dir' ? 'info' : 'default'">
                  {{ row.type === 'dir' ? '目录' : row.type === 'link' ? '链接' : '文件' }}
                </n-tag>
              </td>
              <td class="py-2 pr-3 opacity-70">{{ row.type === 'dir' ? '—' : formatSize(row.size) }}</td>
              <td class="py-2 pr-3 opacity-70">{{ row.mtime ? formatDateTime(new Date(row.mtime * 1000).toISOString()) : '—' }}</td>
              <td class="py-2 pr-3 mono text-xs opacity-60">{{ row.perm || '—' }}</td>
              <td class="py-2">
                <div class="flex flex-wrap gap-1">
                  <n-button v-if="row.type === 'file'" size="tiny" quaternary type="primary" @click="openPreview(row)">查看</n-button>
                  <n-button v-if="row.type === 'file'" size="tiny" quaternary type="primary" @click="download(row)">下载</n-button>
                  <n-button size="tiny" quaternary @click="openRename(row)">重命名</n-button>
                  <n-button size="tiny" quaternary type="error" @click="confirmDelete(row)">删除</n-button>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && entries.length === 0">
              <td colspan="6" class="py-10 text-center text-sm opacity-45">（空目录）</td>
            </tr>
            <tr v-if="loading">
              <td colspan="6" class="py-10 text-center text-sm opacity-45">读取中…</td>
            </tr>
          </tbody>
        </table>
      </div>
    </n-card>

    <!-- 新建 / 重命名 -->
    <n-modal v-model:show="editVisible" preset="card" :title="editTitle" class="w-[420px] max-w-[92vw]">
      <div class="space-y-3">
        <div>
          <div class="text-xs opacity-60 mb-1">{{ editMode === 'rename' ? '原名' : '名称' }}</div>
          <n-input v-model:value="editValue" :disabled="editMode === 'rename'" :placeholder="editMode === 'mkdir' ? '例如：照片' : '例如：note.txt'" />
        </div>
        <div v-if="editMode === 'rename'">
          <div class="text-xs opacity-60 mb-1">新名称</div>
          <n-input v-model:value="editValue2" placeholder="输入新名称" />
        </div>
        <div v-if="editMode === 'touch'">
          <div class="text-xs opacity-60 mb-1">初始内容（可留空）</div>
          <n-input v-model:value="editValue2" type="textarea" :rows="4" placeholder="留空则创建空文件" />
        </div>
        <div class="text-xs opacity-50">位置：{{ currentPath }}</div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="editVisible = false">取消</n-button>
          <n-button type="primary" :loading="editSubmitting" @click="submitEdit">确定</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 文本预览 -->
    <n-modal v-model:show="previewVisible" preset="card" title="文件预览" class="w-[720px] max-w-[94vw]">
      <div class="text-xs opacity-55 mb-2 break-all">{{ previewPath }}</div>
      <pre class="text-xs whitespace-pre-wrap break-all max-h-[60vh] overflow-auto bg-black/[0.03] dark:bg-white/[0.05] rounded p-3">{{ previewContent || '（空文件）' }}</pre>
      <template #footer>
        <div class="flex justify-end">
          <n-button @click="previewVisible = false">关闭</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>
