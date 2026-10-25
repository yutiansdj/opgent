// 极简的表单校验规则生成器（NaiveUI n-form 使用）
export const requiredRule = (message, trigger = ['input', 'blur']) => ({
  required: true,
  message,
  trigger
})

export const passwordRule = (message = '密码至少 6 位') => ({
  required: true,
  validator: (_rule, value) => {
    if (!value) return new Error('请输入密码')
    if (String(value).length < 6) return new Error(message)
    return true
  },
  trigger: ['input', 'blur']
})
