import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ok, fail, authRequired, requireSuper } from '../http.js';
import { db } from '../db.js';
import { config } from '../config.js';

/**
 * 缓存维护：查看占用、手动清理、自动清理
 *  - photos  相册原图缓存（缩略图保留）
 *  - uploads 文件管理/APK 上传的历史文件
 *  - icons   应用图标缓存
 */
const router = Router();
router.use(authRequired, requireSuper);

const DIRS = {
  photos: () => path.join(config.dataDir, 'photo-cache'),
  uploads: () => config.uploadDir,
  icons: () => path.join(config.dataDir, 'app-cache'),
};

function usageOf(dir) {
  let files = 0;
  let bytes = 0;
  if (!fs.existsSync(dir)) return { files, bytes };
  for (const name of fs.readdirSync(dir)) {
    try {
      const st = fs.statSync(path.join(dir, name));
      if (st.isFile()) {
        files += 1;
        bytes += st.size;
      }
    } catch {
      /* ignore */
    }
  }
  return { files, bytes };
}

/** 各缓存占用 */
router.get('/', (req, res) => {
  const out = {};
  for (const [k, fn] of Object.entries(DIRS)) out[k] = usageOf(fn());
  // 数据库文件也算上
  try {
    out.database = { files: 3, bytes: fs.statSync(path.join(config.dataDir, 'app.db')).size };
  } catch {
    out.database = { files: 0, bytes: 0 };
  }
  return ok(res, out);
});

/** 清理：days<=0 表示全清 */
router.post('/clean', (req, res) => {
  const type = String(req.body?.type || 'all');
  const days = Number(req.body?.days ?? 7);
  const cutoff = days > 0 ? Date.now() - days * 86400_000 : Number.POSITIVE_INFINITY;
  const targets = type === 'all' ? Object.keys(DIRS) : [type];

  const report = {};
  for (const t of targets) {
    if (!DIRS[t]) return fail(res, 'VALIDATION_ERROR', `未知类型：${t}`, 400);
    const dir = DIRS[t]();
    let removed = 0;
    let freed = 0;
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        // 相册只删原图，缩略图保留
        if (t === 'photos' && !name.endsWith('.orig')) continue;
        const full = path.join(dir, name);
        try {
          const st = fs.statSync(full);
          if (!st.isFile()) continue;
          if (st.mtimeMs > cutoff) continue;
          freed += st.size;
          fs.unlinkSync(full);
          removed += 1;
          if (t === 'uploads') {
            // 同步删掉 files 表里的记录
            try {
              db.prepare('DELETE FROM files WHERE path = ?').run(full);
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    report[t] = { removed, freed };
  }

  return ok(res, report);
});

export default router;
