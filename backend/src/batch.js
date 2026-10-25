import { db, mapDevice, nowIso } from './db.js';
import { rid } from './crypto.js';
import { execOnDevice } from './exec.js';
import { describeCommand } from './commands.js';

/**
 * 创建批量任务并异步执行（不阻塞 HTTP 响应）。
 * @returns {string} taskId
 */
export function createBatchTask({ deviceIds, type, params = {}, user, name }) {
  const taskId = rid('b_');
  const label = describeCommand(type, params);
  const ids = [...new Set((deviceIds || []).filter(Boolean))];

  db.prepare(
    `INSERT INTO tasks (id, name, type, params, status, total, done, success, failed, created_by, created_at)
     VALUES (?, ?, ?, ?, 'running', ?, 0, 0, 0, ?, ?)`
  ).run(
    taskId,
    (name || `批量下发：${label}`).slice(0, 80),
    type,
    JSON.stringify(params || {}),
    ids.length,
    user?.username ?? 'system',
    nowIso()
  );

  const insItem = db.prepare('INSERT INTO task_items (task_id, device_id, status) VALUES (?, ?, ?)');
  for (const id of ids) insItem.run(taskId, id, 'pending');

  // 异步推进任务，逐台串行执行，避免同时下发压垮设备
  setImmediate(() => runTask(taskId, user));
  return taskId;
}

async function runTask(taskId, user) {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return;
    const params = JSON.parse(task.params || '{}');
    const items = db.prepare('SELECT * FROM task_items WHERE task_id = ? ORDER BY id ASC').all(taskId);

    let done = 0;
    let success = 0;
    let failed = 0;

    for (const item of items) {
      db.prepare('UPDATE task_items SET status = ? WHERE id = ?').run('running', item.id);

      const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(item.device_id);
      const device = row ? mapDevice(row) : { id: item.device_id, name: '（设备已删除）' };

      const r = await execOnDevice(device, { username: user?.username ?? 'system' }, task.type, params, {
        taskId,
      });
      const text = [r?.stdout, r?.stderr].filter(Boolean).join('\n') || (r?.status === 'success' ? '执行成功' : '');

      db.prepare('UPDATE task_items SET status = ?, result = ?, finished_at = ? WHERE id = ?').run(
        r?.status || 'failed',
        text,
        nowIso(),
        item.id
      );

      done += 1;
      if (r?.status === 'success') success += 1;
      else failed += 1;

      db.prepare('UPDATE tasks SET done = ?, success = ?, failed = ? WHERE id = ?').run(done, success, failed, taskId);
    }

    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('done', taskId);
  } catch (e) {
    console.error('[batch] 任务执行异常', e);
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('done', taskId);
  }
}

export function mapTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    type: row.type,
    command: describeCommand(row.type, JSON.parse(row.params || '{}')),
    status: row.status,
    total: row.total,
    done: row.done,
    success: row.success,
    failed: row.failed,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
  };
}
