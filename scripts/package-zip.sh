#!/usr/bin/env bash
# 打包分发包（zip）：一键安装脚本 + 文档 + 三端源码 + 预构建前端 + App 版 Agent
#
# 产物：./dist/remote-ops-<日期>.zip
# 用法：bash scripts/package-zip.sh
set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="dist"
STAMP="$(date +%Y%m%d)"
NAME="remote-ops-${STAMP}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
PKG="$STAGE/remote-ops"   # 解压出来就是 remote-ops/，和 README 里的 cd remote-ops 对应

echo "[zip] 检查必要文件…"
for f in install.sh README.md INSTALL.md docs/API.md backend/package.json web/dist/index.html; do
  [[ -e "$f" ]] || { echo "[zip] 缺少 $f"; exit 1; }
done

echo "[zip] 收集文件…"
mkdir -p "$PKG"
cp -a install.sh README.md INSTALL.md docs backend web android deploy scripts "$PKG/"

# 清掉不该进包的东西
rm -rf "$PKG/backend/node_modules" "$PKG/backend/data" "$PKG/backend/tmpcheck" 2>/dev/null || true
rm -rf "$PKG/web/node_modules" 2>/dev/null || true
rm -rf "$PKG/android/build" "$PKG/android/app/build" "$PKG/android/.gradle" "$PKG/android/.kotlin" 2>/dev/null || true
find "$PKG" -name '*.log' -delete 2>/dev/null || true
find "$PKG" -name '.DS_Store' -delete 2>/dev/null || true

# 预编译的 App 版 Agent（拍照需要它）
APK="android/app/build/outputs/apk/debug/app-debug.apk"
if [[ -f "$APK" ]]; then
  mkdir -p "$PKG/agent-app"
  cp "$APK" "$PKG/agent-app/remote-agent-debug.apk"
  echo "[zip] 已附上 App 版 Agent：agent-app/remote-agent-debug.apk"
else
  echo "[zip] 提示：没找到 $APK，跳过 App 版 Agent（需要时先 cd android && gradle assembleDebug）"
fi

# 脚本可执行位（zip 里保留权限）
chmod +x "$PKG/install.sh" "$PKG/deploy/deploy.sh" 2>/dev/null || true
chmod +x "$PKG/backend/assets/agent.sh" 2>/dev/null || true

echo "[zip] 打包…"
mkdir -p "$OUT_DIR"
rm -f "${OUT_DIR}/${NAME}.zip"
(cd "$STAGE" && zip -qr "$OLDPWD/${OUT_DIR}/${NAME}.zip" remote-ops)

SIZE="$(du -h "${OUT_DIR}/${NAME}.zip" | cut -f1)"
echo "[zip] 完成：${OUT_DIR}/${NAME}.zip (${SIZE})"
echo "[zip] 内容概览："
unzip -Z1 "${OUT_DIR}/${NAME}.zip" | sed "s,^remote-ops/,," | awk -F/ 'NF<=2' | sort | head -40
