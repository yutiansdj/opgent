import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { ok, fail, authRequired, requirePerm } from '../http.js';
import { rid } from '../crypto.js';
import { createBatchTask } from '../batch.js';

const router = Router();
router.use(authRequired);

function mapTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    description: row.description || '',
    createdBy: row.created_by || '',
    createdAt: row.created_at,
  };
}

router.get('/', requirePerm('templates'), (req, res) => {
  const rows = db.prepare('SELECT * FROM templates ORDER BY id DESC').all();
  return ok(res, { list: rows.map(mapTemplate) });
});

router.post('/', requirePerm('templates'), (req, res) => {
  const { name, command, description = '' } = req.body || {};
  const n = String(name || '').trim();
  const c = String(command || '').trim();
  if (!n) return fail(res, 'VALIDATION_ERROR', '请填写模板名称', 400);
  if (!c) return fail(res, 'VALIDATION_ERROR', '请填写命令内容', 400);

  const id = rid('t_');
  db.prepare('INSERT INTO templates (id, name, command, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    n.slice(0, 60),
    c,
    String(description).slice(0, 200),
    req.user.username,
    nowIso()
  );
  return ok(res, mapTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(id)), 201);
});

router.put('/:id', requirePerm('templates'), (req, res) => {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '模板不存在', 404);

  const { name, command, description } = req.body || {};
  if (name !== undefined) {
    const n = String(name).trim();
    if (!n) return fail(res, 'VALIDATION_ERROR', '模板名称不能为空', 400);
    db.prepare('UPDATE templates SET name = ? WHERE id = ?').run(n.slice(0, 60), row.id);
  }
  if (command !== undefined) {
    const c = String(command).trim();
    if (!c) return fail(res, 'VALIDATION_ERROR', '命令内容不能为空', 400);
    db.prepare('UPDATE templates SET command = ? WHERE id = ?').run(c, row.id);
  }
  if (description !== undefined) {
    db.prepare('UPDATE templates SET description = ? WHERE id = ?').run(String(description).slice(0, 200), row.id);
  }
  return ok(res, mapTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(row.id)));
});

router.delete('/:id', requirePerm('templates'), (req, res) => {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '模板不存在', 404);
  db.prepare('DELETE FROM templates WHERE id = ?').run(row.id);
  return ok(res, true);
});

/** 选中模板一键下发到多台设备 */
router.post('/:id/run', requirePerm('templates'), (req, res) => {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '模板不存在', 404);

  const deviceIds = req.body?.deviceIds;
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    return fail(res, 'VALIDATION_ERROR', '请至少选择一台设备', 400);
  }

  const taskId = createBatchTask({
    deviceIds,
    type: 'shell',
    params: { command: row.command },
    user: req.user,
    name: `模板「${row.name}」批量下发`,
  });
  return ok(res, { taskId });
});

export default router;
