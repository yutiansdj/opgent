import request from '@/utils/request'

// 仪表盘概览（契约 §2）
export function fetchOverview() {
  return request.get('/dashboard/overview')
}
