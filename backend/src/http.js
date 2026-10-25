import { verifyToken } from './crypto.js';
import { db, mapUser } from './db.js';

/* ---------------- 统一响应 ---------------- */

export const ok = (res, data = null, status = 200) => res.status(status).json({ ok: true, data });

export const fail = (res, code, message, status = 400) =>
  res.status(status).json({ ok: false, error: { code, message } });

/* ---------------- 鉴权 ---------------- */

/** 从请求里取出当前用户（Bearer JWT），失败返回 null */
export function currentUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
  if (!row || !row.enabled) return null;
  return mapUser(row);
}

/** 必须登录 */
export function authRequired(req, res, next) {
  const user = currentUser(req);
  if (!user) return fail(res, 'UNAUTHORIZED', '未登录或登录已过期', 401);
  req.user = user;
  next();
}

/** 必须有某个权限点 */
export function requirePerm(perm) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) return fail(res, 'UNAUTHORIZED', '未登录', 401);
    if (user.role === 'super') return next();
    if (!user.permissions.includes(perm)) return fail(res, 'FORBIDDEN', '没有该操作权限', 403);
    next();
  };
}

/** 仅超级管理员 */
export function requireSuper(req, res, next) {
  if (!req.user) return fail(res, 'UNAUTHORIZED', '未登录', 401);
  if (req.user.role !== 'super') return fail(res, 'FORBIDDEN', '仅超级管理员可操作', 403);
  next();
}

/* ---------------- 分页参数 ---------------- */

export function paging(req, defSize = 10, maxSize = 100) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(req.query.pageSize, 10) || defSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
