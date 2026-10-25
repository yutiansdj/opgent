import { Router } from 'express';
import { db, mapLog } from '../db.js';
import { ok, paging, authRequired, requirePerm } from '../http.js';
import { scopedDeviceIds, isSuper } from '../access.js';

const router = Router();
router.use(authRequired);

/** 把筛选条件拼成 WHERE 子句（含项目隔离） */
function buildWhere(q, user) {
  const where = [];
  const args = [];

  // 数据隔离：普通账号只能看自己项目下设备的日志
  const ids = scopedDeviceIds(user);
  if (ids !== null) {
    if (ids.length === 0) return { clause: 'WHERE 1 = 0', args: [] };
    where.push(`device_id IN (${ids.map(() => '?').join(',')})`);
    args.push(...ids);
  }

  if (q.keyword) {
    const kw = `%${String(q.keyword).trim()}%`;
    where.push('(command LIKE ? OR result LIKE ? OR username LIKE ? OR device_name LIKE ?)');
    args.push(kw, kw, kw, kw);
  }
  if (q.deviceId) {
    where.push('device_id = ?');
    args.push(String(q.deviceId));
  }
  if (q.username) {
    where.push('username = ?');
    args.push(String(q.username));
  }
  if (q.status) {
    where.push('status = ?');
    args.push(String(q.status));
  }
  if (q.start) {
    const s = String(q.start);
    where.push('created_at >= ?');
    args.push(s.length === 10 ? `${s}T00:00:00.000Z` : s);
  }
  if (q.end) {
    const e = String(q.end);
    where.push('created_at <= ?');
    args.push(e.length === 10 ? `${e}T23:59:59.999Z` : e);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

router.get('/', requirePerm('logs'), (req, res) => {
  const { page, pageSize, offset } = paging(req, 20);
  const { clause, args } = buildWhere(req.query, req.user);

  const total = db.prepare(`SELECT COUNT(*) AS c FROM logs ${clause}`).get(...args).c;
  const rows = db
    .prepare(`SELECT * FROM logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset);

  return ok(res, { list: rows.map(mapLog), total, page, pageSize });
});

/* CSV 导出（Excel 友好：带 BOM，字段加引号转义） */
router.get('/export', requirePerm('logs'), (req, res) => {
  const { clause, args } = buildWhere(req.query, req.user);
  const rows = db.prepare(`SELECT * FROM logs ${clause} ORDER BY id DESC LIMIT 50000`).all(...args).map(mapLog);

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['时间', '账号', '设备', '指令类型', '指令', '返回结果', '状态', '耗时(ms)'];
  const lines = [header.map(esc).join(',')];

  for (const r of rows) {
    lines.push(
      [
        r.createdAt,
        r.username,
        r.deviceName,
        r.type,
        r.command,
        r.result,
        r.status,
        r.durationMs,
      ]
        .map(esc)
        .join(',')
    );
  }

  const csv = '\uFEFF' + lines.join('\r\n');
  const filename = `logs_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csv);
});

export default router;
