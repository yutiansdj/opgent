<script setup>
/**
 * 项目管理
 * 每个项目 = 一段业务 shell 脚本 + 一个专属设备 token。
 * 生成的注入脚本会把业务脚本放前面、把「对接段」固定放在最后，
 * 然后可以一键推送到设备执行。
 */
import { computed, onMounted, ref } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import AppIcon from '@/components/AppIcon.vue'
import {
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
  resetProjectToken,
  downloadProjectScript,
  injectProject
} from '@/api/projects'
import { fetchDevices } from '@/api/devices'
import { saveBlob } from '@/utils/download'
import { PROJECT_TEMPLATES } from '@/constants/projectTemplates'
import { INTEGRATION_SAMPLES, getSample } from '@/constants/integrationSamples'
import { formatDateTime } from '@/utils/format'

const message = useMessage()
const dialog = useDialog()

const loading = ref(false)
const list = ref([])

/* ---------------- 新建 / 编辑 ---------------- */
const editVisible = ref(false)
const editing = ref(null) // null=新建
const form = ref({ name: '', script: '', quietInstall: true, encrypt: false, binary: false })
const submitting = ref(false)
const fileInput = ref(null)

const editTitle = computed(() => (editing.value ? '编辑项目' : '新建项目'))

/** 套用脚本模板 */
function applyTemplate(key) {
  const t = PROJECT_TEMPLATES.find((x) => x.key === key)
  if (!t) return
  form.value.script = t.script
  if (!form.value.name.trim()) form.value.name = t.name
  message.success(`已套用模板：${t.name}`)
}

const templateOptions = PROJECT_TEMPLATES.map((t) => ({ label: t.name, value: t.key }))

/* ---------- 多语言对接模板（按项目生成） ---------- */
const samplesVisible = ref(false)
const sampleKey = ref('cpp')
const sampleProjectId = ref('')
const sampleDeviceName = ref('我的设备')
const publicBase = ref('')

const currentSample = computed(() => getSample(sampleKey.value))
const currentProject = computed(() => list.value.find((p) => p.id === sampleProjectId.value) || null)

/** 把模板里的占位替换成当前项目的真实信息 */
const renderedCode = computed(() => {
  const p = currentProject.value
  const base = publicBase.value || 'https://43.251.226.134'
  const token = p?.token || 'dt_你的项目token'
  const name = String(sampleDeviceName.value || '').trim() || '我的设备'
  return currentSample.value.code
    .split('https://43.251.226.134').join(base)
    .split('dt_你的项目token').join(token)
    .split('我的设备').join(name)
})

async function openSamples(presetId) {
  samplesVisible.value = true
  if (presetId) sampleProjectId.value = presetId
  else if (!sampleProjectId.value && list.value.length) sampleProjectId.value = list.value[0].id
  if (!publicBase.value) {
    try {
      const { fetchSiteInfo } = await import('@/api/site')
      const info = await fetchSiteInfo()
      publicBase.value = info?.publicBase || ''
      if (!sampleDeviceName.value) sampleDeviceName.value = '我的设备'
    } catch {
      /* 拿不到就用默认地址 */
    }
  }
}

async function copySample() {
  try {
    await navigator.clipboard.writeText(renderedCode.value)
    message.success(`已复制 ${currentSample.value.name} 模板`)
  } catch {
    message.warning('浏览器不允许复制，请手动选中')
  }
}

/** 下载当前语言的对接模板文件 */
function downloadSample() {
  if (!currentProject.value) {
    message.warning('请先选择项目')
    return
  }
  const blob = new Blob([renderedCode.value], { type: 'text/plain;charset=utf-8' })
  const safeName = (currentProject.value.name || 'project').replace(/[\\/:*?"<>|]/g, '_')
  saveBlob(blob, `${safeName}-agent.${currentSample.value.ext}`)
  message.success('已下载')
}

async function load() {
  loading.value = true
  try {
    const data = await fetchProjects()
    list.value = data?.list || []
  } catch (error) {
    message.error(error.message || '项目列表加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.value = { name: '', script: '#!/system/bin/sh\n\n', silent: true, encrypt: false }
  editVisible.value = true
}

function openEdit(row) {
  editing.value = row
  form.value = {
    name: row.name,
    script: row.script || '',
    // 兼容旧字段名 silent
    quietInstall: row.options?.quietInstall !== undefined ? row.options.quietInstall !== false : row.options?.silent !== false,
    encrypt: !!row.options?.encrypt,
    binary: !!row.options?.binary
  }
  editVisible.value = true
}

function pickFile() {
  fileInput.value?.click()
}

function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    form.value.script = String(reader.result || '')
    if (!form.value.name) form.value.name = file.name.replace(/\.sh$/i, '')
    message.success(`已读取 ${file.name}`)
  }
  reader.readAsText(file, 'utf-8')
  e.target.value = ''
}

async function submit() {
  const name = form.value.name.trim()
  if (!name) {
    message.warning('请填写项目名称')
    return
  }
  submitting.value = true
  try {
    const payload = {
      name,
      script: form.value.script,
      options: { quietInstall: form.value.quietInstall, encrypt: form.value.encrypt, binary: form.value.binary }
    }
    if (editing.value) {
      await updateProject(editing.value.id, payload)
      message.success('项目已更新')
    } else {
      await createProject(payload)
      message.success('项目已创建')
    }
    editVisible.value = false
    await load()
  } catch (error) {
    message.error(error.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

/* ---------------- 操作 ---------------- */
async function copyToken(row) {
  try {
    await navigator.clipboard.writeText(row.token)
    message.success('token 已复制')
  } catch {
    message.warning('浏览器不允许复制，请手动选中')
  }
}

async function downloadScript(row) {
  const hide = message.loading('正在生成…', { duration: 0 })
  try {
    const res = await downloadProjectScript(row.id)
    // 无论普通脚本还是二进制，统一用 .sh 后缀
    saveBlob(res.data, `${row.name}-inject.sh`)
    message.success('已下载')
  } catch (error) {
    message.error(error.message || '下载失败')
  } finally {
    hide.destroy()
  }
}

function confirmResetToken(row) {
  dialog.warning({
    title: '重置 token',
    content: `重置后，属于该项目的 ${row.deviceCount || 0} 台设备会失去归属，需要重新注入才能回来。确定吗？`,
    positiveText: '重置',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await resetProjectToken(row.id)
        message.success('token 已重置')
        await load()
      } catch (error) {
        message.error(error.message || '重置失败')
      }
    }
  })
}

function confirmDelete(row) {
  dialog.warning({
    title: '删除项目',
    content: `确定删除项目「${row.name}」吗？设备不会被删除，只会解除归属。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deleteProject(row.id)
        message.success('已删除')
        await load()
      } catch (error) {
        message.error(error.message || '删除失败')
      }
    }
  })
}

/* ---------------- 一键注入 ---------------- */
const injectVisible = ref(false)
const injectTarget = ref(null)
const devices = ref([])
const deviceLoading = ref(false)
const selectedIds = ref([])
const injectResults = ref([])
const injecting = ref(false)

const deviceOptions = computed(() =>
  devices.value.map((d) => ({
    label: `${d.name || d.id}${d.online ? '' : '（离线）'}${d.projectName ? ` · ${d.projectName}` : ''}`,
    value: d.id,
    disabled: !d.online
  }))
)

async function openInject(row) {
  injectTarget.value = row
  injectResults.value = []
  selectedIds.value = []
  injectVisible.value = true
  deviceLoading.value = true
  try {
    const data = await fetchDevices({ page: 1, pageSize: 100 })
    devices.value = data?.list || []
  } catch (error) {
    message.error(error.message || '设备列表加载失败')
    devices.value = []
  } finally {
    deviceLoading.value = false
  }
}

async function doInject() {
  if (selectedIds.value.length === 0) {
    message.warning('请选择至少一台设备')
    return
  }
  injecting.value = true
  injectResults.value = []
  try {
    const data = await injectProject(injectTarget.value.id, selectedIds.value)
    injectResults.value = data?.results || []
    const ok = injectResults.value.filter((r) => r.status === 'success').length
    message.success(`已注入 ${ok}/${injectResults.value.length} 台`)
    await load()
  } catch (error) {
    message.error(error.message || '注入失败')
  } finally {
    injecting.value = false
  }
}

onMounted(load)
</script>
<template>
  <div class="page-wrap">
    <n-card :bordered="false" class="!rounded-xl">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <div class="text-base font-semibold">项目管理</div>
        <span class="text-xs opacity-55">每个项目有专属 token；注入脚本的「对接段」固定放在末尾</span>
        <div class="flex-1"></div>
        <n-button size="small" :loading="loading" @click="load">
          <template #icon><AppIcon name="refresh" :size="15" /></template>
          刷新
        </n-button>
        <n-button size="small" @click="openSamples()">对接模板</n-button>
        <n-button size="small" type="primary" @click="openCreate">新建项目</n-button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[980px]">
          <thead>
            <tr class="text-left text-xs opacity-60 border-b border-black/[0.06] dark:border-white/[0.08]">
              <th class="py-2 pr-3 font-medium">项目名称</th>
              <th class="py-2 pr-3 font-medium">专属 token</th>
              <th class="py-2 pr-3 font-medium w-[80px]">设备数</th>
              <th class="py-2 pr-3 font-medium w-[100px]">归属</th>
              <th class="py-2 pr-3 font-medium w-[90px]">选项</th>
              <th class="py-2 pr-3 font-medium w-[160px]">创建时间</th>
              <th class="py-2 font-medium w-[330px]">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in list" :key="row.id" class="border-b border-black/[0.04] dark:border-white/[0.05]">
              <td class="py-2 pr-3">
                <div class="font-medium">{{ row.name }}</div>
                <div class="text-[11px] opacity-45 mono">{{ row.id }}</div>
              </td>
              <td class="py-2 pr-3">
                <a class="cursor-pointer text-[#2563eb] mono text-xs break-all" @click="copyToken(row)">{{ row.token }}</a>
              </td>
              <td class="py-2 pr-3">{{ row.deviceCount ?? 0 }} 台</td>
              <td class="py-2 pr-3 opacity-70">{{ row.ownerName || '—' }}</td>
              <td class="py-2 pr-3">
                <div class="flex flex-wrap gap-1">
                  <n-tag v-if="row.options?.quietInstall ?? row.options?.silent" size="small" :bordered="false">静默</n-tag>
                  <n-tag v-if="row.options?.encrypt" size="small" type="warning" :bordered="false">加密</n-tag>
                  <n-tag v-if="row.options?.binary" size="small" type="error" :bordered="false">二进制</n-tag>
                </div>
              </td>
              <td class="py-2 pr-3 opacity-70">{{ formatDateTime(row.createdAt) }}</td>
              <td class="py-2">
                <div class="flex flex-wrap gap-1">
                  <n-button size="tiny" quaternary type="primary" @click="openEdit(row)">编辑</n-button>
                  <n-button size="tiny" quaternary type="primary" @click="downloadScript(row)">下载脚本</n-button>
                  <n-button size="tiny" quaternary type="primary" @click="openSamples(row.id)">对接模板</n-button>
                  <n-button size="tiny" quaternary type="primary" @click="openInject(row)">一键注入</n-button>
                  <n-button size="tiny" quaternary @click="confirmResetToken(row)">重置 token</n-button>
                  <n-button size="tiny" quaternary type="error" @click="confirmDelete(row)">删除</n-button>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && list.length === 0">
              <td colspan="7" class="py-10 text-center text-sm opacity-45">
                还没有项目，点右上角「新建项目」，上传或粘贴你的 .sh 脚本
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </n-card>

    <!-- 新建 / 编辑 -->
    <n-modal v-model:show="editVisible" preset="card" :title="editTitle" class="w-[760px] max-w-[96vw]">
      <div class="space-y-3">
        <div>
          <div class="text-xs opacity-60 mb-1">项目名称</div>
          <n-input v-model:value="form.name" placeholder="例如：自动签到" />
        </div>

        <div>
          <div class="flex items-center gap-2 mb-1">
            <div class="text-xs opacity-60">业务脚本（.sh）</div>
            <div class="flex-1"></div>
            <n-select
              :value="null"
              size="tiny"
              class="w-[150px]"
              placeholder="套用模板…"
              :options="templateOptions"
              @update:value="applyTemplate"
            />
            <n-button size="tiny" @click="pickFile">上传 .sh 文件</n-button>
            <input ref="fileInput" type="file" accept=".sh,.txt" class="hidden" @change="onFileChange" />
          </div>
          <n-input v-model:value="form.script" type="textarea" :rows="14" placeholder="粘贴你的 shell 脚本内容…" />
          <div class="text-[11px] opacity-50 mt-1">
            脚本会原样执行；平台会自动把「对接段」追加到最后（业务脚本里写 exit 也不会影响它）。
          </div>
        </div>

        <div class="space-y-2">
          <n-checkbox v-model:checked="form.quietInstall">
            隐藏对接提示（只静默安装/连接过程的输出，业务脚本自己的输出照常打印）
          </n-checkbox>
          <div>
            <n-checkbox v-model:checked="form.encrypt">
              加密：自研置换加密（文件里没有明文，解密表由后端下发）
            </n-checkbox>
            <div class="text-[11px] opacity-50 mt-1">
              加密后每次下载都会生成新的密文和下载码，旧文件不受影响。
            </div>
          </div>
          <div>
            <n-checkbox v-model:checked="form.binary">
              输出二进制文件（服务器把脚本编译成 arm64 可执行文件，看不到脚本内容）
            </n-checkbox>
            <div class="text-[11px] opacity-50 mt-1">
              仅支持 arm64 设备；下载到的是可直接运行的程序（不是 .sh），一键注入会直接执行它。
              与「加密」同时开启时以二进制为准。
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="editVisible = false">取消</n-button>
          <n-button type="primary" :loading="submitting" @click="submit">保存</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 一键注入 -->
    <n-modal v-model:show="injectVisible" preset="card" title="一键注入" class="w-[620px] max-w-[96vw]">
      <div class="space-y-3">
        <div class="text-xs opacity-60">项目：<b>{{ injectTarget?.name }}</b> —— 注入后设备会切换到该项目的 token</div>
        <n-select
          v-model:value="selectedIds"
          multiple
          filterable
          :options="deviceOptions"
          :loading="deviceLoading"
          placeholder="选择要注入的设备（离线设备不可选）"
        />
        <div v-if="injectResults.length" class="space-y-1 max-h-[240px] overflow-auto">
          <div v-for="r in injectResults" :key="r.deviceId" class="text-xs flex items-center gap-2">
            <n-tag size="small" :bordered="false" :type="r.status === 'success' ? 'success' : 'error'">
              {{ r.status === 'success' ? '成功' : '失败' }}
            </n-tag>
            <span class="mono opacity-60">{{ r.deviceId }}</span>
            <span class="opacity-70">{{ r.message }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="injectVisible = false">关闭</n-button>
          <n-button type="primary" :loading="injecting" @click="doInject">
            开始注入（{{ selectedIds.length }} 台）
          </n-button>
        </div>
      </template>
    </n-modal>

    <!-- 多语言对接模板 -->
    <n-modal v-model:show="samplesVisible" preset="card" title="多语言对接模板" class="w-[920px] max-w-[96vw]">
      <div class="space-y-3">
        <div class="text-xs opacity-55 leading-relaxed">
          按项目生成：自动填入该项目的 token 和服务器地址，下载下来就能用。
        </div>

        <div class="flex flex-wrap items-end gap-3">
          <div class="w-[200px]">
            <div class="text-xs opacity-60 mb-1">项目</div>
            <n-select
              v-model:value="sampleProjectId"
              size="small"
              filterable
              :options="list.map((p) => ({ label: p.name, value: p.id }))"
              placeholder="选择项目"
            />
          </div>
          <div class="w-[220px]">
            <div class="text-xs opacity-60 mb-1">设备名称</div>
            <n-input v-model:value="sampleDeviceName" size="small" placeholder="我的设备" />
            <div class="text-[11px] opacity-45 mt-1">只用于首次注册时在后台显示，之后可改</div>
          </div>
          <div class="flex-1"></div>
          <div class="text-[11px] opacity-50">服务器：{{ publicBase || '（默认）' }}</div>
        </div>

        <div class="flex flex-wrap gap-1.5">
          <n-button
            v-for="s in INTEGRATION_SAMPLES"
            :key="s.key"
            size="small"
            :type="sampleKey === s.key ? 'primary' : 'default'"
            @click="sampleKey = s.key"
          >
            {{ s.name }}
          </n-button>
        </div>

        <div class="text-xs opacity-55">{{ currentSample.desc }}</div>
        <pre class="text-[11px] leading-relaxed whitespace-pre max-h-[46vh] overflow-auto bg-black/[0.03] dark:bg-white/[0.05] rounded p-3">{{ renderedCode }}</pre>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button :disabled="!currentProject" @click="downloadSample">下载文件</n-button>
          <n-button @click="copySample">复制代码</n-button>
          <n-button @click="samplesVisible = false">关闭</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>
