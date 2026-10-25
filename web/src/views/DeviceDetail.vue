<script setup>
import { computed, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { NTag, useDialog, useMessage } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import Pagination from '@/components/Pagination.vue'
import {
  fetchDevice,
  fetchDeviceLogs,
  installApk,
  requestDeviceDownload,
  runCommand,
  updateDevice,
  uploadFileToDevice
} from '@/api/devices'
import { downloadBase64Image, downloadWithAuth } from '@/utils/download'
import { commandLabel, formatDateTime, statusLabel, statusTagType } from '@/utils/format'
import { useIsMobile } from '@/composables/useIsMobile'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const isMobile = useIsMobile()

const deviceId = route.params.id
const device = ref(null)
const loading = ref(false)

/* 发送通知（显示在奶奶手机的通知栏） */
const notifyVisible = ref(false)
const notifySending = ref(false)
const notifyForm = ref({ title: '', text: '' })

/* 远程拍照（需要手机装 App 版 Agent 并授予相机权限） */
const cameraVisible = ref(false)
const cameraImage = ref('')
const cameraFacing = ref('front')
const cameraLoading = ref(false)

function openCamera() {
  cameraImage.value = ''
  cameraVisible.value = true
}

async function takePhoto(facing) {
  cameraFacing.value = facing
  cameraLoading.value = true
  try {
    const r = await runCommand(deviceId, 'camera', { facing: facing }, { timeout: 90000 })
    if (r?.status === 'success' && r?.image) {
      cameraImage.value = r.image
      message.success(facing === 'front' ? '前置摄像头拍好了' : '后置摄像头拍好了')
    } else {
      message.error(r?.stderr || '拍照失败')
    }
  } catch (e) {
    message.error(e.message || '拍照失败')
  } finally {
    cameraLoading.value = false
  }
}

function savePhoto() {
  if (!cameraImage.value) return
  downloadBase64Image(cameraImage.value, `photo-${Date.now()}.jpg`)
  message.success('照片已开始下载')
}

const NOTIFY_TEMPLATES = [
  { label: '记得吃药', title: '该吃药啦', text: '到时间吃药了，记得喝点温水。' },
  { label: '记得充电', title: '手机该充电了', text: '电量不多了，记得插上充电器。' },
  { label: '出门带钥匙', title: '出门提醒', text: '出门记得带钥匙和手机。' },
  { label: '按时吃饭', title: '吃饭时间到', text: '别忘了按时吃饭，别饿着。' },
  { label: '有事联系', title: '有事找家人', text: '有任何问题随时给我打电话。' }
]

function openNotify() {
  notifyForm.value = { title: '', text: '' }
  notifyVisible.value = true
}

function applyNotifyTpl(t) {
  notifyForm.value = { title: t.title, text: t.text }
}

async function sendNotify() {
  const title = notifyForm.value.title.trim()
  const text = notifyForm.value.text.trim()
  if (!title || !text) {
    message.warning('标题和内容都要填')
    return
  }
  notifySending.value = true
  try {
    const r = await runCommand(deviceId, 'notify', { title, text }, { timeout: 30000 })
    if (r?.status === 'success') {
      message.success(
        r?.fallback === 'shell'
          ? '已发送（兼容模式）。建议在手机上重新执行一次 agent.sh install 升级手机端，后续更稳'
          : '已发送，通知会显示在手机通知栏'
      )
      notifyVisible.value = false
    } else {
      const err = r?.stderr || '发送失败'
      message.error(
        /不支持/.test(err)
          ? '手机端 agent 版本太旧，请在手机上执行：su，然后 sh /sdcard/Download/agent.sh install'
          : err
      )
    }
  } catch (e) {
    message.error(e.message || '发送失败')
  } finally {
    notifySending.value = false
  }
}

/* 删除设备记录（清理重复记录用） */
async function removeDevice() {
  const name = device.value?.name || deviceId
  if (!window.confirm(`确定删除设备「${name}」的记录吗？\n\n只删后台记录，不影响手机上的 agent；手机下次上报会自动重新注册一条。`)) return
  try {
    const { deleteDevice } = await import('@/api/devices')
    await deleteDevice(deviceId)
    message.success('设备记录已删除')
    router.push('/devices')
  } catch (e) {
    message.error(e.message || '删除失败')
  }
}

/* 设备共享 */
const shareVisible = ref(false)
const shareLoading = ref(false)
const shares = ref([])
const candidates = ref([])
const shareUsername = ref('')
const shareLevel = ref('view')
const shareSubmitting = ref(false)

// 只读共享：能看不能操作
const readOnly = computed(() => device.value && device.value.canControl === false)

async function openShares() {
  shareVisible.value = true
  shareLoading.value = true
  try {
    const { fetchDeviceShares, fetchShareCandidates } = await import('@/api/devices')
    const [s, c] = await Promise.all([fetchDeviceShares(deviceId), fetchShareCandidates()])
    shares.value = s?.list || []
    // 已共享的账号不再出现在候选里
    const taken = new Set(shares.value.map((x) => x.userId))
    candidates.value = (c?.list || []).filter((u) => !taken.has(u.id))
  } catch (error) {
    message.error(error.message || '共享信息加载失败')
  } finally {
    shareLoading.value = false
  }
}

async function addShare() {
  const name = String(shareUsername.value || '').trim()
  if (!name) {
    message.warning('请选择账号')
    return
  }
  shareSubmitting.value = true
  try {
    const { addDeviceShare } = await import('@/api/devices')
    await addDeviceShare(deviceId, name, shareLevel.value)
    message.success('已共享')
    shareUsername.value = ''
    await openShares()
  } catch (error) {
    message.error(error.message || '共享失败')
  } finally {
    shareSubmitting.value = false
  }
}

async function dropShare(userId) {
  try {
    const { removeDeviceShare } = await import('@/api/devices')
    await removeDeviceShare(deviceId, userId)
    message.success('已取消共享')
    await openShares()
  } catch (error) {
    message.error(error.message || '取消共享失败')
  }
}

/* 系统自检 */
const diagVisible = ref(false)
const diagLoading = ref(false)
const diagData = ref(null)

async function runDiag() {
  diagVisible.value = true
  diagLoading.value = true
  diagData.value = null
  try {
    const { runDeviceDiag } = await import('@/api/devices')
    diagData.value = await runDeviceDiag(deviceId)
  } catch (error) {
    message.error(error.message || '自检失败')
    diagVisible.value = false
  } finally {
    diagLoading.value = false
  }
}

// 各指令独立 loading
const actionLoading = reactive({})
const lastResult = ref(null)

// 备注编辑
const noteDraft = ref('')
const savingNote = ref(false)

// 截图预览
const screenshotVisible = ref(false)
const screenshotImage = ref('')

// 打开应用 / 卸载应用 弹窗
const packageVisible = ref(false)
const packageMode = ref('open_app')
const packageName = ref('')
const packageSubmitting = ref(false)

// 文件上传 / 下载
const targetPath = ref('/sdcard/Download/')
const uploading = ref(false)
const uploadPercent = ref(0)
const installing = ref(false)
const installPercent = ref(0)
const downloadPath = ref('/sdcard/')
const downloading = ref(false)

// 自定义 Shell
const shellCommand = ref('')
const shellRunning = ref(false)

// 指令日志
const logsLoading = ref(false)
const logsList = ref([])
const logsTotal = ref(0)
const logsPage = ref(1)
const logsPageSize = ref(10)
let logsTimer = null
let deviceTimer = null

const descColumns = computed(() => (isMobile.value ? 1 : 3))

const onlineText = computed(() => (device.value?.online ? '在线' : '离线'))

const rootStatusMeta = computed(() => {
  const status = device.value?.rootStatus
  if (status === 'granted') return { type: 'success', text: '已授权' }
  if (status === 'denied') return { type: 'error', text: '未授权' }
  return { type: 'default', text: status || '未知' }
})

const packageTitle = computed(() =>
  packageMode.value === 'open_app' ? '打开指定 APP' : '卸载应用'
)

const screenshotSrc = computed(() => {
  const image = screenshotImage.value
  if (!image) return ''
  if (image.startsWith('data:')) return image
  return `data:image/png;base64,${image}`
})

// ------- 基础数据 -------
async function loadDevice(silent = false) {
  if (!silent) loading.value = true
  try {
    const data = await fetchDevice(deviceId)
    device.value = data
    if (!savingNote.value) noteDraft.value = data?.note || ''
  } catch (error) {
    message.error(error.message || '设备信息加载失败')
    if (error.status === 404) router.replace('/devices')
  } finally {
    loading.value = false
  }
}

async function loadLogs(silent = false) {
  if (!silent) logsLoading.value = true
  try {
    const data = await fetchDeviceLogs(deviceId, {
      page: logsPage.value,
      pageSize: logsPageSize.value
    })
    logsList.value = data?.list || []
    logsTotal.value = data?.total || 0
  } catch (error) {
    if (!silent) message.error(error.message || '指令日志加载失败')
  } finally {
    logsLoading.value = false
  }
}

async function saveNote() {
  savingNote.value = true
  try {
    const data = await updateDevice(deviceId, { note: noteDraft.value })
    device.value = data || device.value
    noteDraft.value = data?.note ?? noteDraft.value
    message.success('备注已保存')
  } catch (error) {
    message.error(error.message || '备注保存失败')
  } finally {
    savingNote.value = false
  }
}

// ------- 指令下发 -------
function formatStatusMessage(result) {
  if (result?.accepted) return '指令已下发，等待设备执行'
  if (result?.status === 'success') return '指令执行成功'
  if (result?.status === 'timeout') return '指令执行超时，设备可能未响应'
  return '指令执行失败'
}

async function sendCommand(type, params = {}) {
  actionLoading[type] = true
  try {
    const data = await runCommand(deviceId, type, params)
    lastResult.value = { type, ...(data || {}) }

    if (type === 'screenshot') {
      if (data?.image) {
        screenshotImage.value = data.image
        screenshotVisible.value = true
      } else {
        message.warning('未获取到截图内容')
      }
    }

    if (data?.accepted) {
      message.info('指令已下发，设备将立即执行')
    } else if (data?.status === 'success') {
      message.success(formatStatusMessage(data))
    } else if (data?.status === 'timeout') {
      message.warning(formatStatusMessage(data))
    } else {
      message.error(data?.stderr ? `执行失败：${data.stderr}` : formatStatusMessage(data))
    }

    // 指令可能改变在线状态 / 电量，同时刷新日志
    loadDevice(true)
    loadLogs(true)
    return data
  } catch (error) {
    if (error.code === 'DEVICE_OFFLINE') {
      message.error('设备当前离线，无法下发指令')
    } else {
      message.error(error.message || '指令下发失败')
    }
    return null
  } finally {
    delete actionLoading[type]
  }
}

// 危险操作二次确认
function confirmDanger(type, label) {
  dialog.warning({
    title: `确认${label}`,
    content: `即将对设备「${device.value?.name || deviceId}」执行${label}操作，执行后设备将暂时失联，请确认。`,
    positiveText: `确认${label}`,
    negativeText: '取消',
    onPositiveClick: () => sendCommand(type)
  })
}

function openPackageModal(mode) {
  packageMode.value = mode
  packageName.value = ''
  packageVisible.value = true
}

async function submitPackage() {
  const name = packageName.value.trim()
  if (!name) {
    message.warning('请输入应用包名')
    return
  }
  if (packageMode.value === 'uninstall_app') {
    // 卸载属于不可逆操作，额外确认一次
    dialog.warning({
      title: '确认卸载',
      content: `确定要在设备上卸载「${name}」吗？此操作不可撤销。`,
      positiveText: '卸载',
      negativeText: '取消',
      onPositiveClick: () => {
        packageVisible.value = false
        return sendCommand('uninstall_app', { packageName: name })
      }
    })
    return
  }
  packageSubmitting.value = true
  try {
    const result = await sendCommand('open_app', { packageName: name })
    // 只有真正下发成功才关闭弹窗，失败便于用户重试
    if (result) packageVisible.value = false
  } finally {
    packageSubmitting.value = false
  }
}

async function runShell() {
  const command = shellCommand.value.trim()
  if (!command) {
    message.warning('请输入要执行的 Shell 命令')
    return
  }
  shellRunning.value = true
  try {
    await sendCommand('shell', { command })
  } finally {
    shellRunning.value = false
  }
}

// ------- 文件上传 / 下载 -------
async function handleUpload({ file, onFinish, onError }) {
  const raw = file?.file
  if (!raw) {
    onError()
    return
  }
  const path = targetPath.value.trim()
  if (!path) {
    message.warning('请先填写手机上的目标路径')
    onError()
    return
  }
  uploading.value = true
  uploadPercent.value = 0
  try {
    const data = await uploadFileToDevice(deviceId, raw, path, (event) => {
      if (event.total) uploadPercent.value = Math.round((event.loaded / event.total) * 100)
    })
    message.success(`文件已上传到 ${data?.path || path}`)
    onFinish()
    loadLogs(true)
  } catch (error) {
    message.error(error.message || '文件上传失败')
    onError()
  } finally {
    uploading.value = false
  }
}

async function handleInstall({ file, onFinish, onError }) {
  const raw = file?.file
  if (!raw) {
    onError()
    return
  }
  if (!/\.apk$/i.test(raw.name || '')) {
    message.warning('请选择 .apk 安装包')
    onError()
    return
  }
  installing.value = true
  installPercent.value = 0
  try {
    const data = await installApk(deviceId, raw, (event) => {
      if (event.total) installPercent.value = Math.round((event.loaded / event.total) * 100)
    })
    if (data?.status === 'success') message.success('APK 安装成功')
    else message.error(data?.stderr ? `安装失败：${data.stderr}` : 'APK 安装失败')
    lastResult.value = { type: 'install_apk', ...(data || {}) }
    onFinish()
    loadLogs(true)
  } catch (error) {
    message.error(error.message || 'APK 安装失败')
    onError()
  } finally {
    installing.value = false
  }
}

async function handleDownload() {
  const path = downloadPath.value.trim()
  if (!path) {
    message.warning('请输入手机上的文件路径')
    return
  }
  downloading.value = true
  try {
    const info = await requestDeviceDownload(deviceId, path)
    if (!info?.fileId) throw new Error('后端未返回 fileId')
    await downloadWithAuth(`/files/${info.fileId}/download`, {
      fallbackName: info.name || path.split('/').pop() || 'download'
    })
    message.success('文件下载已开始')
    loadLogs(true)
  } catch (error) {
    message.error(error.message || '文件下载失败')
  } finally {
    downloading.value = false
  }
}

function openScreenshot() {
  if (!screenshotImage.value) {
    message.info('暂无截图，请先执行「截图预览」指令')
    return
  }
  screenshotVisible.value = true
}

function downloadScreenshot() {
  if (!screenshotImage.value) return
  downloadBase64Image(screenshotImage.value, `screenshot-${deviceId}.png`)
  message.success('截图已开始下载')
}

// ------- 复制 -------
async function copyText(text) {
  if (!text) {
    message.warning('没有可复制的内容')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    message.success('已复制到剪贴板')
  } catch {
    // 不支持 Clipboard API 时降级
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
    message.success('已复制到剪贴板')
  }
}

// ------- 日志分页 -------
function onLogsPageChange(nextPage) {
  logsPage.value = nextPage
  loadLogs()
}

function onLogsPageSizeChange(nextSize) {
  logsPageSize.value = nextSize
  logsPage.value = 1
  loadLogs()
}

const logColumns = [
  {
    type: 'expand',
    renderExpand: (row) =>
      h('pre', { class: 'code-block', style: 'margin: 8px 4px' }, row.result || '（无返回内容）')
  },
  {
    title: '执行时间',
    key: 'createdAt',
    width: 165,
    render: (row) => formatDateTime(row.createdAt)
  },
  {
    title: '指令',
    key: 'command',
    minWidth: 180,
    render: (row) =>
      h('div', { class: 'leading-tight min-w-0' }, [
        h('div', { class: 'text-[13px]' }, commandLabel(row.type)),
        h(
          'div',
          { class: 'mono text-[11px] opacity-50 truncate' },
          row.command || '—'
        )
      ])
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (row) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: statusTagType(row.status) },
        { default: () => statusLabel(row.status) }
      )
  },
  {
    title: '返回结果',
    key: 'result',
    minWidth: 280,
    ellipsis: { tooltip: true },
    render: (row) => row.result || h('span', { class: 'opacity-40' }, '—')
  },
  {
    title: '耗时',
    key: 'durationMs',
    width: 90,
    render: (row) => (row.durationMs != null ? `${row.durationMs} ms` : '—')
  }
]

onMounted(() => {
  loadDevice()
  loadLogs()
  // 实时刷新该设备指令日志（5s）
  logsTimer = window.setInterval(() => loadLogs(true), 5000)
  // 设备状态轮询（15s）
  deviceTimer = window.setInterval(() => loadDevice(true), 15000)
})

onBeforeUnmount(() => {
  if (logsTimer) window.clearInterval(logsTimer)
  if (deviceTimer) window.clearInterval(deviceTimer)
})
</script>

<template>
  <div class="page-wrap">
    <!-- 页头 -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex min-w-0 items-start gap-2">
        <n-button quaternary circle aria-label="返回" @click="router.push('/devices')">
          <template #icon>
            <AppIcon name="back" :size="20" />
          </template>
        </n-button>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="m-0 truncate text-xl font-semibold">
              {{ device?.name || '设备详情' }}
            </h2>
            <n-tag v-if="device" :type="device.online ? 'success' : 'default'" size="small" :bordered="false">
              {{ onlineText }}
            </n-tag>
          </div>
          <p class="mt-1 truncate text-xs opacity-55 mono">{{ deviceId }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <n-button size="small" type="primary" @click="router.push(`/devices/${deviceId}/files`)">
          <AppIcon name="folder" :size="15" class="mr-1" />
          文件管理
        </n-button>
        <n-button size="small" type="primary" @click="router.push(`/devices/${deviceId}/control`)">
          远程触控
        </n-button>
        <n-button size="small" type="primary" @click="router.push(`/devices/${deviceId}/apps`)">
          <AppIcon name="devices" :size="15" class="mr-1" />
          应用
        </n-button>
        <n-button size="small" type="primary" @click="router.push(`/devices/${deviceId}/gallery`)">
          <AppIcon name="image" :size="15" class="mr-1" />
          相册
        </n-button>
        <n-button size="small" @click="openShares">共享</n-button>
        <n-button size="small" @click="runDiag">系统自检</n-button>
        <n-button size="small" type="error" quaternary @click="removeDevice">删除设备</n-button>
        <n-button size="small" :loading="loading" @click="loadDevice()">
          <template #icon>
            <AppIcon name="refresh" :size="15" />
          </template>
          刷新
        </n-button>
      </div>
    </div>

    <n-alert v-if="readOnly" type="info" :bordered="false" class="mb-3">
      这台设备是别人共享给你的<strong>只读</strong>权限：可以查看信息和日志，不能下发指令或修改文件。
    </n-alert>

    <n-spin :show="loading && !device">
      <!-- 基础信息 -->
      <n-card :bordered="false" class="page-card" title="基础信息">
        <n-descriptions v-if="device" :column="descColumns" bordered size="small" label-placement="left">
          <n-descriptions-item label="设备名称">{{ device.name || '—' }}</n-descriptions-item>
          <n-descriptions-item label="设备 ID">
            <span class="mono">{{ device.id }}</span>
          </n-descriptions-item>
          <n-descriptions-item label="设备唯一标识">
            <span class="mono">{{ device.deviceUid || '—' }}</span>
          </n-descriptions-item>
          <n-descriptions-item label="型号">{{ device.model || '—' }}</n-descriptions-item>
          <n-descriptions-item label="安卓版本">
            {{ device.androidVersion ? `Android ${device.androidVersion}` : '—' }}
          </n-descriptions-item>
          <n-descriptions-item label="Root 授权">
            <n-tag :type="rootStatusMeta.type" size="small" :bordered="false">
              {{ rootStatusMeta.text }}
            </n-tag>
          </n-descriptions-item>
          <n-descriptions-item label="IP 地址">
            <span class="mono">{{ device.ip || '—' }}</span>
          </n-descriptions-item>
          <n-descriptions-item label="网络类型">{{ device.network || '—' }}</n-descriptions-item>
          <n-descriptions-item label="当前电量">
            <div v-if="device.battery != null" class="flex items-center gap-2">
              <n-progress
                type="line"
                :percentage="Number(device.battery)"
                :show-indicator="false"
                :height="6"
                class="w-[70px]"
                :color="Number(device.battery) <= 20 ? '#d03050' : '#18a058'"
              />
              <span class="text-xs">{{ device.battery }}%</span>
            </div>
            <span v-else>—</span>
          </n-descriptions-item>
          <n-descriptions-item label="最后上线">
            {{ formatDateTime(device.lastSeenAt) }}
          </n-descriptions-item>
          <n-descriptions-item label="接入时间">
            {{ formatDateTime(device.createdAt) }}
          </n-descriptions-item>
          <n-descriptions-item label="备注">
            <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
              <n-input
                v-model:value="noteDraft"
                size="small"
                placeholder="填写设备位置 / 用途等备注"
                :maxlength="100"
                class="min-w-0"
              />
              <n-button
                size="small"
                type="primary"
                :loading="savingNote"
                :disabled="noteDraft === (device.note || '')"
                @click="saveNote"
              >
                保存备注
              </n-button>
            </div>
          </n-descriptions-item>
        </n-descriptions>
        <n-skeleton v-else text :repeat="6" />
      </n-card>
    </n-spin>

    <!-- 远程指令操作区 -->
    <n-card :bordered="false" :class="['page-card', readOnly ? 'pointer-events-none opacity-50' : '']" title="远程指令">
      <template #header-extra>
        <span class="text-xs opacity-50">截图结果最长等待 35 秒</span>
      </template>

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <n-button :loading="!!actionLoading.screen_on" @click="sendCommand('screen_on')">
          点亮屏幕
        </n-button>
        <n-button :loading="!!actionLoading.screen_off" @click="sendCommand('screen_off')">
          熄屏
        </n-button>
        <n-button :loading="!!actionLoading.screenshot" @click="sendCommand('screenshot')">
          截图预览
        </n-button>
        <n-button
          type="warning"
          secondary
          :loading="!!actionLoading.reboot"
          @click="confirmDanger('reboot', '重启')"
        >
          重启设备
        </n-button>
        <n-button
          type="error"
          secondary
          :loading="!!actionLoading.shutdown"
          @click="confirmDanger('shutdown', '关机')"
        >
          关机
        </n-button>
        <n-button @click="openPackageModal('open_app')">打开指定 APP</n-button>
        <n-button @click="openPackageModal('uninstall_app')">卸载应用</n-button>
        <n-button @click="openScreenshot">查看上次截图</n-button>
        <n-button type="primary" secondary @click="openNotify">发送通知</n-button>
        <n-button type="info" secondary @click="openCamera">远程拍照</n-button>
      </div>

      <n-divider class="!my-4" />

      <!-- 上传 / 安装 APK -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="rounded-lg border border-[rgba(128,128,128,0.16)] p-3">
          <div class="mb-2 text-sm font-medium">上传文件到手机</div>
          <div class="flex flex-col gap-2 sm:flex-row">
            <n-input
              v-model:value="targetPath"
              size="small"
              placeholder="手机目标路径，如 /sdcard/Download/a.apk"
              class="min-w-0 flex-1"
            />
            <n-upload
              :show-file-list="false"
              :custom-request="handleUpload"
              :disabled="uploading"
            >
              <n-button size="small" type="primary" :loading="uploading">
                {{ uploading ? `上传中 ${uploadPercent}%` : '选择文件上传' }}
              </n-button>
            </n-upload>
          </div>
          <div class="mt-1 text-[11px] opacity-45">
            上传后由设备端拉取并写入指定路径，需保证目标目录可写
          </div>
        </div>

        <div class="rounded-lg border border-[rgba(128,128,128,0.16)] p-3">
          <div class="mb-2 text-sm font-medium">安装 APK</div>
          <div class="flex items-center gap-2">
            <n-upload
              :show-file-list="false"
              :custom-request="handleInstall"
              accept=".apk,application/vnd.android.package-archive"
              :disabled="installing"
            >
              <n-button size="small" type="primary" :loading="installing">
                {{ installing ? `安装中 ${installPercent}%` : '选择 APK 安装' }}
              </n-button>
            </n-upload>
            <span class="text-[11px] opacity-45">安装过程可能持续数十秒</span>
          </div>
        </div>
      </div>

      <n-divider class="!my-4" />

      <!-- 从手机下载文件 -->
      <div class="rounded-lg border border-[rgba(128,128,128,0.16)] p-3">
        <div class="mb-2 text-sm font-medium">从手机下载文件</div>
        <div class="flex flex-col gap-2 sm:flex-row">
          <n-input
            v-model:value="downloadPath"
            size="small"
            placeholder="手机文件路径，如 /sdcard/a.log"
            class="min-w-0 flex-1"
            @keyup.enter="handleDownload"
          />
          <n-button size="small" type="primary" :loading="downloading" @click="handleDownload">
            <template #icon>
              <AppIcon name="download" :size="15" />
            </template>
            获取并下载
          </n-button>
        </div>
      </div>
    </n-card>

    <!-- 自定义 Shell -->
    <n-card :bordered="false" :class="['page-card', readOnly ? 'pointer-events-none opacity-50' : '']" title="自定义 Shell 命令">
      <template #header-extra>
        <span class="text-xs opacity-50">需要设备已授予 root 权限</span>
      </template>
      <n-input
        v-model:value="shellCommand"
        type="textarea"
        placeholder="支持多行命令，例如：&#10;ls -l /sdcard&#10;dumpsys battery"
        :autosize="{ minRows: 4, maxRows: 10 }"
        class="mono"
      />
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <n-button type="primary" :loading="shellRunning" @click="runShell">执行命令</n-button>
        <n-button :disabled="!shellCommand" @click="shellCommand = ''">清空</n-button>
        <span class="text-xs opacity-45">执行结果在下方「最近一次执行结果」查看</span>
      </div>
    </n-card>

    <!-- 最近一次执行结果 -->
    <n-card v-if="lastResult" :bordered="false" class="page-card" title="最近一次执行结果">
      <template #header-extra>
        <div class="flex flex-wrap items-center gap-2">
          <n-tag size="small" :bordered="false" :type="lastResult.accepted ? 'info' : statusTagType(lastResult.status)">
            {{ lastResult.accepted ? '已下发' : statusLabel(lastResult.status) }}
          </n-tag>
          <span class="mono text-[11px] opacity-50">
            {{ commandLabel(lastResult.type) }}
          </span>
        </div>
      </template>

      <div class="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs opacity-65">
        <span v-if="lastResult.requestId" class="mono">requestId: {{ lastResult.requestId }}</span>
        <span v-if="lastResult.durationMs != null">耗时：{{ lastResult.durationMs }} ms</span>
        <span v-if="lastResult.exitCode != null">exitCode：{{ lastResult.exitCode }}</span>
        <span v-if="lastResult.accepted" class="text-[#f0a020]">重启/关机已受理，设备将离线</span>
      </div>

      <div class="flex flex-col gap-3">
        <div>
          <div class="mb-1 flex items-center justify-between">
            <span class="text-xs font-medium opacity-70">stdout</span>
            <n-button text size="tiny" @click="copyText(lastResult.stdout)">复制</n-button>
          </div>
          <pre class="code-block">{{ lastResult.stdout || '（空）' }}</pre>
        </div>
        <div>
          <div class="mb-1 flex items-center justify-between">
            <span class="text-xs font-medium opacity-70">stderr</span>
            <n-button text size="tiny" @click="copyText(lastResult.stderr)">复制</n-button>
          </div>
          <pre class="code-block" :style="lastResult.stderr ? 'color:#d03050' : ''">{{ lastResult.stderr || '（空）' }}</pre>
        </div>
        <div v-if="lastResult.image" class="pt-1">
          <n-button size="small" @click="screenshotVisible = true">查看截图预览</n-button>
        </div>
      </div>
    </n-card>

    <!-- 实时指令日志 -->
    <n-card :bordered="false" class="page-card" title="实时命令日志">
      <template #header-extra>
        <div class="flex items-center gap-2">
          <span class="text-xs opacity-45">每 5 秒自动刷新</span>
          <n-button size="tiny" :loading="logsLoading" @click="loadLogs()">刷新</n-button>
        </div>
      </template>

      <div class="table-scroll">
        <n-data-table
          :columns="logColumns"
          :data="logsList"
          :loading="logsLoading"
          :row-key="(row) => row.id"
          :scroll-x="920"
          size="small"
          :bordered="false"
        >
          <template #empty>
            <div class="py-8 text-center text-sm opacity-55">该设备暂无指令记录</div>
          </template>
        </n-data-table>
      </div>

      <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs opacity-55">共 {{ logsTotal }} 条</span>
        <Pagination
          :page="logsPage"
          :page-size="logsPageSize"
          :total="logsTotal"
          @update:page="onLogsPageChange"
          @update:page-size="onLogsPageSizeChange"
        />
      </div>
    </n-card>

    <!-- 打开应用 / 卸载应用 弹窗 -->
    <n-modal
      v-model:show="packageVisible"
      preset="card"
      :title="packageTitle"
      class="w-[92vw] max-w-[440px]"
      :mask-closable="false"
    >
      <n-form label-placement="top" @submit.prevent>
        <n-form-item label="应用包名" :show-feedback="false">
          <n-input
            v-model:value="packageName"
            placeholder="例如 com.tencent.mm"
            class="mono"
            @keyup.enter="submitPackage"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="packageVisible = false">取消</n-button>
          <n-button
            :type="packageMode === 'uninstall_app' ? 'error' : 'primary'"
            :loading="packageSubmitting || !!actionLoading[packageMode]"
            @click="submitPackage"
          >
            {{ packageMode === 'uninstall_app' ? '卸载' : '打开' }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <!-- 截图预览 -->
    <n-modal
      v-model:show="screenshotVisible"
      preset="card"
      title="设备截图"
      style="width: 92vw; max-width: 900px"
    >
      <div class="flex justify-center overflow-auto">
        <img
          v-if="screenshotImage"
          :src="screenshotSrc"
          alt="设备截图"
          class="max-h-[70vh] max-w-full rounded border border-[rgba(128,128,128,0.2)]"
        />
        <n-empty v-else description="暂无截图，请先执行截图指令" />
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="screenshotVisible = false">关闭</n-button>
          <n-button type="primary" :disabled="!screenshotImage" @click="downloadScreenshot">
            <template #icon>
              <AppIcon name="download" :size="15" />
            </template>
            下载图片
          </n-button>
        </div>
      </template>
    </n-modal>
  </div>

    <!-- 系统自检 -->
    <n-modal v-model:show="diagVisible" preset="card" title="系统自检" class="w-[620px] max-w-[96vw]">
      <n-spin :show="diagLoading">
        <div v-if="diagData" class="space-y-3">
          <div class="flex flex-wrap gap-2">
            <n-tag size="small" :type="diagData.amOk ? 'success' : 'error'" :bordered="false">
              am（activity）{{ diagData.amOk ? '可用' : '不可用' }}
            </n-tag>
            <n-tag size="small" :type="diagData.pmOk ? 'success' : 'error'" :bordered="false">
              pm（package）{{ diagData.pmOk ? '可用' : '不可用' }}
            </n-tag>
          </div>

          <n-alert v-if="!diagData.pmOk" type="warning" :bordered="false">
            <div class="text-xs leading-relaxed">
              <div class="font-medium mb-1">pm 不可用 = 装不了/卸不了 APK</div>
              <div>常见原因是 LSPosed / zygisk 类模块 hook 了 Java 进程，导致 <code>am</code>/<code>pm</code> 连不上系统服务。</div>
              <div class="mt-1">按顺序试：① 重启手机；② 在 LSPosed 里临时关闭作用域含「Android 系统」的模块；③ 给终端 App 开启「卸载模块」；④ 修好后回来点「系统自检」确认。</div>
            </div>
          </n-alert>

          <pre class="text-xs whitespace-pre-wrap break-all max-h-[45vh] overflow-auto bg-black/[0.03] dark:bg-white/[0.05] rounded p-3">{{ diagData.raw }}</pre>
        </div>
      </n-spin>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="runDiag" :loading="diagLoading">重新检测</n-button>
          <n-button @click="diagVisible = false">关闭</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 设备共享 -->
    <n-modal v-model:show="shareVisible" preset="card" title="共享设备" class="w-[560px] max-w-[96vw]">
      <n-spin :show="shareLoading">
        <div class="space-y-3">
          <div class="text-xs opacity-60">共享后，对方能在「设备管理」里看到这台设备。</div>

          <div class="flex flex-wrap items-end gap-2">
            <div class="w-[180px]">
              <div class="text-xs opacity-60 mb-1">账号</div>
              <n-select
                v-model:value="shareUsername"
                filterable
                :options="candidates.map((u) => ({ label: u.username, value: u.username }))"
                placeholder="选择账号"
                size="small"
              />
            </div>
            <div class="w-[130px]">
              <div class="text-xs opacity-60 mb-1">权限</div>
              <n-select
                v-model:value="shareLevel"
                :options="[
                  { label: '只读查看', value: 'view' },
                  { label: '可操作', value: 'control' }
                ]"
                size="small"
              />
            </div>
            <n-button size="small" type="primary" :loading="shareSubmitting" @click="addShare">添加</n-button>
          </div>

          <div class="border-t border-black/[0.06] dark:border-white/[0.08] pt-2">
            <div class="text-xs opacity-60 mb-2">已共享给</div>
            <div v-if="shares.length === 0" class="text-xs opacity-45 py-2">还没有共享给任何人</div>
            <div
              v-for="item in shares"
              :key="item.userId"
              class="flex items-center gap-2 py-1.5 border-b border-black/[0.04] dark:border-white/[0.05] last:border-0"
            >
              <span class="text-sm">{{ item.username }}</span>
              <n-tag size="small" :bordered="false" :type="item.level === 'control' ? 'warning' : 'default'">
                {{ item.level === 'control' ? '可操作' : '只读' }}
              </n-tag>
              <div class="flex-1"></div>
              <n-button size="tiny" quaternary type="error" @click="dropShare(item.userId)">取消共享</n-button>
            </div>
          </div>
        </div>
      </n-spin>
      <template #footer>
        <div class="flex justify-end">
          <n-button @click="shareVisible = false">关闭</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 远程拍照 -->
    <n-modal v-model:show="cameraVisible" preset="card" title="远程拍照" class="w-[560px] max-w-[96vw]">
      <div class="space-y-3">
        <div class="text-xs opacity-55">
          需要手机上装「远程运维 Agent」App 并允许相机权限（纯 shell 版 agent 没有相机能力）。
          拍完只回传这一刻的一张照片，不会持续占用摄像头。
        </div>
        <div class="flex flex-wrap gap-2">
          <n-button
            type="primary"
            :loading="cameraLoading && cameraFacing === 'front'"
            :disabled="cameraLoading"
            @click="takePhoto('front')"
          >
            用前置摄像头拍
          </n-button>
          <n-button
            :loading="cameraLoading && cameraFacing === 'back'"
            :disabled="cameraLoading"
            @click="takePhoto('back')"
          >
            用后置摄像头拍
          </n-button>
        </div>
        <div v-if="cameraImage" class="flex flex-col items-center gap-2">
          <img :src="cameraImage" class="max-h-[60vh] rounded-lg" alt="远程照片" />
          <n-button size="small" @click="savePhoto">保存这张照片</n-button>
        </div>
        <n-empty v-else description="还没有照片" />
      </div>
      <template #footer>
        <div class="flex justify-end">
          <n-button @click="cameraVisible = false">关闭</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 发送通知 -->
    <n-modal v-model:show="notifyVisible" preset="card" title="发送通知到手机" class="w-[520px] max-w-[96vw]">
      <div class="space-y-3">
        <div class="text-xs opacity-55">
          通知会出现在手机通知栏，并自动把通知栏拉下来，方便老人一眼看到。
        </div>

        <div>
          <div class="text-xs opacity-60 mb-1">常用模板</div>
          <div class="flex flex-wrap gap-1.5">
            <n-button v-for="t in NOTIFY_TEMPLATES" :key="t.label" size="tiny" @click="applyNotifyTpl(t)">
              {{ t.label }}
            </n-button>
          </div>
        </div>

        <div>
          <div class="text-xs opacity-60 mb-1">标题</div>
          <n-input v-model:value="notifyForm.title" placeholder="例如：该吃药啦" :maxlength="60" show-count />
        </div>
        <div>
          <div class="text-xs opacity-60 mb-1">内容</div>
          <n-input
            v-model:value="notifyForm.text"
            type="textarea"
            :rows="3"
            placeholder="例如：到时间吃药了，记得喝点温水。"
            :maxlength="500"
            show-count
          />
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="notifyVisible = false">取消</n-button>
          <n-button type="primary" :loading="notifySending" @click="sendNotify">发送</n-button>
        </div>
      </template>
    </n-modal>
</template>
