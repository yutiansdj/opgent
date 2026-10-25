import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import AppInfoParser from 'app-info-parser';
import AdmZip from 'adm-zip';

import { db, nowIso } from '../db.js';
import { ok, fail, authRequired, requirePerm } from '../http.js';
import { canAccessDevice } from '../access.js';
import { dispatchCommand, isReachable } from '../dispatch.js';
import { findFile } from '../storage.js';
import { config } from '../config.js';

/**
 * 应用列表
 *
 * 列表本身在手机上取（pm list packages -f，很快）；
 * 图标和应用名需要解析 APK 资源，所以按需「拉一次 APK → 解析 → 缓存」，
 * 之后同一版本不再重复拉取。
 */
const router = Router();
router.use(authRequired);

const CACHE_DIR = path.join(config.dataDir, 'app-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const getDevice = (id) => db.prepare('SELECT * FROM devices WHERE id = ?').get(id);


/** 判断图片格式 */
function imageKind(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** 从 APK 里挑一个最高清的 ic_launcher 图片（自适应图标是 XML，只能走这条路） */
function iconFromApk(apkPath) {
  const z = new AdmZip(apkPath);
  const rank = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi', 'ldpi'];
  const score = (name) => {
    if (!/ic_launcher[^/]*\.(png|webp)$/i.test(name)) return -1;
    if (/_foreground|_monochrome|_background/i.test(name)) return -1;
    const m = name.match(/(xxxhdpi|xxhdpi|xhdpi|hdpi|mdpi|ldpi)/i);
    const idx = m ? rank.findIndex((r) => r.toLowerCase() === m[1].toLowerCase()) : rank.length;
    return (idx < 0 ? rank.length : idx) * 1000 - name.length * 0.001;
  };
  let best = null;
  let bestScore = -1;
  for (const e of z.getEntries()) {
    if (e.isDirectory) continue;
    const sc = score(e.entryName);
    if (sc > bestScore) {
      bestScore = sc;
      best = e;
    }
  }
  if (!best) return null;
  const buf = best.getData();
  const kind = imageKind(buf);
  return kind ? { buf, ext: kind } : null;
}

function cacheKey(pkg, size) {
  const safe = String(pkg).replace(/[^A-Za-z0-9._-]/g, '_');
  return `${safe}__${Number(size) || 0}`;
}

function readMeta(key) {
  const f = path.join(CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

/** 从设备拉取 APK 并解析出 名称 / 版本 / 图标 */
async function ensureMeta(device, pkg, apkPath, size) {
  const key = cacheKey(pkg, size);
  const cached = readMeta(key);
  if (cached) return cached;

  const r = await dispatchCommand(device.id, 'download', { path: apkPath }, 180000);
  if (!r || r.status !== 'success' || !r.fileId) {
    throw new Error(r?.stderr || '从手机拉取 APK 失败');
  }
  const f = findFile(r.fileId);
  if (!f || !fs.existsSync(f.path)) throw new Error('APK 回传丢失');

  let meta = { pkg, label: '', version: '', iconFile: '' };
  try {
    const parsed = await new AppInfoParser(f.path).parse();
    const rawLabel = parsed?.application?.label;
    const label = Array.isArray(rawLabel) ? rawLabel[0] : rawLabel;
    meta.label = label || pkg;
    meta.version = parsed?.versionName || '';

    // 1) 优先用解析出来的图标（注意是 data:image/png;base64, 形式）
    let icon = null;
    if (parsed?.icon) {
      const raw = String(parsed.icon);
      const b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
      const buf = Buffer.from(b64, 'base64');
      const kind = imageKind(buf);
      if (kind) icon = { buf, ext: kind };
    }

    // 2) 自适应图标（XML）解析不出图片，就从 APK 里挑一个最高清的 mipmap
    if (!icon) {
      try {
        icon = iconFromApk(f.path);
      } catch {
        icon = null;
      }
    }

    if (icon) {
      const iconFile = path.join(CACHE_DIR, `${key}.${icon.ext}`);
      fs.writeFileSync(iconFile, icon.buf);
      meta.iconFile = iconFile;
      meta.iconExt = icon.ext;
    }
  } finally {
    // APK 用完即删，别把上传目录撑爆
    try {
      fs.unlinkSync(f.path);
    } catch {
      /* ignore */
    }
    try {
      db.prepare('DELETE FROM files WHERE id = ?').run(r.fileId);
    } catch {
      /* ignore */
    }
  }

  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(meta), 'utf8');
  return meta;
}

/** 应用列表（含已缓存的名称/图标标记） */
router.get('/:id/apps', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备离线', 409);

  const r = await dispatchCommand(row.id, 'apps_list', {}, 120000);
  if (!r || r.status !== 'success') {
    return fail(res, 'INTERNAL_ERROR', r?.stderr || '读取应用列表失败（pm 可能不可用）', 400);
  }

  const list = String(r.stdout || '')
    .split('\n')
    .map((line) => {
      const parts = line.split('|');
      if (parts.length < 2) return null;
      const [pkg, apk, size] = parts;
      if (!pkg || !apk) return null;
      const meta = readMeta(cacheKey(pkg, size));
      return {
        package: pkg,
        apk,
        size: Number(size) || 0,
        label: meta?.label || '',
        version: meta?.version || '',
        hasIcon: !!(meta && meta.iconFile && fs.existsSync(meta.iconFile)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.label || a.package).localeCompare(b.label || b.package, 'zh'));

  return ok(res, { total: list.length, list });
});

/** 拉取并缓存某个应用的名称/版本/图标 */
router.get('/:id/apps/meta', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);

  const pkg = String(req.query.pkg || '').trim();
  const apk = String(req.query.apk || '').trim();
  const size = Number(req.query.size) || 0;
  if (!pkg || !apk) return fail(res, 'VALIDATION_ERROR', '缺少 pkg / apk 参数', 400);
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备离线', 409);

  try {
    const meta = await ensureMeta(row, pkg, apk, size);
    return ok(res, {
      package: pkg,
      label: meta.label || pkg,
      version: meta.version || '',
      hasIcon: !!(meta.iconFile && fs.existsSync(meta.iconFile)),
    });
  } catch (e) {
    return fail(res, 'INTERNAL_ERROR', e.message || '解析失败', 500);
  }
});

/** 图标（PNG），没缓存则现拉现解析 */
router.get('/:id/apps/icon', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);

  const pkg = String(req.query.pkg || '').trim();
  const apk = String(req.query.apk || '').trim();
  const size = Number(req.query.size) || 0;
  if (!pkg || !apk) return fail(res, 'VALIDATION_ERROR', '缺少 pkg / apk 参数', 400);

  const key = cacheKey(pkg, size);
  const cached = readMeta(key);
  const ext = cached?.iconExt || 'png';
  const iconFile = cached?.iconFile || path.join(CACHE_DIR, `${key}.png`);
  if (fs.existsSync(iconFile)) {
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.type(`image/${ext}`).sendFile(iconFile);
  }

  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备离线', 409);
  try {
    const meta2 = await ensureMeta(row, pkg, apk, size);
    if (meta2.iconFile && fs.existsSync(meta2.iconFile)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.type(`image/${meta2.iconExt || 'png'}`).sendFile(meta2.iconFile);
    }
    return res.status(404).type('text/plain').send('NO ICON');
  } catch (e) {
    return fail(res, 'INTERNAL_ERROR', e.message || '图标解析失败', 500);
  }
});

/** 缓存占用情况 */
router.get('/:id/apps/cache', requirePerm('devices'), (req, res) => {
  let size = 0;
  let count = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    try {
      size += fs.statSync(path.join(CACHE_DIR, f)).size;
      if (f.endsWith('.png') || f.endsWith('.webp') || f.endsWith('.jpg')) count += 1;
    } catch {
      /* ignore */
    }
  }
  return ok(res, { icons: count, bytes: size });
});

export default router;
