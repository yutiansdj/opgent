/**
 * 纯 shell Agent 的 HTTP 通道（长轮询）。
 *
 * 与 WebSocket 通道互补：WS 用于 App，HTTP 轮询用于 root shell 脚本。
 * 两条通道共用同一套指令语义与日志，前端无感知。
 */

import { config } from './config.js';
import { rid } from './crypto.js';

/** deviceId -> { queue: [], waiter, lastPollAt, results: Map } */
const agents = new Map();

function bucket(deviceId) {
  let b = agents.get(deviceId);
  if (!b) {
    b = { queue: [], waiter: null, lastPollAt: 0, results: new Map() };
    agents.set(deviceId, b);
  }
  return b;
}

export function shellTouch(deviceId) {
  bucket(deviceId).lastPollAt = Date.now();
}

/** 最近 45 秒内轮询过，即视为该设备有 shell agent 在线 */
export function shellOnline(deviceId) {
  const b = agents.get(deviceId);
  return !!b && Date.now() - b.lastPollAt < 90_000;
}

/**
 * 指令参数按固定顺序序列化成 base64 数组，避免在 shell 里解析 JSON。
 * 顺序由 cmd 决定，两端必须一致。
 */
export function encodeParams(cmd, params = {}) {
  const pick = (v) => Buffer.from(String(v ?? ''), 'utf8').toString('base64');
  switch (cmd) {
    case 'shell':
      return [pick(params.command)];
    case 'open_app':
    case 'uninstall_app':
      return [pick(params.packageName)];
    case 'download':
      return [pick(params.path)];
    case 'pull_file':
      return [pick(params.fileId), pick(params.targetPath), pick(params.mode || 'save')];
    case 'fs_list':
    case 'fs_mkdir':
    case 'fs_delete':
    case 'fs_read':
      return [pick(params.path)];
    case 'fs_touch':
      return [pick(params.path), pick(params.content || '')];
    case 'fs_rename':
      return [pick(params.from), pick(params.to)];
    case 'tap':
      return [pick(params.x), pick(params.y)];
    case 'swipe':
      return [pick(params.x1), pick(params.y1), pick(params.x2), pick(params.y2), pick(params.duration)];
    case 'key':
      return [pick(params.code)];
    case 'input_text':
      return [pick(params.text)];
    case 'notify':
      return [pick(params.title), pick(params.text)];
    case 'camera':
      return [pick(params.facing || 'front')];
    case 'diag':
    case 'apps_list':
      return [];
    default:
      return [];
  }
}

/** 把一条指令放入该设备的队列，等待脚本取走并回传结果 */
export function enqueueForShell(deviceId, cmd, params, timeoutMs = config.commandTimeoutMs) {
  const b = bucket(deviceId);
  const requestId = rid('r_');

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      b.results.delete(requestId);
      resolve({
        requestId,
        status: 'timeout',
        stdout: '',
        stderr: 'shell agent 响应超时',
        exitCode: null,
        durationMs: timeoutMs,
        image: null,
        fileId: null,
        accepted: false,
      });
    }, timeoutMs);

    b.results.set(requestId, { resolve, timer });
    b.queue.push({ requestId, cmd, args: encodeParams(cmd, params) });

    // 唤醒正在长轮询的请求
    if (b.waiter) {
      const w = b.waiter;
      b.waiter = null;
      w();
    }
  });
}

/** 阻塞等待一条指令（长轮询），超时返回 null */
export function waitForCommand(deviceId, waitMs = 20_000) {
  const b = bucket(deviceId);
  b.lastPollAt = Date.now();

  if (b.queue.length) return Promise.resolve(b.queue.shift());

  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      b.waiter = null;
      resolve(null);
    }, waitMs);

    b.waiter = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(b.queue.shift() || null);
    };
  });
}

/** 把 shell 回传的原始字段归一化成与 WebSocket 通道一致的结构 */
function normalize(requestId, payload) {
  const okFlag = payload.ok !== false;
  let image = payload.image || null;
  if (image && !String(image).startsWith('data:')) {
    image = `data:image/png;base64,${image}`;
  }
  return {
    requestId,
    status: okFlag ? 'success' : 'failed',
    stdout: payload.stdout ?? '',
    stderr: payload.stderr ?? '',
    exitCode: payload.exitCode ?? (okFlag ? 0 : 1),
    durationMs: payload.durationMs ?? 0,
    image,
    fileId: payload.fileId || null,
    accepted: false,
  };
}

/** 脚本回传结果 */
export function settleShell(requestId, payload) {
  for (const b of agents.values()) {
    const p = b.results.get(requestId);
    if (!p) continue;
    clearTimeout(p.timer);
    b.results.delete(requestId);
    p.resolve(normalize(requestId, payload));
    return true;
  }
  return false;
}

export function shellStats() {
  return [...agents.entries()].map(([id, b]) => ({
    deviceId: id,
    lastPollAt: b.lastPollAt,
    queued: b.queue.length,
  }));
}
