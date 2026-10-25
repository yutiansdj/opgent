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
