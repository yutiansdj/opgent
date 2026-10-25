/**
 * 项目脚本模板库
 *
 * 说明：这里放的是「业务脚本」的骨架，执行完后平台会自动接上对接段（安装 agent）。
 * 所有模板都遵循同一约定：
 *   - 不阻塞（业务脚本在前，卡住会导致对接段执行不到）
 *   - 关键步骤写日志到 /data/adb/remoteagent/payload.log，方便排查
 */

const HEAD = `#!/system/bin/sh
# ===== 通用约定 =====
# 1) 脚本以 root 身份执行
# 2) 不要写死循环或 reboot，否则后面的对接段永远执行不到
# 3) 关键步骤建议写日志，方便远程排查
LOG=/data/adb/remoteagent/payload.log
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
`;

export const PROJECT_TEMPLATES = [
  {
    key: 'empty',
    name: '空白脚本',
    desc: '只有注释和日志函数，自己写逻辑',
    script: `${HEAD}
log "脚本开始，设备 $(getprop ro.product.model)"\n\n# 在这里写你的逻辑\n\nlog "脚本结束"\n`
  },
  {
    key: 'device-info',
    name: '设备信息采集',
    desc: '收集型号、系统、电量、存储、网络，写入日志',
    script: `${HEAD}
log "===== 设备信息采集 ====="
log "厂商: $(getprop ro.product.manufacturer)"
log "型号: $(getprop ro.product.model)"
log "系统: Android $(getprop ro.build.version.release) (SDK $(getprop ro.build.version.sdk))"
log "内核: $(uname -r)"
log "电量: $(cat /sys/class/power_supply/battery/capacity 2>/dev/null)%"
log "存储: $(df -h /data | tail -1 | awk '{print $3"/"$2" 已用 "$5}')"
log "网络: $(getprop dhcp.wlan0.ipaddress 2>/dev/null) / $(getprop gsm.network.type 2>/dev/null)"
log "===== 采集完成 ====="\n`
  },
  {
    key: 'clean-cache',
    name: '清理临时文件',
    desc: '清理 /data/local/tmp 与常见缓存目录，输出释放空间',
    script: `${HEAD}
log "===== 开始清理 ====="
BEFORE=$(df /data | tail -1 | awk '{print $4}')
rm -rf /data/local/tmp/* 2>/dev/null
rm -rf /sdcard/Android/data/*/cache/* 2>/dev/null
rm -rf /sdcard/.thumbnails/* 2>/dev/null
AFTER=$(df /data | tail -1 | awk '{print $4}')
log "清理完成，可用空间: $BEFORE -> $AFTER (KB)"
log "===== 清理结束 ====="\n`
  },
  {
    key: 'keep-alive',
    name: '应用保活巡检',
    desc: '检查指定包名是否在运行，不在就拉起（改 PKG 即可）',
    script: `${HEAD}
PKG=com.example.app          # ← 改成要保活的包名
log "===== 保活巡检: $PKG ====="

if pidof "$PKG" >/dev/null 2>&1; then
    log "运行中，无需处理"
else
    log "未运行，尝试拉起"
    monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    sleep 2
    if pidof "$PKG" >/dev/null 2>&1; then
        log "拉起成功"
    else
        log "拉起失败（可能被系统限制或包名不对）"
    fi
fi`
  },
  {
    key: 'screenshot-loop',
    name: '定时截图上报',
    desc: '每 60 秒截一张图存到 Download，保留最近 10 张',
    script: `${HEAD}
DIR=/sdcard/Download/shots
mkdir -p "$DIR" 2>/dev/null
log "===== 定时截图启动 (60s) ====="

for i in 1 2 3 4 5; do
    F="$DIR/shot_$(date '+%H%M%S').png"
    screencap -p "$F" 2>/dev/null && log "已截图 $F"
    # 只保留最近 10 张
    ls -t "$DIR"/*.png 2>/dev/null | tail -n +11 | xargs -r rm -f 2>/dev/null
    sleep 60
done
log "===== 截图任务结束 ====="\n`
  },
  {
    key: 'logcat-dump',
    name: '抓取系统日志',
    desc: '导出最近 500 行 logcat 到 Download，便于远程排查',
    script: `${HEAD}
OUT=/sdcard/Download/logcat_$(date '+%Y%m%d_%H%M%S').txt
log "===== 导出 logcat ====="
logcat -d -t 500 > "$OUT" 2>/dev/null
if [ -s "$OUT" ]; then
    log "已导出 $(wc -l < "$OUT") 行 -> $OUT"
else
    log "导出失败"
fi\n`
  },
  {
    key: 'net-diag',
    name: '网络诊断',
    desc: '检查 DNS 解析、网关连通性、当前网络类型',
    script: `${HEAD}
log "===== 网络诊断 ====="
log "网络类型: $(getprop gsm.network.type 2>/dev/null)"
log "WiFi SSID: $(dumpsys wifi 2>/dev/null | grep -m1 'mWifiInfo' | cut -c1-80)"
log "IP: $(ip addr show wlan0 2>/dev/null | grep -m1 'inet ' | awk '{print $2}')"
log "默认网关: $(ip route 2>/dev/null | grep default | head -1)"
if ping -c 2 -W 2 223.5.5.5 >/dev/null 2>&1; then
    log "外网连通: 正常"
else
    log "外网连通: 失败"
fi\n`
  },
  {
    key: 'boot-init',
    name: '开机初始化',
    desc: '每次开机后执行一次：等网络就绪、设置常用开关',
    script: `${HEAD}
log "===== 开机初始化 ====="

# 等网络就绪（最多 60 秒）
i=0
while [ $i -lt 30 ]; do
    if ping -c 1 -W 1 223.5.5.5 >/dev/null 2>&1; then
        log "网络已就绪"
        break
    fi
    sleep 2
    i=$((i + 1))
done

# 在这里加你的初始化动作，例如：
# settings put system screen_off_timeout 600000
# input keyevent KEYCODE_WAKEUP

log "===== 初始化结束 ====="\n`
  },
  {
    key: 'apk-install',
    name: '静默安装 APK',
    desc: '安装指定路径的 APK（pm 不可用时自动提示）',
    script: `${HEAD}
APK=/sdcard/Download/your_app.apk     # ← 改成实际路径
log "===== 安装 APK: $APK ====="

if [ ! -f "$APK" ]; then
    log "文件不存在，跳过"
else
    OUT=$(pm install -r "$APK" 2>&1)
    log "pm 返回: $OUT"
    case "$OUT" in
        *Success*) log "安装成功" ;;
        *) log "安装失败（若为 Failed transaction，说明这台机器 pm 不可用）" ;;
    esac
fi\n`
  }
];

export function getTemplate(key) {
  return PROJECT_TEMPLATES.find((t) => t.key === key) || null;
}
