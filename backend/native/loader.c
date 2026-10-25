/*
 * 通用加载器（Android arm64）
 *
 * 自身尾部追加了一段数据：
 *   MAGIC | keyLen(4) | key | dataLen(4) | cipher
 * 运行时读出自身，找到 MAGIC，用 key 逐字节异或还原脚本，然后交给 /system/bin/sh 执行。
 *
 * 注意：这是防「顺手查看」的混淆，不是密码学安全。能拿到文件的人总有办法还原。
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static const char MAGIC[] = "\n===PAYLOAD===\n";

int main(int argc, char **argv) {
    char self[4096];
    ssize_t n = readlink("/proc/self/exe", self, sizeof(self) - 1);
    if (n <= 0) {
        snprintf(self, sizeof(self), "%s", argv[0]);
    } else {
        self[n] = 0;
    }

    FILE *f = fopen(self, "rb");
    if (!f) {
        perror("open self");
        return 1;
    }
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (sz <= 0) return 1;

    unsigned char *buf = (unsigned char *)malloc((size_t)sz);
    if (!buf) return 1;
    if (fread(buf, 1, (size_t)sz, f) != (size_t)sz) {
        fclose(f);
        return 1;
    }
    fclose(f);

    long mlen = (long)strlen(MAGIC);
    long pos = -1;
    for (long i = sz - mlen; i >= 0; i--) {
        if (memcmp(buf + i, MAGIC, (size_t)mlen) == 0) {
            pos = i;
            break;
        }
    }
    if (pos < 0) {
        fprintf(stderr, "bad payload\n");
        return 2;
    }

    unsigned char *p = buf + pos + mlen;
    unsigned int klen = 0;
    memcpy(&klen, p, 4);
    p += 4;
    if (klen == 0 || klen > 256) return 2;
    unsigned char *key = p;
    p += klen;
    unsigned int dlen = 0;
    memcpy(&dlen, p, 4);
    p += 4;
    if (dlen == 0 || dlen > 4 * 1024 * 1024) return 2;

    char *script = (char *)malloc(dlen + 1);
    if (!script) return 1;
    for (unsigned int i = 0; i < dlen; i++) {
        script[i] = (char)(p[i] ^ key[i % klen]);
    }
    script[dlen] = 0;

    /* 通过环境变量传脚本，避免超长参数问题 */
    setenv("__RS", script, 1);
    execl("/system/bin/sh", "sh", "-c", "eval \"$__RS\"", (char *)NULL);
    perror("exec sh");
    return 3;
}
