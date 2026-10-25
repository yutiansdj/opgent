#!/bin/sh
# 重新编译 Android arm64 静态加载器
#
# 依赖：musl 交叉工具链（https://musl.cc/aarch64-linux-musl-cross.tgz）
#   tar -xzf aarch64-linux-musl-cross.tgz -C /opt/musl-cross --strip-components=1
#
# 为什么用 musl 而不是 glibc：
#   Android 的 C 库是 bionic，静态 glibc 程序在部分 Android 上会 Segmentation fault。
#   musl 静态可执行文件在 Android 上通用（静态 busybox 就是用 musl 编的）。
set -e
cd "$(dirname "$0")"
/opt/musl-cross/bin/aarch64-linux-musl-gcc -Os -static -no-pie -s -o ../assets/loader_a64 loader.c
echo "已生成 ../assets/loader_a64"
file ../assets/loader_a64
