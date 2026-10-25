<script setup>
import { computed } from 'vue'

// 内置线性图标（避免额外引入图标库），按名称渲染 SVG path
const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 18 }
})

const paths = {
  dashboard:
    'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  devices:
    'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm5 15.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM8 5h8v11H8V5z',
  templates:
    'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm3 5h10v2H7V8zm0 4h10v2H7v-2zm0 4h6v2H7v-2z',
  tasks:
    'M9 3h6l1 2h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3l1-2zm-1 8.5-1.5 1.5 3 3L16 9.5 14.5 8 9.5 13l-1.5-1.5z',
  logs:
    'M6 2h8l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm7 1.5V8h4.5L13 3.5zM8 12h8v1.5H8V12zm0 4h8v1.5H8V16zm0-8h4v1.5H8V8z',
  users:
    'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-8 2-8 5v2h16v-2c0-3-4-5-8-5z',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9.4 4a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L16.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  menu: 'M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5 1.5 3h-3L12 2zm0 20-1.5-3h3L12 22zM2 12l3-1.5v3L2 12zm20 0-3 1.5v-3L22 12zM4.9 4.9l3.2 1.3-1.9 1.9L4.9 4.9zm14.2 14.2-3.2-1.3 1.9-1.9 1.3 3.2zM19.1 4.9l-1.3 3.2-1.9-1.9 3.2-1.3zM4.9 19.1l1.3-3.2 1.9 1.9-3.2 1.3z',
  bell: 'M12 2a6 6 0 0 0-6 6v3.6L4 15v2h16v-2l-2-3.4V8a6 6 0 0 0-6-6zm0 20a3 3 0 0 0 3-3H9a3 3 0 0 0 3 3z',
  logout: 'M10 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h5v-2H6V5h4V3zm5.6 3.6L19 10l-3.4 3.4-1.4-1.4 1-1H9v-2h6.2l-1-1 1.4-1.4zM19 12l-2 2v6h-2v-4l-2 2v2h4z',
  key: 'M12.6 10.4a5 5 0 1 0-1.4 1.4l1 1H14v2h2v2h2l3-3v-3.4l-1-1h-7.4zM7 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
  back: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12l4.6-4.6z',
  refresh:
    'M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  download:
    'M12 3v10.2l3.6-3.6L17 11l-5 5-5-5 1.4-1.4L12 13.2V3h0zM5 19h14v2H5v-2z',
  upload:
    'M12 16V5.8L8.4 9.4 7 8l5-5 5 5-1.4 1.4L12 5.8V16h0zM5 19h14v2H5v-2z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z',
  folder:
    'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z',
  'folder-open':
    'M2 6a2 2 0 0 1 2-2h6l2 2h6a2 2 0 0 1 2 2v1H8a2 2 0 0 0-1.9 1.4L4 17.6V6zm2.2 12.3L7.1 11a1 1 0 0 1 1-.7h13.1a1 1 0 0 1 .9 1.4l-2.6 6.6a2 2 0 0 1-1.9 1.2H4.6a1 1 0 0 1-.4-1.2z',
  file:
    'M6 2h7l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm6 1.5V9h4.5L12 3.5z',
  link:
    'M3.9 12c0-1.7 1.4-3.1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7c-1.7 0-3.1-1.4-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.7 0 3.1 1.4 3.1 3.1s-1.4 3.1-3.1 3.1h-4V17h4a5 5 0 0 0 0-10z',
  image:
    'M21 5v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8.5 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5 19h14l-4.5-6-3.5 4.5-2.5-3L5 19z',
  trash:
    'M9 3h6l1 2h4v2H4V5h4l1-2zM6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8zm3 3v8h2v-8H9zm4 0v8h2v-8h-2z',
  edit:
    'M3 17.2V21h3.8L18 9.8 14.2 6 3 17.2zM20.7 7.1a1 1 0 0 0 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0l-1.8 1.8L18.9 9l1.8-1.9z'
}

const path = computed(() => paths[props.name] || paths.dashboard)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path :d="path" />
  </svg>
</template>
