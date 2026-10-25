/**
 * 后端端到端自测：模拟一个 Agent 走完整链路。
 * 运行：cd backend && node /tmp/test-api.mjs
 */
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:8787';
let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name} ${extra}`);
  }
};

async function api(path, { method = 'GET', body, token, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return res;
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n== 1. 登录 ==');
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  check('登录成功', login.ok === true, JSON.stringify(login));
  const token = login.data?.token;
  check('拿到 token', !!token);

  const bad = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
  check('错误密码返回 401', bad.status === 401);

  const noAuth = await api('/api/devices');
  check('未登录访问设备列表返回 401', noAuth.status === 401);

  console.log('\n== 2. 设备注册 ==');
  const reg = await api('/api/devices/register', {
    method: 'POST',
    body: { deviceUid: 'test-uid-001', name: '奶奶的手机', token: 'dt_testtoken001' },
  });
  check('注册设备成功', reg.ok === true, JSON.stringify(reg));
  const deviceId = reg.data?.id;
  const deviceToken = reg.data?.token;
  check('设备 id 形如 dev_', String(deviceId).startsWith('dev_'), deviceId);
  check('返回设备 token', deviceToken === 'dt_testtoken001');

  console.log('\n== 3. Agent WebSocket 接入 ==');
  const ws = new WebSocket(`ws://127.0.0.1:8787/ws/agent?token=${deviceToken}`);
  const received = [];
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('ws 连接超时')), 5000);
  });
  check('WS 连接建立', ws.readyState === WebSocket.OPEN);

  ws.on('message', (buf) => {
    const msg = JSON.parse(buf.toString());
    received.push(msg);
    if (msg.type === 'command') {
      // 模拟 agent 执行
      let stdout = '';
      let stderr = '';
      let ok = true;
      if (msg.cmd === 'shell') {
        if (msg.params.command === 'fail') {
          ok = false;
          stderr = 'boom';
        } else stdout = `executed: ${msg.params.command}`;
      } else if (msg.cmd === 'screenshot') {
        return ws.send(JSON.stringify({ type: 'result', requestId: msg.requestId, ok: true, stdout: '', stderr: '', exitCode: 0, durationMs: 5, image: 'AAAA' }));
      } else if (msg.cmd === 'download') {
        return ws.send(JSON.stringify({ type: 'result', requestId: msg.requestId, ok: true, stdout: '', stderr: '', exitCode: 0, durationMs: 5, fileId: 'f_fake' }));
      } else if (msg.cmd === 'notify') {
        // 模拟旧版 Agent：不认识 notify
        ok = false;
        stderr = '不支持的指令: notify';
      } else if (msg.cmd === 'reboot' || msg.cmd === 'shutdown') {
        return; // 模拟不返回
      }
      ws.send(JSON.stringify({ type: 'result', requestId: msg.requestId, ok, stdout, stderr, exitCode: ok ? 0 : 1, durationMs: 7 }));
    }
  });

  ws.send(JSON.stringify({ type: 'hello', device: { model: 'OnePlus PLR110', androidVersion: '16', rootStatus: 'granted', battery: 50, network: 'wifi', ip: '1.2.3.4' } }));
  await sleep(400);

  const detail = await api(`/api/devices/${deviceId}`, { token });
  check('设备详情可见', detail.ok === true);
  check('设备已上线', detail.data?.online === true, JSON.stringify(detail.data));
  check('型号已同步', detail.data?.model === 'OnePlus PLR110', detail.data?.model);

  console.log('\n== 4. 下发指令 ==');
  const shell = await api(`/api/devices/${deviceId}/command`, {
    method: 'POST',
    token,
    body: { type: 'shell', params: { command: 'ls /sdcard' } },
  });
  check('shell 指令成功', shell.ok === true && shell.data?.status === 'success', JSON.stringify(shell));
  check('stdout 正确回传', shell.data?.stdout === 'executed: ls /sdcard', shell.data?.stdout);

  const failCmd = await api(`/api/devices/${deviceId}/command`, {
    method: 'POST',
    token,
    body: { type: 'shell', params: { command: 'fail' } },
  });
  check('失败指令状态为 failed', failCmd.data?.status === 'failed', JSON.stringify(failCmd.data));
  check('stderr 正确回传', failCmd.data?.stderr === 'boom');

  const shot = await api(`/api/devices/${deviceId}/command`, { method: 'POST', token, body: { type: 'screenshot' } });
  check('截图回传被归一化为 data URL', String(shot.data?.image || '').startsWith('data:image/png;base64,'), JSON.stringify(shot.data));

  const nt = await api(`/api/devices/${deviceId}/command`, {
    method: 'POST',
    token,
    body: { type: 'notify', params: { title: '记得吃药', text: '一天两次' } },
  });
  check('老 Agent 不支持 notify 时自动退回 shell', nt.data?.status === 'success' && nt.data?.fallback === 'shell', JSON.stringify(nt.data));
  const ntCmd = received.filter((m) => m.type === 'command' && m.cmd === 'shell' && /cmd notification post/.test(m.params?.command || ''));
  check('退化的 shell 命令带上了通知内容', ntCmd.length === 1 && /记得吃药/.test(ntCmd[0].params.command), JSON.stringify(ntCmd.map((m) => m.params)));
  check('退化的 shell 命令会回读通知列表做校验', ntCmd.length === 1 && /dumpsys notification/.test(ntCmd[0].params.command));

  const inv = await api(`/api/devices/${deviceId}/command`, {
    method: 'POST',
    token,
    body: { type: 'shell', params: { command: '' } },
  });
  check('空命令被拦截 400', inv.status === 400);

  const reboot = await api(`/api/devices/${deviceId}/command`, { method: 'POST', token, body: { type: 'reboot' } });
  check('重启立即返回 accepted', reboot.data?.accepted === true, JSON.stringify(reboot.data));

  console.log('\n== 5. 设备日志 / 全局日志 ==');
  const devLogs = await api(`/api/devices/${deviceId}/logs`, { token });
  check('设备日志有记录', devLogs.data?.total >= 4, JSON.stringify(devLogs.data?.total));

  const allLogs = await api('/api/logs?page=1&pageSize=5', { token });
  check('全局日志分页正常', allLogs.data?.list?.length > 0 && allLogs.data?.total > 0);

  const searchLogs = await api('/api/logs?keyword=ls%20%2Fsdcard', { token });
  check('日志关键词搜索命中', searchLogs.data?.total >= 1, JSON.stringify(searchLogs.data?.total));

  const csv = await api('/api/logs/export', { token, raw: true });
  const csvText = await csv.text();
  check('CSV 导出有表头', csvText.includes('时间') && csvText.includes('返回结果'));
  check('CSV Content-Type 正确', String(csv.headers.get('content-type')).includes('text/csv'));

  console.log('\n== 6. 模板与批量任务 ==');
  const tpl = await api('/api/templates', { method: 'POST', token, body: { name: '查看存储', command: 'df -h', description: '磁盘占用' } });
  check('创建模板成功', tpl.ok === true, JSON.stringify(tpl));
  const tplId = tpl.data?.id;

  const tplList = await api('/api/templates', { token });
  check('模板列表返回', tplList.data?.list?.length === 1);

  const reg2 = await api('/api/devices/register', { method: 'POST', body: { deviceUid: 'test-uid-002', name: '第二台', token: 'dt_testtoken002' } });
  const device2 = reg2.data?.id;
  check('第二台设备注册', !!device2);

  const batch = await api('/api/tasks', {
    method: 'POST',
    token,
    body: { deviceIds: [deviceId, device2], type: 'shell', params: { command: 'uptime' } },
  });
  check('批量任务创建', batch.ok === true, JSON.stringify(batch));
  const taskId = batch.data?.taskId;

  // 轮询任务完成
  let task;
  for (let i = 0; i < 20; i++) {
    task = await api(`/api/tasks/${taskId}`, { token });
    if (task.data?.status === 'done') break;
    await sleep(300);
  }
  check('批量任务完成', task.data?.status === 'done', JSON.stringify(task.data?.status));
  check('任务统计 done=2', task.data?.done === 2, JSON.stringify({ done: task.data?.done }));
  check('逐设备结果齐全', task.data?.items?.length === 2);
  check('在线设备执行成功', task.data?.items?.find((i) => i.deviceId === deviceId)?.status === 'success');
  check('离线设备标记 offline', task.data?.items?.find((i) => i.deviceId === device2)?.status === 'offline');

  const tplRun = await api(`/api/templates/${tplId}/run`, { method: 'POST', token, body: { deviceIds: [deviceId] } });
  check('模板一键下发', tplRun.ok === true, JSON.stringify(tplRun));

  console.log('\n== 7. 仪表盘 ==');
  const dash = await api('/api/dashboard/overview', { token });
  check('仪表盘统计', dash.data?.devices?.total === 2, JSON.stringify(dash.data?.devices));
  check('图表 7 天数据', dash.data?.logChart?.length === 7);
  check('最近日志', Array.isArray(dash.data?.recentLogs));

  console.log('\n== 8. 用户权限 ==');
  const opUser = await api('/api/users', {
    method: 'POST',
    token,
    body: { username: 'ops1', password: 'ops123', role: 'op', permissions: ['dashboard', 'devices'] },
  });
  check('创建普通运维账号', opUser.ok === true, JSON.stringify(opUser));
  check('op 没有 users 权限', !opUser.data?.permissions?.includes('users'), JSON.stringify(opUser.data?.permissions));

  const opLogin = await api('/api/auth/login', { method: 'POST', body: { username: 'ops1', password: 'ops123' } });
  const opToken = opLogin.data?.token;
  check('op 能登录', !!opToken);

  const opUsers = await api('/api/users', { token: opToken });
  check('op 访问用户管理被拒 403', opUsers.status === 403, String(opUsers.status));

  const opLogs = await api('/api/logs', { token: opToken });
  check('op 无 logs 权限被拒 403', opLogs.status === 403, String(opLogs.status));

  const opDevices = await api('/api/devices', { token: opToken });
  check('op 有 devices 权限可访问', opDevices.ok === true);

  console.log('\n== 9. 断开与离线判定 ==');
  ws.close();
  await sleep(600);
  const afterClose = await api(`/api/devices/${deviceId}`, { token });
  // 新语义：断开后不立即置离线，留心跳宽限期，避免后台状态闪烁
  check('断开后仍处于宽限期（显示在线）', afterClose.data?.online === true, JSON.stringify(afterClose.data?.online));

  const offlineCmd = await api(`/api/devices/${deviceId}/command`, { method: 'POST', token, body: { type: 'screen_on' } });
  check('宽限期内下发指令被拒 409', offlineCmd.status === 409 && offlineCmd.error?.code === 'DEVICE_OFFLINE', JSON.stringify(offlineCmd));

  console.log('\n== 10. 设置 ==');
  const st = await api('/api/settings', { token });
  check('读取设置', st.data?.siteName === '远程安卓设备运维平台', JSON.stringify(st.data));
  const st2 = await api('/api/settings', { method: 'PUT', token, body: { logRetentionDays: 15 } });
  check('修改日志保留天数', st2.data?.logRetentionDays === 15, JSON.stringify(st2.data));

  console.log(`\n===== 结果：${failures === 0 ? '全部通过 ✅' : `${failures} 项失败 ❌`} =====`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('测试脚本异常', e);
  process.exit(1);
});
