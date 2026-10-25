<script setup>
import { h, onMounted, ref } from 'vue'
import { NTag, useMessage } from 'naive-ui'
import PageTable from '@/components/PageTable.vue'
import SearchBar from '@/components/SearchBar.vue'
import { exportLogs, fetchLogs } from '@/api/logs'
import { useAppStore } from '@/stores/app'
import {
  commandLabel,
  filenameFromDisposition,
  formatDateTime,
  statusLabel,
  statusTagType,
  toDateOnly
} from '@/utils/format'
import { saveBlob } from '@/utils/download'

const message = useMessage()
const appStore = useAppStore()

const loading = ref(false)
const exporting = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)

const filters = ref({
  keyword: '',
  username: '',
  deviceId: '',
  range: null
})

const columns = [
  {
    type: 'expand',
    renderExpand: (row) =>
      h('pre', { class: 'code-block', style: 'margin: 8px 4px' }, row.result || '（无返回内容）')
  },
  {
    title: '时间',
    key: 'createdAt',
    width: 165,
    render: (row) => formatDateTime(row.createdAt)
  },
  { title: '账号', key: 'username', width: 110, ellipsis: { tooltip: true } },
  {
    title: '设备',
    key: 'deviceName',
    minWidth: 130,
    ellipsis: { tooltip: true },
    render: (row) =>
      h('div', { class: 'leading-tight' }, [
        h('div', { class: 'text-[13px]' }, row.deviceName || '—'),
        h('div', { class: 'mono text-[11px] opacity-45' }, row.deviceId || '')
      ])
  },
  {
    title: '指令',
    key: 'command',
    minWidth: 200,
    ellipsis: { tooltip: true },
    render: (row) =>
      h('div', { class: 'leading-tight' }, [
        h('div', { class: 'text-[13px]' }, commandLabel(row.type)),
        h('div', { class: 'mono text-[11px] opacity-50 truncate' }, row.command || '—')
      ])
  },
  {
    title: '返回结果',
    key: 'result',
    minWidth: 260,
    ellipsis: { tooltip: true },
    render: (row) => row.result || h('span', { class: 'opacity-40' }, '—')
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: (row) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: statusTagType(row.status) },
        { default: () => statusLabel(row.status) }
      )
  },
  {
    title: '耗时',
    key: 'durationMs',
    width: 90,
    render: (row) => (row.durationMs != null ? `${row.durationMs} ms` : '—')
  }
]

// 组装查询参数：时间范围按契约转 YYYY-MM-DD
function buildParams() {
  const params = {}
  if (filters.value.keyword.trim()) params.keyword = filters.value.keyword.trim()
  if (filters.value.username.trim()) params.username = filters.value.username.trim()
  if (filters.value.deviceId.trim()) params.deviceId = filters.value.deviceId.trim()
  if (Array.isArray(filters.value.range) && filters.value.range.length === 2) {
    params.start = toDateOnly(filters.value.range[0])
    params.end = toDateOnly(filters.value.range[1])
  }
  return params
}

async function loadLogs() {
  loading.value = true
  try {
    const data = await fetchLogs({ ...buildParams(), page: page.value, pageSize: pageSize.value })
    list.value = data?.list || []
    total.value = data?.total || 0
  } catch (error) {
    message.error(error.message || '日志加载失败')
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  page.value = 1
  loadLogs()
}

function handleReset() {
  filters.value = { keyword: '', username: '', deviceId: '', range: null }
  page.value = 1
  loadLogs()
}

function onPageUpdate(nextPage) {
  page.value = nextPage
  loadLogs()
}

function onPageSizeUpdate(nextSize) {
  pageSize.value = nextSize
  page.value = 1
  loadLogs()
}

// 导出 CSV：留空 page/pageSize，仅带筛选条件
async function handleExport() {
  exporting.value = true
  try {
    const response = await exportLogs(buildParams())
    const blob = response.data instanceof Blob ? response.data : new Blob([response.data])
    if (blob.type && blob.type.includes('application/json')) {
      const text = await blob.text()
      let msg = '导出失败'
      try {
        msg = JSON.parse(text)?.error?.message || msg
      } catch {
        /* 忽略解析错误 */
      }
      throw new Error(msg)
    }
    const disposition = response.headers?.['content-disposition']
    const name =
      filenameFromDisposition(disposition, '') ||
      `${appStore.siteName || '操作日志'}-${toDateOnly(Date.now())}.csv`
    saveBlob(blob, name)
    message.success('导出已开始')
  } catch (error) {
    message.error(error.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(loadLogs)
</script>

<template>
  <div class="page-wrap">
    <PageTable
      title="操作日志"
      :columns="columns"
      :data="list"
      :loading="loading"
      :total="total"
      :page="page"
      :page-size="pageSize"
      :scroll-x="1280"
      @update:page="onPageUpdate"
      @update:page-size="onPageSizeUpdate"
    >
      <template #extra>
        <n-button size="small" :loading="loading" @click="loadLogs">刷新</n-button>
        <n-button size="small" type="primary" :loading="exporting" @click="handleExport">
          导出 CSV
        </n-button>
      </template>

      <template #search>
        <SearchBar :loading="loading" @search="handleSearch" @reset="handleReset">
          <n-input
            v-model:value="filters.keyword"
            placeholder="关键词：指令 / 返回结果"
            clearable
            class="w-full sm:w-[200px]"
            @keyup.enter="handleSearch"
          />
          <n-input
            v-model:value="filters.username"
            placeholder="操作账号"
            clearable
            class="w-full sm:w-[140px]"
            @keyup.enter="handleSearch"
          />
          <n-input
            v-model:value="filters.deviceId"
            placeholder="设备 ID"
            clearable
            class="w-full sm:w-[150px]"
            @keyup.enter="handleSearch"
          />
          <n-date-picker
            v-model:value="filters.range"
            type="daterange"
            clearable
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            class="w-full sm:w-[260px]"
          />
        </SearchBar>
      </template>
    </PageTable>
  </div>
</template>
