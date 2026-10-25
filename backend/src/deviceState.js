import { db, nowIso } from './db.js';

/**
 * 用 Agent 上报的设备信息刷新数据库（WS 与 HTTP 两条通道共用）。
 * 空值不覆盖已有字段，避免心跳里没带 IP 就把 IP 冲掉。
 */
export function updateDeviceFromAgent(deviceId, info = {}, ip = '') {
  const fields = {
    model: info.model,
    android_version: info.androidVersion,
    root_status: info.rootStatus,
    battery: info.battery,
    network: info.network,
    ip: info.ip || ip,
  };

  const sets = ['online = 1', 'last_seen_at = ?'];
  const args = [nowIso()];

  for (const [col, val] of Object.entries(fields)) {
    if (val !== undefined && val !== null && val !== '') {
      sets.push(`${col} = ?`);
      args.push(val);
    }
  }

  args.push(deviceId);
  db.prepare(`UPDATE devices SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}
