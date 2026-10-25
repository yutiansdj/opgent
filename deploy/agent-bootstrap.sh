#!/system/bin/sh
# =====================================================================
# 远程运维 Agent —— 一键安装 / 启动 / 守护（纯 shell，不需要打开 App）
#
# 用法（在手机上用 root 终端执行）：
#   sh /sdcard/dsha/remote-ops/deploy/agent-bootstrap.sh install   # 安装 + 启动 + 守护
#   sh /sdcard/dsha/remote-ops/deploy/agent-bootstrap.sh status    # 看状态（含是否被冻结）
#   sh /sdcard/dsha/remote-ops/deploy/agent-bootstrap.sh kick      # 手动强制重启
#   sh /sdcard/dsha/remote-ops/deploy/agent-bootstrap.sh stop      # 停守护（服务保留）
#   sh /sdcard/dsha/remote-ops/deploy/agent-bootstrap.sh uninstall # 停止并删除脚本
#
# v1.2 关键改动：
#   - 识别「应用速冻」：ps 里 WCHAN 显示 do_freezer_trap 即为冻结；
#   - 冻结时不依赖 am（会被系统拒绝），直接 kill -9，让 START_STICKY 自动拉回；
#   - 冷却 30 秒，避免反复杀进程造成抖动。
# =====================================================================

PKG=com.dsha.remoteagent
SVC=$PKG/.service.AgentService
DIR=/data/adb/remoteagent
BOOT_SCRIPT=/data/adb/service.d/remoteagent.sh
LOGF=$DIR/daemon.log

log() { echo "[bootstrap] $*"; }

need_root() {
    if [ "$(id -u)" != "0" ]; then
        echo "错误：需要 root。请用 su -c \"sh $0 $*\" 或在 root 终端里执行。" >&2
        exit 1
    fi
}

write_scripts() {
    mkdir -p "$DIR" /data/adb/service.d || return 1

    cat > "$DIR/daemon.sh" <<'DAEMON_EOF'
#!/system/bin/sh
# Agent 守护：识别「死亡」与「被速冻」两种状态并恢复
PKG=com.dsha.remoteagent
SVC=$PKG/.service.AgentService
DIR=/data/adb/remoteagent
LOCK=$DIR/daemon.lock
LOG=$DIR/daemon.log
KICKF=$DIR/.last_kick
COOLDOWN=30

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [daemon] $*" >> "$LOG"; }

# 单实例：pid 活着且 cmdline 确实是本脚本
if [ -f "$LOCK" ]; then
    OLD=$(tr -d ' \n' < "$LOCK" 2>/dev/null)
    if [ -n "$OLD" ] && [ -r "/proc/$OLD/cmdline" ] && grep -q "daemon.sh" "/proc/$OLD/cmdline" 2>/dev/null; then
        exit 0
    fi
fi
echo $$ > "$LOCK"
log "start pid=$$"

# 返回 alive / frozen / dead
service_state() {
    LP=$(ps -A 2>/dev/null | grep "$PKG" | head -1)
    if [ -z "$LP" ]; then
        echo dead
        return
    fi
    case "$LP" in
        *do_freezer_trap*) echo frozen ;;
        *) echo alive ;;
    esac
}

can_kick() {
    NOW=$(date '+%s')
    LAST=$(cat "$KICKF" 2>/dev/null)
    case "$LAST" in ''|*[!0-9]*) LAST=0 ;; esac
    [ $((NOW - LAST)) -ge $COOLDOWN ]
}

mark_kick() { date '+%s' > "$KICKF"; }

while true; do
    ST=$(service_state)
    case "$ST" in
        frozen)
            if can_kick; then
                P=$(pidof "$PKG" 2>/dev/null)
                log "FROZEN(pid=$P) -> kill -9，交给系统按 START_STICKY 自愈"
                [ -n "$P" ] && kill -9 "$P" 2>/dev/null
                mark_kick
                sleep 4
            fi
            ;;
        dead)
            if can_kick; then
                log "DEAD -> am start-foreground-service"
                OUT=$(am start-foreground-service --user 0 -n "$SVC" 2>&1)
                RC=$?
                log "am rc=$RC out=$(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-240)"
                mark_kick
                sleep 3
            fi
            ;;
        *)
            : # alive，什么都不做
            ;;
    esac
    sleep 5
done
DAEMON_EOF

    cat > "$DIR/guard.sh" <<'GUARD_EOF'
#!/system/bin/sh
# 外层守护：daemon.sh 挂了就拉起来
DIR=/data/adb/remoteagent
LOCK=$DIR/guard.lock
DLOCK=$DIR/daemon.lock
LOG=$DIR/daemon.log

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [guard] $*" >> "$LOG"; }

if [ -f "$LOCK" ]; then
    OLD=$(tr -d ' \n' < "$LOCK" 2>/dev/null)
    if [ -n "$OLD" ] && [ -r "/proc/$OLD/cmdline" ] && grep -q "guard.sh" "/proc/$OLD/cmdline" 2>/dev/null; then
        exit 0
    fi
fi
echo $$ > "$LOCK"
log "start pid=$$"

daemon_alive() {
    D=$(tr -d ' \n' < "$DLOCK" 2>/dev/null)
    [ -n "$D" ] && [ -r "/proc/$D/cmdline" ] && grep -q "daemon.sh" "/proc/$D/cmdline" 2>/dev/null
}

while true; do
    if ! daemon_alive; then
        log "daemon dead -> spawn"
        sh "$DIR/daemon.sh" >/dev/null 2>&1 &
        sleep 2
        daemon_alive && log "daemon spawned ok" || log "daemon spawn FAILED"
    fi
    sleep 5
done
GUARD_EOF

    cat > "$BOOT_SCRIPT" <<'BOOT_EOF'
#!/system/bin/sh
# 开机自启：等 ActivityManager 就绪后拉起 guard
sleep 20
( trap '' HUP; exec sh /data/adb/remoteagent/guard.sh ) >/dev/null 2>&1 < /dev/null &
BOOT_EOF

    chmod 755 "$DIR/daemon.sh" "$DIR/guard.sh" "$BOOT_SCRIPT"
}

kill_old() {
    for f in guard daemon; do
        p=$(tr -d ' \n' < "$DIR/$f.lock" 2>/dev/null)
        if [ -n "$p" ] && grep -q "$f.sh" "/proc/$p/cmdline" 2>/dev/null; then
            kill -9 "$p" 2>/dev/null
        fi
    done
    rm -f "$DIR/guard.lock" "$DIR/daemon.lock"
}

whitelist_app() {
    dumpsys deviceidle whitelist +"$PKG" >/dev/null 2>&1
    cmd deviceidle whitelist +"$PKG" >/dev/null 2>&1
    cmd appops set "$PKG" RUN_IN_BACKGROUND allow >/dev/null 2>&1
    cmd appops set "$PKG" RUN_ANY_IN_BACKGROUND allow >/dev/null 2>&1
    log "已尝试加入电池/后台白名单"
}

show_status() {
    echo "---- 状态 ----"
    P=$(pidof "$PKG" 2>/dev/null)
    echo "App 进程   : ${P:-未运行}"
    if [ -n "$P" ]; then
        PS_LINE=$(ps -A 2>/dev/null | grep "$PKG" | head -1)
        case "$PS_LINE" in
            *do_freezer_trap*) echo "进程状态   : 已被系统速冻（需要关掉 ColorOS 应用速冻）" ;;
            *) echo "进程状态   : 正常" ;;
        esac
    fi
    echo "guard  pid : $(tr -d ' \n' < "$DIR/guard.lock" 2>/dev/null || echo '-')"
    echo "daemon pid : $(tr -d ' \n' < "$DIR/daemon.lock" 2>/dev/null || echo '-')"
    echo "开机自启   : $([ -f "$BOOT_SCRIPT" ] && echo 已安装 || echo 未安装)"
    echo "电池白名单 : $(dumpsys deviceidle whitelist 2>/dev/null | grep -c "$PKG") 条匹配"
    echo "---- 最近日志 ----"
    tail -10 "$LOGF" 2>/dev/null || echo "（暂无日志）"
}

case "${1:-install}" in
    install)
        need_root "$@"
        log "写入守护脚本到 $DIR"
        write_scripts || { echo "写入失败，请确认 root 正常"; exit 1; }
        log "停止旧守护"
        kill_old
        log "加入电池白名单"
        whitelist_app
        log "启动前台服务（只拉服务，不拉界面）"
        am start-foreground-service --user 0 -n "$SVC" 2>&1 | sed 's/^/  /'
        sleep 2
        log "后台启动守护"
        ( trap '' HUP; exec sh "$DIR/guard.sh" ) </dev/null >/dev/null 2>&1 &
        sleep 2
        show_status
        ;;
    status)
        need_root "$@"
        show_status
        ;;
    kick)
        need_root "$@"
        log "强制重启 Agent"
        P=$(pidof "$PKG" 2>/dev/null)
        [ -n "$P" ] && kill -9 "$P" 2>/dev/null
        sleep 2
        am start-foreground-service --user 0 -n "$SVC" 2>&1 | sed 's/^/  /'
        sleep 2
        show_status
        ;;
    stop)
        need_root "$@"
        log "停止守护（服务保留）"
        kill_old
        show_status
        ;;
    uninstall)
        need_root "$@"
        log "停止并清理守护脚本"
        kill_old
        rm -rf "$DIR" "$BOOT_SCRIPT"
        echo "已删除 $DIR 与 $BOOT_SCRIPT（App 本体未动）"
        ;;
    *)
        echo "用法：sh $0 {install|status|kick|stop|uninstall}"
        exit 1
        ;;
esac
