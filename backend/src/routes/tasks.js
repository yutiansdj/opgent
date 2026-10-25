import { Router } from 'express';
import { db } from '../db.js';
import { ok, fail, paging, authRequired, requirePerm } from '../http.js';
import { isSuper } from '../access.js';
import { validateCommand } from '../commands.js';
import { createBatchTask, mapTask } from '../batch.js';

const router = Router();
router.use(authRequired);

router.post('/', requirePerm('tasks'), (req, res) => {
  const { deviceIds, type, params, name } = req.body || {};
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    return fail(res, 'VALIDATION_ERROR', '请至少选择一台设备', 400);
  }
  const v = validateCommand(type, params);
  if (!v.valid) return fail(res, 'VALIDATION_ERROR', v.message, 400);

  const taskId = createBatchTask({ deviceIds, type, params: v.params, user: req.user, name });
  return ok(res, { taskId });
});

router.get('/', requirePerm('tasks'), (req, res) => {
  const { page, pageSize, offset } = paging(req);
  // 数据隔离：普通账号只看自己创建的批量任务
  const onlyMine = !isSuper(req.user);
  const where = onlyMine ? 'WHERE created_by = ?' : '';
  const args = onlyMine ? [req.user.username] : [];

  const total = db.prepare(`SELECT COUNT(*) AS c FROM tasks ${where}`).get(...args).c;
  const rows = db
    .prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset);
  return ok(res, { list: rows.map(mapTask), total, page, pageSize });
});

router.get('/:id', requirePerm('tasks'), (req, res) => {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '任务不存在', 404);
  if (!isSuper(req.user) && row.created_by !== req.user.username) {
    return fail(res, 'FORBIDDEN', '无权查看该任务', 403);
  }

  const items = db
    .prepare(
      `SELECT ti.*, d.name AS device_name
         FROM task_items ti
         LEFT JOIN devices d ON d.id = ti.device_id
        WHERE ti.task_id = ?
        ORDER BY ti.id ASC`
    )
    .all(row.id)
    .map((it) => ({
      deviceId: it.device_id,
      deviceName: it.device_name || '（设备已删除）',
      status: it.status,
      result: it.result || '',
      finishedAt: it.finished_at || null,
    }));

  return ok(res, { ...mapTask(row), items });
});

export default router;
