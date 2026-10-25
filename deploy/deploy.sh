#!/usr/bin/env bash
# =====================================================================
# 远程安卓设备运维平台 —— 一键部署脚本
#
# 用法（密码方式）：
#   SSH_PASS='你的服务器密码' HOST=1.2.3.4 bash deploy/deploy.sh
# 用法（已配置 SSH 公钥）：
#   HOST=1.2.3.4 bash deploy/deploy.sh
#
# 做了什么：
#   1. 本地构建前端（vite build）
#   2. 同步后端源码 + 前端 dist 到服务器
#   3. 服务器上 npm install --omit=dev、装 systemd 服务、装 Nginx 配置
#   4. 重启服务并做健康检查
# 幂等：可以反复执行，用于升级。
# =====================================================================
set -euo pipefail

HOST="${HOST:-43.251.226.134}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/remote-ops}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SSH_COMMON="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15"

if [[ -n "${SSH_PASS:-}" ]]; then
  command -v sshpass >/dev/null || { echo "缺少 sshpass，请先 apt install sshpass"; exit 1; }
  export SSHPASS="$SSH_PASS"
  SSH() { sshpass -e ssh $SSH_COMMON "$@"; }
  # 关键：源目录可能是 /sdcard（FUSE）等特殊权限的文件系统，不能保留属主/权限，
  # 否则服务器上 nginx 读不到文件，会直接 403。统一强制 755/644。
  RSYNC() { sshpass -e rsync -az --no-perms --no-owner --no-group --chmod=D755,F644 -e "ssh $SSH_COMMON" "$@"; }
else
  SSH() { ssh $SSH_COMMON "$@"; }
  RSYNC() { rsync -az --no-perms --no-owner --no-group --chmod=D755,F644 -e "ssh $SSH_COMMON" "$@"; }
fi

echo "==> [1/6] 构建前端"
cd "$PROJECT_DIR/web"
# /sdcard 是 FUSE 挂载，不支持软链接，必须 --no-bin-links，并直接调用 vite
[[ -d node_modules ]] || npm install --no-bin-links --no-audit --no-fund
NODE_OPTIONS=--max-old-space-size=1536 node node_modules/vite/bin/vite.js build
[[ -f dist/index.html ]] || { echo "前端构建失败：dist/index.html 不存在"; exit 1; }

echo "==> [2/6] 同步目录结构"
SSH "$REMOTE_USER@$HOST" "mkdir -p $REMOTE_DIR/backend $REMOTE_DIR/web"

echo "==> 同步 shell agent 资源（注入脚本要从这里下载）"
mkdir -p backend/assets
cp deploy/shell-agent/agent.sh backend/assets/agent.sh

echo "==> [3/6] 同步后端源码"
cd "$PROJECT_DIR"
RSYNC --delete --exclude node_modules --exclude data --exclude '*.log' \
  backend/ "$REMOTE_USER@$HOST:$REMOTE_DIR/backend/"

echo "==> [4/6] 同步前端产物"
RSYNC --delete web/dist/ "$REMOTE_USER@$HOST:$REMOTE_DIR/web/"

echo "==> [5/6] 服务器安装依赖与服务"
SSH "$REMOTE_USER@$HOST" "bash -s" <<REMOTE
set -e
cd $REMOTE_DIR/backend
npm install --omit=dev --no-audit --no-fund >/dev/null
REMOTE

# 上传 systemd / nginx 配置
RSYNC deploy/remote-ops.service deploy/nginx.conf "$REMOTE_USER@$HOST:/tmp/"
SSH "$REMOTE_USER@$HOST" "bash -s" <<'REMOTE'
set -e
install -m 644 /tmp/remote-ops.service /etc/systemd/system/remote-ops.service
systemctl daemon-reload
systemctl enable remote-ops >/dev/null 2>&1 || true
systemctl restart remote-ops

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
install -m 644 /tmp/nginx.conf /etc/nginx/sites-available/remote-ops
ln -sf /etc/nginx/sites-available/remote-ops /etc/nginx/sites-enabled/remote-ops
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx || systemctl restart nginx
REMOTE

echo "==> [6/6] 健康检查"
sleep 2
SSH "$REMOTE_USER@$HOST" "curl -s --max-time 5 http://127.0.0.1:8787/api/health" || true
echo
echo "部署完成：http://$HOST/"
echo "默认账号：admin / admin123 （登录后请立即修改密码）"
