import { db } from './db.js';

/** 是否超级管理员 */
export const isSuper = (user) => user?.role === 'super';

/** 该用户能看到的项目 id 列表（超管返回 null 表示不限制） */
export function allowedProjectIds(user) {
  if (isSuper(user)) return null;
  return db.prepare('SELECT id FROM projects WHERE owner_id = ?').all(user.id).map((r) => r.id);
}

export function canAccessProject(user, projectId) {
  if (isSuper(user)) return true;
  if (!projectId) return false;
  const row = db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(projectId);
  return !!row && row.owner_id === user.id;
}

/** 某台设备被共享给该用户时的权限级别（view / control），没有共享返回 null */
export function shareLevel(user, deviceId) {
  if (!user || !deviceId) return null;
  const row = db
    .prepare('SELECT level FROM device_shares WHERE device_id = ? AND user_id = ?')
    .get(deviceId, user.id);
  return row ? row.level : null;
}

/**
 * 该用户可见的设备 id 列表。
 * 超管返回 null（不限制）；否则 = 自己项目下的设备 + 别人共享给自己的设备。
 */
export function scopedDeviceIds(user) {
  if (isSuper(user)) return null;

  const projects = allowedProjectIds(user);
  const own =
    projects && projects.length
      ? db
          .prepare(`SELECT id FROM devices WHERE project_id IN (${projects.map(() => '?').join(',')})`)
          .all(...projects)
          .map((r) => r.id)
      : [];

  const shared = db
    .prepare('SELECT device_id FROM device_shares WHERE user_id = ?')
    .all(user.id)
    .map((r) => r.device_id);

  return [...new Set([...own, ...shared])];
}

/** 能否看到这台设备（自己的项目 / 被共享 / 超管） */
export function canAccessDevice(user, deviceRow) {
  if (isSuper(user)) return true;
  if (!deviceRow) return false;
  if (shareLevel(user, deviceRow.id)) return true;
  if (!deviceRow.project_id) return false; // 无归属的历史设备只有超管能看
  return canAccessProject(user, deviceRow.project_id);
}

/** 能否操作这台设备（共享只读的不能操作） */
export function canControlDevice(user, deviceRow) {
  if (isSuper(user)) return true;
  if (!deviceRow) return false;
  if (!deviceRow.project_id || canAccessProject(user, deviceRow.project_id)) return true;
  return shareLevel(user, deviceRow.id) === 'control';
}

/** 是否为「别人共享给我的只读设备」 */
export function isViewOnlyShare(user, deviceRow) {
  return !canControlDevice(user, deviceRow);
}
