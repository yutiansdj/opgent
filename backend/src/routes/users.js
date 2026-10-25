import { Router } from 'express';
import { db, mapUser, nowIso } from '../db.js';
import { hashPassword } from '../crypto.js';
import { ok, fail, authRequired, requireSuper } from '../http.js';
import { PERMISSIONS } from '../config.js';

const router = Router();
router.use(authRequired, requireSuper);

const VALID_PERMS = new Set(PERMISSIONS);

// 仅超管可用的权限点，不允许分配给运维账号
const SUPER_ONLY = new Set(['users', 'settings']);

function normalizePermissions(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((p) => VALID_PERMS.has(p) && !SUPER_ONLY.has(p)))];
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id ASC').all();
  return ok(res, { list: rows.map(mapUser) });
});

router.post('/', (req, res) => {
  const { username, password, role = 'op', permissions = [] } = req.body || {};
  const name = String(username || '').trim();
  if (!name) return fail(res, 'VALIDATION_ERROR', '请填写账号', 400);
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(name)) {
    return fail(res, 'VALIDATION_ERROR', '账号需为 3~24 位字母、数字或下划线', 400);
  }
  if (!password || String(password).length < 6) return fail(res, 'VALIDATION_ERROR', '密码至少 6 位', 400);
  if (!['super', 'op'].includes(role)) return fail(res, 'VALIDATION_ERROR', '角色不合法', 400);

  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name)) {
    return fail(res, 'VALIDATION_ERROR', '该账号已存在', 409);
  }

  const perms = role === 'super' ? PERMISSIONS : normalizePermissions(permissions);
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, role, permissions, enabled, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .run(name, hashPassword(password), role, JSON.stringify(perms), nowIso());

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  return ok(res, mapUser(row), 201);
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) return fail(res, 'NOT_FOUND', '账号不存在', 404);

  const { password, role, permissions, enabled } = req.body || {};

  if (role !== undefined) {
    if (!['super', 'op'].includes(role)) return fail(res, 'VALIDATION_ERROR', '角色不合法', 400);
    // 不允许把最后一个超管降级
    if (row.role === 'super' && role !== 'super') {
      const supers = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'super' AND enabled = 1`).get().c;
      if (supers <= 1) return fail(res, 'VALIDATION_ERROR', '系统至少保留一个超级管理员', 400);
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }

  if (permissions !== undefined) {
    const r = role !== undefined ? role : row.role;
    const perms = r === 'super' ? PERMISSIONS : normalizePermissions(permissions);
    db.prepare('UPDATE users SET permissions = ? WHERE id = ?').run(JSON.stringify(perms), id);
  }

  if (enabled !== undefined) {
    if (!enabled && id === req.user.id) return fail(res, 'VALIDATION_ERROR', '不能禁用当前登录账号', 400);
    if (!enabled && row.role === 'super') {
      const supers = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'super' AND enabled = 1`).get().c;
      if (supers <= 1) return fail(res, 'VALIDATION_ERROR', '系统至少保留一个可用的超级管理员', 400);
    }
    db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  }

  if (password !== undefined && password !== null && password !== '') {
    if (String(password).length < 6) return fail(res, 'VALIDATION_ERROR', '密码至少 6 位', 400);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  }

  return ok(res, mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) return fail(res, 'NOT_FOUND', '账号不存在', 404);
  if (id === req.user.id) return fail(res, 'VALIDATION_ERROR', '不能删除当前登录账号', 400);
  if (row.role === 'super') {
    const supers = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'super'`).get().c;
    if (supers <= 1) return fail(res, 'VALIDATION_ERROR', '系统至少保留一个超级管理员', 400);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return ok(res, true);
});

export default router;
