<script setup>
import { computed } from 'vue'
import {
  NConfigProvider,
  NDialogProvider,
  NGlobalStyle,
  NLoadingBarProvider,
  NMessageProvider,
  NNotificationProvider,
  darkTheme
} from 'naive-ui'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

// 手动深浅色切换：默认浅色，深色使用 NaiveUI 官方 darkTheme
const theme = computed(() => (appStore.dark ? darkTheme : null))

// 企业蓝主色调，统一圆角
const themeOverrides = {
  common: {
    primaryColor: '#2563eb',
    primaryColorHover: '#3b82f6',
    primaryColorPressed: '#1d4ed8',
    primaryColorSuppl: '#3b82f6',
    borderRadius: '6px',
    borderRadiusSmall: '4px'
  },
  Card: {
    borderRadius: '8px'
  }
}
</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="themeOverrides">
    <n-loading-bar-provider>
      <n-message-provider :max="3">
        <n-dialog-provider>
          <n-notification-provider :max="3">
            <!-- 注入全局 body 背景色，跟随主题 -->
            <n-global-style />
            <router-view />
          </n-notification-provider>
        </n-dialog-provider>
      </n-message-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>
