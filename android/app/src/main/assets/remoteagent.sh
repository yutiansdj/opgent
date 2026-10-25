#!/system/bin/sh
# 远程运维 Agent —— 开机自启入口
# 安装路径：/data/adb/service.d/remoteagent.sh
# Magisk / KernelSU 会在开机时以 root 执行该目录下的所有 .sh 脚本。

DIR=/data/adb/remoteagent

# 等系统服务（ActivityManager）就绪，太早执行 am 会失败
sleep 20

# 不用 nohup（部分 Android 没有），用 subshell + 重定向让子进程脱离当前会话
( trap '' HUP; exec sh "$DIR/guard.sh" ) >/dev/null 2>&1 < /dev/null &
