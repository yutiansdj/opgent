import { Router } from 'express';
import { db, mapLog } from '../db.js';
import { ok, authRequired, requirePerm } from '../http.js';
import { scopedDeviceIds } from '../access.js';

const router = Router();
router.use(authRequired);

/** 近 7 天日期（按东八区），返回 ['2025-01-01', ...] */
function last7Days() {
  const out = [];
  const now = Date.now();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now - i * 86400_000 + 8 * 3600_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

router.get('/overview', requirePerm('dashboard'), (req, res) => {
  // 数据隔离：普通账号只统计自己项目下的设备与指令
  const ids = scopedDeviceIds(req.user);
  if (ids !== null && ids.length === 0) {
    return ok(res, {
      devices: { total: 0, online: 0, offline: 0 },
      logChart: last7Days().map((d) => ({ date: d.slice(5), fullDate: d, count: 0 })),
      recentLogs: [],
      todayCommands: 0,
    });
  }

  const devWhere = ids === null ? '' : `WHERE project_id IN (${ids.map(() => '?').join(',')})`;
  const devArgs = ids === null ? [] : ids;

  const total = db.prepare(`SELECT COUNT(*) AS c FROM devices ${devWhere}`).get(...devArgs).c;
  const online = db
    .prepare(`SELECT COUNT(*) AS c FROM devices ${devWhere ? `${devWhere} AND` : 'WHERE'} online = 1`)
    .get(...devArgs).c;

  // 日志范围：普通账号只看自己设备的日志
  const logWhere = ids === null ? '' : `WHERE device_id IN (${ids.map(() => '?').join(',')})`;
  const logArgs = ids === null ? [] : ids;
  const logAnd = logWhere ? `${logWhere} AND` : 'WHERE';

  const days = last7Days();
  const rows = db
    .prepare(
      `SELECT date(datetime(created_at, '+8 hours')) AS d, COUNT(*) AS c
         FROM logs
        ${logAnd} datetime(created_at, '+8 hours') >= datetime(?)
        GROUP BY d`
    )
    .all(...logArgs, `${days[0]} 00:00:00`);
  const map = new Map(rows.map((r) => [r.d, r.c]));
  const logChart = days.map((d) => ({ date: d.slice(5), fullDate: d, count: map.get(d) || 0 }));

  const recentLogs = db
    .prepare(`SELECT * FROM logs ${logWhere} ORDER BY id DESC LIMIT 10`)
    .all(...logArgs)
    .map(mapLog);

  const todayStart = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const todayCommands =
    db
      .prepare(`SELECT COUNT(*) AS c FROM logs ${logAnd} date(datetime(created_at, '+8 hours')) = ?`)
      .get(...logArgs, todayStart).c || 0;

  return ok(res, {
    devices: { total, online, offline: Math.max(0, total - online) },
    logChart,
    recentLogs,
    todayCommands,
  });
});

export default router;
