/**
 * 重置管理员密码（忘记密码时的救命工具）
 *
 * 用法：
 *   cd backend
 *   node tools/reset-password.js 新密码 [账号名]
 *
 * 默认重置 admin；账号不存在会直接创建为超级管理员。
 */
import { db, nowIso } from '../src/db.js';
import { hashPassword } from '../src/crypto.js';

const password = process.argv[2];
const username = process.argv[3] || 'admin';

if (!password || password.length < 6) {
  console.error('用法：node tools/reset-password.js <新密码(至少6位)> [账号名，默认 admin]');
  process.exit(1);
}

const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

if (row) {
  db.prepare('UPDATE users SET password_hash = ?, enabled = 1, role = ? WHERE id = ?').run(
    hashPassword(password),
    row.role === 'super' ? 'super' : 'super', // 重置后提到超管，保证能救回来
    row.id
  );
  console.log(`已重置账号「${username}」的密码，并设为超级管理员、启用状态。`);
} else {
  db.prepare(
    `INSERT INTO users (username, password_hash, role, permissions, enabled, created_at)
     VALUES (?, ?, 'super', ?, 1, ?)`
  ).run(
    username,
    hashPassword(password),
    JSON.stringify(['dashboard', 'devices', 'templates', 'tasks', 'logs', 'users', 'settings']),
    nowIso()
  );
  console.log(`账号「${username}」不存在，已创建为超级管理员。`);
}

console.log('密码已更新，请重启后端服务（systemctl restart remote-ops）后登录。');
