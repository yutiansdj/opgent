<script setup>
import { computed } from 'vue'

// 轻量柱状图：纯 CSS 实现，不额外引入 echarts，减少构建体积
const props = defineProps({
  data: { type: Array, default: () => [] }, // [{date, count}]
  height: { type: Number, default: 200 },
  color: { type: String, default: '#2563eb' }
})

// 最大值为 0 时避免除零
const maxValue = computed(() => {
  const values = props.data.map((item) => Number(item.count) || 0)
  const max = Math.max(0, ...values)
  return max > 0 ? max : 1
})

function heightPercent(count) {
  const value = Number(count) || 0
  if (value <= 0) return '2px'
  // 最低保留 4% 高度，保证 0 值以上的柱子可见
  return `${Math.max(4, (value / maxValue.value) * 100)}%`
}
</script>

<template>
  <div class="w-full">
    <div
      v-if="props.data.length"
      class="flex items-end gap-2 sm:gap-4"
      :style="{ height: `${props.height}px` }"
    >
      <div
        v-for="item in props.data"
        :key="item.date"
        class="group flex h-full flex-1 flex-col items-center justify-end gap-1"
        :title="`${item.date}：${item.count} 次`"
      >
        <span class="text-[11px] leading-none opacity-55">{{ item.count }}</span>
        <div class="flex w-full flex-1 items-end">
          <div
            class="w-full rounded-t transition-opacity group-hover:opacity-80"
            :style="{
              height: heightPercent(item.count),
              background: props.color,
              minHeight: '2px'
            }"
          />
        </div>
        <span class="whitespace-nowrap text-[11px] leading-none opacity-55">
          {{ item.date }}
        </span>
      </div>
    </div>
    <div v-else class="flex items-center justify-center text-sm opacity-50" :style="{ height: `${props.height}px` }">
      暂无图表数据
    </div>
  </div>
</template>
