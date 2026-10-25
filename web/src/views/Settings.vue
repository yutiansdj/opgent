<script setup>
import { computed, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import AppIcon from '@/components/AppIcon.vue'
import { fetchSettings, updateSettings } from '@/api/settings'
import { fetchAppFiles, fetchAppFile, saveAppFile, deleteAppFile } from '@/api/appfiles'
import { fetchCacheUsage, cleanCache } from '@/api/maintenance'
import { useAppStore } from '@/stores/app'
import { getApiBase, setApiBase } from '@/utils/auth'
import { requiredRule } from '@/utils/validate'
import { formatDate } from '@/utils/format'

const message = useMessage()
const appStore = useAppStore()

// ------- 服务端系统设置 -------
const loading = ref(false)
const saving = ref(false)
const formRef = ref(null)
const settings = ref({
  siteName: '',
  logRetentionDays: 30,
  allowRegister: false
})

const rules = {
  siteName: requiredRule('请输入站点名称'),
  logRetentionDays: {
    required: true,
    type: 'number',
    message: '请输入日志保留天数',
    trigger: ['input', 'blur']
  }
}

// ------- 缓存维护 -------
const usage = ref(null)
const usageLoading = ref(false)
const cleaning = ref(false)
const keepDays = ref(7)

async function loadUsage() {
  usageLoading.value = true
  try {
    usage.value = await fetchCacheUsage()
  } catch {
    usage.value = null
  } finally {
    usageLoading.value = false
  }
}

function fmtSize(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function doClean(type, all = false) {
  const label = type === 'photos' ? '相册原图' : type === 'uploads' ? '上传文件' : '全部缓存'
  const tip = all ? `确定清空${label}（全部）吗？` : `确定清理 ${keepDays.value} 天前的${label}吗？`
  if (!window.confirm(tip)) return
  cleaning.value = true
  try {
    const r = await cleanCache(type, all ? 0 : keepDays.value)
    const total = Object.values(r || {}).reduce((a, x) => a + (x.freed || 0), 0)
    message.success(`已清理，释放 ${fmtSize(total)}`)
    await loadUsage()
  } catch (e) {
    message.error(e.message || '清理失败')
  } finally {
    cleaning.value = false
  }
}

// ------- 公开脚本目录 /app/ -------
const appFiles = ref([])
const appLoading = ref(false)
const appSelected = ref('')
const appContent = ref('')
const appSaving = ref(false)
const appNewName = ref('')
const appDirty = ref(false)

const appOrigin = computed(() => window.location.origin)

const appUrl = computed(() =>
  appSelected.value ? `${window.location.origin}/app/${appSelected.value}` : ''
)

async function loadAppFiles() {
  appLoading.value = true
  try {
    const data = await fetchAppFiles()
    appFiles.value = data?.list || []
    if (appSelected.value && !appFiles.value.some((f) => f.name === appSelected.value)) {
      appSelected.value = ''
      appContent.value = ''
    }
  } catch (e) {
    message.error(e.message || '读取目录失败')
  } finally {
    appLoading.value = false
  }
}

async function openAppFile(name) {
  if (appDirty.value && !window.confirm('当前文件有未保存的修改，确定要切换吗？')) return
  appLoading.value = true
  try {
    const data = await fetchAppFile(name)
    appSelected.value = name
    appContent.value = data?.content || ''
    appDirty.value = false
  } catch (e) {
    message.error(e.message || '读取失败')
  } finally {
    appLoading.value = false
  }
}

async function saveApp() {
  if (!appSelected.value) return
  appSaving.value = true
  try {
    await saveAppFile(appSelected.value, appContent.value)
    appDirty.value = false
    message.success('已保存并通过 /app/ 对外提供')
    await loadAppFiles()
  } catch (e) {
    message.error(e.message || '保存失败')
  } finally {
    appSaving.value = false
  }
}

async function createApp() {
  const name = appNewName.value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    message.warning('文件名只能包含字母、数字、点、横线、下划线')
    return
  }
  if (appFiles.value.some((f) => f.name === name)) {
    message.warning('同名文件已存在')
    return
  }
  try {
    await saveAppFile(name, '#!/system/bin/sh\n\n')
    appNewName.value = ''
    await loadAppFiles()
    await openAppFile(name)
    message.success('已创建')
  } catch (e) {
    message.error(e.message || '创建失败')
  }
}

async function removeApp(name) {
  if (!window.confirm(`确定删除 ${name} 吗？删除后链接立即失效。`)) return
  try {
    await deleteAppFile(name)
    if (appSelected.value === name) {
      appSelected.value = ''
      appContent.value = ''
    }
    await loadAppFiles()
    message.success('已删除')
  } catch (e) {
    message.error(e.message || '删除失败')
  }
}

async function copyAppUrl() {
  try {
    await navigator.clipboard.writeText(appUrl.value || `${appOrigin.value}/app/`)
    message.success('链接已复制')
  } catch {
    message.warning('浏览器不允许复制')
  }
}

function formatSize(n) {
  if (n < 1024) return `${n} B`
  return `${(n / 1024).toFixed(1)} KB`
}

// ------- 前端本地接口地址 -------
const envBase = import.meta.env.VITE_API_BASE || ''
const apiBaseInput = ref(getApiBase())
const localSaving = ref(false)
const testing = ref(false)

const effectiveBase = computed(() => getApiBase() || '（同源 / 开发代理）')

async function loadSettings() {
  loading.value = true
  try {
    const data = await fetchSettings()
    settings.value = {
      siteName: data?.siteName || appStore.siteName,
      logRetentionDays: Number(data?.logRetentionDays) || 30,
      allowRegister: Boolean(data?.allowRegister)
    }
    if (data?.siteName) appStore.setSiteName(data.siteName)
  } catch (error) {
    message.error(error.message || '系统设置加载失败')
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  saving.value = true
  try {
    const data = await updateSettings({
      siteName: settings.value.siteName.trim(),
      logRetentionDays: Number(settings.value.logRetentionDays),
      allowRegister: settings.value.allowRegister
    })
    if (data?.siteName) appStore.setSiteName(data.siteName)
    message.success('系统设置已保存')
  } catch (error) {
    message.error(error.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// 保存前端接口地址（localStorage 覆盖 .env）。留空表示使用同源/代理。
function saveApiBase(showMessage = true) {
  const value = apiBaseInput.value.trim()
  if (value && !/^https?:\/\//i.test(value)) {
    message.warning('接口地址需以 http:// 或 https:// 开头')
    return false
  }
  setApiBase(value)
  apiBaseInput.value = getApiBase()
  localSaving.value = true
  window.setTimeout(() => (localSaving.value = false), 150)
  if (showMessage) message.success('接口地址已保存，后续请求立即生效')
  return true
}

async function testConnection() {
  if (!saveApiBase(false)) return
  testing.value = true
  try {
    await fetchSettings()
    message.success('连接成功：后端接口可访问')
  } catch (error) {
    message.error(`连接失败：${error.message || '无法访问后端'}，请确认地址与服务状态`)
  } finally {
    testing.value = false
  }
}

function resetApiBase() {
  apiBaseInput.value = envBase
  saveApiBase(false)
  message.success('已恢复为默认接口地址（.env 配置）')
}

onMounted(() => {
  loadSettings()
  loadAppFiles()
  loadUsage()
})
</script>

<template>
  <div class="page-wrap">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="m-0 text-xl font-semibold">系统设置</h2>
        <p class="mt-1 text-sm opacity-55">服务端运行参数与前端接口地址配置</p>
      </div>
      <n-button size="small" :loading="loading" @click="loadSettings">
        <template #icon>
          <AppIcon name="refresh" :size="15" />
        </template>
        重新加载
      </n-button>
    </div>

    <!-- 服务端设置 -->
    <n-card :bordered="false" class="page-card" title="服务端设置">
      <template #header-extra>
        <span class="text-xs opacity-50">保存后写入后端 settings</span>
      </template>
      <n-spin :show="loading">
        <n-form
          ref="formRef"
          :model="settings"
          :rules="rules"
          label-placement="top"
          require-mark-placement="right-hanging"
          class="max-w-[620px]"
        >
          <n-form-item label="站点名称" path="siteName">
            <n-input
              v-model:value="settings.siteName"
              placeholder="显示在顶部导航与登录页"
              :maxlength="40"
            />
          </n-form-item>
          <n-form-item label="日志保留时长（天）" path="logRetentionDays">
            <n-input-number
              v-model:value="settings.logRetentionDays"
              :min="1"
              :max="3650"
              :step="1"
              class="w-full sm:w-[220px]"
            />
            <span class="ml-2 text-xs opacity-50">超期的操作日志由后端定期清理</span>
          </n-form-item>
          <n-form-item label="允许新设备注册">
            <div class="flex items-center gap-2">
              <n-switch v-model:value="settings.allowRegister" />
              <span class="text-xs opacity-55">
                关闭后新设备无法通过 /api/devices/register 自动接入
              </span>
            </div>
          </n-form-item>
        </n-form>
      </n-spin>
      <div class="mt-2 flex justify-end">
        <n-button type="primary" :loading="saving" :disabled="loading" @click="saveSettings">
          保存设置
        </n-button>
      </div>
    </n-card>

    <!-- 前端接口地址 -->
    <n-card :bordered="false" class="page-card" title="缓存维护">
      <div class="text-xs opacity-60 mb-3">
        相册原图、上传过的文件、应用图标都会在服务器留一份缓存。系统每 6 小时自动清理 7 天前的数据。
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div class="rounded-lg border border-black/[0.06] dark:border-white/[0.08] px-3 py-2">
          <div class="text-[11px] opacity-50">相册原图</div>
          <div class="text-sm font-medium">{{ usage ? fmtSize(usage.photos?.bytes) : '—' }}</div>
          <div class="text-[11px] opacity-40">{{ usage?.photos?.files ?? 0 }} 个文件</div>
        </div>
        <div class="rounded-lg border border-black/[0.06] dark:border-white/[0.08] px-3 py-2">
          <div class="text-[11px] opacity-50">上传文件</div>
          <div class="text-sm font-medium">{{ usage ? fmtSize(usage.uploads?.bytes) : '—' }}</div>
          <div class="text-[11px] opacity-40">{{ usage?.uploads?.files ?? 0 }} 个文件</div>
        </div>
        <div class="rounded-lg border border-black/[0.06] dark:border-white/[0.08] px-3 py-2">
          <div class="text-[11px] opacity-50">应用图标</div>
          <div class="text-sm font-medium">{{ usage ? fmtSize(usage.icons?.bytes) : '—' }}</div>
          <div class="text-[11px] opacity-40">{{ usage?.icons?.files ?? 0 }} 个文件</div>
        </div>
        <div class="rounded-lg border border-black/[0.06] dark:border-white/[0.08] px-3 py-2">
          <div class="text-[11px] opacity-50">数据库</div>
          <div class="text-sm font-medium">{{ usage ? fmtSize(usage.database?.bytes) : '—' }}</div>
          <div class="text-[11px] opacity-40">不含日志</div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs opacity-60">保留</span>
        <n-input-number v-model:value="keepDays" size="small" :min="1" :max="365" class="w-[100px]" />
        <span class="text-xs opacity-60">天内的缓存</span>
        <n-button size="small" :loading="cleaning" @click="doClean('photos')">清相册原图</n-button>
        <n-button size="small" :loading="cleaning" @click="doClean('uploads')">清上传文件</n-button>
        <n-button size="small" :loading="cleaning" @click="doClean('all')">全部清理</n-button>
        <n-button size="small" quaternary :loading="usageLoading" @click="loadUsage">刷新</n-button>
      </div>
      <div class="text-[11px] opacity-45 mt-2">
        清相册只删原图，缩略图保留，相册页面照常能用；原图会在下次查看大图时重新从手机拉取。
      </div>
    </n-card>

    <n-card :bordered="false" class="page-card" title="公开脚本目录（/app/）">
      <div class="text-xs opacity-60 mb-3 leading-relaxed">
        这个目录里的文件可以通过 <code>{{ appOrigin }}/app/文件名</code> 直接下载，不需要登录。
        适合放要分发给别人执行的脚本。只有超级管理员能编辑。
      </div>

      <div class="flex flex-wrap items-center gap-2 mb-3">
        <n-input
          v-model:value="appNewName"
          size="small"
          placeholder="新建文件名，如 test.sh"
          class="w-[240px]"
          @keyup.enter="createApp"
        />
        <n-button size="small" type="primary" @click="createApp">新建</n-button>
        <n-button size="small" :loading="appLoading" @click="loadAppFiles">刷新</n-button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-3">
        <!-- 文件列表 -->
        <div class="border border-black/[0.06] dark:border-white/[0.08] rounded-lg overflow-hidden">
          <div
            v-for="f in appFiles"
            :key="f.name"
            class="px-3 py-2 cursor-pointer text-sm border-b border-black/[0.04] dark:border-white/[0.05] last:border-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
            :class="appSelected === f.name ? 'bg-[#2563eb]/10 font-medium' : ''"
            @click="openAppFile(f.name)"
          >
            <div class="mono truncate">{{ f.name }}</div>
            <div class="text-[11px] opacity-45">{{ formatSize(f.size) }} · {{ formatDate(f.mtime) }}</div>
          </div>
          <div v-if="appFiles.length === 0" class="px-3 py-6 text-center text-xs opacity-45">
            目录为空
          </div>
        </div>

        <!-- 编辑器 -->
        <div v-if="appSelected" class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="mono text-xs break-all">{{ appUrl }}</span>
            <n-button size="tiny" @click="copyAppUrl">复制链接</n-button>
            <a :href="appUrl" target="_blank" rel="noopener" class="text-xs text-[#2563eb]">打开</a>
            <div class="flex-1"></div>
            <n-button size="tiny" type="error" quaternary @click="removeApp(appSelected)">删除</n-button>
            <n-button size="tiny" type="primary" :loading="appSaving" @click="saveApp">保存</n-button>
          </div>
          <n-input
            v-model:value="appContent"
            type="textarea"
            :rows="16"
            class="font-mono"
            @update:value="appDirty = true"
          />
          <div class="text-[11px] opacity-45">保存后立即生效，通过上面的链接下载到的就是这份内容</div>
        </div>
        <div v-else class="flex items-center justify-center border border-dashed border-black/[0.08] dark:border-white/[0.1] rounded-lg min-h-[220px] text-xs opacity-45">
          从左侧选一个文件，或先新建
        </div>
      </div>
    </n-card>

    <n-card :bordered="false" class="page-card" title="后端接口地址（前端本地配置）">
      <n-alert type="info" :bordered="false" class="mb-4">
        地址仅填写主机与端口，<b>不要</b>带末尾的 <code>/api</code>。配置保存在浏览器 localStorage，
        会覆盖 <code>.env</code> 中的 <code>VITE_API_BASE</code>，保存后立即生效，无需刷新。
      </n-alert>
      <div class="max-w-[720px]">
        <n-form label-placement="top">
          <n-form-item label="API 基础地址">
            <div class="flex w-full flex-col gap-2 sm:flex-row">
              <n-input
                v-model:value="apiBaseInput"
                placeholder="如 http://127.0.0.1:8787；留空则使用同源 / 开发代理"
                class="min-w-0 flex-1"
                @keyup.enter="saveApiBase()"
              />
              <div class="flex gap-2">
                <n-button type="primary" :loading="localSaving" @click="saveApiBase()">保存</n-button>
                <n-button :loading="testing" @click="testConnection">测试连接</n-button>
                <n-button @click="resetApiBase">恢复默认</n-button>
              </div>
            </div>
          </n-form-item>
        </n-form>
        <div class="grid grid-cols-1 gap-2 text-xs opacity-60 sm:grid-cols-2">
          <div>当前生效地址：<span class="mono">{{ effectiveBase }}</span></div>
          <div>
            .env 默认地址：<span class="mono">{{ envBase || '（空）' }}</span>
          </div>
          <div>
            实际请求前缀：<span class="mono">{{ getApiBase() }}/api</span>
          </div>
          <div>开发环境另有 Vite 代理：/api → http://127.0.0.1:8787</div>
        </div>
      </div>
    </n-card>

    <!-- 关于 -->
    <n-card :bordered="false" class="page-card" title="关于">
      <div class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div class="opacity-70">界面主题：当前为{{ appStore.dark ? '深色' : '浅色' }}模式，可在顶部切换并持久保存。</div>
        <div class="opacity-70">前端版本：v1.0.0（Vue 3 + NaiveUI + Pinia + TailwindCSS）</div>
      </div>
    </n-card>
  </div>
</template>
