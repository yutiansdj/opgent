import { WebSocket } from 'ws';
import { config } from './config.js';
import { rid } from './crypto.js';

/**
 * Agent 连接池 + 指令请求/应答关联器。
 * 全部内存态：服务重启后 agent 会自动重连，无需持久化。
 */

/** deviceId -> WebSocket */
const agents = new Map();
/** requestId -> { resolve, timer } */
const pending = new Map();

export function attachAgent(deviceId, ws) {
  const old = agents.get(deviceId);
  if (old && old !== ws) {
    try {
      old.close();
    } catch {
      /* ignore */
    }
  }
  agents.set(deviceId, ws);
}

export function detachAgent(deviceId, ws) {
  if (agents.get(deviceId) === ws) agents.delete(deviceId);
}

export function isOnline(deviceId) {
  const ws = agents.get(deviceId);
  return !!ws && ws.readyState === WebSocket.OPEN;
}

export function onlineDeviceIds() {
  return [...agents.entries()].filter(([, ws]) => ws.readyState === WebSocket.OPEN).map(([id]) => id);
}

/** 结算一条指令（agent 回传 result 时调用） */
export function settle(requestId, payload) {
  const p = pending.get(requestId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve(payload);
  return true;
}

function normalize(requestId, payload) {
  const okFlag = payload.ok !== false;
  // Agent 回传的 image 可能是裸 base64，统一补成 data URL，前端只处理一种格式
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
    accepted: !!payload.accepted,
  };
}

/**
 * 发一条指令并等待结果。
 * @returns Promise<normalize 后的对象>；设备不在线返回 null
 */
export function runCommand(deviceId, cmd, params = {}, timeoutMs = config.commandTimeoutMs) {
  const ws = agents.get(deviceId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve(null);

  const requestId = rid('r_');
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({
        requestId,
        status: 'timeout',
        stdout: '',
        stderr: '设备响应超时（可能已离线）',
        exitCode: null,
        durationMs: timeoutMs,
        image: null,
        fileId: null,
        accepted: false,
      });
    }, timeoutMs);

    pending.set(requestId, { resolve: (payload) => resolve(normalize(requestId, payload)), timer });

    try {
      ws.send(JSON.stringify({ type: 'command', requestId, cmd, params }));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve({
        requestId,
        status: 'failed',
        stdout: '',
        stderr: `下发失败：${e.message}`,
        exitCode: null,
        durationMs: 0,
        image: null,
        fileId: null,
        accepted: false,
      });
    }
  });
}

/** 不等待结果（重启/关机这类会断开连接的指令） */
export function fireCommand(deviceId, cmd, params = {}) {
  const ws = agents.get(deviceId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return null;
  const requestId = rid('r_');
  try {
    ws.send(JSON.stringify({ type: 'command', requestId, cmd, params }));
    return requestId;
  } catch {
    return null;
  }
}

/**
 * 通知 agent 拉取服务器上的文件（上传到手机 / 安装 APK）。
 * 消息结构见契约 §9 的 pull_file。
 */
export function pullFile(deviceId, fileId, targetPath, mode = 'save', timeoutMs = 120_000) {
  const ws = agents.get(deviceId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve(null);

  const requestId = rid('r_');
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({
        requestId,
        status: 'timeout',
        stdout: '',
        stderr: '设备响应超时',
        exitCode: null,
        durationMs: timeoutMs,
        accepted: false,
      });
    }, timeoutMs);
    pending.set(requestId, { resolve: (payload) => resolve(normalize(requestId, payload)), timer });
    try {
      ws.send(JSON.stringify({ type: 'pull_file', requestId, fileId, targetPath, mode }));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve({ requestId, status: 'failed', stdout: '', stderr: e.message, exitCode: null, durationMs: 0, accepted: false });
    }
  });
}

export function dropAll() {
  for (const ws of agents.values()) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  agents.clear();
  pending.clear();
}
