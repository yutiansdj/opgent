<script setup>
import { computed, h, onMounted, ref } from 'vue'
import { NButton, NTag, useMessage } from 'naive-ui'
import { useRouter } from 'vue-router'
import PageTable from '@/components/PageTable.vue'
import SearchBar from '@/components/SearchBar.vue'
import AppIcon from '@/components/AppIcon.vue'
import { fetchDevices } from '@/api/devices'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/format'

const router = useRouter()
const message = useMessage()
const auth = useAuthStore()

const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)

// 筛选条件：keyword 模糊匹配 name/model/id，online 传 1/0
const filters = ref({ keyword: '', online: '' })

const columns = [
  {
    title: '设备名称',
    key: 'name',
    minWidth: 150,
    ellipsis: { tooltip: true },
    render: (row) =>
      h(
        'div',
        { class: 'flex items-center gap-2 min-w-0' },
        [
          h('span', { class: `status-dot ${row.online ? 'online' : 'offline'}` }),
          h(
            'span',
            {
              class: 'font-medium cursor-pointer text-[#2563eb] truncate',
              onClick: (e) => {
                e.stopPropagation()
                openDetail(row)
              }
            },
            row.name || '未命名设备'
          )
        ]
      )
  },
  {
    title: '设备 ID',
    key: 'id',
    minWidth: 160,
    ellipsis: { tooltip: true },
    render: (row) => h('span', { class: 'mono opacity-75' }, row.id)
  },
  {
    title: '系统版本',
    key: 'androidVersion',
    minWidth: 170,
    render: (row) =>
      h('div', { class: 'leading-tight' }, [
        h('div', null, `Android ${row.androidVersion || '—'}`),
        h('div', { class: 'text-[11px] opacity-50 truncate' }, row.model || '未知型号')
      ])
  },
  {
    title: '在线状态',
    key: 'online',
    width: 100,
    render: (row) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: row.online ? 'success' : 'default' },
        { default: () => (row.online ? '在线' : '离线') }
      )
  },
  {
    title: '最后上线时间',
    key: 'lastSeenAt',
    width: 165,
    render: (row) => formatDateTime(row.lastSeenAt)
  },
  {
    title: '备注',
    key: 'note',
    minWidth: 140,
    ellipsis: { tooltip: true },
    render: (row) => row.note || h('span', { class: 'opacity-40' }, '—')
  },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    fixed: 'right',
    render: (row) =>
      h(
        NButton,
        {
          size: 'small',
          quaternary: true,
          type: 'primary',
          onClick: (e) => {
            e.stopPropagation()
            openDetail(row)
          }
        },
        { default: () => '详情' }
      )
  }
]

async function loadData() {
  loading.value = true
  try {
    const params = {
      page: page.value,
      pageSize: pageSize.value
    }
    if (filters.value.keyword.trim()) params.keyword = filters.value.keyword.trim()
    if (filters.value.online !== '') params.online = filters.value.online
    const data = await fetchDevices(params)
    list.value = data?.list || []
    total.value = data?.total || 0
  } catch (error) {
    message.error(error.message || '设备列表加载失败')
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  page.value = 1
  loadData()
}

function handleReset() {
  filters.value = { keyword: '', online: '' }
  page.value = 1
  loadData()
}

function onPageUpdate(nextPage) {
  page.value = nextPage
  loadData()
}

function onPageSizeUpdate(nextSize) {
  pageSize.value = nextSize
  page.value = 1
  loadData()
}

function openDetail(row) {
  if (!auth.hasPerm('devices')) return
  router.push(`/devices/${row.id}`)
}

const onlineCount = computed(() => list.value.filter((item) => item.online).length)

onMounted(loadData)
</script>

<template>
  <div class="page-wrap">
    <PageTable
      title="设备管理"
      :columns="columns"
      :data="list"
      :loading="loading"
      :total="total"
      :page="page"
      :page-size="pageSize"
      :scroll-x="1180"
      clickable-rows
      @update:page="onPageUpdate"
      @update:page-size="onPageSizeUpdate"
      @row-click="openDetail"
    >
      <template #extra>
        <span class="text-xs opacity-55">当前页在线 {{ onlineCount }} 台</span>
        <n-button size="small" :loading="loading" @click="loadData">
          <template #icon>
            <AppIcon name="refresh" :size="15" />
          </template>
          刷新
        </n-button>
      </template>

      <template #search>
        <SearchBar :loading="loading" @search="handleSearch" @reset="handleReset">
          <n-input
            v-model:value="filters.keyword"
            placeholder="搜索设备名称 / 型号 / ID"
            clearable
            class="w-full sm:w-[260px]"
            @keyup.enter="handleSearch"
          />
          <n-select
            v-model:value="filters.online"
            :options="[
              { label: '全部状态', value: '' },
              { label: '在线', value: '1' },
              { label: '离线', value: '0' }
            ]"
            class="w-[130px]"
          />
        </SearchBar>
      </template>
    </PageTable>
  </div>
</template>
