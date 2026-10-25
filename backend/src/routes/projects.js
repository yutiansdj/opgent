import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, mapProject, nowIso } from '../db.js';
import { ok, fail, authRequired, requirePerm } from '../http.js';
import { rid } from '../crypto.js';
import { config } from '../config.js';
import { canAccessProject, canAccessDevice, allowedProjectIds } from '../access.js';
import { buildInjectionScript, publicBase } from '../scriptgen.js';
import { randomAlphabet, encryptScript, makeCode } from '../cipher.js';
import { buildBinaryFromScript } from '../binary.js';
import { dispatchPullFile, dispatchCommand, isReachable } from '../dispatch.js';

const router = Router();

const getProject = (id) => db.prepare('SELECT * FROM projects WHERE id = ?').get(id);

const COUNT_SQL =
  '(SELECT COUNT(*) FROM devices d WHERE d.project_id = p.id) AS device_count';

/* ------------------------------------------------------------------
 * 公开接口：设备端按项目 token 拉取 agent 脚本（注入脚本会调它）
 * 必须放在鉴权中间件之前
 * ------------------------------------------------------------------ */
router.get('/:id/agent.sh', (req, res) => {
  const p = getProject(req.params.id);
  const token = String(req.query.token || '');
  if (!p || !token || p.token !== token) {
    return res.status(403).type('text/plain').send('ERR TOKEN');
  }
  if (!fs.existsSync(config.agentScript)) {
    return res.status(500).type('text/plain').send('ERR AGENT MISSING');
  }
  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  return res.send(fs.readFileSync(config.agentScript, 'utf8'));
});

/* 下发解密表：凭下载码换取 */
router.get('/bootstrap/key', (req, res) => {
  const code = String(req.query.code || '');
  const row = db.prepare('SELECT * FROM cipher_keys WHERE code = ?').get(code);
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(403).type('text/plain').send('');
  }
  db.prepare('UPDATE cipher_keys SET uses = uses + 1 WHERE code = ?').run(code);
  return res.type('text/plain').send(row.alphabet);
});

/* 创建一次性引导码 */
function createBootstrapCode(projectId, maxUses = 1000000, hours = 24 * 3650) {
  const code = rid('bc_', 10);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + hours * 3600_000).toISOString();
  db.prepare(
    'INSERT INTO bootstrap_codes (code, project_id, created_at, expires_at, uses, max_uses) VALUES (?, ?, ?, ?, 0, ?)'
  ).run(code, projectId, now.toISOString(), expiresAt, maxUses);
  return { code, expiresAt, maxUses };
}

/* 引导码兑换：返回真正的注入脚本（含项目 token，走 HTTPS 加密传输） */
router.get('/bootstrap/run', (req, res) => {
  const code = String(req.query.code || '');
  const row = db.prepare('SELECT * FROM bootstrap_codes WHERE code = ?').get(code);
  if (!row) return res.status(403).type('text/plain').send('ERR CODE');
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(403).type('text/plain').send('ERR EXPIRED');
  }
  // 不再限制使用次数：这个码本身就是凭据，限制次数只会让你重跑脚本时莫名 403
  db.prepare('UPDATE bootstrap_codes SET uses = uses + 1 WHERE code = ?').run(code);

  const p = getProject(row.project_id);
  if (!p) return res.status(404).type('text/plain').send('ERR PROJECT');

  const content = buildInjectionScript(mapProject(p), publicBase(), { forceLocal: true });
  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  return res.send(content);
});

/* 加密模式的运行入口：脚本体凭 token 拉取真正的脚本内容 */
router.get('/:id/run.sh', (req, res) => {
  const p = getProject(req.params.id);
  const token = String(req.query.token || '');
  if (!p || !token || p.token !== token) {
    return res.status(403).type('text/plain').send('ERR TOKEN');
  }
  // forceLocal：返回内嵌业务脚本的版本，避免无限套娃
  const content = buildInjectionScript(mapProject(p), publicBase(), { forceLocal: true });
  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  return res.send(content);
});

/* ---------------- 以下都要登录 ---------------- */
router.use(authRequired);

/* 项目列表 */
router.get('/', requirePerm('devices'), (req, res) => {
  const mine = allowedProjectIds(req.user);
  let rows;
  if (mine === null) {
    rows = db.prepare(`SELECT p.*, ${COUNT_SQL} FROM projects p ORDER BY p.created_at DESC`).all();
  } else if (mine.length === 0) {
    rows = [];
  } else {
    rows = db
      .prepare(
        `SELECT p.*, ${COUNT_SQL} FROM projects p
          WHERE p.id IN (${mine.map(() => '?').join(',')})
          ORDER BY p.created_at DESC`
      )
      .all(...mine);
  }
  return ok(res, { list: rows.map(mapProject) });
});

/* 新建项目 */
router.post('/', requirePerm('devices'), (req, res) => {
  const { name, script = '', options = {} } = req.body || {};
  const n = String(name || '').trim();
  if (!n) return fail(res, 'VALIDATION_ERROR', '请填写项目名称', 400);

  const id = rid('prj_');
  const token = rid('dt_', 16);

  db.prepare(
    `INSERT INTO projects (id, name, owner_id, owner_name, token, script, options, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    n.slice(0, 60),
    req.user.id,
    req.user.username,
    token,
    String(script || ''),
    JSON.stringify(options || {}),
    nowIso()
  );

  return ok(res, mapProject(getProject(id)), 201);
});

/* 项目详情 */
router.get('/:id', requirePerm('devices'), (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return fail(res, 'NOT_FOUND', '项目不存在', 404);
  if (!canAccessProject(req.user, p.id)) return fail(res, 'FORBIDDEN', '无权访问该项目', 403);
  return ok(res, mapProject(p));
});

/* 修改项目（名称 / 脚本 / 选项） */
router.put('/:id', requirePerm('devices'), (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return fail(res, 'NOT_FOUND', '项目不存在', 404);
  if (!canAccessProject(req.user, p.id)) return fail(res, 'FORBIDDEN', '无权修改该项目', 403);

  const { name, script, options } = req.body || {};
  if (name !== undefined) {
    const n = String(name).trim();
    if (!n) return fail(res, 'VALIDATION_ERROR', '项目名称不能为空', 400);
    db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(n.slice(0, 60), p.id);
  }
  if (script !== undefined) {
    db.prepare('UPDATE projects SET script = ? WHERE id = ?').run(String(script), p.id);
  }
  if (options !== undefined) {
    db.prepare('UPDATE projects SET options = ? WHERE id = ?').run(JSON.stringify(options || {}), p.id);
  }
  return ok(res, mapProject(getProject(p.id)));
});

/* 删除项目（设备不删，只解除归属） */
router.delete('/:id', requirePerm('devices'), (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return fail(res, 'NOT_FOUND', '项目不存在', 404);
  if (!canAccessProject(req.user, p.id)) return fail(res, 'FORBIDDEN', '无权删除该项目', 403);

  db.prepare('UPDATE devices SET project_id = NULL WHERE project_id = ?').run(p.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  return ok(res, true);
});

/* 重置项目 token（旧设备会失去归属，需要重新注入） */
router.post('/:id/reset-token', requirePerm('devices'), (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return fail(res, 'NOT_FOUND', '项目不存在', 404);
  if (!canAccessProject(req.user, p.id)) return fail(res, 'FORBIDDEN', '无权操作该项目', 403);

  const token = rid('dt_', 16);
  db.prepare('UPDATE projects SET token = ? WHERE id = ?').run(token, p.id);
  return ok(res, mapProject(getProject(p.id)));
});

/* 下载注入脚本（业务脚本 + 末尾对接段） */
router.get('/:id/script', requirePerm('devices'), (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return fail(res, 'NOT_FOUND', '项目不存在', 404);
  if (!canAccessProject(req.user, p.id)) return fail(res, 'FORBIDDEN', '无权访问该项目', 403);

  const project = mapProject(p);
  let content;

  // 二进制模式：把完整脚本编进 arm64 可执行文件，下载到的是程序不是脚本
  if (project.options && project.options.binary) {
    const plain = buildInjectionScript(project, publicBase(), { forceLocal: true });
    const bin = buildBinaryFromScript(plain);
    // 为了和普通脚本保持一致，二进制也用 .sh 后缀（内容仍是可执行文件）
    const name = encodeURIComponent(`${project.name || 'agent'}-inject.sh`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${name}`);
    res.setHeader('X-Is-Binary', '1');
    return res.send(bin);
  }

  if (project.options && project.options.encrypt) {
    // 自研加密：随机置换表 + 下载码；密文写进文件，解密表由后端下发
    const alphabet = randomAlphabet();
    const code = makeCode();
    const expiresAt = new Date(Date.now() + 365 * 86400_000).toISOString();
    db.prepare(
      'INSERT INTO cipher_keys (code, project_id, alphabet, created_at, expires_at, uses) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(code, p.id, alphabet, nowIso(), expiresAt);

    const plain = buildInjectionScript(project, publicBase(), { forceLocal: true });
    content = buildInjectionScript(project, publicBase(), {
      code,
      cipher: encryptScript(plain, alphabet),
    });
  } else {
    content = buildInjectionScript(project, publicBase(), { forceLocal: true });
  }
  const filename = encodeURIComponent(`${p.name}-inject.sh`);
  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  return res.send(content);
});

/* 一键注入到设备：推送脚本 → 后台执行（脚本自己会安装并接管 agent） */
router.post('/:id/inject', requirePerm('devices'), async (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return fail(res, 'NOT_FOUND', '项目不存在', 404);
  if (!canAccessProject(req.user, p.id)) return fail(res, 'FORBIDDEN', '无权操作该项目', 403);

  const ids = Array.isArray(req.body?.deviceIds) ? req.body.deviceIds : [];
  if (ids.length === 0) return fail(res, 'VALIDATION_ERROR', '请至少选择一台设备', 400);

  const project = mapProject(p);
  const isBinary = !!(project.options && project.options.binary);
  const content = isBinary
    ? buildBinaryFromScript(buildInjectionScript(project, publicBase(), { forceLocal: true }))
    : buildInjectionScript(project, publicBase());

  // 先落盘成服务器上的一个文件，让设备通过既有通道拉取
  const fileId = rid('f_');
  const filePath = path.join(config.uploadDir, `${fileId}${isBinary ? '.bin' : '.sh'}`);
  fs.writeFileSync(filePath, content);
  db.prepare('INSERT INTO files (id, name, path, size, created_at) VALUES (?, ?, ?, ?, ?)').run(
    fileId,
    `${project.name}-inject${isBinary ? '.bin' : '.sh'}`,
    filePath,
    Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content),
    nowIso()
  );

  const results = [];
  for (const deviceId of ids) {
    const drow = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
    if (!drow) {
      results.push({ deviceId, status: 'failed', message: '设备不存在' });
      continue;
    }
    if (!canAccessDevice(req.user, drow)) {
      results.push({ deviceId, status: 'failed', message: '无权访问该设备' });
      continue;
    }
    if (!isReachable(deviceId)) {
      results.push({ deviceId, status: 'failed', message: '设备离线' });
      continue;
    }

    const remote = `/data/local/tmp/proj_${project.id}${isBinary ? '.bin' : '.sh'}`;
    const up = await dispatchPullFile(deviceId, fileId, remote, 'save');
    if (!up || up.status !== 'success') {
      results.push({ deviceId, status: 'failed', message: up?.stderr || '脚本推送失败' });
      continue;
    }

    // 二进制直接执行；脚本走 sh
    const runner = isBinary ? `sh -c "chmod 755 ${remote}; ${remote}"` : `sh ${remote}`;
    await dispatchCommand(
      deviceId,
      'shell',
      {
        command: `chmod 755 ${remote}; ( trap '' HUP; ${runner} >/dev/null 2>&1 & ); echo injected`,
      },
      15000
    );
    results.push({ deviceId, status: 'success', message: '已注入，设备将切换到该项目' });
  }

  return ok(res, { results });
});

export default router;
