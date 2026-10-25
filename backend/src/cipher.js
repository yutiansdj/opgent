/**
 * 自研加密：字母表置换（不是 base64 套壳）
 *
 * 原理：把 base64 后的脚本逐字符按「随机置换表」替换，
 *       置换表本身由后端按下载码下发，文件里只存密文。
 * 解密：逆置换 → base64 -d → 得到原始脚本。
 *
 * 注意：这是混淆级加密，不是密码学安全的加密。目的是让拿到文件的人
 *      无法直接读懂内容；真正防窃听靠 HTTPS。
 */

export const STD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

/** 生成一个随机置换表（65 个字符的乱序） */
export function randomAlphabet() {
  const arr = STD_ALPHABET.split('');
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

/** 用置换表加密（输入是 base64 文本） */
export function encryptText(plainBase64, alphabet) {
  let out = '';
  for (const ch of plainBase64) {
    const idx = STD_ALPHABET.indexOf(ch);
    out += idx >= 0 ? alphabet[idx] : ch;
  }
  return out;
}

/** 解密（Node 侧自测用） */
export function decryptText(cipher, alphabet) {
  let out = '';
  for (const ch of cipher) {
    const idx = alphabet.indexOf(ch);
    out += idx >= 0 ? STD_ALPHABET[idx] : ch;
  }
  return out;
}

/** 把脚本文本加密成可安全嵌入 shell 单引号的密文 */
export function encryptScript(scriptText, alphabet) {
  const b64 = Buffer.from(scriptText, 'utf8').toString('base64').replace(/\n/g, '');
  return encryptText(b64, alphabet);
}

/** 生成下载码 */
export function makeCode(prefix = 'bk_') {
  const chars = 'abcdef0123456789';
  let s = '';
  for (let i = 0; i < 14; i += 1) s += chars[Math.floor(Math.random() * 16)];
  return prefix + s;
}
