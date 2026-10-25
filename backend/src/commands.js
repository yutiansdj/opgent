/** 指令类型的展示名与参数校验（三端共用语义） */

export const COMMAND_LABELS = {
  screen_on: '点亮屏幕',
  screen_off: '熄屏',
  reboot: '重启设备',
  shutdown: '关机',
  shell: 'Shell 命令',
  screenshot: '屏幕截图',
  open_app: '打开应用',
  uninstall_app: '卸载应用',
  download: '下载文件',
  install_apk: '安装 APK',
  fs_list: '浏览目录',
  fs_mkdir: '新建文件夹',
  fs_touch: '新建文件',
  fs_rename: '重命名',
  fs_delete: '删除',
  fs_read: '查看文件',
  diag: '系统自检',
  apps_list: '应用列表',
  tap: '点击屏幕',
  swipe: '滑动屏幕',
  key: '按键',
  input_text: '输入文本',
  notify: '发送通知',
  camera: '远程拍照',
};

/** 需要二次确认的危险指令 */
export const DANGEROUS_COMMANDS = ['reboot', 'shutdown'];

export function describeCommand(type, params = {}) {
  switch (type) {
    case 'shell':
      return params.command || '';
    case 'open_app':
      return `打开应用 ${params.packageName || ''}`.trim();
    case 'tap':
      return `点击 (${params.x}, ${params.y})`;
    case 'swipe':
      return `滑动 (${params.x1},${params.y1}) → (${params.x2},${params.y2})`;
    case 'key':
      return `按键 ${params.code || ''}`.trim();
    case 'input_text':
      return `输入文本 ${String(params.text || '').slice(0, 20)}`;
    case 'notify':
      return `发送通知「${String(params.title || '').slice(0, 20)}」`;
    case 'camera':
      return `远程拍照（${params.facing === 'back' ? '后置' : '前置'}摄像头）`;
    case 'uninstall_app':
      return `卸载应用 ${params.packageName || ''}`.trim();
    case 'download':
      return `下载文件 ${params.path || ''}`.trim();
    case 'fs_list':
      return `浏览目录 ${params.path || ''}`.trim();
    case 'fs_mkdir':
      return `新建文件夹 ${params.path || ''}`.trim();
    case 'fs_touch':
      return `新建文件 ${params.path || ''}`.trim();
    case 'fs_rename':
      return `重命名 ${params.from || ''} → ${params.to || ''}`.trim();
    case 'fs_delete':
      return `删除 ${params.path || ''}`.trim();
    case 'fs_read':
      return `查看文件 ${params.path || ''}`.trim();
    default:
      return COMMAND_LABELS[type] || type;
  }
}

/**
 * 校验并规范化参数。
 * @returns {{valid:boolean, message?:string, params?:object}}
 */
export function validateCommand(type, params = {}) {
  const p = params || {};
  switch (type) {
    case 'shell': {
      const command = String(p.command ?? '').trim();
      if (!command) return { valid: false, message: '请填写 shell 命令' };
      return { valid: true, params: { command } };
    }
    case 'open_app':
    case 'uninstall_app': {
      const packageName = String(p.packageName ?? '').trim();
      if (!packageName) return { valid: false, message: '请填写应用包名' };
      if (!/^[a-zA-Z0-9_.]+$/.test(packageName)) return { valid: false, message: '包名格式不正确' };
      return { valid: true, params: { packageName } };
    }
    case 'download': {
      const filePath = String(p.path ?? '').trim();
      if (!filePath) return { valid: false, message: '请填写手机上的文件路径' };
      return { valid: true, params: { path: filePath } };
    }
    case 'fs_list':
    case 'fs_mkdir':
    case 'fs_touch':
    case 'fs_delete':
    case 'fs_read': {
      const p2 = String(p.path ?? '').trim();
      if (!p2) return { valid: false, message: '请填写路径' };
      return { valid: true, params: { path: p2 } };
    }
    case 'fs_rename': {
      const from = String(p.from ?? '').trim();
      const to = String(p.to ?? '').trim();
      if (!from || !to) return { valid: false, message: '请填写原路径和新路径' };
      return { valid: true, params: { from, to } };
    }
    case 'tap': {
      const x = Number(p.x);
      const y = Number(p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
        return { valid: false, message: '坐标不合法' };
      }
      return { valid: true, params: { x: Math.round(x), y: Math.round(y) } };
    }
    case 'swipe': {
      const n = ['x1', 'y1', 'x2', 'y2'].map((k) => Number(p[k]));
      if (n.some((v) => !Number.isFinite(v) || v < 0)) return { valid: false, message: '滑动坐标不合法' };
      const dur = Math.min(3000, Math.max(50, Number(p.duration) || 300));
      return { valid: true, params: { x1: Math.round(n[0]), y1: Math.round(n[1]), x2: Math.round(n[2]), y2: Math.round(n[3]), duration: Math.round(dur) } };
    }
    case 'key': {
      const code = String(p.code ?? '').trim();
      if (!/^[A-Za-z0-9_]{1,32}$/.test(code)) return { valid: false, message: '按键不合法' };
      return { valid: true, params: { code } };
    }
    case 'camera': {
      const facing = String(p.facing ?? 'front').trim().toLowerCase();
      if (facing !== 'front' && facing !== 'back') {
        return { valid: false, message: 'facing 只能是 front 或 back' };
      }
      return { valid: true, params: { facing } };
    }
    case 'notify': {
      const title = String(p.title ?? '').trim();
      const text = String(p.text ?? '').trim();
      if (!title) return { valid: false, message: '请填写通知标题' };
      if (!text) return { valid: false, message: '请填写通知内容' };
      if (title.length > 60) return { valid: false, message: '标题过长（上限 60 字）' };
      if (text.length > 500) return { valid: false, message: '内容过长（上限 500 字）' };
      return { valid: true, params: { title, text } };
    }
    case 'input_text': {
      const text = String(p.text ?? '');
      if (!text) return { valid: false, message: '请输入内容' };
      if (text.length > 200) return { valid: false, message: '文本过长（上限 200 字符）' };
      return { valid: true, params: { text } };
    }
    case 'diag':
    case 'apps_list':
      return { valid: true, params: {} };
    case 'screen_on':
    case 'screen_off':
    case 'reboot':
    case 'shutdown':
    case 'screenshot':
      return { valid: true, params: {} };
    default:
      return { valid: false, message: `不支持的指令类型：${type}` };
  }
}

/** shell 单引号转义：把 ' 变成 '\'' */
function shQuote(v) {
  return `'${String(v ?? '').replace(/'/g, `'\\''`)}'`;
}

/**
 * 老版本 Agent 不认识某些指令时，退化成等价的 shell 命令重发一次。
 * 返回 null 表示没有等价写法（只能提示用户升级 Agent）。
 */
export function shellFallback(type, params = {}) {
  switch (type) {
    case 'notify': {
      const t = shQuote(params.title);
      const x = shQuote(params.text);
      // 每条通知用唯一 tag：既能避开旧记录造成的“假成功”，也让系统每次都当新通知处理
      const tag = `rs${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      return [
        `T=${t}`,
        `X=${x}`,
        'I=0',
        'while [ "$I" -lt 3 ]; do',
        `  cmd notification post -S bigtext -t "$T" ${tag} "$X" >/dev/null 2>&1 || cmd notification post --user 0 -S bigtext -t "$T" ${tag} "$X" >/dev/null 2>&1`,
        '  sleep 1',
        `  N=$(dumpsys notification --noredact 2>/dev/null | grep -c ${tag})`,
        '  [ "${N:-0}" -gt 0 ] 2>/dev/null && break',
        '  I=$((I+1))',
        'done',
        'if [ "${N:-0}" -gt 0 ] 2>/dev/null; then',
        '  cmd statusbar expand-notifications >/dev/null 2>&1 || cmd statusbar expand-settings >/dev/null 2>&1 || true',
        '  echo "通知已发出并已展开通知栏"',
        'else',
        '  echo "通知没有进入系统通知列表，这条消息没送到" >&2',
        '  echo "常见原因：这台手机的系统服务拒绝 root 发通知（ColorOS 通知管理 / KernelSU 环境问题），可重启手机再试；要稳定送达需要装提示 App" >&2',
        '  exit 1',
        'fi',
      ].join('\n');
    }
    case 'tap':
      return `input tap ${Number(params.x)} ${Number(params.y)}; echo 已点击 (${Number(params.x)}, ${Number(params.y)})`;
    case 'swipe':
      return `input swipe ${Number(params.x1)} ${Number(params.y1)} ${Number(params.x2)} ${Number(params.y2)} ${Number(params.duration) || 300}; echo 已滑动`;
    case 'key':
      return `input keyevent ${String(params.code || '').replace(/[^A-Za-z0-9_]/g, '')}; echo 已按键`;
    case 'input_text': {
      const text = String(params.text || '').replace(/[^0-9A-Za-z .,:/@_+=#*-]/g, '');
      if (!text) return null;
      return `input text ${shQuote(text)}; echo 已输入`;
    }
    case 'open_app':
      return `monkey -p ${String(params.packageName || '')} -c android.intent.category.LAUNCHER 1 2>&1 | tail -2`;
    case 'screen_on':
      return 'input keyevent KEYCODE_WAKEUP; echo 屏幕已点亮';
    case 'screen_off':
      return 'input keyevent 223; echo 屏幕已熄灭';
    default:
      return null;
  }
}
