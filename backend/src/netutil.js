import { db, nowIso } from './db.js';

/** 取客户端真实 IP（Nginx 反代时 socket 地址是 127.0.0.1） */
export function clientIp(req) {
  const xr = req.headers['x-real-ip'];
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  let ip = String(xr || xf || req.socket?.remoteAddress || '').trim();
  ip = ip.replace(/^::ffff:/, '');
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') return '';
  return ip;
}
