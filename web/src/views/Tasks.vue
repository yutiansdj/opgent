<script setup>
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NProgress, NTag, useDialog, useMessage } from 'naive-ui'
import PageTable from '@/components/PageTable.vue'
import { createTask, fetchTask, fetchTasks } from '@/api/tasks'
import { fetchDevices } from '@/api/devices'
import { commandLabel, formatDateTime, statusLabel, statusTagType } from '@/utils/format'
import { requiredRule } from '@/utils/validate'

const message = useMessage()
const dialog = useDialog()

const loading = ref(false)
const tasks = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
let listTimer = null

// 新建任务
const createVisible = ref(false)
const creating = ref(false)
const formRef = ref(null)
const form = ref({
  name: '',
  type: 'shell',
  command: '',
  packageName: '',
  deviceIds: []
})
const devices = ref([])
const devicesLoading = ref(false)

// 任务详情
const detailVisible = ref(false)
const detailLoading = ref(false)
const currentTask = ref(null)
let detailTimer = null

const typeOptions = [
  { label: 'Shell 命令', value: 'shell' },
  { label: '打开应用', value: 'open_app' },
  { label: '卸载应用', value: 'uninstall_app' },
  { label: '点亮屏幕', value: 'screen_on' },
  { label: '熄屏', value: 'screen_off' },
  { label: '重启设备', value: 'reboot' },
  { label: '关机', value: 'shutdown' }
]

// 需要输入参数的指令类型
const needCommand = computed(() => form.value.type === 'shell')
const needPackage = computed(() => ['open_app', 'uninstall_app'].includes(form.value.type))

const formRules = computed(() => ({
  deviceIds: {
    required: true,
    type: 'array',
    message: '请至少选择一台设备',
    trigger: ['change', 'blur']
  },
  command: needCommand.value ? requiredRule('请输入要执行的命令') : {},
  packageName: needPackage.value ? requiredRule('请输入应用包名') : {}
}))

const percent = (row) => {
  const totalCount = Number(row?.total) || 0
  if (!totalCount) return 0
  return Math.min(100, Math.round(((Number(row.done) || 0) / totalCount) * 100))
}

const columns = [
  {
    title: '任务',
    key: 'name',
    minWidth: 180,
    ellipsis: { tooltip: true },
    render: (row) =>
      h('div', { class: 'leading-tight' }, [
        h('div', { class: 'text-[13px] font-medium truncate' }, row.name || `批量${commandLabel(row.type)}`),
        h('div', { class: 'mono text-[11px] opacity-50' }, row.id)
      ])
  },
  {
    title: '指令',
    key: 'type',
    minWidth: 160,
    render: (row) =>
      h('div', { class: 'leading-tight' }, [
        h('div', { class: 'text-[13px]' }, commandLabel(row.type)),
        h('div', { class: 'mono text-[11px] opacity-50 truncate' }, row.command || '—')
      ])
  },
  {
    title: '进度',
    key: 'progress',
    width: 190,
    render: (row) =>
      h('div', { class: 'flex items-center gap-2' }, [
        h(NProgress, {
          type: 'line',
          percentage: percent(row),
          height: 6,
          showIndicator: false,
          status: row.status === 'done' ? 'success' : 'default',
          style: 'flex: 1'
        }),
        h('span', { class: 'text-[11px] opacity-60 whitespace-nowrap' }, `${row.done ?? 0}/${row.total ?? 0}`)
      ])
  },
  {
    title: '成功 / 失败',
    key: 'success',
    width: 110,
    render: (row) =>
      h('span', { class: 'text-xs' }, [
        h('span', { style: 'color:#18a058' }, String(row.success ?? 0)),
        h('span', { class: 'opacity-40' }, ' / '),
        h('span', { style: 'color:#d03050' }, String(row.failed ?? 0))
      ])
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          bordered: false,
          type: row.status === 'done' ? 'success' : 'info'
        },
        { default: () => (row.status === 'done' ? '已完成' : '执行中') }
      )
  },
  {
    title: '创建时间',
    key: 'createdAt',
    width: 165,
    render: (row) => formatDateTime(row.createdAt)
  },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    fixed: 'right',
    render: (row) =>
      h(
        NButton,
        { size: 'small', quaternary: true, type: 'primary', onClick: () => openDetail(row) },
        { default: () => '查看进度' }
      )
  }
]

async function loadTasks(silent = false) {
  if (!silent) loading.value = true
  try {
    const data = await fetchTasks({ page: page.value, pageSize: pageSize.value })
    tasks.value = data?.list || []
    total.value = data?.total || 0
  } catch (error) {
    if (!silent) message.error(error.message || '任务列表加载失败')
  } finally {
    loading.value = false
  }
}

function onPageUpdate(nextPage) {
  page.value = nextPage
  loadTasks()
}

function onPageSizeUpdate(nextSize) {
  pageSize.value = nextSize
  page.value = 1
  loadTasks()
}

// ------- 新建任务 -------
async function loadDevices() {
  devicesLoading.value = true
  try {
    const data = await fetchDevices({ page: 1, pageSize: 200 })
    devices.value = data?.list || []
  } catch (error) {
    message.error(error.message || '设备列表加载失败')
    devices.value = []
  } finally {
    devicesLoading.value = false
  }
}

function openCreate() {
  form.value = { name: '', type: 'shell', command: '', packageName: '', deviceIds: [] }
  createVisible.value = true
  loadDevices()
}

function buildParams() {
  if (form.value.type === 'shell') return { command: form.value.command }
  if (['open_app', 'uninstall_app'].includes(form.value.type)) {
    return { packageName: form.value.packageName.trim() }
  }
  return {}
}

async function submitCreate() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  // 批量重启 / 关机属于危险操作，创建前二次确认
  if (['reboot', 'shutdown'].includes(form.value.type)) {
    const label = form.value.type === 'reboot' ? '重启' : '关机'
    dialog.warning({
      title: '确认危险批量操作',
      content: `即将对 ${form.value.deviceIds.length} 台设备批量执行「${label}」，执行后这些设备会立即离线，请确认。`,
      positiveText: `确认${label}`,
      negativeText: '取消',
      onPositiveClick: () => performCreate()
    })
    return
  }
  await performCreate()
}

async function performCreate() {
  creating.value = true
  try {
    const payload = {
      deviceIds: form.value.deviceIds,
      type: form.value.type,
      params: buildParams()
    }
    if (form.value.name.trim()) payload.name = form.value.name.trim()
    const data = await createTask(payload)
    message.success(`批量任务已创建：${data?.taskId || ''}`)
    createVisible.value = false
    page.value = 1
    loadTasks()
  } catch (error) {
    message.error(error.message || '创建任务失败')
  } finally {
    creating.value = false
  }
}

// ------- 任务详情与轮询 -------
const itemsColumns = [
  { title: '设备', key: 'deviceName', minWidth: 140, ellipsis: { tooltip: true } },
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
    title: '执行结果',
    key: 'result',
    minWidth: 260,
    ellipsis: { tooltip: true },
    render: (row) => row.result || h('span', { class: 'opacity-40' }, '—')
  },
  {
    title: '完成时间',
    key: 'finishedAt',
    width: 165,
    render: (row) => formatDateTime(row.finishedAt)
  }
]

async function loadDetail(id, silent = false) {
  if (!silent) detailLoading.value = true
  try {
    const data = await fetchTask(id)
    currentTask.value = data
    // 任务完成后停止轮询，并刷新一次列表
    if (data?.status === 'done') {
      stopDetailPolling()
      loadTasks(true)
    }
  } catch (error) {
    if (!silent) message.error(error.message || '任务详情加载失败')
    stopDetailPolling()
  } finally {
    detailLoading.value = false
  }
}

function stopDetailPolling() {
  if (detailTimer) {
    window.clearInterval(detailTimer)
    detailTimer = null
  }
}

function openDetail(row) {
  currentTask.value = row
  detailVisible.value = true
  loadDetail(row.id)
  stopDetailPolling()
  // 未完成的任务每 3 秒轮询一次
  detailTimer = window.setInterval(() => {
    if (!currentTask.value || currentTask.value.status === 'done') {
      stopDetailPolling()
      return
    }
    loadDetail(currentTask.value.id, true)
  }, 3000)
}

function closeDetail() {
  detailVisible.value = false
  stopDetailPolling()
}

onMounted(() => {
  loadTasks()
  // 列表每 15 秒静默刷新，便于观察运行中的任务
  listTimer = window.setInterval(() => loadTasks(true), 15000)
})

onBeforeUnmount(() => {
  if (listTimer) window.clearInterval(listTimer)
  stopDetailPolling()
})
</script>

<template>
  <div class="page-wrap">
    <PageTable
      title="批量任务"
      :columns="columns"
      :data="tasks"
      :loading="loading"
      :total="total"
      :page="page"
      :page-size="pageSize"
      :scroll-x="1180"
      @update:page="onPageUpdate"
      @update:page-size="onPageSizeUpdate"
    >
      <template #extra>
        <n-button size="small" :loading="loading" @click="loadTasks()">刷新</n-button>
        <n-button size="small" type="primary" @click="openCreate">
          <template #icon>
            <span class="text-base leading-none">+</span>
          </template>
          新建批量任务
        </n-button>
      </template>
    </PageTable>

    <!-- 新建任务 -->
    <n-modal
      v-model:show="createVisible"
      preset="card"
      title="新建批量任务"
      class="w-[92vw] max-w-[600px]"
      :mask-closable="false"
    >
      <n-form
        ref="formRef"
        :model="form"
        :rules="formRules"
        label-placement="top"
        require-mark-placement="right-hanging"
      >
        <n-form-item label="选择设备" path="deviceIds">
          <n-select
            v-model:value="form.deviceIds"
            multiple
            filterable
            :loading="devicesLoading"
            :options="devices.map((d) => ({ label: `${d.name || d.id}（${d.online ? '在线' : '离线'}）`, value: d.id }))"
            placeholder="可多选设备"
            :max-tag-count="5"
          />
        </n-form-item>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <n-form-item label="指令类型" path="type">
            <n-select v-model:value="form.type" :options="typeOptions" />
          </n-form-item>
          <n-form-item label="任务名称（可选）" path="name">
            <n-input v-model:value="form.name" placeholder="留空则自动生成" :maxlength="50" />
          </n-form-item>
        </div>
        <n-form-item v-if="needCommand" label="Shell 命令" path="command">
          <n-input
            v-model:value="form.command"
            type="textarea"
            placeholder="如：df -h"
            :autosize="{ minRows: 4, maxRows: 10 }"
            class="mono"
          />
        </n-form-item>
        <n-form-item v-if="needPackage" label="应用包名" path="packageName">
          <n-input v-model:value="form.packageName" placeholder="如 com.tencent.mm" class="mono" />
        </n-form-item>
        <n-alert v-if="form.type === 'reboot' || form.type === 'shutdown'" type="warning" :bordered="false">
          重启 / 关机为危险操作，选中的设备将立即离线，请谨慎批量执行。
        </n-alert>
      </n-form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="createVisible = false">取消</n-button>
          <n-button type="primary" :loading="creating" @click="submitCreate">创建任务</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 任务详情 -->
    <n-modal
      v-model:show="detailVisible"
      preset="card"
      title="任务执行进度"
      style="width: 94vw; max-width: 980px"
      :mask-closable="true"
      @close="closeDetail"
    >
      <n-spin :show="detailLoading && !currentTask">
        <div v-if="currentTask" class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold">
                {{ currentTask.name || `批量${commandLabel(currentTask.type)}` }}
              </div>
              <div class="mono mt-1 text-[11px] opacity-50">{{ currentTask.id }}</div>
            </div>
            <div class="flex items-center gap-2">
              <n-tag :bordered="false" :type="currentTask.status === 'done' ? 'success' : 'info'" size="small">
                {{ currentTask.status === 'done' ? '已完成' : '执行中' }}
              </n-tag>
              <span class="text-xs opacity-55">成功 {{ currentTask.success ?? 0 }} / 失败 {{ currentTask.failed ?? 0 }}</span>
            </div>
          </div>

          <n-progress
            type="line"
            :percentage="percent(currentTask)"
            :height="10"
            :status="currentTask.status === 'done' ? 'success' : 'default'"
            indicator-placement="inside"
          />

          <div class="table-scroll">
            <n-data-table
              :columns="itemsColumns"
              :data="currentTask.items || []"
              :row-key="(row) => row.deviceId"
              :scroll-x="760"
              size="small"
              :bordered="false"
              max-height="360"
            >
              <template #empty>
                <div class="py-6 text-center text-sm opacity-55">暂无执行明细</div>
              </template>
            </n-data-table>
          </div>
        </div>
        <n-empty v-else description="任务加载中" class="py-10" />
      </n-spin>
      <template #footer>
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] opacity-45">
            {{ currentTask?.status === 'done' ? '任务已结束' : '每 3 秒自动刷新进度' }}
          </span>
          <div class="flex gap-2">
            <n-button @click="currentTask && loadDetail(currentTask.id)">刷新</n-button>
            <n-button type="primary" @click="closeDetail">关闭</n-button>
          </div>
        </div>
      </template>
    </n-modal>
  </div>
</template>
