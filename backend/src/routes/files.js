import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ok, fail, authRequired } from '../http.js';
import { upload, recordUploadedFile, findFile, findDeviceByToken } from '../storage.js';

const router = Router();

/** Agent 回传文件（用设备 token 鉴权，不走 JWT） */
router.post('/upload', upload.single('file'), (req, res) => {
  const device = findDeviceByToken(req.query.token || req.headers['x-device-token']);
  if (!device) return fail(res, 'UNAUTHORIZED', '设备 token 无效', 401);
  if (!req.file) return fail(res, 'VALIDATION_ERROR', '缺少文件字段 file', 400);
  // 记录设备的 IP，方便运维排查
  const f = recordUploadedFile(req.file);
  return ok(res, { fileId: f.fileId, name: f.name, size: f.size });
});

/** Agent 拉取服务器上的文件（用设备 token 鉴权） */
router.get('/:fileId/raw', (req, res) => {
  const device = findDeviceByToken(req.query.token || req.headers['x-device-token']);
  if (!device) return fail(res, 'UNAUTHORIZED', '设备 token 无效', 401);
  const f = findFile(req.params.fileId);
  if (!f || !fs.existsSync(f.path)) return fail(res, 'NOT_FOUND', '文件不存在', 404);
  res.setHeader('Content-Type', 'application/octet-stream');
  return res.sendFile(path.resolve(f.path));
});

/** 管理员下载（Bearer JWT） */
router.get('/:fileId/download', authRequired, (req, res) => {
  const f = findFile(req.params.fileId);
  if (!f || !fs.existsSync(f.path)) return fail(res, 'NOT_FOUND', '文件不存在', 404);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name || 'file')}`);
  return res.sendFile(path.resolve(f.path));
});

export default router;
