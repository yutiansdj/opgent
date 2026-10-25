<script setup>
// 统一搜索/筛选栏：列表页复用，自带查询与重置按钮
const props = defineProps({
  loading: { type: Boolean, default: false },
  showReset: { type: Boolean, default: true },
  resetDisabled: { type: Boolean, default: false }
})

const emit = defineEmits(['search', 'reset'])
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <!-- 具体的筛选项由页面通过插槽传入 -->
    <div class="flex flex-wrap items-center gap-3">
      <slot />
    </div>
    <div class="flex items-center gap-2">
      <slot name="extra" />
      <n-button type="primary" :loading="props.loading" @click="emit('search')">
        查询
      </n-button>
      <n-button v-if="props.showReset" :disabled="props.resetDisabled" @click="emit('reset')">
        重置
      </n-button>
    </div>
  </div>
</template>
