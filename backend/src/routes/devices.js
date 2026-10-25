import { Router } from 'express';
import path from 'node:path';
import { db, mapDevice, mapLog, nowIso, writeLog } from '../db.js';
import { ok, fail, paging, authRequired, requirePerm } from '../http.js';
import { rid } from '../crypto.js';
import { execOnDevice } from '../exec.js';
import { validateCommand, describeCommand } from '../commands.js';
import { upload, recordUploadedFile, findFile } from '../storage.js';
import { isReachable, dispatchPullFile } from '../dispatch.js';
import { allowedProjectIds, canAccessDevice, canControlDevice, scopedDeviceIds, isSuper } from '../access.js';

const router = Router();
const getDevice = (id) => db.prepare('SELECT * FROM devices WHERE id = ?').get(id);

/** 共享只读的设备不允许操作 */
function requireControl(req, res, row) {
  if (canControlDevice(req.user, row)) return true;
  fail(res, 'FORBIDDEN', '这是共享给你的只读设备，没有操作权限', 403);
  return false;
}


/* ---------- 公开：设备注册（Agent 首次接入 / 重装后重新报到） ---------- */
router.post('/register', (req, res) => {
  const { deviceUid, name, token } = req.body || {};
  const uid = deviceUid ? String(deviceUid).trim() : '';
  const tk = token ? String(token).trim() : '';

  if (!uid && !tk) return fail(res, 'VALIDATION_ERROR', '缺少 deviceUid 或 token', 400);

  let row = null;

  // 1) 最精确：同一个 token + 同一台设备
  if (tk && uid) row = db.prepare('SELECT * FROM devices WHERE token = ? AND device_uid = ?').get(tk, uid);

  // 2) 同一台设备换了 token（例如被注入到新项目）：以新 token 为准
  if (!row && uid) {
    const byUid = db.prepare('SELECT * FROM devices WHERE device_uid = ? ORDER BY created_at LIMIT 1').get(uid);
    if (byUid && tk && byUid.token !== tk) {
      db.prepare('UPDATE devices SET token = ?, project_id = NULL WHERE id = ?').run(tk, byUid.id);
      row = db.prepare('SELECT * FROM devices WHERE id = ?').get(byUid.id);
    } else if (byUid) {
      row = byUid;
    }
  }

  // 3) 只有「客户端没带 uid」时才退回按 token 取第一条（兼容老版本）
  //    带了 uid 却匹配不到，说明是新设备，必须新建，不能复用别人那条
  if (!row && tk && !uid) {
    row = db.prepare('SELECT * FROM devices WHERE token = ? ORDER BY created_at LIMIT 1').get(tk);
  }

  // 如果这个 token 属于某个项目，设备就归到该项目（项目 → 用户 的隔离依据）
  const proj = tk ? db.prepare('SELECT id FROM projects WHERE token = ?').get(tk) : null;

  if (row) {
    if (name) db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(String(name).slice(0, 60), row.id);
    if (uid && !row.device_uid) db.prepare('UPDATE devices SET device_uid = ? WHERE id = ?').run(uid, row.id);
    if (proj && row.project_id !== proj.id) {
      db.prepare('UPDATE devices SET project_id = ? WHERE id = ?').run(proj.id, row.id);
    }
    row = getDevice(row.id);
  } else {
    const id = rid('dev_');
    const newToken = tk || rid('dt_', 16);
    db.prepare(
      `INSERT INTO devices (id, name, token, device_uid, online, note, project_id, created_at)
       VALUES (?, ?, ?, ?, 0, '', ?, ?)`
    ).run(
      id,
      name ? String(name).slice(0, 60) : '未命名设备',
      newToken,
      uid || null,
      proj ? proj.id : null,
      nowIso()
    );
    row = getDevice(id);
    console.log(`[device] 新设备注册：${row.name} (${id})`);
  }
  return ok(res, mapDevice(row));
});

/* ---------- 以下都要登录 ---------- */
router.use(authRequired);

/* ==================== 设备共享 ==================== */

/** 可共享的账号列表（只暴露 id / 用户名，避免泄露其它信息） */
router.get('/share/candidates', requirePerm('devices'), (req, res) => {
  const rows = db
    .prepare('SELECT id, username, role FROM users WHERE enabled = 1 AND id != ? ORDER BY username')
    .all(req.user.id);
  return ok(res, { list: rows.map((r) => ({ id: r.id, username: r.username, role: r.role })) });
});

/** 谁能管理共享：超管 或 设备所属项目的所有者 */
function canManageShares(user, row) {
  if (isSuper(user)) return true;
  if (!row.project_id) return false;
  const p = db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(row.project_id);
  return !!p && p.owner_id === user.id;
}

/** 某设备的共享列表 */
router.get('/:id/shares', requirePerm('devices'), (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canManageShares(req.user, row)) return fail(res, 'FORBIDDEN', '只有设备所有者可以管理共享', 403);

  const list = db
    .prepare(
      `SELECT s.user_id AS userId, s.level, s.created_at AS createdAt, u.username
         FROM device_shares s JOIN users u ON u.id = s.user_id
        WHERE s.device_id = ? ORDER BY s.created_at`
    )
    .all(row.id);

  return ok(res, { list });
});

/** 添加共享 */
router.post('/:id/shares', requirePerm('devices'), (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canManageShares(req.user, row)) return fail(res, 'FORBIDDEN', '只有设备所有者可以管理共享', 403);

  const { username, userId, level = 'view' } = req.body || {};
  if (!['view', 'control'].includes(level)) return fail(res, 'VALIDATION_ERROR', '权限只能是 view 或 control', 400);

  const target = userId
    ? db.prepare('SELECT id, username FROM users WHERE id = ?').get(Number(userId))
    : db.prepare('SELECT id, username FROM users WHERE username = ?').get(String(username || '').trim());
  if (!target) return fail(res, 'NOT_FOUND', '账号不存在', 404);
  if (target.id === req.user.id) return fail(res, 'VALIDATION_ERROR', '不能共享给自己', 400);

  db.prepare(
    `INSERT INTO device_shares (device_id, user_id, level, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(device_id, user_id) DO UPDATE SET level = excluded.level`
  ).run(row.id, target.id, level, nowIso());

  return ok(res, { deviceId: row.id, userId: target.id, username: target.username, level });
});

/** 取消共享 */
router.delete('/:id/shares/:userId', requirePerm('devices'), (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canManageShares(req.user, row)) return fail(res, 'FORBIDDEN', '只有设备所有者可以管理共享', 403);

  db.prepare('DELETE FROM device_shares WHERE device_id = ? AND user_id = ?').run(row.id, Number(req.params.userId));
  return ok(res, true);
});


/* 设备列表 */
router.get('/', requirePerm('devices'), (req, res) => {
  const { page, pageSize, offset } = paging(req);
  const where = [];
  const args = [];

  // 数据隔离：自己项目下的设备 + 别人共享给我的设备（超管不限制）
  const mine = scopedDeviceIds(req.user);
  if (mine !== null) {
    if (mine.length === 0) return ok(res, { list: [], total: 0, page, pageSize });
    where.push(`d.id IN (${mine.map(() => '?').join(',')})`);
    args.push(...mine);
  }
  const sharedIds = new Set(
    db.prepare('SELECT device_id FROM device_shares WHERE user_id = ?').all(req.user.id).map((r) => r.device_id)
  );

  if (req.query.keyword) {
    const kw = `%${String(req.query.keyword).trim()}%`;
    where.push('(d.name LIKE ? OR d.model LIKE ? OR d.id LIKE ? OR d.note LIKE ?)');
    args.push(kw, kw, kw, kw);
  }
  if (req.query.online === '1' || req.query.online === '0') {
    where.push('d.online = ?');
    args.push(Number(req.query.online));
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM devices d ${clause}`).get(...args).c;
  const rows = db
    .prepare(
      `SELECT d.*, p.name AS project_name
         FROM devices d
         LEFT JOIN projects p ON p.id = d.project_id
         ${clause}
        ORDER BY d.online DESC, d.last_seen_at DESC
        LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, offset);

  return ok(res, {
    list: rows.map((r) => {
      const d = mapDevice(r);
      if (sharedIds.has(d.id)) d.shared = true;
      return d;
    }),
    total,
    page,
    pageSize,
  });
});

/* 单个设备 */
router.get('/:id', requirePerm('devices'), (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  // 在线状态统一用数据库里的判定值（含心跳宽限期），
  // 不再用内存里的连接状态覆盖，避免详情页与列表页显示不一致。
  const device = mapDevice(row);
  const shared = db
    .prepare('SELECT level FROM device_shares WHERE device_id = ? AND user_id = ?')
    .get(row.id, req.user.id);
  if (shared) {
    device.shared = true;
    device.shareLevel = shared.level;
  }
  device.canControl = canControlDevice(req.user, row);
  return ok(res, device);
});

/* 修改名称 / 备注 */
router.patch('/:id', requirePerm('devices'), (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!requireControl(req, res, row)) return;

  const { name, note } = req.body || {};
  if (name !== undefined) {
    const v = String(name).trim();
    if (!v) return fail(res, 'VALIDATION_ERROR', '设备名称不能为空', 400);
    db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(v.slice(0, 60), row.id);
  }
  if (note !== undefined) {
    db.prepare('UPDATE devices SET note = ? WHERE id = ?').run(String(note).slice(0, 500), row.id);
  }
  return ok(res, mapDevice(getDevice(row.id)));
});

/* 删除设备 */
router.delete('/:id', requirePerm('devices'), (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  // 删除比操作更敏感：只允许超管或设备所属项目的所有者
  if (!isSuper(req.user)) {
    const p = row.project_id
      ? db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(row.project_id)
      : null;
    if (!p || p.owner_id !== req.user.id) {
      return fail(res, 'FORBIDDEN', '只有设备所有者可以删除设备', 403);
    }
  }
  db.prepare('DELETE FROM devices WHERE id = ?').run(row.id);
  return ok(res, true);
});

/* ---------- 下发指令 ---------- */
router.post('/:id/command', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!requireControl(req, res, row)) return;

  const { type, params } = req.body || {};
  const v = validateCommand(type, params);
  if (!v.valid) return fail(res, 'VALIDATION_ERROR', v.message, 400);

  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备当前离线，无法下发指令', 409);

  const device = mapDevice(row);
  // 截图体积大（几 MB），移动网络上传慢，单独放宽超时
  const timeoutMs = type === 'screenshot' || type === 'camera' ? 180000 : undefined;
  const result = await execOnDevice(device, req.user, type, v.params, { timeoutMs });
  return ok(res, { deviceId: device.id, command: describeCommand(type, v.params), ...result });
});

/* ---------- 上传文件到手机 ---------- */
router.post('/:id/upload', requirePerm('devices'), upload.single('file'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!requireControl(req, res, row)) return;
  if (!req.file) return fail(res, 'VALIDATION_ERROR', '缺少文件字段 file', 400);
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备当前离线', 409);

  const f = recordUploadedFile(req.file);
  const originalName = f.name || 'upload.bin';
  let targetPath = String(req.body.targetPath || '').trim();
  if (!targetPath) targetPath = `/sdcard/Download/${originalName}`;
  // 用户/前端只给了目录（以 / 结尾）时，必须补上文件名，
  // 否则手机上会存成一个无意义的临时名（例如 dl.bin）。
  if (targetPath.endsWith('/')) targetPath += originalName;

  const r = await dispatchPullFile(row.id, f.fileId, targetPath, 'save');

  writeLog({
    user: req.user,
    deviceId: row.id,
    deviceName: row.name,
    type: 'upload',
    command: `上传 ${originalName} → ${targetPath}`,
    result: r?.stdout || r?.stderr || `已写入 ${targetPath}`,
    status: r?.status || 'offline',
    durationMs: r?.durationMs || 0,
  });

  if (!r) return fail(res, 'DEVICE_OFFLINE', '设备当前离线', 409);
  return ok(res, { path: targetPath, size: f.size, status: r.status, stdout: r.stdout, stderr: r.stderr });
});

/* ---------- 安装 APK ---------- */
router.post('/:id/install_apk', requirePerm('devices'), upload.single('file'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!requireControl(req, res, row)) return;
  if (!req.file) return fail(res, 'VALIDATION_ERROR', '缺少文件字段 file', 400);
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备当前离线', 409);

  const f = recordUploadedFile(req.file);
  const targetPath = `/data/local/tmp/${f.fileId}.apk`;
  const r = await dispatchPullFile(row.id, f.fileId, targetPath, 'install');

  writeLog({
    user: req.user,
    deviceId: row.id,
    deviceName: row.name,
    type: 'install_apk',
    command: `安装 ${f.name}`,
    result: r?.stdout || r?.stderr || '',
    status: r?.status || 'offline',
    durationMs: r?.durationMs || 0,
  });

  if (!r) return fail(res, 'DEVICE_OFFLINE', '设备当前离线', 409);
  return ok(res, { status: r.status, stdout: r.stdout, stderr: r.stderr });
});

/* ---------- 从手机下载文件 ---------- */
router.get('/:id/download', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!requireControl(req, res, row)) return;

  const filePath = String(req.query.path || '').trim();
  if (!filePath) return fail(res, 'VALIDATION_ERROR', '请提供文件路径 path', 400);
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备当前离线', 409);

  const device = mapDevice(row);
  const r = await execOnDevice(device, req.user, 'download', { path: filePath });

  if (r.status !== 'success' || !r.fileId) {
    return fail(res, 'INTERNAL_ERROR', r.stderr || '文件下载失败（可能文件不存在）', 400);
  }
  const f = findFile(r.fileId);
  if (!f) return fail(res, 'NOT_FOUND', '回传文件已丢失', 404);
  return ok(res, { fileId: f.id, name: f.name, size: f.size });
});

/* ---------- 该设备的指令日志 ---------- */
router.get('/:id/logs', requirePerm('devices'), (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);

  const { page, pageSize, offset } = paging(req, 20);
  const total = db.prepare('SELECT COUNT(*) AS c FROM logs WHERE device_id = ?').get(row.id).c;
  const rows = db
    .prepare('SELECT * FROM logs WHERE device_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(row.id, pageSize, offset);

  return ok(res, { list: rows.map(mapLog), total, page, pageSize });
});

/* ==================== 文件管理（内置文件管理器） ==================== */

/** 危险路径黑名单：文件管理器不允许动系统目录 */
const FS_DENY = [
  /^\/$/,
  /^\/system(\/|$)/,
  /^\/vendor(\/|$)/,
  /^\/product(\/|$)/,
  /^\/proc(\/|$)/,
  /^\/sys(\/|$)/,
  /^\/data\/adb(\/|$)/,
  /^\/data\/data(\/|$)/,
  /^\/data\/system(\/|$)/,
  /^\/sdcard$/,
  /^\/storage\/emulated\/0$/,
];

function fsGuard(p) {
  const v = String(p || '').trim();
  if (!v || v === '.' || v === '..') return '路径不合法';
  if (FS_DENY.some((re) => re.test(v))) return `为安全起见，禁止操作系统目录：${v}`;
  return null;
}

/** 解析脚本返回的 `类型|大小|时间|权限|base64文件名` 行 */
function parseFsList(stdout) {
  return String(stdout || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|');
      if (parts.length < 5) return null;
      const [, size, mtime, perm, nameB64] = parts;
      let name = '';
      try {
        name = Buffer.from(nameB64, 'base64').toString('utf8');
      } catch {
        return null;
      }
      if (!name || name === '.' || name === '..') return null;
      // 类型以权限串首字母为准：Android 的 `stat -c %F` 在某些 ROM 上不可靠
      const t = (perm || '').startsWith('d') ? 'dir' : (perm || '').startsWith('l') ? 'link' : 'file';
      return { name, type: t, size: Number(size) || 0, mtime: Number(mtime) || 0, perm: perm || '' };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.type !== b.type) {
        if (a.type === 'dir') return -1;
        if (b.type === 'dir') return 1;
      }
      return a.name.localeCompare(b.name, 'zh');
    });
}

/** 列目录 */
router.get('/:id/fs/list', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备当前离线', 409);

  const target = String(req.query.path || '').trim() || '/sdcard';
  const r = await execOnDevice(mapDevice(row), req.user, 'fs_list', { path: target });
  if (r.status !== 'success') return fail(res, 'INTERNAL_ERROR', r.stderr || '读取目录失败', 400);

  return ok(res, {
    path: target,
    parent: path.posix.dirname(target) || '/',
    entries: parseFsList(r.stdout),
  });
});

/** 新建文件夹 */
router.post('/:id/fs/mkdir', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!requireControl(req, res, row)) return;
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备当前离线', 409);

  const target = String(req.body?.path || '').trim();
  const bad = fsGuard(target);
  if (bad) return fail(res, 'VALIDATION_ERROR', bad, 400);

  const r = await execOnDevice(mapDevice(row), req.user, 'fs_mkdir', { path: target });
  if (r.status !== 'success') return fail(res, 'INTERNAL_ERROR', r.stderr || '创建失败', 400);
  return ok(res, { path: target });
});

/** 新建文件（可带初始内容） */
router.post('/:id/fs/touch', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!requireControl(req, res, row)) return;
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备当前离线', 409);

  const target = String(req.body?.path || '').trim();
  const bad = fsGuard(target);
  if (bad) return fail(res, 'VALIDATION_ERROR', bad, 400);

  const content = req.body?.content === undefined ? '' : String(req.body.content);
  const r = await execOnDevice(mapDevice(row), req.user, 'fs_touch', { path: target, content });
  if (r.status !== 'success') return fail(res, 'INTERNAL_ERROR', r.stderr || '创建失败', 400);
  return ok(res, { path: target, size: Buffer.byteLength(content) });
});

/** 重命名 / 移动 */
router.post('/:id/fs/rename', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!requireControl(req, res, row)) return;
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备当前离线', 409);

  const from = String(req.body?.from || '').trim();
  const to = String(req.body?.to || '').trim();
  const bad = fsGuard(from) || fsGuard(to);
  if (bad) return fail(res, 'VALIDATION_ERROR', bad, 400);

  const r = await execOnDevice(mapDevice(row), req.user, 'fs_rename', { from, to });
  if (r.status !== 'success') return fail(res, 'INTERNAL_ERROR', r.stderr || '重命名失败', 400);
  return ok(res, { from, to });
});

/** 删除（文件或目录，递归） */
router.post('/:id/fs/delete', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!requireControl(req, res, row)) return;
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备当前离线', 409);

  const target = String(req.body?.path || '').trim();
  const bad = fsGuard(target);
  if (bad) return fail(res, 'VALIDATION_ERROR', bad, 400);

  const r = await execOnDevice(mapDevice(row), req.user, 'fs_delete', { path: target });
  if (r.status !== 'success') return fail(res, 'INTERNAL_ERROR', r.stderr || '删除失败', 400);
  return ok(res, { path: target });
});

/** 读取文本文件（用于预览/编辑） */
router.get('/:id/fs/read', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备当前离线', 409);

  const target = String(req.query.path || '').trim();
  if (!target) return fail(res, 'VALIDATION_ERROR', '请填写文件路径', 400);

  const r = await execOnDevice(mapDevice(row), req.user, 'fs_read', { path: target });
  if (r.status !== 'success') return fail(res, 'INTERNAL_ERROR', r.stderr || '读取失败', 400);
  return ok(res, { path: target, content: r.stdout });
});

/* ==================== 系统自检 ==================== */
router.get('/:id/diag', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备离线', 409);

  const r = await execOnDevice(mapDevice(row), req.user, 'diag', {});
  const info = {};
  String(r.stdout || '')
    .split('\n')
    .forEach((line) => {
      const i = line.indexOf('=');
      if (i > 0) info[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });

  // 把 pm/am 的可用性直接判出来，前端好展示
  const pmOk = !!info.pm && !/Failure|error|Exception|not found/i.test(info.pm);
  const amOk = !!info.am && !/Failure|error|Exception/i.test(info.am);

  return ok(res, { info, pmOk, amOk, raw: r.stdout || '', status: r.status });
});

export default router;


