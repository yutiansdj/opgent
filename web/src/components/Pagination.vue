<script setup>
// 统一分页封装：页码 / 每页条数 / 总条数，双向事件交由列表页处理
const props = defineProps({
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 10 },
  total: { type: Number, default: 0 },
  pageSizes: { type: Array, default: () => [10, 20, 50] },
  showSizePicker: { type: Boolean, default: true }
})

const emit = defineEmits(['update:page', 'update:pageSize', 'change'])

function onPageChange(page) {
  emit('update:page', page)
  emit('change', { page, pageSize: props.pageSize })
}

function onPageSizeChange(size) {
  // 只通知每页条数，页码由父页面自行重置，避免触发两次加载
  emit('update:pageSize', size)
  emit('change', { page: 1, pageSize: size })
}
</script>

<template>
  <n-pagination
    :page="props.page"
    :page-size="props.pageSize"
    :item-count="props.total"
    :page-sizes="props.pageSizes"
    :show-size-picker="props.showSizePicker"
    :show-quick-jumper="false"
    :page-slot="6"
    @update:page="onPageChange"
    @update:page-size="onPageSizeChange"
  />
</template>
