import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ok, fail, authRequired, requireSuper } from '../http.js';
import { config } from '../config.js';

/**
 * 公开脚本目录管理（/app/ 映射到磁盘同名目录）。
 * 只有超级管理员能读写；对外只读，且不可列目录。
 */
const router = Router();

router.use(authRequired, requireSuper);

fs.mkdirSync(config.appDir, { recursive: true });

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function safePath(name) {
  const n = String(name || '').trim();
  if (!NAME_RE.test(n)) return null;
  const full = path.join(config.appDir, n);
  // 双重保险：解析后必须仍在 appDir 之内
  if (!path.resolve(full).startsWith(path.resolve(config.appDir) + path.sep)) return null;
  return full;
}

/** 文件列表 */
router.get('/', (req, res) => {
  const list = fs
    .readdirSync(config.appDir)
    .filter((n) => NAME_RE.test(n))
    .map((n) => {
      const st = fs.statSync(path.join(config.appDir, n));
      return { name: n, size: st.size, mtime: st.mtime.toISOString(), url: `/app/${n}` };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return ok(res, { dir: config.appDir, list });
});

/** 读取内容 */
router.get('/:name', (req, res) => {
  const full = safePath(req.params.name);
  if (!full) return fail(res, 'VALIDATION_ERROR', '文件名不合法', 400);
  if (!fs.existsSync(full)) return fail(res, 'NOT_FOUND', '文件不存在', 404);
  if (fs.statSync(full).size > 512 * 1024) return fail(res, 'VALIDATION_ERROR', '文件超过 512KB，请直接改服务器', 400);
  return ok(res, { name: req.params.name, content: fs.readFileSync(full, 'utf8') });
});

/** 保存（不存在则新建） */
router.put('/:name', (req, res) => {
  const full = safePath(req.params.name);
  if (!full) return fail(res, 'VALIDATION_ERROR', '文件名不合法', 400);
  const content = String(req.body?.content ?? '');
  if (Buffer.byteLength(content) > 512 * 1024) {
    return fail(res, 'VALIDATION_ERROR', '内容超过 512KB', 400);
  }
  fs.writeFileSync(full, content, 'utf8');
  fs.chmodSync(full, 0o644);
  return ok(res, { name: req.params.name, size: Buffer.byteLength(content), url: `/app/${req.params.name}` });
});

/** 删除 */
router.delete('/:name', (req, res) => {
  const full = safePath(req.params.name);
  if (!full) return fail(res, 'VALIDATION_ERROR', '文件名不合法', 400);
  if (!fs.existsSync(full)) return fail(res, 'NOT_FOUND', '文件不存在', 404);
  fs.unlinkSync(full);
  return ok(res, true);
});

export default router;
