<script setup>
import { computed, h, onMounted, ref } from 'vue'
import { NButton, NSpace, NSwitch, NTag, useDialog, useMessage } from 'naive-ui'
import PageTable from '@/components/PageTable.vue'
import { createUser, deleteUser, fetchUsers, updateUser } from '@/api/users'
import { useAuthStore } from '@/stores/auth'
import { ALL_PERMISSIONS } from '@/utils/permission'
import { formatDateTime, PERMISSION_OPTIONS } from '@/utils/format'
import { requiredRule } from '@/utils/validate'

const message = useMessage()
const dialog = useDialog()
const auth = useAuthStore()

const loading = ref(false)
const users = ref([])
const switchLoading = ref({})

// 新增 / 编辑弹窗
const modalVisible = ref(false)
const submitting = ref(false)
const editingUser = ref(null)
const formRef = ref(null)
const form = ref({
  username: '',
  password: '',
  role: 'op',
  permissions: []
})

const isEdit = computed(() => Boolean(editingUser.value))

const permissionOptions = PERMISSION_OPTIONS

const roleOptions = [
  { label: '运维人员（op）— 只看得到自己项目下的设备', value: 'op' },
  { label: '超级管理员（super）— 能看到全部项目和设备', value: 'super' }
]

const formRules = computed(() => ({
  username: requiredRule('请输入账号'),
  password: isEdit.value
    ? {
        validator: (_rule, value) => {
          if (!value) return true // 编辑时留空表示不修改密码
          if (String(value).length < 6) return new Error('密码至少 6 位')
          return true
        },
        trigger: ['input', 'blur']
      }
    : {
        required: true,
        validator: (_rule, value) => {
          if (!value) return new Error('请输入密码')
          if (String(value).length < 6) return new Error('密码至少 6 位')
          return true
        },
        trigger: ['input', 'blur']
      },
  role: requiredRule('请选择角色', ['change', 'blur'])
}))

const columns = [
  {
    title: '账号',
    key: 'username',
    minWidth: 150,
    render: (row) =>
      h('div', { class: 'flex items-center gap-2 min-w-0' }, [
        h('span', { class: 'font-medium truncate' }, row.username),
        row.id === auth.user?.id
          ? h(NTag, { size: 'small', bordered: false, type: 'info' }, { default: () => '本人' })
          : null
      ])
  },
  {
    title: '角色',
    key: 'role',
    width: 130,
    render: (row) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: row.role === 'super' ? 'success' : 'default' },
        { default: () => (row.role === 'super' ? '超级管理员（全部）' : '运维人员（自己）') }
      )
  },
  {
    title: '权限',
    key: 'permissions',
    minWidth: 320,
    render: (row) => {
      if (row.role === 'super') {
        return h(NTag, { size: 'small', bordered: false, type: 'success' }, { default: () => '全部权限' })
      }
      const list = row.permissions || []
      if (!list.length) return h('span', { class: 'opacity-40 text-xs' }, '未分配')
      return h(
        NSpace,
        { size: 4 },
        {
          default: () =>
            list.map((perm) =>
              h(
                NTag,
                { size: 'small', bordered: false },
                { default: () => permissionOptions.find((p) => p.value === perm)?.label || perm }
              )
            )
        }
      )
    }
  },
  {
    title: '状态',
    key: 'enabled',
    width: 100,
    render: (row) =>
      h(NSwitch, {
        value: row.enabled,
        size: 'small',
        loading: Boolean(switchLoading.value[row.id]),
        disabled: row.id === auth.user?.id,
        onUpdateValue: (value) => toggleEnabled(row, value)
      })
  },
  {
    title: '创建时间',
    key: 'createdAt',
    width: 165,
    render: (row) => formatDateTime(row.createdAt)
  },
  {
    title: '最后登录',
    key: 'lastLoginAt',
    width: 165,
    render: (row) => formatDateTime(row.lastLoginAt)
  },
  {
    title: '操作',
    key: 'actions',
    width: 160,
    fixed: 'right',
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, {
        default: () => [
          h(
            NButton,
            { size: 'small', quaternary: true, type: 'primary', onClick: () => openEdit(row) },
            { default: () => '编辑' }
          ),
          h(
            NButton,
            {
              size: 'small',
              quaternary: true,
              type: 'error',
              disabled: row.id === auth.user?.id,
              onClick: () => confirmDelete(row)
            },
            { default: () => '删除' }
          )
        ]
      })
  }
]

async function loadUsers() {
  loading.value = true
  try {
    const data = await fetchUsers()
    users.value = data?.list || []
  } catch (error) {
    message.error(error.message || '用户列表加载失败')
    users.value = []
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingUser.value = null
  form.value = { username: '', password: '', role: 'op', permissions: ['dashboard'] }
  modalVisible.value = true
}

function openEdit(row) {
  editingUser.value = row
  form.value = {
    username: row.username,
    password: '',
    role: row.role,
    permissions: row.role === 'super' ? [...ALL_PERMISSIONS] : [...(row.permissions || [])]
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
    // super 拥有全部权限；op 只保存勾选项
    const permissions =
      form.value.role === 'super' ? [...ALL_PERMISSIONS] : [...form.value.permissions].filter((p) => p !== 'users')

    if (isEdit.value) {
      const payload = {
        role: form.value.role,
        permissions
      }
      if (form.value.password) payload.password = form.value.password
      await updateUser(editingUser.value.id, payload)
      message.success('用户已更新')
    } else {
      await createUser({
        username: form.value.username.trim(),
        password: form.value.password,
        role: form.value.role,
        permissions
      })
      message.success('用户已创建')
    }
    modalVisible.value = false
    loadUsers()
  } catch (error) {
    message.error(error.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

async function toggleEnabled(row, enabled) {
  switchLoading.value = { ...switchLoading.value, [row.id]: true }
  try {
    await updateUser(row.id, { enabled })
    row.enabled = enabled
    message.success(enabled ? '账号已启用' : '账号已禁用')
  } catch (error) {
    message.error(error.message || '状态修改失败')
    loadUsers()
  } finally {
    switchLoading.value = { ...switchLoading.value, [row.id]: false }
  }
}

function confirmDelete(row) {
  dialog.warning({
    title: '删除用户',
    content: `确定删除账号「${row.username}」吗？删除后不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await deleteUser(row.id)
        message.success('用户已删除')
        loadUsers()
      } catch (error) {
        message.error(error.message || '删除失败')
      }
    }
  })
}

onMounted(loadUsers)
</script>

<template>
  <div class="page-wrap">
    <PageTable
      title="用户管理"
      :columns="columns"
      :data="users"
      :loading="loading"
      :show-pagination="false"
      :scroll-x="1320"
    >
      <template #extra>
        <span class="text-xs opacity-55">仅超级管理员可管理账号</span>
        <n-button size="small" :loading="loading" @click="loadUsers">刷新</n-button>
        <n-button size="small" type="primary" @click="openCreate">
          <template #icon>
            <span class="text-base leading-none">+</span>
          </template>
          新增账号
        </n-button>
      </template>
    </PageTable>

    <n-modal
      v-model:show="modalVisible"
      preset="card"
      :title="isEdit ? '编辑账号' : '新增账号'"
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
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <n-form-item label="账号" path="username">
            <n-input
              v-model:value="form.username"
              placeholder="登录账号"
              :disabled="isEdit"
              :maxlength="30"
            />
          </n-form-item>
          <n-form-item :label="isEdit ? '新密码（留空不修改）' : '密码'" path="password">
            <n-input
              v-model:value="form.password"
              type="password"
              show-password-on="click"
              placeholder="至少 6 位"
            />
          </n-form-item>
        </div>
        <n-form-item label="角色" path="role">
          <n-select v-model:value="form.role" :options="roleOptions" />
        </n-form-item>
        <n-form-item label="权限">
          <n-alert v-if="form.role === 'super'" type="warning" :bordered="false">
            <div class="text-xs leading-relaxed">
              超级管理员拥有全部权限，并且<strong>能看到所有项目和所有设备</strong>（不受项目归属限制）。<br />
              如果只想让他管理自己的设备，请选「运维人员」。
            </div>
          </n-alert>
          <n-checkbox-group v-else v-model:value="form.permissions">
            <n-space vertical size="small">
              <n-checkbox
                v-for="item in permissionOptions.filter((p) => p.value !== 'users')"
                :key="item.value"
                :value="item.value"
                :label="item.label"
              />
            </n-space>
          </n-checkbox-group>
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="modalVisible = false">取消</n-button>
          <n-button type="primary" :loading="submitting" @click="submitForm">保存</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>
