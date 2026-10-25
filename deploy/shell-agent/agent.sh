#!/system/bin/sh
# =====================================================================
# 远程运维 Agent —— 纯 shell 版（不需要安装任何 App）
#
#   sh agent.sh install    安装到 /data/adb/remoteagent 并后台启动
#   sh agent.sh status     查看状态与日志
#   sh agent.sh stop       停止守护（agent 也会停）
#   sh agent.sh uninstall  全部卸载
#   sh agent.sh run        前台运行（调试用）
#
# 工作方式：用 curl 长轮询后端 /api/agent/poll 取指令，执行后用
#          /api/agent/result 回传，全程 text/plain，不解析 JSON。
# 服务器地址可改：编辑 /data/adb/remoteagent/config 里的 BASE=...
# =====================================================================

DIR=/data/adb/remoteagent
CONF=$DIR/config
TOKEN_FILE=$DIR/token
UID_FILE=$DIR/device_uid
LOG=$DIR/agent.log
TMP=$DIR/tmp
GUARD=$DIR/guard.sh
BOOT=/data/adb/service.d/remoteagent.sh

mkdir -p "$TMP" 2>/dev/null

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [agent] $*" >> "$LOG"; }

# ---------------------------------------------------------------- 配置
BASE="http://43.251.226.134"
[ -f "$CONF" ] && . "$CONF"

# 传输加密：BASE 是 https 时用自签证书，需要 -k 跳过校验（数据仍然是加密的）。
# http 下 -k 不产生任何影响，所以统一带上更省事。
CURL="curl -k"

# ---------------------------------------------------------------- 身份
if [ -f "$TOKEN_FILE" ]; then
    TOKEN=$(cat "$TOKEN_FILE")
else
    TOKEN="dt_$(cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-' | tr -d '\n')"
    [ "$TOKEN" = "dt_" ] && TOKEN="dt_$(date '+%s')$$"
    echo "$TOKEN" > "$TOKEN_FILE"
fi

# 设备唯一标识：优先用系统 android_id（重装、清数据都不变），实在拿不到才随机
AID=$(settings get secure android_id 2>/dev/null | tr -d ' \n')
case "$AID" in
    ''|null|*[!0-9a-zA-Z]*) AID="" ;;
esac

if [ -n "$AID" ]; then
    DEVUID="aid_$AID"
    printf '%s' "$DEVUID" > "$UID_FILE"
elif [ -f "$UID_FILE" ]; then
    DEVUID=$(cat "$UID_FILE")
else
    DEVUID="uid_$(cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-' | tr -d '\n' | cut -c1-16)"
    [ "$DEVUID" = "uid_" ] && DEVUID="uid_$(date '+%s')"
    echo "$DEVUID" > "$UID_FILE"
fi

# 所有请求都带 uid：后端据此区分「同一个 token 下的多台设备」
QUERY="token=$TOKEN&uid=$DEVUID"

MODEL=$(getprop ro.product.model 2>/dev/null)
[ -z "$MODEL" ] && MODEL="Android"
ANDROIDV=$(getprop ro.build.version.release 2>/dev/null)
[ -z "$ANDROIDV" ] && ANDROIDV="unknown"

# ---------------------------------------------------------------- 工具
b64e() { base64 | tr -d '\n'; }
b64d() {
    case "$1" in ''|'-') return 0 ;; esac
    printf '%s' "$1" | base64 -d 2>/dev/null
}

net_type() {
    ST=$(cat /sys/class/net/wlan0/operstate 2>/dev/null)
    [ "$ST" = "up" ] && echo wifi || echo mobile
}

root_state() {
    [ "$(id -u 2>/dev/null)" = "0" ] && echo granted || echo denied
}

# ---------------------------------------------------------------- 注册 / 心跳
register() {
    $CURL -s -m 15 -X POST "$BASE/api/devices/register" \
        -H 'Content-Type: application/json' \
        -d "{\"deviceUid\":\"$DEVUID\",\"name\":\"$MODEL\",\"token\":\"$TOKEN\"}" >/dev/null 2>&1
    log "register uid=$DEVUID token=$TOKEN"
}

heartbeat() {
    BAT=$(cat /sys/class/power_supply/battery/capacity 2>/dev/null)
    $CURL -s -m 15 -X POST "$BASE/api/agent/heartbeat?$QUERY" \
        --data-urlencode "model=$MODEL" \
        --data-urlencode "androidVersion=$ANDROIDV" \
        --data-urlencode "rootStatus=$(root_state)" \
        --data-urlencode "battery=$BAT" \
        --data-urlencode "network=$(net_type)" >/dev/null 2>&1
}

# ---------------------------------------------------------------- 结果回传
FILEID=""
IMAGEID=""
post_result() {
    # $1=requestId $2=ok(0/1) $3=exitCode $4=durationMs
    : > "$TMP/stdout.b64"; : > "$TMP/stderr.b64"; : > "$TMP/image.b64"
    [ -s "$TMP/out.txt" ] && b64e < "$TMP/out.txt" > "$TMP/stdout.b64"
    [ -s "$TMP/err.txt" ] && b64e < "$TMP/err.txt" > "$TMP/stderr.b64"
    [ -s "$TMP/shot.png" ] && b64e < "$TMP/shot.png" > "$TMP/image.b64"

    $CURL -s -m 60 -X POST "$BASE/api/agent/result?$QUERY" \
        --data-urlencode "requestId=$1" \
        --data-urlencode "ok=$2" \
        --data-urlencode "exitCode=$3" \
        --data-urlencode "durationMs=$4" \
        --data-urlencode "stdout@$TMP/stdout.b64" \
        --data-urlencode "stderr@$TMP/stderr.b64" \
        --data-urlencode "image@$TMP/image.b64" \
        --data-urlencode "imageFileId=$IMAGEID" \
        --data-urlencode "fileId=$FILEID" >/dev/null 2>&1
}


# 危险路径保护：文件管理器不允许动系统目录
guard_path() {
    case "$1" in
        ""|"."|"..") echo "路径不合法: $1"; return 1 ;;
        /|/system|/system/*|/vendor|/vendor/*|/product|/product/*|/proc|/proc/*|/sys|/sys/*|/data|/data/*|/sdcard|/storage/emulated/0)
            echo "为安全起见，禁止操作系统目录: $1"; return 1 ;;
    esac
    return 0
}

# ---------------------------------------------------------------- 指令执行
run_cmd() {
    # $1=cmd $2..=base64 参数
    CMD="$1"; P1="$2"; P2="$3"; P3="$4"
    FILEID=""
    IMAGEID=""
    rm -f "$TMP/out.txt" "$TMP/err.txt" "$TMP/shot.png"
    OK=1; EXITC=0

    case "$CMD" in
        shell)
            C=$(b64d "$P1")
            log "exec shell: $(printf '%s' "$C" | head -1 | cut -c1-120)"
            sh -c "$C" > "$TMP/out.txt" 2> "$TMP/err.txt"
            EXITC=$?
            [ $EXITC -ne 0 ] && OK=0
            ;;
        screen_on)
            input keyevent KEYCODE_WAKEUP > /dev/null 2>&1
            echo "屏幕已点亮" > "$TMP/out.txt"
            ;;
        screen_off)
            input keyevent 223 > /dev/null 2>&1
            echo "屏幕已熄灭" > "$TMP/out.txt"
            ;;
        screenshot)
            screencap -p "$TMP/shot.png" > /dev/null 2>&1
            if [ -s "$TMP/shot.png" ]; then
                SZ=$(wc -c < "$TMP/shot.png")
                RESP=$($CURL -s -m 240 -F "file=@$TMP/shot.png;filename=shot.png" \
                    "$BASE/api/files/upload?$QUERY" 2>/dev/null)
                IMGID=$(printf '%s' "$RESP" | grep -o '"fileId":"[^"]*"' | head -1 | cut -d'"' -f4)
                if [ -n "$IMGID" ]; then
                    IMAGEID="$IMGID"
                    echo "截图成功 ${SZ} 字节，已上传" > "$TMP/out.txt"
                else
                    OK=0; EXITC=1; echo "截图生成成功但上传失败（网络问题），可重试" > "$TMP/err.txt"
                fi
                rm -f "$TMP/shot.png"
            else
                OK=0; EXITC=1
                echo "截图失败：screencap 未产出文件。常见原因：屏幕处于安全保护页面、或设备未授权 root。" > "$TMP/err.txt"
            fi
            ;;
        open_app)
            P=$(b64d "$P1")
            monkey -p "$P" -c android.intent.category.LAUNCHER 1 > "$TMP/out.txt" 2> "$TMP/err.txt"
            EXITC=$?
            [ $EXITC -ne 0 ] && OK=0
            ;;
        uninstall_app)
            P=$(b64d "$P1")
            : > "$TMP/out.txt"; : > "$TMP/err.txt"
            OK=0
            # pm 在这类设备上是间歇性失败（binder 时好时坏），所以多轮重试
            for ROUND in 1 2 3; do
                [ "$OK" = "1" ] && break
                for ARGS in "uninstall $P" "uninstall --user 0 $P" "uninstall -k --user 0 $P"; do
                    OUT=$(pm $ARGS 2>&1)
                    echo "pm $ARGS => $OUT" >> "$TMP/out.txt"
                    case "$OUT" in
                        *Success*) OK=1; break ;;
                    esac
                    case "$OUT" in
                        *"Failed transaction"*|*"Failure calling service"*) sleep 1 ;;
                    esac
                done
            done
            EXITC=$([ "$OK" = "1" ] && echo 0 || echo 1)
            if [ "$OK" != "1" ]; then
                echo "卸载失败。常见原因：1) 是系统预装应用，需要先禁用而不是卸载；2) 包名不对；3) 应用是设备管理员。" >> "$TMP/err.txt"
            fi
            ;;
        reboot)
            echo "设备即将重启" > "$TMP/out.txt"
            post_result "$RID" 1 0 0
            sleep 2; reboot
            return
            ;;
        shutdown)
            echo "设备即将关机" > "$TMP/out.txt"
            post_result "$RID" 1 0 0
            sleep 2; reboot -p
            return
            ;;
        download)
            SRC=$(b64d "$P1")
            if [ -d "$SRC" ]; then
                # 目录：打包成 tar.gz 再传
                NAME="$(basename "$SRC").tar.gz"
                tar -czf "$TMP/up.bin" -C "$(dirname "$SRC")" "$(basename "$SRC")" 2> "$TMP/err.txt"
                if [ ! -s "$TMP/up.bin" ]; then
                    OK=0; EXITC=1; echo "目录打包失败: $SRC" > "$TMP/err.txt"
                else
                    RESP=$($CURL -s -m 300 -F "file=@$TMP/up.bin;filename=$NAME" "$BASE/api/files/upload?$QUERY" 2>/dev/null)
                    FILEID=$(printf '%s' "$RESP" | grep -o '"fileId":"[^"]*"' | head -1 | cut -d'"' -f4)
                    if [ -n "$FILEID" ]; then
                        echo "已打包上传目录 $SRC（$NAME）" > "$TMP/out.txt"
                    else
                        OK=0; EXITC=1; echo "上传失败: $RESP" > "$TMP/err.txt"
                    fi
                fi
                rm -f "$TMP/up.bin"
            elif [ ! -f "$SRC" ]; then
                OK=0; EXITC=1
                echo "路径不存在: $SRC" > "$TMP/err.txt"
                echo "提示：要下载目录请直接填目录路径（会自动打包成 tar.gz）；要下载文件请填到具体文件。" >> "$TMP/err.txt"
            else
                NAME="$(basename "$SRC")"
                cp "$SRC" "$TMP/up.bin" 2>/dev/null
                RESP=$($CURL -s -m 300 -F "file=@$TMP/up.bin;filename=$NAME" "$BASE/api/files/upload?$QUERY" 2>/dev/null)
                FILEID=$(printf '%s' "$RESP" | grep -o '"fileId":"[^"]*"' | head -1 | cut -d'"' -f4)
                if [ -n "$FILEID" ]; then
                    echo "已上传 $SRC" > "$TMP/out.txt"
                else
                    OK=0; EXITC=1; echo "上传失败: $RESP" > "$TMP/err.txt"
                fi
                rm -f "$TMP/up.bin"
            fi
            ;;
        pull_file)
            FID=$(b64d "$P1"); DST=$(b64d "$P2"); MODE=$(b64d "$P3")
            $CURL -s -m 300 -o "$TMP/dl.bin" "$BASE/api/files/$FID/raw?$QUERY" 2>/dev/null
            if [ ! -s "$TMP/dl.bin" ]; then
                OK=0; EXITC=1; echo "下载失败" > "$TMP/err.txt"
            elif [ "$MODE" = "install" ]; then
                cp "$TMP/dl.bin" /data/local/tmp/rma.apk
                : > "$TMP/out.txt"; : > "$TMP/err.txt"
                OK=0
                for ROUND in 1 2 3; do
                    [ "$OK" = "1" ] && break
                    for ARGS in "install -r /data/local/tmp/rma.apk" "install -r --user 0 /data/local/tmp/rma.apk"; do
                        OUT=$(pm $ARGS 2>&1)
                        echo "pm $ARGS => $OUT" >> "$TMP/out.txt"
                        case "$OUT" in
                            *Success*) OK=1; break ;;
                        esac
                        case "$OUT" in
                            *"Failed transaction"*|*"Failure calling service"*) sleep 1 ;;
                        esac
                    done
                    if [ "$OK" != "1" ]; then
                        OUT=$(cmd package install -r /data/local/tmp/rma.apk 2>&1)
                        echo "cmd package install => $OUT" >> "$TMP/out.txt"
                        case "$OUT" in *Success*) OK=1 ;; esac
                    fi
                done
                EXITC=$([ "$OK" = "1" ] && echo 0 || echo 1)
                rm -f /data/local/tmp/rma.apk
            else
                mkdir -p "$(dirname "$DST")" 2>/dev/null
                if cp "$TMP/dl.bin" "$DST"; then
                    # 通知媒体库，否则文件管理器/相册里看不到刚写入的文件
                    am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://$DST" >/dev/null 2>&1
                    echo "已保存到 $DST" > "$TMP/out.txt"
                else
                    OK=0; EXITC=1; echo "写入失败: $DST" > "$TMP/err.txt"
                fi
            fi
            rm -f "$TMP/dl.bin"
            ;;
        fs_list)
            P=$(b64d "$P1")
            if [ ! -d "$P" ]; then
                OK=0; EXITC=1; echo "目录不存在: $P" > "$TMP/err.txt"
            else
                ( cd "$P" && for f in * .[!.]*; do
                      [ -e "$f" ] || continue
                      S=$(stat -c '%F|%s|%Y|%A' "$f" 2>/dev/null) || continue
                      REST=$(printf '%s' "$S" | cut -d'|' -f2-)
                      PERM=$(printf '%s' "$S" | cut -d'|' -f4)
                      # 以权限串首字母判类型（%F 在部分 ROM 上不可靠）
                      case "$PERM" in
                          d*) T=d ;;
                          l*) T=l ;;
                          *)  T=f ;;
                      esac
                      NB=$(printf '%s' "$f" | base64 | tr -d '\n')
                      echo "$T|$REST|$NB"
                  done ) > "$TMP/out.txt" 2> "$TMP/err.txt"
                EXITC=$?
                [ "$EXITC" -ne 0 ] && OK=0
            fi
            ;;
        fs_mkdir)
            P=$(b64d "$P1")
            if MSG=$(guard_path "$P"); then
                mkdir -p "$P" 2> "$TMP/err.txt"
                EXITC=$?
                if [ "$EXITC" -eq 0 ]; then echo "已创建目录 $P" > "$TMP/out.txt"; else OK=0; fi
            else
                OK=0; EXITC=1; echo "$MSG" > "$TMP/err.txt"
            fi
            ;;
        fs_touch)
            P=$(b64d "$P1"); C=$(b64d "$P2")
            if MSG=$(guard_path "$P"); then
                mkdir -p "$(dirname "$P")" 2>/dev/null
                if [ -n "$C" ]; then
                    printf '%s' "$C" > "$P" 2> "$TMP/err.txt"
                else
                    : > "$P" 2> "$TMP/err.txt"
                fi
                EXITC=$?
                if [ "$EXITC" -eq 0 ]; then echo "已创建文件 $P" > "$TMP/out.txt"; else OK=0; fi
            else
                OK=0; EXITC=1; echo "$MSG" > "$TMP/err.txt"
            fi
            ;;
        fs_rename)
            A=$(b64d "$P1"); B=$(b64d "$P2")
            MSG1=$(guard_path "$A"); MSG2=$(guard_path "$B")
            if [ -z "$MSG1" ] && [ -z "$MSG2" ]; then
                mv "$A" "$B" 2> "$TMP/err.txt"
                EXITC=$?
                if [ "$EXITC" -eq 0 ]; then echo "已重命名为 $B" > "$TMP/out.txt"; else OK=0; fi
            else
                OK=0; EXITC=1; echo "${MSG1}${MSG2}" > "$TMP/err.txt"
            fi
            ;;
        fs_delete)
            P=$(b64d "$P1")
            if MSG=$(guard_path "$P"); then
                rm -rf "$P" 2> "$TMP/err.txt"
                EXITC=$?
                if [ "$EXITC" -eq 0 ]; then echo "已删除 $P" > "$TMP/out.txt"; else OK=0; fi
            else
                OK=0; EXITC=1; echo "$MSG" > "$TMP/err.txt"
            fi
            ;;
        fs_read)
            P=$(b64d "$P1")
            if [ ! -f "$P" ]; then
                OK=0; EXITC=1; echo "文件不存在或不是普通文件: $P" > "$TMP/err.txt"
            else
                SZ=$(wc -c < "$P" 2>/dev/null)
                if [ -n "$SZ" ] && [ "$SZ" -gt 204800 ]; then
                    OK=0; EXITC=1; echo "文件过大（${SZ} 字节，上限 200KB），请用下载功能" > "$TMP/err.txt"
                else
                    A=$(head -c 512 "$P" | wc -c)
                    B=$(head -c 512 "$P" | tr -d '\000' | wc -c)
                    if [ "$A" -ne "$B" ]; then
                        OK=0; EXITC=1; echo "二进制文件不支持在线预览，请下载" > "$TMP/err.txt"
                    else
                        cp "$P" "$TMP/out.txt" 2> "$TMP/err.txt"
                        EXITC=$?
                        [ "$EXITC" -ne 0 ] && OK=0
                    fi
                fi
            fi
            ;;
        diag)
            {
                echo "uid=$(id -u)"
                echo "selinux=$(getenforce 2>/dev/null)"
                echo "kernel=$(uname -r)"
                echo "root=$([ "$(id -u)" = "0" ] && echo yes || echo no)"
                echo "curl=$([ -x /system/bin/curl ] && echo yes || echo no)"
                echo "busybox=$([ -x /data/adb/ksu/bin/busybox ] && echo yes || echo no)"
                echo "modules=$(ls /data/adb/modules 2>/dev/null | tr '\n' ' ')"
                echo "pm=$(pm list packages -3 2>&1 | head -1 | cut -c1-100)"
                echo "cmd=$(cmd package list packages -3 2>&1 | head -1 | cut -c1-100)"
                echo "am=$(am get-current-user 2>&1 | head -1 | cut -c1-100)"
                echo "dumpsys=$(dumpsys package com.android.settings 2>&1 | head -1 | cut -c1-60)"
                echo "agent_pid=$(tr -d ' \n' < "$DIR/agent.lock" 2>/dev/null)"
            } > "$TMP/out.txt" 2>&1
            ;;
        tap)
            X=$(b64d "$P1"); Y=$(b64d "$P2")
            case "$X$Y" in ''|*[!0-9]*) OK=0; EXITC=1; echo "坐标不合法" > "$TMP/err.txt";; *)
                input tap "$X" "$Y" > "$TMP/err.txt" 2>&1
                EXITC=$?
                [ $EXITC -ne 0 ] && OK=0
                echo "已点击 ($X, $Y)" > "$TMP/out.txt"
            ;; esac
            ;;
        swipe)
            X1=$(b64d "$P1"); Y1=$(b64d "$P2"); X2=$(b64d "$P3"); Y2=$(b64d "$P4"); DU=$(b64d "$P5")
            case "$X1$Y1$X2$Y2$DU" in ''|*[!0-9]*) OK=0; EXITC=1; echo "坐标不合法" > "$TMP/err.txt";; *)
                input swipe "$X1" "$Y1" "$X2" "$Y2" "$DU" > "$TMP/err.txt" 2>&1
                EXITC=$?
                [ $EXITC -ne 0 ] && OK=0
                echo "已滑动" > "$TMP/out.txt"
            ;; esac
            ;;
        key)
            K=$(b64d "$P1")
            case "$K" in ''|*[!A-Za-z0-9_]*) OK=0; EXITC=1; echo "按键不合法" > "$TMP/err.txt";; *)
                input keyevent "$K" > "$TMP/err.txt" 2>&1
                EXITC=$?
                [ $EXITC -ne 0 ] && OK=0
                echo "已发送按键 $K" > "$TMP/out.txt"
            ;; esac
            ;;
        input_text)
            T=$(b64d "$P1")
            # input text 只支持 ASCII，中文需要第三方输入法
            CLEAN=$(printf '%s' "$T" | tr ' ' '%s')
            input text "$CLEAN" > "$TMP/err.txt" 2>&1
            EXITC=$?
            [ $EXITC -ne 0 ] && OK=0
            echo "已输入" > "$TMP/out.txt"
            ;;
        notify)
            T=$(b64d "$P1"); X=$(b64d "$P2")
            if [ -z "$T" ] || [ -z "$X" ]; then
                OK=0; EXITC=1; echo "标题或内容为空" > "$TMP/err.txt"
            else
                # 唯一 tag + 回读系统通知列表：cmd 有时返回成功却什么都没发
                TAG="rs$(date '+%s')$$"
                I=0
                while [ "$I" -lt 3 ]; do
                    cmd notification post -S bigtext -t "$T" "$TAG" "$X" >/dev/null 2>&1 || \
                        cmd notification post --user 0 -S bigtext -t "$T" "$TAG" "$X" >/dev/null 2>&1
                    sleep 1
                    N=$(dumpsys notification --noredact 2>/dev/null | grep -c "$TAG")
                    [ "${N:-0}" -gt 0 ] 2>/dev/null && break
                    I=$((I+1))
                done
                if [ "${N:-0}" -gt 0 ] 2>/dev/null; then
                    # 自动下拉通知栏，让它立刻出现在屏幕上方
                    cmd statusbar expand-notifications >/dev/null 2>&1 || \
                        cmd statusbar expand-settings >/dev/null 2>&1 || true
                    echo "通知已发出并已展开通知栏" > "$TMP/out.txt"
                else
                    OK=0; EXITC=1
                    echo "通知没有进入系统通知列表，这条消息没送到" > "$TMP/err.txt"
                    echo "常见原因：这台手机的系统服务拒绝 root 发通知（ColorOS 通知管理 / KernelSU 环境问题），可重启手机再试；要稳定送达需要装提示 App" >> "$TMP/err.txt"
                fi
            fi
            ;;
        apps_list)
            : > "$TMP/out.txt"
            OK=0
            for ROUND in 1 2 3; do
                OUT=$(pm list packages -f 2>&1)
                case "$OUT" in
                    *"Failed transaction"*|*"Failure calling"*) sleep 1; continue ;;
                esac
                printf '%s\n' "$OUT" | while IFS= read -r line; do
                    case "$line" in package:*) ;; *) continue ;; esac
                    REST=${line#package:}
                    APK=${REST%=*}
                    PKG=${REST##*=}
                    [ -f "$APK" ] || continue
                    SZ=$(stat -c %s "$APK" 2>/dev/null)
                    echo "$PKG|$APK|$SZ"
                done > "$TMP/out.txt"
                OK=1
                break
            done
            [ "$OK" = "1" ] || { EXITC=1; echo "pm 不可用（Failed transaction）" > "$TMP/err.txt"; }
            ;;
        *)
            OK=0; EXITC=1; echo "不支持的指令: $CMD" > "$TMP/err.txt"
            ;;
    esac

    log "done $CMD ok=$OK exit=$EXITC fileId=$FILEID"
    post_result "$RID" "$OK" "$EXITC" "$DUR"
}

# ---------------------------------------------------------------- 主循环
run_loop() {
    log "agent start pid=$$ base=$BASE"
    register
    while true; do
        heartbeat
        LINE=$($CURL -s -m 28 "$BASE/api/agent/poll?$QUERY" 2>/dev/null)
        case "$LINE" in
            CMD\ *)
                set -- $LINE
                RID="$2"; T0=$(date '+%s')
                run_cmd "$3" "$4" "$5" "$6"
                DUR=$(( $(date '+%s') - T0 ))
                ;;
            ERR*)
                log "token 无效，退出"
                exit 1
                ;;
            *)
                sleep 2
                ;;
        esac
    done
}

# ---------------------------------------------------------------- 安装 / 守护
write_guard() {
    cat > "$GUARD" <<'GUARD_EOF'
#!/system/bin/sh
DIR=/data/adb/remoteagent
LOCK=$DIR/guard.lock
LOG=$DIR/agent.log
if [ -f "$LOCK" ]; then
    OLD=$(tr -d ' \n' < "$LOCK" 2>/dev/null)
    if [ -n "$OLD" ] && [ -r "/proc/$OLD/cmdline" ] && grep -q "guard.sh" "/proc/$OLD/cmdline" 2>/dev/null; then
        exit 0
    fi
fi
echo $$ > "$LOCK"
echo "$(date '+%Y-%m-%d %H:%M:%S') [guard] start pid=$$" >> "$LOG"
while true; do
    A=$(tr -d ' \n' < "$DIR/agent.lock" 2>/dev/null)
    ALIVE=0
    if [ -n "$A" ] && [ -r "/proc/$A/cmdline" ] && grep -q "agent.sh" "/proc/$A/cmdline" 2>/dev/null; then
        ALIVE=1
    fi
    if [ "$ALIVE" = "0" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [guard] agent dead -> respawn" >> "$LOG"
        ( trap '' HUP; sh "$DIR/agent.sh" run ) >/dev/null 2>&1 &
        sleep 3
    fi
    sleep 10
done
GUARD_EOF
    chmod 755 "$GUARD"

    cat > "$BOOT" <<'BOOT_EOF'
#!/system/bin/sh
sleep 20
( trap '' HUP; exec sh /data/adb/remoteagent/guard.sh ) >/dev/null 2>&1 < /dev/null &
BOOT_EOF
    chmod 755 "$BOOT"
}

# 彻底停止所有 agent / guard 进程（不依赖锁文件，锁文件可能已被清掉）
kill_all() {
    # 先收集自己的祖先链（父、祖父…），这些进程绝不杀，避免误伤调用方
    ANC=" $$ "
    _p=$PPID
    _n=0
    while [ -n "$_p" ] && [ "$_p" != "0" ] && [ "$_p" != "1" ] && [ "$_n" -lt 12 ]; do
        ANC="$ANC$_p "
        _p=$(sed -n 's/^PPid:[[:space:]]*//p' "/proc/$_p/status" 2>/dev/null)
        _n=$((_n + 1))
    done

    for d in /proc/[0-9]*; do
        pid=${d#/proc/}
        case "$pid" in *[!0-9]*) continue ;; esac
        [ "$pid" = "$$" ] && continue
        case "$ANC" in *" $pid "*) continue ;; esac
        c=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null) || continue
        case "$c" in
            # 跳过本次调用本身及其子 shell（它们继承了相同命令行）
            *"$0 install"*|*"$0 stop"*|*"$0 status"*|*"$0 uninstall"*|*"$0 kick"*) continue ;;
            *agent.sh*|*guard.sh*|*remoteagent/daemon.sh*)
                echo "  停止残留进程 pid=$pid"
                kill -9 "$pid" 2>/dev/null
                ;;
        esac
    done
    rm -f "$DIR/guard.lock" "$DIR/agent.lock"
}

do_install() {
    if [ "$(id -u)" != "0" ]; then echo "需要 root：su -c \"sh $0 install\""; exit 1; fi
    MY=$(readlink -f "$0" 2>/dev/null); [ -z "$MY" ] && MY="$0"
    # 关键：如果当前脚本本来就在目标位置（注入脚本先下载到 $DIR 再执行），
    # 绝对不能 cp 到自己身上 —— shell 会先截断目标，导致脚本变成 0 字节。
    if [ "$MY" != "$DIR/agent.sh" ]; then
        cp "$MY" "$DIR/agent.sh" 2>/dev/null || cat "$MY" > "$DIR/agent.sh"
    fi
    chmod 755 "$DIR/agent.sh"
    # 顺手修好被旧版本清空的文件
    if [ ! -s "$DIR/agent.sh" ]; then
        echo "错误：$DIR/agent.sh 是空文件，请重新下载后再执行" >&2
    fi
    [ -f "$CONF" ] || printf 'BASE=%s\n' "$BASE" > "$CONF"
    write_guard
    # 清理 App 时代遗留的守护脚本（它会每 30 秒 am 拉起一个已经卸载的 App）
    rm -f "$DIR/daemon.sh" "$DIR/daemon.lock"

    # 停掉所有旧进程（关键：旧进程内存里还是老代码，不杀光会出现新旧两个 agent 抢指令）
    kill_all
    # background 启动守护（不用 nohup）
    ( trap '' HUP; exec sh "$GUARD" ) </dev/null >/dev/null 2>&1 &
    sleep 3
    # 如果手机上还装着 App，两条通道会同时在线，指令可能被 App 抢走
    if pm list packages com.dsha.remoteagent 2>/dev/null | grep -q com.dsha.remoteagent; then
        echo ""
        echo "⚠ 检测到还装着「远程运维 Agent」App。"
        echo "  纯脚本模式建议把 App 停用或卸载，否则 App 的 WebSocket 会优先收到指令："
        echo "    pm uninstall com.dsha.remoteagent"
        echo ""
    fi
    do_status
}

do_status() {
    echo "---- 状态 ----"
    A=$(tr -d ' \n' < "$DIR/agent.lock" 2>/dev/null)
    G=$(tr -d ' \n' < "$DIR/guard.lock" 2>/dev/null)
    # 统计真实在跑的实例数：不是 1 就说明有残留（会导致指令被旧进程抢走）
    RUNNING=0
    for d in /proc/[0-9]*; do
        pid=${d#/proc/}
        case "$pid" in *[!0-9]*) continue ;; esac
        [ "$pid" = "$$" ] && continue
        c=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null) || continue
        case "$c" in
            *agent.sh*run*) RUNNING=$((RUNNING + 1)) ;;
        esac
    done
    echo "agent pid : ${A:-未运行}   guard pid : ${G:-未运行}"
    echo "运行实例  : ${RUNNING} 个（正常应为 1；大于 1 就是有残留进程，先 stop 再 install）"
    echo "服务地址  : $BASE"
    echo "设备 token: $TOKEN"
    echo "开机自启  : $([ -f "$BOOT" ] && echo 已安装 || echo 未安装)"
    echo "---- 最近日志 ----"
    tail -10 "$LOG" 2>/dev/null || echo "（暂无日志）"
}

do_stop() {
    kill_all
    echo "已停止"
}

case "${1:-run}" in
    run)
        echo $$ > "$DIR/agent.lock"
        run_loop
        ;;
    install)    do_install ;;
    status)     do_status ;;
    stop)       do_stop ;;
    uninstall)  do_stop; rm -rf "$DIR" "$BOOT"; echo "已卸载（App 不受影响）" ;;
    *)
        echo "用法: sh $0 {run|install|status|stop|uninstall}"
        exit 1
        ;;
esac
