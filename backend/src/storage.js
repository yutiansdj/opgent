import multer from 'multer';
import path from 'node:path';
import { config } from './config.js';
import { rid } from './crypto.js';
import { db, nowIso } from './db.js';

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => cb(null, rid('f_') + (path.extname(file.originalname || '') || '')),
});

/** 单文件上限 500MB */
export const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

/**
 * 修复中文文件名乱码。
 * multipart 的 filename 由 busboy 按 latin1 解码，中文会变成 "ä¸Šä¼ " 这种。
 * 这里尝试按 latin1 还原字节再按 UTF-8 解；若还原失败（已是正常字符串）则原样返回。
 */
function fixFilename(name) {
  if (!name) return name;
  try {
    const restored = Buffer.from(name, 'latin1').toString('utf8');
    if (restored.includes('\uFFFD')) return name;
    return restored;
  } catch {
    return name;
  }
}

/** multer 落盘后登记到 files 表，返回 {fileId,name,size,path} */
export function recordUploadedFile(file) {
  const ext = path.extname(file.filename);
  const fileId = path.basename(file.filename, ext);
  const name = fixFilename(file.originalname) || file.filename;
  db.prepare('INSERT INTO files (id, name, path, size, created_at) VALUES (?, ?, ?, ?, ?)').run(
    fileId,
    name,
    file.path,
    file.size,
    nowIso()
  );
  return { fileId, name, size: file.size, path: file.path };
}

export function findFile(fileId) {
  return db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
}

export function findDeviceByToken(token, deviceUid) {
  if (!token) return null;
  const tk = String(token);
  const uid = deviceUid ? String(deviceUid) : '';
  // 优先按 (token, device_uid) 精确定位；没有 uid 时退回按 token 取第一条
  if (uid) {
    const hit = db.prepare('SELECT * FROM devices WHERE token = ? AND device_uid = ?').get(tk, uid);
    if (hit) return hit;
  }
  return db.prepare('SELECT * FROM devices WHERE token = ? ORDER BY created_at LIMIT 1').get(tk);
}
