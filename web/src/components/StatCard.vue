<script setup>
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

// 仪表盘统计卡片
const props = defineProps({
  label: { type: String, required: true },
  value: { type: [Number, String], default: 0 },
  icon: { type: String, default: 'devices' },
  color: { type: String, default: '#2563eb' },
  hint: { type: String, default: '' },
  loading: { type: Boolean, default: false }
})

// 图标底色使用主色的浅透明版本
const iconStyle = computed(() => ({
  color: props.color,
  background: `${props.color}1a`
}))
</script>

<template>
  <n-card :bordered="false" class="stat-card h-full" content-style="padding:18px 20px">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm opacity-65">{{ props.label }}</div>
        <n-skeleton v-if="props.loading" text :width="70" class="mt-3" />
        <div v-else class="mt-1 text-3xl font-semibold leading-tight tabular-nums">
          {{ props.value }}
        </div>
        <div v-if="props.hint" class="mt-2 text-xs opacity-50">{{ props.hint }}</div>
      </div>
      <div class="flex h-10 w-10 flex-none items-center justify-center rounded-lg" :style="iconStyle">
        <AppIcon :name="props.icon" :size="20" />
      </div>
    </div>
  </n-card>
</template>
