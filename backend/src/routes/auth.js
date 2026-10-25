import { Router } from 'express';
import { db, mapUser, nowIso, writeLog } from '../db.js';
import { verifyPassword, hashPassword, signToken } from '../crypto.js';
import { ok, fail, authRequired } from '../http.js';
import { config } from '../config.js';

const router = Router();

/** 简单登录限流：同一 IP 每分钟最多 10 次失败 */
const attempts = new Map();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return fail(res, 'VALIDATION_ERROR', '请输入账号和密码', 400);

  const ip = req.ip || 'unknown';
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || now > a.reset) {
    a = { count: 0, reset: now + 60_000 };
    attempts.set(ip, a);
  }
  if (a.count >= 10) return fail(res, 'TOO_MANY_REQUESTS', '尝试过于频繁，请 1 分钟后再试', 429);

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!row || !verifyPassword(password, row.password_hash)) {
    a.count += 1;
    return fail(res, 'BAD_CREDENTIALS', '账号或密码错误', 401);
  }
  if (!row.enabled) return fail(res, 'ACCOUNT_DISABLED', '账号已被禁用，请联系管理员', 403);

  attempts.delete(ip);

  const user = mapUser(row);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);

  const token = signToken({ uid: row.id, username: row.username, role: row.role });
  const expiresAt = new Date(Date.now() + config.tokenTtlHours * 3600_000).toISOString();

  writeLog({ user, type: 'login', command: '登录系统', result: '登录成功', status: 'success' });
  return ok(res, { token, expiresAt, user });
});

router.get('/me', authRequired, (req, res) => ok(res, req.user));

router.post('/logout', authRequired, (req, res) => {
  writeLog({ user: req.user, type: 'logout', command: '退出登录', result: '', status: 'success' });
  return ok(res, true);
});

router.post('/password', authRequired, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return fail(res, 'VALIDATION_ERROR', '请填写原密码和新密码', 400);
  if (String(newPassword).length < 6) return fail(res, 'VALIDATION_ERROR', '新密码至少 6 位', 400);

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(oldPassword, row.password_hash)) {
    return fail(res, 'BAD_CREDENTIALS', '原密码不正确', 400);
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  writeLog({ user: req.user, type: 'password', command: '修改密码', result: '', status: 'success' });
  return ok(res, true);
});

export default router;
