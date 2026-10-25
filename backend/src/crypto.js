import crypto from 'node:crypto';
import { config } from './config.js';

/* ---------------- 密码哈希（scrypt，无第三方依赖） ---------------- */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const calc = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(calc, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- JWT（HS256，手写实现） ---------------- */

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (str) =>
  Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function signToken(payload, ttlHours = config.tokenTtlHours) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + Math.round(ttlHours * 3600) };
  const p1 = b64url(JSON.stringify(header));
  const p2 = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', config.secret).update(`${p1}.${p2}`).digest();
  return `${p1}.${p2}.${b64url(sig)}`;
}

/** 校验失败返回 null */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [p1, p2, sig] = parts;
  const expect = b64url(crypto.createHmac('sha256', config.secret).update(`${p1}.${p2}`).digest());
  // 定长比较，防时序攻击
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(b64urlDecode(p2).toString('utf8'));
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

/* ---------------- ID 生成 ---------------- */

export const rid = (prefix, n = 8) => prefix + crypto.randomBytes(n).toString('hex');
