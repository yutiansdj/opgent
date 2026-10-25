<script setup>
import { computed, h, onMounted, ref } from 'vue'
import { NButton, NSpace, useDialog, useMessage } from 'naive-ui'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import PageTable from '@/components/PageTable.vue'
import {
  createTemplate,
  deleteTemplate,
  fetchTemplates,
  runTemplate,
  updateTemplate
} from '@/api/templates'
import { fetchDevices } from '@/api/devices'
import { formatDateTime } from '@/utils/format'
import { requiredRule } from '@/utils/validate'

const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const auth = useAuthStore()

const loading = ref(false)
const templates = ref([])
const keyword = ref('')

// 新增 / 编辑弹窗
const modalVisible = ref(false)
const submitting = ref(false)
const editingId = ref('')
const formRef = ref(null)
const form = ref({ name: '', command: '', description: '' })

const formRules = {
  name: requiredRule('请输入模板名称'),
  command: requiredRule('请输入要执行的命令')
}

// 下发弹窗
const runVisible = ref(false)
const runSubmitting = ref(false)
const runTemplateRow = ref(null)
const runDeviceIds = ref([])
const devices = ref([])
const devicesLoading = ref(false)

const filteredTemplates = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return templates.value
  return templates.value.filter((item) =>
    [item.name, item.command, item.description, item.createdBy]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(kw))
  )
})

const columns = [
  {
    title: '模板名称',
    key: 'name',
    minWidth: 160,
    ellipsis: { tooltip: true },
    render: (row) => h('span', { class: 'font-medium' }, row.name)
  },
  {
    title: '命令',
    key: 'command',
    minWidth: 260,
    ellipsis: { tooltip: true },
    render: (row) => h('span', { class: 'mono opacity-80' }, row.command)
  },
  {
    title: '描述',
    key: 'description',
    minWidth: 160,
    ellipsis: { tooltip: true },
    render: (row) => row.description || h('span', { class: 'opacity-40' }, '—')
  },
  {
    title: '创建人',
    key: 'createdBy',
    width: 110,
    render: (row) => row.createdBy || '—'
  },
  {
    title: '创建时间',
    key: 'createdAt',
    width: 165,
    render: (row) => formatDateTime(row.createdAt)
  },
  {
    title: '操作',
    key: 'actions',
    width: 210,
    fixed: 'right',
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, {
        default: () => [
          h(
            NButton,
            { size: 'small', quaternary: true, type: 'primary', onClick: () => openRun(row) },
            { default: () => '下发' }
          ),
          h(
            NButton,
            { size: 'small', quaternary: true, onClick: () => openEdit(row) },
            { default: () => '编辑' }
          ),
          h(
            NButton,
            { size: 'small', quaternary: true, type: 'error', onClick: () => confirmDelete(row) },
            { default: () => '删除' }
          )
        ]
      })
  }
]

async function loadTemplates() {
  loading.value = true
  try {
    const data = await fetchTemplates()
    templates.value = data?.list || []
  } catch (error) {
    message.error(error.message || '模板列表加载失败')
    templates.value = []
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.value = { name: '', command: '', description: '' }
  editingId.value = ''
}

function openCreate() {
  resetForm()
  modalVisible.value = true
}

function openEdit(row) {
  editingId.value = row.id
  form.value = {
    name: row.name || '',
    command: row.command || '',
    description: row.description || ''
  }
  modalVisible.value = true
}

async function submitForm() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      command: form.value.command,
      description: form.value.description.trim()
    }
    if (editingId.value) {
      await updateTemplate(editingId.value, payload)
      message.success('模板已更新')
    } else {
      await createTemplate(payload)
      message.success('模板已创建')
    }
    modalVisible.value = false
    loadTemplates()
  } catch (error) {
    message.error(error.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

function confirmDelete(row) {
  dialog.warning({
    title: '删除模板',
    content: `确定删除模板「${row.name}」吗？删除后不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deleteTemplate(row.id)
        message.success('模板已删除')
        loadTemplates()
      } catch (error) {
        message.error(error.message || '删除失败')
      }
    }
  })
}

// ------- 一键下发 -------
async function loadDevicesForRun() {
  devicesLoading.value = true
  try {
    const data = await fetchDevices({ page: 1, pageSize: 200 })
    devices.value = data?.list || []
  } catch (error) {
    message.error(error.message || '设备列表加载失败')
    devices.value = []
  } finally {
    devicesLoading.value = false
  }
}

async function openRun(row) {
  runTemplateRow.value = row
  runDeviceIds.value = []
  runVisible.value = true
  await loadDevicesForRun()
}

async function submitRun() {
  if (!runDeviceIds.value.length) {
    message.warning('请至少选择一台设备')
    return
  }
  runSubmitting.value = true
  try {
    const data = await runTemplate(runTemplateRow.value.id, runDeviceIds.value)
    message.success(`已创建批量任务：${data?.taskId || ''}`)
    runVisible.value = false
    // 有批量任务权限时直接跳转查看进度
    if (auth.hasPerm('tasks')) router.push('/tasks')
  } catch (error) {
    message.error(error.message || '下发失败')
  } finally {
    runSubmitting.value = false
  }
}

onMounted(loadTemplates)
</script>

<template>
  <div class="page-wrap">
    <PageTable
      title="命令模板"
      :columns="columns"
      :data="filteredTemplates"
      :loading="loading"
      :show-pagination="false"
      :scroll-x="1100"
    >
      <template #extra>
        <n-input
          v-model:value="keyword"
          size="small"
          placeholder="搜索模板名称 / 命令"
          clearable
          class="w-[200px]"
        />
        <n-button size="small" :loading="loading" @click="loadTemplates">刷新</n-button>
        <n-button size="small" type="primary" @click="openCreate">
          <template #icon>
            <span class="text-base leading-none">+</span>
          </template>
          新增模板
        </n-button>
      </template>
    </PageTable>

    <!-- 新增 / 编辑 -->
    <n-modal
      v-model:show="modalVisible"
      preset="card"
      :title="editingId ? '编辑模板' : '新增模板'"
      class="w-[92vw] max-w-[560px]"
      :mask-closable="false"
    >
      <n-form
        ref="formRef"
        :model="form"
        :rules="formRules"
        label-placement="top"
        require-mark-placement="right-hanging"
      >
        <n-form-item label="模板名称" path="name">
          <n-input v-model:value="form.name" placeholder="如：查看磁盘占用" :maxlength="50" show-count />
        </n-form-item>
        <n-form-item label="命令" path="command">
          <n-input
            v-model:value="form.command"
            type="textarea"
            placeholder="如：df -h"
            :autosize="{ minRows: 4, maxRows: 10 }"
            class="mono"
          />
        </n-form-item>
        <n-form-item label="描述" path="description">
          <n-input
            v-model:value="form.description"
            type="textarea"
            placeholder="可选，说明该模板的用途"
            :autosize="{ minRows: 2, maxRows: 4 }"
            :maxlength="200"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="modalVisible = false">取消</n-button>
          <n-button type="primary" :loading="submitting" @click="submitForm">保存</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 一键下发 -->
    <n-modal
      v-model:show="runVisible"
      preset="card"
      title="一键下发模板"
      class="w-[92vw] max-w-[560px]"
      :mask-closable="false"
    >
      <div class="mb-4 rounded-md border border-[rgba(128,128,128,0.16)] p-3">
        <div class="text-sm font-medium">{{ runTemplateRow?.name }}</div>
        <pre class="code-block mt-2">{{ runTemplateRow?.command }}</pre>
      </div>
      <n-form label-placement="top">
        <n-form-item label="选择目标设备" :show-feedback="false">
          <n-select
            v-model:value="runDeviceIds"
            multiple
            filterable
            :loading="devicesLoading"
            :options="devices.map((d) => ({ label: `${d.name || d.id}（${d.online ? '在线' : '离线'}）`, value: d.id }))"
            placeholder="可多选设备"
            :max-tag-count="4"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="runVisible = false">取消</n-button>
          <n-button type="primary" :loading="runSubmitting" @click="submitRun">创建批量任务</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>
