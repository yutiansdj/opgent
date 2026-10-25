import { Router } from 'express';
import { getSettings, saveSettings } from '../db.js';
import { ok, fail, authRequired, requireSuper } from '../http.js';

const router = Router();
router.use(authRequired);

router.get('/', requireSuper, (req, res) => ok(res, getSettings()));

router.put('/', requireSuper, (req, res) => {
  const body = req.body || {};
  const patch = {};

  if (body.siteName !== undefined) {
    const v = String(body.siteName).trim();
    if (!v) return fail(res, 'VALIDATION_ERROR', '站点名称不能为空', 400);
    patch.siteName = v.slice(0, 40);
  }
  if (body.apiBase !== undefined) patch.apiBase = String(body.apiBase).trim();
  if (body.logRetentionDays !== undefined) {
    const n = Number(body.logRetentionDays);
    if (!Number.isFinite(n) || n < 1 || n > 3650) {
      return fail(res, 'VALIDATION_ERROR', '日志保留天数需在 1~3650 之间', 400);
    }
    patch.logRetentionDays = Math.round(n);
  }
  return ok(res, saveSettings(patch));
});

export default router;
