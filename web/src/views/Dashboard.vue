<script setup>
import { computed, h, onMounted, ref } from 'vue'
import { NTag, useMessage } from 'naive-ui'
import { useRouter } from 'vue-router'
import StatCard from '@/components/StatCard.vue'
import BarChart from '@/components/BarChart.vue'
import AppIcon from '@/components/AppIcon.vue'
import { fetchOverview } from '@/api/dashboard'
import { fetchDevices } from '@/api/devices'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime, statusLabel, statusTagType } from '@/utils/format'

const router = useRouter()
const message = useMessage()
const auth = useAuthStore()

const loading = ref(false)
const devicesLoading = ref(false)
const overview = ref({
  devices: { total: 0, online: 0, offline: 0 },
  logChart: [],
  recentLogs: [],
  todayCommands: 0
})
const deviceList = ref([])

const stats = computed(() => [
  {
    label: '设备总数',
    value: overview.value.devices?.total ?? 0,
    icon: 'devices',
    color: '#2563eb',
    hint: '已接入平台的设备'
  },
  {
    label: '在线设备',
    value: overview.value.devices?.online ?? 0,
    icon: 'dashboard',
    color: '#18a058',
    hint: '心跳 90s 内视为在线'
  },
  {
    label: '离线设备',
    value: overview.value.devices?.offline ?? 0,
    icon: 'devices',
    color: '#8b8b8b',
    hint: '超过 90s 未上报心跳'
  },
  {
    label: '今日指令',
    value: overview.value.todayCommands ?? 0,
    icon: 'tasks',
    color: '#f0a020',
    hint: '今日下发的指令总数'
  }
])

// 最近 7 天操作日志柱状图数据
const chartData = computed(() => overview.value.logChart || [])
const recentLogs = computed(() => overview.value.recentLogs || [])

const columns = [
  { title: '指令', key: 'command', minWidth: 140, ellipsis: { tooltip: true } },
  { title: '设备', key: 'deviceName', minWidth: 130, ellipsis: { tooltip: true } },
  { title: '操作人', key: 'username', width: 100 },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: (row) =>
      h(
        NTag,
        { size: 'small', type: statusTagType(row.status), bordered: false },
        { default: () => statusLabel(row.status) }
      )
  },
  {
    title: '时间',
    key: 'createdAt',
    width: 165,
    render: (row) => formatDateTime(row.createdAt)
  }
]

// 快速操作入口（按权限过滤）
const quickActions = computed(() => {
  const actions = [
    { title: '设备管理', desc: '查看设备状态、下发远程指令', icon: 'devices', path: '/devices', perm: 'devices' },
    { title: '命令模板', desc: '管理常用命令并一键下发', icon: 'templates', path: '/templates', perm: 'templates' },
    { title: '批量任务', desc: '多设备批量执行与进度跟踪', icon: 'tasks', path: '/tasks', perm: 'tasks' }
  ]
  return actions.filter((item) => auth.hasPerm(item.perm))
})

async function loadOverview() {
  loading.value = true
  try {
    overview.value = await fetchOverview()
  } catch (error) {
    message.error(error.message || '仪表盘数据加载失败')
  } finally {
    loading.value = false
  }
}

// 设备在线状态可视化列表：直接使用设备列表接口的真实数据
async function loadDevices() {
  if (!auth.hasPerm('devices')) return
  devicesLoading.value = true
  try {
    const data = await fetchDevices({ page: 1, pageSize: 100 })
    deviceList.value = data?.list || []
  } catch (error) {
    message.error(error.message || '设备列表加载失败')
  } finally {
    devicesLoading.value = false
  }
}

function refreshAll() {
  loadOverview()
  loadDevices()
}

function openDevice(device) {
  if (auth.hasPerm('devices')) router.push(`/devices/${device.id}`)
}

onMounted(refreshAll)
</script>

<template>
  <div class="page-wrap">
    <!-- 页头 -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="m-0 text-xl font-semibold">仪表盘</h2>
        <p class="mt-1 text-sm opacity-55">设备总览、近期操作与快捷入口</p>
      </div>
      <n-button :loading="loading || devicesLoading" @click="refreshAll">
        <template #icon>
          <AppIcon name="refresh" :size="16" />
        </template>
        刷新
      </n-button>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        v-for="item in stats"
        :key="item.label"
        :label="item.label"
        :value="item.value"
        :icon="item.icon"
        :color="item.color"
        :hint="item.hint"
        :loading="loading"
      />
    </div>

    <!-- 图表 + 设备在线状态 -->
    <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <n-card :bordered="false" class="page-card" title="近 7 天操作日志">
        <template #header-extra>
          <span class="text-xs opacity-50">单位：次</span>
        </template>
        <n-skeleton v-if="loading && !chartData.length" height="200px" />
        <BarChart v-else :data="chartData" :height="200" />
      </n-card>

      <n-card :bordered="false" class="page-card" title="设备在线状态">
        <template #header-extra>
          <n-tag size="small" :bordered="false" type="success">
            在线 {{ overview.devices?.online ?? 0 }}
          </n-tag>
        </template>
        <n-spin :show="devicesLoading">
          <div v-if="!auth.hasPerm('devices')" class="py-10 text-center text-sm opacity-55">
            暂无设备管理权限
          </div>
          <n-empty
            v-else-if="!deviceList.length"
            description="暂无设备，请先在安卓端接入"
            class="py-8"
          />
          <div v-else class="max-h-[240px] space-y-1 overflow-y-auto pr-1">
            <div
              v-for="device in deviceList"
              :key="device.id"
              class="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-[rgba(128,128,128,0.08)]"
              @click="openDevice(device)"
            >
              <div class="flex min-w-0 items-center gap-2">
                <span class="status-dot" :class="device.online ? 'online' : 'offline'" />
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium">{{ device.name || device.id }}</div>
                  <div class="truncate text-[11px] opacity-50">
                    {{ device.model || '未知型号' }} · 电量 {{ device.battery ?? '—' }}%
                  </div>
                </div>
              </div>
              <div class="flex-none text-right">
                <div class="text-xs" :class="device.online ? 'text-[#18a058]' : 'opacity-50'">
                  {{ device.online ? '在线' : '离线' }}
                </div>
                <div class="text-[11px] opacity-45">{{ formatDateTime(device.lastSeenAt) }}</div>
              </div>
            </div>
          </div>
        </n-spin>
      </n-card>
    </div>

    <!-- 快速操作入口 -->
    <div v-if="quickActions.length" class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <n-card
        v-for="action in quickActions"
        :key="action.path"
        :bordered="false"
        class="page-card cursor-pointer transition hover:opacity-85"
        content-style="padding:16px 18px"
        @click="router.push(action.path)"
      >
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-[rgba(37,99,235,0.1)] text-primary">
            <AppIcon :name="action.icon" :size="20" />
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold">{{ action.title }}</div>
            <div class="truncate text-xs opacity-55">{{ action.desc }}</div>
          </div>
        </div>
      </n-card>
    </div>

    <!-- 最近操作日志 -->
    <n-card :bordered="false" class="page-card" title="最近操作日志">
      <template #header-extra>
        <n-button
          v-if="auth.hasPerm('logs')"
          text
          type="primary"
          size="small"
          @click="router.push('/logs')"
        >
          查看全部
        </n-button>
      </template>
      <n-data-table
        :columns="columns"
        :data="recentLogs"
        :loading="loading"
        :bordered="false"
        size="small"
        :scroll-x="720"
        :row-key="(row) => row.id"
      >
        <template #empty>
          <div class="py-6 text-center text-sm opacity-55">暂无操作记录</div>
        </template>
      </n-data-table>
    </n-card>
  </div>
</template>
