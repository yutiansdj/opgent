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
