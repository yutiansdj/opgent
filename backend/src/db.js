import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from './config.js';
import { hashPassword } from './crypto.js';

export const nowIso = () => new Date().toISOString();

export const db = new DatabaseSync(path.join(config.dataDir, 'app.db'));

/* ---------------- 建表 ---------------- */

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'op',
  permissions  TEXT NOT NULL DEFAULT '[]',
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  token          TEXT NOT NULL,
  device_uid     TEXT,
  model          TEXT,
  android_version TEXT,
  root_status    TEXT,
  ip             TEXT,
  battery        INTEGER,
  network        TEXT,
  online         INTEGER NOT NULL DEFAULT 0,
  last_seen_at   TEXT,
  note           TEXT DEFAULT '',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  username    TEXT,
  device_id   TEXT,
  device_name TEXT,
  type        TEXT,
  command     TEXT,
  result      TEXT,
  status      TEXT,
  duration_ms INTEGER,
  task_id     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_device ON logs(device_id);

CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  command     TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_by  TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  type       TEXT NOT NULL,
  params     TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'running',
  total      INTEGER NOT NULL DEFAULT 0,
  done       INTEGER NOT NULL DEFAULT 0,
  success    INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  result      TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_task ON task_items(task_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   INTEGER,
  owner_name TEXT,
  token      TEXT NOT NULL UNIQUE,
  script     TEXT NOT NULL DEFAULT '',
  options    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cipher_keys (
  code       TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  alphabet   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  uses       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS device_shares (
  device_id  TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  level      TEXT NOT NULL DEFAULT 'view',
  created_at TEXT NOT NULL,
  PRIMARY KEY (device_id, user_id)
);

CREATE TABLE IF NOT EXISTS bootstrap_codes (
  code       TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  uses       INTEGER NOT NULL DEFAULT 0,
  max_uses   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  path       TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`);

/* ---------------- 平滑升级：token 不再全局唯一 ---------------- */
(function migrateDeviceTokenUnique() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='devices'").get();
  const sql = row?.sql || '';
  if (!/token\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(sql)) return;

  console.log('[db] 迁移 devices：token 唯一 → (token, device_uid) 唯一（支持一个项目多台设备）');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE devices_new (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        token          TEXT NOT NULL,
        device_uid     TEXT,
        model          TEXT,
        android_version TEXT,
        root_status    TEXT,
        ip             TEXT,
        battery        INTEGER,
        network        TEXT,
        online         INTEGER NOT NULL DEFAULT 0,
        last_seen_at   TEXT,
        note           TEXT DEFAULT '',
        project_id     TEXT,
        created_at     TEXT NOT NULL,
        UNIQUE(token, device_uid)
      );
      INSERT INTO devices_new
        SELECT id, name, token, device_uid, model, android_version, root_status, ip,
               battery, network, online, last_seen_at, note, project_id, created_at
          FROM devices;
      DROP TABLE devices;
      ALTER TABLE devices_new RENAME TO devices;
    `);
    db.exec('COMMIT');
    console.log('[db] devices 迁移完成');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('[db] devices 迁移失败，保持原表:', e.message);
  }
})();

/* ---------------- 平滑升级：老库补列 ---------------- */
(function migrate() {
  const cols = db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
  if (!cols.includes('project_id')) {
    db.exec('ALTER TABLE devices ADD COLUMN project_id TEXT');
    console.log('[db] devices 表已新增 project_id 列');
  }
})();

/* ---------------- 初始数据 ---------------- */

export function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count === 0) {
    db.prepare(
      `INSERT INTO users (username, password_hash, role, permissions, enabled, created_at)
       VALUES (?, ?, 'super', ?, 1, ?)`
    ).run(
      'admin',
      hashPassword('admin123'),
      JSON.stringify(['dashboard', 'devices', 'templates', 'tasks', 'logs', 'users', 'settings']),
      nowIso()
    );
    console.log('[db] 已创建默认超级管理员 admin / admin123（请登录后立即修改密码）');
  }
  if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get('config')) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'config',
      JSON.stringify({
        siteName: '远程安卓设备运维平台',
        apiBase: '',
        logRetentionDays: config.logRetentionDays,
      })
    );
  }
}
seed();
stripSuperOnlyPerms();

/* ---------------- 行 → 对象 ---------------- */

/** 老数据修正：运维账号不应持有 settings 权限（系统设置仅超管可见） */
export function stripSuperOnlyPerms() {
  const rows = db.prepare(`SELECT id, permissions FROM users WHERE role != 'super'`).all();
  let fixed = 0;
  const upd = db.prepare('UPDATE users SET permissions = ? WHERE id = ?');
  for (const r of rows) {
    let perms = [];
    try {
      perms = JSON.parse(r.permissions || '[]');
    } catch {
      perms = [];
    }
    const next = perms.filter((p) => p !== 'settings' && p !== 'users');
    if (next.length !== perms.length) {
      upd.run(JSON.stringify(next), r.id);
      fixed += 1;
    }
  }
  if (fixed) console.log(`[db] 已收回 ${fixed} 个运维账号的超管专属权限（settings/users）`);
}

export function mapUser(row) {
  if (!row) return null;
  let permissions = [];
  try {
    permissions = JSON.parse(row.permissions || '[]');
  } catch {
    permissions = [];
  }
  if (row.role === 'super') {
    permissions = ['dashboard', 'devices', 'templates', 'tasks', 'logs', 'users', 'settings'];
  }
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    permissions,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

export function mapDevice(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    token: row.token,
    deviceUid: row.device_uid || '',
    model: row.model || '',
    androidVersion: row.android_version || '',
    rootStatus: row.root_status || 'unknown',
    ip: row.ip || '',
    battery: row.battery ?? null,
    network: row.network || '',
    online: !!row.online,
    lastSeenAt: row.last_seen_at || null,
    note: row.note || '',
    projectId: row.project_id || '',
    projectName: row.project_name || '',
    createdAt: row.created_at,
  };
}

export function mapProject(row) {
  if (!row) return null;
  let options = {};
  try {
    options = JSON.parse(row.options || '{}');
  } catch {
    options = {};
  }
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id ?? null,
    ownerName: row.owner_name || '',
    token: row.token,
    script: row.script || '',
    options,
    deviceCount: row.device_count ?? undefined,
    createdAt: row.created_at,
  };
}

export function mapLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username || '',
    deviceId: row.device_id || '',
    deviceName: row.device_name || '',
    type: row.type || '',
    command: row.command || '',
    result: row.result || '',
    status: row.status || '',
    durationMs: row.duration_ms ?? 0,
    createdAt: row.created_at,
  };
}

export function getSettings() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('config');
  const defaults = { siteName: '远程安卓设备运维平台', apiBase: '', logRetentionDays: config.logRetentionDays };
  if (!row) return defaults;
  try {
    return { ...defaults, ...JSON.parse(row.value) };
  } catch {
    return defaults;
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('config', JSON.stringify(next));
  return next;
}

/* ---------------- 日志写入（统一出口） ---------------- */

export function writeLog({ user, deviceId, deviceName, type, command, result, status, durationMs, taskId }) {
  db.prepare(
    `INSERT INTO logs (user_id, username, device_id, device_name, type, command, result, status, duration_ms, task_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    user?.id ?? null,
    user?.username ?? 'system',
    deviceId ?? null,
    deviceName ?? null,
    type ?? '',
    command ?? '',
    result ?? '',
    status ?? '',
    durationMs ?? 0,
    taskId ?? null,
    nowIso()
  );
}

/** 按保留天数清理过期日志，每小时跑一次 */
export function startLogRetention() {
  const tick = () => {
    try {
      const days = Number(getSettings().logRetentionDays) || 30;
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      const info = db.prepare('DELETE FROM logs WHERE created_at < ?').run(cutoff);
      if (info.changes) console.log(`[db] 清理过期日志 ${info.changes} 条`);
    } catch (e) {
      console.error('[db] 日志清理失败', e.message);
    }
  };
  tick();
  setInterval(tick, 3600_000).unref?.();
}
