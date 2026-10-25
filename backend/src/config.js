import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

const dataDir = process.env.DATA_DIR || path.join(backendRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const uploadDir = process.env.UPLOAD_DIR || path.join(dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

/** JWT 密钥：优先环境变量，否则落盘持久化，避免重启后所有登录态失效 */
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = path.join(dataDir, 'secret.key');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  uploadDir,
  secret: loadSecret(),
  tokenTtlHours: Number(process.env.TOKEN_TTL_HOURS || 12),
  heartbeatTimeoutMs: Number(process.env.HEARTBEAT_TIMEOUT_MS || 90_000),
  commandTimeoutMs: Number(process.env.COMMAND_TIMEOUT_MS || 35_000),
  logRetentionDays: Number(process.env.LOG_RETENTION_DAYS || 30),
  // 前端构建产物目录（存在则直接由后端托管，便于单端口部署）
  webDist: process.env.WEB_DIST || path.resolve(backendRoot, '..', 'web', 'dist'),
  // 对外的站点地址：注入脚本里要用它回连，可在环境变量里覆盖
  publicBase: process.env.PUBLIC_BASE || 'http://43.251.226.134',
  // shell agent 脚本所在位置（注入脚本会来下载它）
  agentScript: path.join(backendRoot, 'assets', 'agent.sh'),
  // 公开脚本目录：nginx 的 /app/ 映射到这里，后台可在线编辑
  appDir: process.env.APP_DIR || path.resolve(backendRoot, '..', 'app'),
};

export const PERMISSIONS = ['dashboard', 'devices', 'templates', 'tasks', 'logs', 'users', 'settings'];
