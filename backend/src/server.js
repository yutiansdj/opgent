import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

import { config } from './config.js';
import { db, nowIso, mapDevice, startLogRetention, getSettings } from './db.js';
import { ok, fail } from './http.js';
import { attachAgent, detachAgent, settle } from './hub.js';
import { findDeviceByToken } from './storage.js';
import { clientIp } from './netutil.js';
import { updateDeviceFromAgent } from './deviceState.js';

import authRouter from './routes/auth.js';
import dashboardRouter from './routes/dashboard.js';
import devicesRouter from './routes/devices.js';
import templatesRouter from './routes/templates.js';
import tasksRouter from './routes/tasks.js';
import logsRouter from './routes/logs.js';
import usersRouter from './routes/users.js';
import settingsRouter from './routes/settings.js';
import filesRouter from './routes/files.js';
import agentRouter from './routes/agent.js';
import projectsRouter from './routes/projects.js';
import galleryRouter from './routes/gallery.js';
import appFilesRouter from './routes/appfiles.js';
import appsRouter from './routes/apps.js';
import maintenanceRouter from './routes/maintenance.js';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* 开发期跨域（生产由 Nginx 同源代理，不影响） */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------------- API ---------------- */
app.get('/api/health', (req, res) => ok(res, { status: 'up', time: nowIso() }));

/** 公开的站点信息（登录页也要显示系统名称，不能要求鉴权） */
app.get('/api/site', (req, res) => {
  const s = getSettings();
  return ok(res, {
    siteName: s.siteName || '远程安卓设备运维平台',
    // 对外地址：生成对接模板时要用它回连
    publicBase: config.publicBase || '',
  });
});

app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/logs', logsRouter);
app.use('/api/users', usersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/files', filesRouter);
app.use('/api/agent', agentRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/gallery', galleryRouter);
app.use('/api/appfiles', appFilesRouter);
app.use('/api/apps', appsRouter);
app.use('/api/maintenance', maintenanceRouter);

app.use('/api', (req, res) => fail(res, 'NOT_FOUND', `接口不存在：${req.method} ${req.originalUrl}`, 404));

/* ---------------- 前端静态资源（存在 dist 就由后端一并托管） ---------------- */
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist, { index: false }));

  const INDEX_FILE = path.join(config.webDist, 'index.html');

  /**
   * 返回 index.html，并把 <title> 替换成「系统设置」里的站点名称。
   * 这样首屏（JS 还没跑）标题就是对的，不会先闪一下默认名。
   */
  function sendIndex(res) {
    try {
      const name = getSettings().siteName || '远程安卓设备运维平台';
      const html = fs
        .readFileSync(INDEX_FILE, 'utf8')
        .replace(/<title>[^<]*<\/title>/, `<title>${name.replace(/[<>&]/g, '')}</title>`);
      return res.type('html').send(html);
    } catch {
      return res.sendFile(INDEX_FILE);
    }
  }

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    return sendIndex(res);
  });
} else {
  console.log(`[web] 未找到前端产物（${config.webDist}），仅提供 API`);
}

/* ---------------- 统一错误处理 ---------------- */
app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return fail(res, 'VALIDATION_ERROR', '文件超过 500MB 上限', 413);
  console.error('[http] 未捕获异常', err);
  return fail(res, 'INTERNAL_ERROR', err?.message || '服务器内部错误', 500);
});

/* ---------------- WebSocket：Agent 接入 ---------------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    socket.destroy();
    return;
  }
  if (url.pathname !== '/ws/agent') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  const token = url.searchParams.get('token') || req.headers['x-device-token'];
  const row = findDeviceByToken(token);
  if (!row) {
    console.log('[ws] 拒绝连接：设备 token 无效');
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, row);
  });
});

wss.on('connection', (ws, req, device) => {
  const ip = clientIp(req);
  attachAgent(device.id, ws);
  updateDeviceFromAgent(device.id, {}, ip);
  console.log(`[ws] 设备上线：${device.name} (${device.id}) from ${ip}`);

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }

    if (msg.type === 'hello' || msg.type === 'heartbeat') {
      updateDeviceFromAgent(device.id, msg.device || {}, ip);
      if (msg.type === 'hello') {
        try {
          ws.send(JSON.stringify({ type: 'hello_ack', serverTime: nowIso() }));
        } catch {
          /* ignore */
        }
      }
    } else if (msg.type === 'result') {
      settle(msg.requestId, msg);
    }
  });

  ws.on('close', () => {
    detachAgent(device.id, ws);
    // 不在这里立刻置离线：网络抖动/系统冻结会让连接瞬间重连，
    // 立刻标红会导致后台状态疯狂闪烁。改由下面的巡检按心跳超时统一判定，
    // 与界面上「心跳 60s 内视为在线」的文案保持一致。
    console.log(`[ws] 连接断开（等待心跳超时判定）：${device.name} (${device.id})`);
  });

  ws.on('error', (e) => {
    console.error(`[ws] 设备连接异常 ${device.id}:`, e.message);
  });
});

/** 心跳巡检：每 15 秒打一次 ping，清理僵死连接，并按心跳超时判定离线 */
const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
  // 兜底：长时间没有心跳的设备置为离线
  const cutoff = new Date(Date.now() - config.heartbeatTimeoutMs).toISOString();
  db.prepare('UPDATE devices SET online = 0 WHERE online = 1 AND (last_seen_at IS NULL OR last_seen_at < ?)').run(
    cutoff
  );
}, 15_000);
heartbeatTimer.unref?.();

startLogRetention();

/**
 * 缓存自动清理：每 6 小时检查一次
 *  - 相册原图：超过 7 天删除（缩略图保留）
 *  - 上传文件：超过 7 天删除（同步清掉 files 表记录）
 */
function startCacheCleanup() {
  const tick = () => {
    const cutoff = Date.now() - 7 * 86400_000;
    const clean = (dir, filter) => {
      if (!fs.existsSync(dir)) return 0;
      let n = 0;
      for (const name of fs.readdirSync(dir)) {
        if (filter && !filter(name)) continue;
        const full = path.join(dir, name);
        try {
          const st = fs.statSync(full);
          if (!st.isFile() || st.mtimeMs > cutoff) continue;
          fs.unlinkSync(full);
          try {
            db.prepare('DELETE FROM files WHERE path = ?').run(full);
          } catch {
            /* ignore */
          }
          n += 1;
        } catch {
          /* ignore */
        }
      }
      return n;
    };
    try {
      const a = clean(path.join(config.dataDir, 'photo-cache'), (n) => n.endsWith('.orig'));
      const b = clean(config.uploadDir);
      if (a || b) console.log(`[cleanup] 清理缓存：相册原图 ${a} 个，上传文件 ${b} 个`);
    } catch (e) {
      console.error('[cleanup] 失败', e.message);
    }
  };
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, 6 * 3600_000).unref?.();
}
startCacheCleanup();

server.listen(config.port, config.host, () => {
  console.log(`[server] 远程安卓设备运维平台后端已启动：http://${config.host}:${config.port}`);
  console.log(`[server] WebSocket：ws://<host>:${config.port}/ws/agent?token=<设备token>`);
  const admins = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'super'`).get().c;
  console.log(`[server] 超级管理员账号数：${admins}`);
});

/* 优雅退出 */
function shutdown(sig) {
  console.log(`[server] 收到 ${sig}，正在关闭…`);
  clearInterval(heartbeatTimer);
  for (const ws of wss.clients) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref?.();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
