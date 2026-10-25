import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOADER_PATH = path.resolve(__dirname, '..', 'assets', 'loader_a64');

const MAGIC = Buffer.from('\n===PAYLOAD===\n', 'utf8');

/**
 * 把一段 shell 脚本打包成 arm64 可执行文件：
 *   loader（静态 ELF）+ MAGIC + keyLen + key + dataLen + XOR(脚本)
 *
 * 运行时 loader 读自己、找到 MAGIC、异或还原脚本，交给 /system/bin/sh 执行。
 * 注意：这是防「顺手查看」的混淆，不是密码学安全。
 */
export function buildBinaryFromScript(scriptText) {
  if (!fs.existsSync(LOADER_PATH)) {
    throw new Error('加载器缺失（backend/assets/loader_a64），请先运行 native/build.sh');
  }
  const loader = fs.readFileSync(LOADER_PATH);
  const data = Buffer.from(String(scriptText), 'utf8');
  const key = crypto.randomBytes(16);

  const cipher = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 1) {
    cipher[i] = data[i] ^ key[i % key.length];
  }

  const klen = Buffer.alloc(4);
  klen.writeUInt32LE(key.length);
  const dlen = Buffer.alloc(4);
  dlen.writeUInt32LE(data.length);

  return Buffer.concat([loader, MAGIC, klen, key, dlen, cipher]);
}
