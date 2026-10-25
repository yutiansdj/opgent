/**
 * 假 Agent：连到已部署的公网后端，按契约响应指令，用于 Web 端真实联调。
 * 用法：node test/fake-agent.mjs [wsBase] [token]
 */
import WebSocket from 'ws';

const WS_BASE = process.argv[2] || 'ws://43.251.226.134';
const TOKEN = process.argv[3] || 'dt_uie2e0001';

// 1x1 透明 PNG，模拟截图回传（裸 base64，后端会补 data URL 前缀）
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function connect() {
  const ws = new WebSocket(`${WS_BASE}/ws/agent?token=${TOKEN}`);

  ws.on('open', () => {
    console.log('[fake-agent] 已连接', WS_BASE);
    ws.send(
      JSON.stringify({
        type: 'hello',
        device: {
          model: 'OnePlus PLR110',
          androidVersion: '16',
          rootStatus: 'granted',
          battery: 76,
          network: 'wifi',
          ip: '10.0.0.23',
        },
      })
    );
    setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: 'heartbeat',
          device: { battery: 76, network: 'wifi', model: 'OnePlus PLR110', androidVersion: '16', rootStatus: 'granted' },
        })
      );
    }, 15000);
  });

  ws.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    console.log('[fake-agent] 收到', msg.type, msg.cmd || msg.requestId);

    if (msg.type === 'command') {
      const reply = (payload) =>
        ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'result', requestId: msg.requestId, ...payload }));

      switch (msg.cmd) {
        case 'screenshot':
          reply({ ok: true, stdout: '截图成功，68 字节', stderr: '', exitCode: 0, durationMs: 12, image: PNG_1PX });
          break;
        case 'shell':
          reply({
            ok: true,
            stdout: `$ ${msg.params?.command}\n/ 47G 12G 35G 26% /data`,
            stderr: '',
            exitCode: 0,
            durationMs: 9,
          });
          break;
        case 'screen_on':
        case 'screen_off':
          reply({ ok: true, stdout: '已执行', stderr: '', exitCode: 0, durationMs: 5 });
          break;
        case 'open_app':
          reply({ ok: true, stdout: `已启动 ${msg.params?.packageName}`, stderr: '', exitCode: 0, durationMs: 30 });
          break;
        default:
          reply({ ok: true, stdout: 'ok', stderr: '', exitCode: 0, durationMs: 3 });
      }
    }
  });

  ws.on('close', () => {
    console.log('[fake-agent] 断开，3 秒后重连');
    setTimeout(connect, 3000);
  });
  ws.on('error', (e) => console.log('[fake-agent] 错误', e.message));
}

connect();
