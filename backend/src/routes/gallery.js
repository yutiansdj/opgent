import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// sharp 用于生成缩略图；属于可选依赖，装不上时退回原图
let sharp = null;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.warn('[gallery] 未安装 sharp，缩略图将直接返回原图');
}

import { db, nowIso, mapDevice } from '../db.js';
import { ok, fail, authRequired, requirePerm } from '../http.js';
import { canAccessDevice } from '../access.js';
import { dispatchCommand, isReachable } from '../dispatch.js';
import { findFile } from '../storage.js';
import { config } from '../config.js';

const router = Router();
router.use(authRequired);

const CACHE_DIR = path.join(config.dataDir, 'photo-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i;
const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

const getDevice = (id) => db.prepare('SELECT * FROM devices WHERE id = ?').get(id);

/** 解析脚本返回的 `类型|大小|时间|权限|base64文件名` */
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
      if (!name) return null;
      const t = (perm || '').startsWith('d') ? 'd' : (perm || '').startsWith('l') ? 'l' : 'f';
      return { name, type: t, size: Number(size) || 0, mtime: Number(mtime) || 0, perm: perm || '' };
    })
    .filter(Boolean);
}

function cacheKey(deviceId, filePath, size, mtime) {
  return crypto.createHash('sha1').update(`${deviceId}|${filePath}|${size}|${mtime}`).digest('hex');
}

/** 从设备拉取原图到本地缓存（同一张图只拉一次） */
async function ensureOriginal(device, filePath, key) {
  const target = path.join(CACHE_DIR, `${key}.orig`);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) return target;

  const r = await dispatchCommand(device.id, 'download', { path: filePath }, 120000);
  if (!r || r.status !== 'success' || !r.fileId) {
    throw new Error(r?.stderr || '从手机拉取图片失败');
  }
  const f = findFile(r.fileId);
  if (!f || !fs.existsSync(f.path)) throw new Error('回传文件丢失');
  fs.copyFileSync(f.path, target);
  return target;
}

/* ---------------- 相册列表 ---------------- */
router.get('/:id/gallery', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);
  if (!isReachable(row.id)) return fail(res, 'DEVICE_OFFLINE', '设备离线', 409);

  const dir = String(req.query.path || '/sdcard/DCIM/Camera').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(60, Math.max(1, parseInt(req.query.pageSize, 10) || 24));

  const r = await dispatchCommand(row.id, 'fs_list', { path: dir }, 30000);
  if (!r || r.status !== 'success') {
    return fail(res, 'INTERNAL_ERROR', r?.stderr || '读取目录失败（可能没有相册目录）', 400);
  }

  const images = parseFsList(r.stdout)
    .filter((e) => e.type === 'f' && IMAGE_EXT.test(e.name))
    .sort((a, b) => b.mtime - a.mtime);

  const total = images.length;
  const slice = images.slice((page - 1) * pageSize, page * pageSize);

  return ok(res, {
    path: dir,
    total,
    page,
    pageSize,
    items: slice.map((e) => ({
      name: e.name,
      path: dir.endsWith('/') ? `${dir}${e.name}` : `${dir}/${e.name}`,
      size: e.size,
      mtime: e.mtime,
    })),
  });
});

/* ---------------- 缩略图 ---------------- */
router.get('/:id/thumb', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);

  const filePath = String(req.query.path || '');
  if (!filePath) return fail(res, 'VALIDATION_ERROR', '缺少 path', 400);
  const size = Number(req.query.size) || 0;
  const mtime = Number(req.query.mtime) || 0;
  const width = Math.min(800, Math.max(120, parseInt(req.query.w, 10) || 360));

  const key = cacheKey(row.id, filePath, size, mtime);
  const thumbFile = path.join(CACHE_DIR, `${key}_${width}.jpg`);
  if (fs.existsSync(thumbFile)) {
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.type('image/jpeg').sendFile(thumbFile);
  }

  try {
    if (!sharp) throw new Error('sharp-unavailable');
    const original = await ensureOriginal(row, filePath, key);
    await sharp(original, { failOn: 'none', limitInputPixels: false })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(thumbFile);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.type('image/jpeg').sendFile(thumbFile);
  } catch (e) {
    // 生成失败（比如 HEIC 不被 libvips 支持）就退回原图，让浏览器自己处理
    try {
      const original = await ensureOriginal(row, filePath, key);
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.type(MIME[ext] || 'application/octet-stream').sendFile(original);
    } catch (e2) {
      return fail(res, 'INTERNAL_ERROR', e2.message || e.message || '缩略图生成失败', 500);
    }
  }
});

/* ---------------- 原图 ---------------- */
router.get('/:id/photo', requirePerm('devices'), async (req, res) => {
  const row = getDevice(req.params.id);
  if (!row) return fail(res, 'NOT_FOUND', '设备不存在', 404);
  if (!canAccessDevice(req.user, row)) return fail(res, 'FORBIDDEN', '无权访问该设备', 403);

  const filePath = String(req.query.path || '');
  if (!filePath) return fail(res, 'VALIDATION_ERROR', '缺少 path', 400);
  const key = cacheKey(row.id, filePath, Number(req.query.size) || 0, Number(req.query.mtime) || 0);

  try {
    const original = await ensureOriginal(row, filePath, key);
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.type(MIME[ext] || 'application/octet-stream').sendFile(original);
  } catch (e) {
    return fail(res, 'INTERNAL_ERROR', e.message || '读取原图失败', 500);
  }
});

/* ---------------- 常见相册目录 ---------------- */
router.get('/:id/gallery/dirs', requirePerm('devices'), (req, res) => {
  return ok(res, {
    list: [
      { label: '相机照片', path: '/sdcard/DCIM/Camera' },
      { label: '截图', path: '/sdcard/Pictures/Screenshots' },
      { label: '图片', path: '/sdcard/Pictures' },
      { label: '下载', path: '/sdcard/Download' },
      { label: '微信图片', path: '/sdcard/Pictures/WeiXin' },
      { label: '根目录', path: '/sdcard' },
    ],
  });
});

export default router;
