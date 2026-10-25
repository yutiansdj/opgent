<script setup>
import { computed } from 'vue'
import Pagination from './Pagination.vue'

// 列表页统一骨架：标题栏 + 搜索栏 + 数据表格 + 分页
const props = defineProps({
  title: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  columns: { type: Array, required: true },
  data: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 10 },
  pageSizes: { type: Array, default: () => [10, 20, 50] },
  showPagination: { type: Boolean, default: true },
  // NaiveUI 的 row-key 只接受函数，这里默认按 id 取键
  rowKey: { type: Function, default: null },
  scrollX: { type: [Number, String], default: 960 },
  clickableRows: { type: Boolean, default: false },
  showIndex: { type: Boolean, default: false },
  emptyText: { type: String, default: '暂无数据' }
})

const emit = defineEmits(['update:page', 'update:pageSize', 'page-change', 'row-click'])

const rowKeyFn = computed(() => props.rowKey || ((row) => row?.id))

// 可点击行：设备列表点击进入详情
const rowProps = computed(() => {
  if (!props.clickableRows) return undefined
  return (row) => ({
    style: 'cursor: pointer;',
    onClick: () => emit('row-click', row)
  })
})
</script>

<template>
  <n-card :bordered="false" class="page-card w-full" content-style="padding:0">
    <div
      v-if="props.title || $slots.extra"
      class="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
      :class="$slots.search ? '' : 'border-b border-[rgba(128,128,128,0.15)]'"
    >
      <div class="flex items-center gap-2">
        <span class="text-base font-semibold">{{ props.title }}</span>
        <slot name="title-extra" />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <slot name="extra" />
      </div>
    </div>

    <!-- 筛选区 -->
    <div
      v-if="$slots.search"
      class="border-b border-[rgba(128,128,128,0.15)] px-4 py-3"
    >
      <slot name="search" />
    </div>

    <n-data-table
      :columns="props.columns"
      :data="props.data"
      :loading="props.loading"
      :row-key="rowKeyFn"
      :scroll-x="props.scrollX"
      :row-props="rowProps"
      :single-line="false"
      size="small"
      class="w-full"
    >
      <template #empty>
        <div class="py-8 text-center text-sm opacity-60">{{ props.emptyText }}</div>
      </template>
    </n-data-table>

    <!-- 分页区 -->
    <div
      v-if="props.showPagination"
      class="flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(128,128,128,0.15)] px-4 py-3"
    >
      <span class="text-xs opacity-60">共 {{ props.total }} 条</span>
      <Pagination
        :page="props.page"
        :page-size="props.pageSize"
        :total="props.total"
        :page-sizes="props.pageSizes"
        @update:page="(p) => emit('update:page', p)"
        @update:page-size="(s) => emit('update:pageSize', s)"
        @change="(payload) => emit('page-change', payload)"
      />
    </div>
  </n-card>
</template>
