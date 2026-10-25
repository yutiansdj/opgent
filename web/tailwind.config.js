/** @type {import('tailwindcss').Config} */
export default {
  // 深色模式交给 NaiveUI 的 darkTheme，这里只保留 Tailwind 的间距/布局能力
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  corePlugins: {
    // 关键：关闭 preflight，避免 Tailwind 的全局重置与 NaiveUI 组件样式冲突
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        // 与 NaiveUI primaryColor 保持一致
        primary: '#2563eb'
      }
    }
  },
  plugins: []
}
