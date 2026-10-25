import { Router } from 'express';
import { findDeviceByToken } from '../storage.js';
import { waitForCommand, settleShell } from '../shell.js';
import { updateDeviceFromAgent } from '../deviceState.js';
import { clientIp } from '../netutil.js';
import fs from 'node:fs';
import { findFile } from '../storage.js';

/**
 * 给「纯 shell Agent」用的 HTTP 通道（长轮询）。全部用 text/plain，
 * 让脚本可以用 curl 直接处理，不需要解析 JSON。
 */
const router = Router();

function authDevice(req, res) {
  const token = req.query.token || req.headers['x-device-token'];
  const uid = req.query.uid || req.headers['x-device-uid'];
  const device = findDeviceByToken(token, uid);
  if (!device) {
    res.status(401).type('text/plain').send('ERR TOKEN');
    return null;
  }
  return device;
}

/** 连通性自检 */
router.get('/ping', (req, res) => {
  const device = authDevice(req, res);
  if (!device) return;
  res.type('text/plain').send(`PONG ${device.id}`);
});

/**
 * 长轮询取指令：最多挂 20 秒。
 * 返回：`NONE` 或 `CMD <requestId> <cmd> <base64参数...>`
 * 参数按指令固定顺序排列，缺省位用 `-` 占位（- 不是 base64 字符，安全）。
 */
router.all('/poll', async (req, res) => {
  const device = authDevice(req, res);
  if (!device) return;

  const cmd = await waitForCommand(device.id, 20_000);
  updateDeviceFromAgent(device.id, {}, clientIp(req));

  res.type('text/plain');
  if (!cmd) return res.send('NONE');

  const args = cmd.args.map((a) => (a ? a : '-')).join(' ');
  return res.send(`CMD ${cmd.requestId} ${cmd.cmd}${args ? ` ${args}` : ''}`);
});

/** 回传执行结果（stdout/stderr/image 一律 base64） */
router.post('/result', (req, res) => {
  const device = authDevice(req, res);
  if (!device) return;

  const b = req.body || {};
  const dec = (v) => (v ? Buffer.from(String(v), 'base64').toString('utf8') : '');

  // 截图走文件回传：agent 只发 imageFileId，这里读出来内联成 data URL 给前端
  let image = b.image ? String(b.image) : null;
  if (!image && b.imageFileId) {
    try {
      const f = findFile(String(b.imageFileId));
      if (f && fs.existsSync(f.path)) {
        const buf = fs.readFileSync(f.path);
        image = `data:image/png;base64,${buf.toString('base64')}`;
        fs.unlinkSync(f.path);
        db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
      }
    } catch {
      /* 读不到就当没有图 */
    }
  }

  const payload = {
    ok: String(b.ok) === '1',
    stdout: dec(b.stdout),
    stderr: dec(b.stderr),
    exitCode: b.exitCode !== undefined && b.exitCode !== '' ? Number(b.exitCode) : 0,
    durationMs: Number(b.durationMs || 0),
    // 注意：图片是二进制，绝对不能 Buffer->utf8（会毁掉字节），
    // 这里直接保留 base64 原文，由下游补 data URL 前缀。
    image: image
      ? String(image).startsWith('data:')
        ? String(image)
        : `data:image/png;base64,${String(image)}`
      : null,
    fileId: b.fileId || null,
  };

  const hit = settleShell(String(b.requestId || ''), payload);
  res.type('text/plain').send(hit ? 'OK' : 'NOOP');
});

/** 心跳 + 设备信息上报 */
router.post('/heartbeat', (req, res) => {
  const device = authDevice(req, res);
  if (!device) return;

  const b = req.body || {};
  updateDeviceFromAgent(
    device.id,
    {
      model: b.model,
      androidVersion: b.androidVersion,
      rootStatus: b.rootStatus,
      battery: b.battery !== undefined && b.battery !== '' ? Number(b.battery) : undefined,
      network: b.network,
    },
    clientIp(req)
  );

  res.type('text/plain').send('OK');
});

export default router;
