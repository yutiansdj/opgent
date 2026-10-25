import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Vite 配置：开发服务器把 /api 与 /ws 代理到本地后端
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // @ 指向 src，便于统一使用绝对路径导入
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // HTTP 接口代理
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      },
      // WebSocket 代理（Agent 通道，后台一般用不到，但按要求配置）
      '/ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
    // 移动端/低内存环境：不生成 sourcemap，减少内存占用
    sourcemap: false
  }
})
