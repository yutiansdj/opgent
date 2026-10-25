#!/usr/bin/env bash
# 打包源码分发（在开发机上运行，不需要 root）
#
# 产物：./dist/remote-ops-src-<日期>.tar.gz
# 包含：安装脚本、文档、后端源码、前端源码+预构建 dist、部署配置、安卓源码
# 排除：node_modules / data / 构建产物 / 大文件
set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="dist"
STAMP="$(date +%Y%m%d)"
NAME="remote-ops-src-${STAMP}"
mkdir -p "$OUT_DIR"

echo "[pack] 检查必要文件…"
for f in install.sh INSTALL.md README.md docs/API.md backend/package.json web/dist/index.html; do
  [[ -e "$f" ]] || { echo "缺少 $f"; exit 1; }
done

echo "[pack] 打包…"
tar -czf "${OUT_DIR}/${NAME}.tar.gz" \
  --transform "s,^,${NAME}/," \
  --exclude='node_modules' \
  --exclude='backend/data' \
  --exclude='*.log' \
  --exclude='.gradle' \
  --exclude='android/build' \
  --exclude='android/app/build' \
  --exclude='android/.kotlin' \
  --exclude='*.apk' \
  --exclude='thumbnails.zip' \
  --exclude='.git' \
  install.sh INSTALL.md README.md docs backend web android deploy scripts

SIZE="$(du -h "${OUT_DIR}/${NAME}.tar.gz" | cut -f1)"
echo "[pack] 完成：${OUT_DIR}/${NAME}.tar.gz (${SIZE})"
echo "[pack] 内容概览："
tar -tzf "${OUT_DIR}/${NAME}.tar.gz" | sed "s,^${NAME}/,," | awk -F/ 'NF<=2' | sort | head -30
