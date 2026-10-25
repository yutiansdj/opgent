import { isOnline, runCommand, fireCommand, pullFile } from './hub.js';
import { shellOnline, enqueueForShell } from './shell.js';
import { config } from './config.js';

/** 设备是否可达（WS 或 shell agent 任一在线） */
export function isReachable(deviceId) {
  return isOnline(deviceId) || shellOnline(deviceId);
}

/**
 * 下发指令，自动选择通道：
 *  1) WebSocket（App）优先
 *  2) HTTP 长轮询（root shell 脚本）
 * 设备不可达返回 null。
 */
export function dispatchCommand(deviceId, cmd, params = {}, timeoutMs = config.commandTimeoutMs) {
  if (isOnline(deviceId)) return runCommand(deviceId, cmd, params, timeoutMs);
  if (shellOnline(deviceId)) return enqueueForShell(deviceId, cmd, params, timeoutMs);
  return Promise.resolve(null);
}

/** 不等待结果（重启/关机） */
export function dispatchFire(deviceId, cmd, params = {}) {
  if (isOnline(deviceId)) return fireCommand(deviceId, cmd, params);
  if (shellOnline(deviceId)) {
    // 脚本取走后自行执行，不关心结果
    enqueueForShell(deviceId, cmd, params, 5000).catch(() => {});
    return 'queued';
  }
  return null;
}

/** 让设备拉取服务器上的文件（上传/安装 APK） */
export function dispatchPullFile(deviceId, fileId, targetPath, mode = 'save') {
  if (isOnline(deviceId)) return pullFile(deviceId, fileId, targetPath, mode);
  if (shellOnline(deviceId)) {
    return enqueueForShell(deviceId, 'pull_file', { fileId, targetPath, mode }, 180_000);
  }
  return Promise.resolve(null);
}
