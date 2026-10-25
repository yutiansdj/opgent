#!/usr/bin/env bash
# =====================================================================
# 远程安卓设备运维平台 —— 一键安装脚本
#
# 用法（在全新服务器上，root 执行）：
#   tar -xzf remote-ops-src-*.tar.gz
#   cd remote-ops
#   bash install.sh
#
# 可配置项（环境变量）：
#   PUBLIC_BASE   对外地址，默认 https://<本机公网IP>（Agent 和注入脚本用它回连）
#   HTTP_PORT     HTTP 端口，默认 80
#   HTTPS_PORT    HTTPS 端口，默认 443
#   INSTALL_DIR   安装目录，默认 /opt/remote-ops
#   SKIP_CERT     设为 1 则不生成自签证书（自己已有证书时用）
#
# 说明：
#   - 幂等，可重复执行用于升级
#   - 前台静态文件直接用包里预构建的 web/dist，不需要在服务器上装前端依赖
#   - 后端依赖 npm install（express / ws / multer / sharp / app-info-parser / adm-zip）
# =====================================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/remote-ops}"
HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"
SKIP_CERT="${SKIP_CERT:-0}"
SKIP_SYSTEMD="${SKIP_SYSTEMD:-0}"   # 1 = 只装文件、不碰 systemd/nginx（用于测试）
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '\033[36m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" == "0" ]] || die "请用 root 运行：sudo bash install.sh"

# ---------------------------------------------------------------- 1. 系统依赖
log "检查系统依赖…"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq || warn "apt update 有报错，继续"
  apt-get install -y -qq curl ca-certificates nginx openssl rsync >/dev/null 2>&1 || true
else
  warn "非 apt 系统，请自行确保已安装 nginx / openssl / curl"
fi
for c in nginx openssl curl; do
  command -v "$c" >/dev/null 2>&1 || die "缺少命令：$c"
done

# ---------------------------------------------------------------- 2. Node.js
log "检查 Node.js…"
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  # node:sqlite 需要 Node 22 及以上，建议 24
  if [[ "$major" -ge 22 ]]; then
    need_node=0
    log "已安装 Node $(node -v)"
  else
    warn "Node $(node -v) 版本过低（需要 >= 22），将安装 Node 24"
  fi
fi

if [[ "$need_node" == "1" ]]; then
  NODE_VER="${NODE_VER:-v24.19.0}"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) PKG_ARCH="x64" ;;
    aarch64|arm64) PKG_ARCH="arm64" ;;
    *) die "不支持的 CPU 架构：$ARCH" ;;
  esac
  log "下载 Node ${NODE_VER} (${PKG_ARCH})…"
  curl -fsSL --max-time 300 -o /tmp/node.tar.xz \
    "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-${PKG_ARCH}.tar.xz"
  tar -xJf /tmp/node.tar.xz -C /usr/local
  ln -sfn "/usr/local/node-${NODE_VER}-linux-${PKG_ARCH}" /usr/local/node
  ln -sf /usr/local/node/bin/node /usr/local/bin/node
  ln -sf /usr/local/node/bin/npm /usr/local/bin/npm
  ln -sf /usr/local/node/bin/npx /usr/local/bin/npx
  log "Node 安装完成：$(/usr/local/bin/node -v)"
  NODE_BIN=/usr/local/bin/node
else
  NODE_BIN="$(command -v node)"
fi

# ---------------------------------------------------------------- 3. 部署文件
log "安装目录：$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/backend" "$INSTALL_DIR/web" "$INSTALL_DIR/app"

log "复制后端源码…"
rsync -a --delete \
  --exclude node_modules --exclude data --exclude '*.log' \
  "$SRC_DIR/backend/" "$INSTALL_DIR/backend/"

log "复制前端静态文件（已预构建）…"
if [[ -f "$SRC_DIR/web/dist/index.html" ]]; then
  rsync -a --delete "$SRC_DIR/web/dist/" "$INSTALL_DIR/web/"
else
  die "包内缺少 web/dist，请在开发机执行 npm run build 后重新打包"
fi

# ---------------------------------------------------------------- 4. 后端依赖
log "安装后端依赖（npm）…"
cd "$INSTALL_DIR/backend"
"${NODE_BIN%/node}/npm" install --omit=dev --no-audit --no-fund >/tmp/npm-install.log 2>&1 || {
  tail -30 /tmp/npm-install.log
  die "npm install 失败，详见 /tmp/npm-install.log"
}
# 校验关键依赖
"$NODE_BIN" -e "require('express');require('ws');require('multer');require('sharp');require('adm-zip');require('app-info-parser')" \
  || die "后端依赖不完整"

# ---------------------------------------------------------------- 5. 对外地址
if [[ -z "${PUBLIC_BASE:-}" ]]; then
  IP="$(curl -fsSL --max-time 10 https://api.ipify.org 2>/dev/null || true)"
  [[ -z "$IP" ]] && IP="$(hostname -I | awk '{print $1}')"
  PUBLIC_BASE="https://${IP}"
fi
log "对外地址：$PUBLIC_BASE"

# ---------------------------------------------------------------- 6. 自签证书
SSL_DIR=/etc/nginx/ssl
if [[ "$SKIP_CERT" != "1" ]]; then
  if [[ -f "$SSL_DIR/remote-ops.crt" && -f "$SSL_DIR/remote-ops.key" ]]; then
    log "已存在证书，跳过生成"
  else
    log "生成自签证书（10 年）…"
    mkdir -p "$SSL_DIR"
    CERT_IP="$(echo "$PUBLIC_BASE" | sed -E 's#https?://##; s#/.*##; s#:.*##')"
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
      -keyout "$SSL_DIR/remote-ops.key" \
      -out "$SSL_DIR/remote-ops.crt" \
      -subj "/CN=${CERT_IP}" \
      -addext "subjectAltName=IP:${CERT_IP}" >/dev/null 2>&1 \
      || warn "生成证书失败（旧版 openssl 可能不支持 -addext），HTTPS 将不可用"
    chmod 600 "$SSL_DIR/remote-ops.key" 2>/dev/null || true
  fi
fi

# ---------------------------------------------------------------- 7. systemd
if [[ "$SKIP_SYSTEMD" == "1" ]]; then
  log "SKIP_SYSTEMD=1，跳过 systemd / nginx 配置"
  log "手动启动：PORT=18080 HOST=127.0.0.1 PUBLIC_BASE=$PUBLIC_BASE $NODE_BIN $INSTALL_DIR/backend/src/server.js"
  exit 0
fi

log "安装 systemd 服务…"
SERVICE=/etc/systemd/system/remote-ops.service
cat > "$SERVICE" <<EOF
[Unit]
Description=Remote Ops Backend (远程安卓设备运维平台)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/backend
Environment=NODE_ENV=production
Environment=PORT=8787
Environment=HOST=127.0.0.1
Environment=PUBLIC_BASE=$PUBLIC_BASE
Environment=WEB_DIST=$INSTALL_DIR/web
Environment=APP_DIR=$INSTALL_DIR/app
ExecStart=$NODE_BIN src/server.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=remote-ops

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable remote-ops >/dev/null 2>&1 || true
systemctl restart remote-ops
sleep 2
systemctl is-active --quiet remote-ops || {
  journalctl -u remote-ops -n 30 --no-pager
  die "后端启动失败"
}
log "后端已启动（127.0.0.1:8787）"

# ---------------------------------------------------------------- 8. Nginx
log "配置 Nginx…"
NGINX_CONF=/etc/nginx/sites-available/remote-ops
cat > "$NGINX_CONF" <<EOF
server {
    listen $HTTP_PORT default_server;
    listen [::]:$HTTP_PORT default_server;

    # HTTPS（自签证书，供 Agent 加密传输）
    listen $HTTPS_PORT ssl;
    ssl_certificate     $SSL_DIR/remote-ops.crt;
    ssl_certificate_key $SSL_DIR/remote-ops.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    server_name _;
    client_max_body_size 512m;

    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;

    # 公开脚本目录
    location /app/ {
        root $INSTALL_DIR;
        default_type text/plain;
        add_header Content-Type "text/plain; charset=utf-8";
        add_header X-Content-Type-Options nosniff;
    }

    # 后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_request_buffering off;
    }

    # Agent WebSocket
    location /ws/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # 静态资源
    location /assets/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host \$host;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
    }
    location ~* \.(png|jpg|jpeg|gif|svg|ico|woff2?)\$ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        try_files \$uri =404;
    }

    # 页面请求交给后端（后端会注入站点名称）
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/remote-ops
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || { nginx -t; die "Nginx 配置有误"; }
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx 2>/dev/null || systemctl restart nginx
log "Nginx 已重载"

# ---------------------------------------------------------------- 9. 收尾
log "健康检查…"
sleep 1
health="$(curl -s --max-time 5 http://127.0.0.1:8787/api/health || true)"
[[ "$health" == *'"ok":true'* ]] || warn "后端健康检查未通过：$health"

cat <<EOF

================================================================
 安装完成

 后台地址 : $PUBLIC_BASE
           （HTTP: http://<IP>:$HTTP_PORT，HTTPS 自签证书浏览器会提示风险）
 默认账号 : admin
 默认密码 : admin123        ← 登录后请立刻修改
 对外脚本目录 : $INSTALL_DIR/app  →  $PUBLIC_BASE/app/文件名

 服务管理 :
   systemctl status remote-ops
   journalctl -u remote-ops -f

 手机端接入 :
   1) 后台「项目管理」新建项目，上传 .sh
   2) 下载注入脚本，在手机 root 终端执行：
        su -c "sh /sdcard/Download/xxx-inject.sh"
   3) 或直接在项目上点「一键注入」（设备需在线）

 如果打不开页面，检查云厂商安全组是否放行 $HTTP_PORT / $HTTPS_PORT
================================================================
EOF
