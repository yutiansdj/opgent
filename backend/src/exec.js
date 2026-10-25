import { isReachable, dispatchCommand, dispatchFire } from './dispatch.js';
import { writeLog } from './db.js';
import { describeCommand, shellFallback } from './commands.js';

const STATUS_TEXT = {
  offline: '设备离线，指令未下发',
  timeout: '设备响应超时',
};

/** 老版本 Agent 回执里的“不认识这条指令” */
function isUnsupported(res) {
  if (!res) return false;
  return /不支持的指令|unsupported (command|cmd)|unknown command/i.test(
    `${res.stderr || ''} ${res.stdout || ''}`,
  );
}

/** 老 Agent 不认识这条指令时，换成等价的 shell 命令再发一次 */
async function shellRetry(deviceId, type, params, opts) {
  const cmd = shellFallback(type, params);
  if (!cmd) return null;
  const res = await dispatchCommand(deviceId, 'shell', { command: cmd }, opts.timeoutMs);
  if (res && res.status === 'success') {
    res.stderr = '';
    res.fallback = 'shell';
  }
  return res;
}

/**
 * 在单台设备上执行一条指令，并写入操作日志。
 * @param {object} device 设备对象（含 id/name）
 * @param {object} user 操作人（id/username），批量任务传 { username: '...' }
 * @param {string} type 指令类型
 * @param {object} params 指令参数
 * @param {{taskId?:string, timeoutMs?:number}} opts
 */
export async function execOnDevice(device, user, type, params = {}, opts = {}) {
  const label = describeCommand(type, params);

  if (!device) {
    return { status: 'failed', stdout: '', stderr: '设备不存在', exitCode: null, durationMs: 0 };
  }

  if (!isReachable(device.id)) {
    const res = { status: 'offline', stdout: '', stderr: STATUS_TEXT.offline, exitCode: null, durationMs: 0 };
    writeLog({
      user,
      deviceId: device.id,
      deviceName: device.name,
      type,
      command: label,
      result: res.stderr,
      status: 'offline',
      durationMs: 0,
      taskId: opts.taskId,
    });
    return res;
  }

  // 重启/关机：设备马上会断开，不等结果，直接视为已下发
  if (type === 'reboot' || type === 'shutdown') {
    dispatchFire(device.id, type, {});
    const text = type === 'reboot' ? '指令已下发，设备正在重启' : '指令已下发，设备正在关机';
    writeLog({
      user,
      deviceId: device.id,
      deviceName: device.name,
      type,
      command: label,
      result: text,
      status: 'success',
      durationMs: 0,
      taskId: opts.taskId,
    });
    return { status: 'success', accepted: true, stdout: '', stderr: '', exitCode: 0, durationMs: 0 };
  }

  let res = await dispatchCommand(device.id, type, params, opts.timeoutMs);

  if (isUnsupported(res)) {
    const retry = await shellRetry(device.id, type, params, opts);
    if (retry) res = retry;
  }

  // 拍照只有 App 版 Agent 能做，shell 版没有相机能力，给一句能看懂的提示
  if (type === 'camera' && res && res.status !== 'success' && isUnsupported(res)) {
    res.stderr = '远程拍照需要手机上装 App 版 Agent（纯 shell 版没有相机能力）';
  }

  if (!res) {
    // 发送瞬间掉线
    const text = STATUS_TEXT.offline;
    writeLog({
      user,
      deviceId: device.id,
      deviceName: device.name,
      type,
      command: label,
      result: text,
      status: 'offline',
      durationMs: 0,
      taskId: opts.taskId,
    });
    return { status: 'offline', stdout: '', stderr: text, exitCode: null, durationMs: 0 };
  }

  const resultText = [res.stdout, res.stderr].filter(Boolean).join('\n').trim();
  writeLog({
    user,
    deviceId: device.id,
    deviceName: device.name,
    type,
    command: label,
    result: resultText || (res.status === 'success' ? '执行成功' : STATUS_TEXT[res.status] || ''),
    status: res.status,
    durationMs: res.durationMs,
    taskId: opts.taskId,
  });

  return res;
}
