# 安装说明

面向：一台**全新的 Linux 服务器**（Debian 11/12、Ubuntu 20.04+）。
装完后你在浏览器里管理手机，手机通过一个 shell 脚本接进来。

---

## 一、环境要求

| 项目 | 要求 | 说明 |
|---|---|---|
| 系统 | Debian 11+ / Ubuntu 20.04+ | 其他发行版需自行装 nginx/openssl |
| CPU 架构 | x86_64 或 arm64 | 安装脚本两种都支持 |
| 内存 | ≥ 1 GB | 前端静态托管 + Node 后端，很轻 |
| Node.js | **≥ 22**（推荐 24） | 后端用了 Node 内置的 `node:sqlite`，低版本没有 |
| 端口 | 80 / 443 | 云服务器记得在**安全组**放行 |
| 磁盘 | ≥ 2 GB | 依赖约 200MB，其余是缓存 |

> 手机端要求：**已 root**（KernelSU / Magisk），Android 12+。

---

## 二、快速安装（推荐）

```bash
# 1. 上传并解压
scp remote-ops-src-*.tar.gz root@你的服务器:/root/
ssh root@你的服务器
tar -xzf /root/remote-ops-src-*.tar.gz -C /root
cd /root/remote-ops

# 2. 一键安装（会自动装 nginx / Node 24 / 依赖 / 服务）
bash install.sh

# 3.（可选）指定对外地址，默认自动探测公网 IP
PUBLIC_BASE=https://1.2.3.4 bash install.sh
```

安装完成后终端会打印：

```
后台地址 : https://1.2.3.4
默认账号 : admin
默认密码 : admin123
```

浏览器打开即可登录。**第一件事：改密码。**

---

## 三、可配置项

安装时用环境变量覆盖：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PUBLIC_BASE` | `https://<公网IP>` | Agent 和注入脚本回连的地址，**必须能被手机访问** |
| `HTTP_PORT` | `80` | HTTP 端口 |
| `HTTPS_PORT` | `443` | HTTPS 端口 |
| `INSTALL_DIR` | `/opt/remote-ops` | 安装目录 |
| `SKIP_CERT` | `0` | 设为 1 用你自己的证书（放 `/etc/nginx/ssl/remote-ops.crt/.key`） |
| `NODE_VER` | `v24.19.0` | 自动安装 Node 时使用的版本 |

例：

```bash
PUBLIC_BASE=https://ops.example.com HTTP_PORT=8080 SKIP_CERT=1 bash install.sh
```

---

## 四、手工安装（想自己控制每一步）

```bash
# 1) 依赖
apt-get update && apt-get install -y nginx openssl curl rsync

# 2) Node 24（以 x64 为例，arm64 把 x64 换成 arm64）
curl -O https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz
tar -xJf node-v24.19.0-linux-x64.tar.xz -C /usr/local
ln -sf /usr/local/node-v24.19.0-linux-x64/bin/node /usr/local/bin/node
ln -sf /usr/local/node-v24.19.0-linux-x64/bin/npm  /usr/local/bin/npm

# 3) 后端
mkdir -p /opt/remote-ops
rsync -a backend/ /opt/remote-ops/backend/
rsync -a web/dist/ /opt/remote-ops/web/
cd /opt/remote-ops/backend && npm install --omit=dev

# 4) 启动
node src/server.js          # 前台试跑，确认无报错后 Ctrl+C

# 5) 交给 systemd / nginx
#    直接参考 install.sh 里第 7、8 步生成的两个配置文件
```

---

## 五、手机端接入

### 方式 A：项目注入（推荐）

1. 后台 →「项目管理」→ 新建项目
2. 上传或粘贴你的 `.sh`（可选：静默、加密、二进制）
3. 保存后：
   - 点 **「下载脚本」** → 得到 `项目名-inject.sh`，传到手机上执行：
     ```bash
     su
     sh /sdcard/Download/项目名-inject.sh
     ```
   - 或点 **「一键注入」**，选在线设备 —— 后台会推送并执行
4. 手机跑完后会自动连上，在「设备管理」里出现

### 方式 B：直接装 agent

```bash
su
sh /sdcard/Download/agent.sh install
```

（`agent.sh` 可从服务器 `$INSTALL_DIR/backend/assets/agent.sh` 取，或从项目的注入脚本里自动下载）

---

## 六、升级

```bash
cd /root/remote-ops          # 新版本的源码目录
bash install.sh              # 幂等，直接覆盖升级
```

数据（设备、项目、日志）在 `$INSTALL_DIR/backend/data/`，升级不会动。

> 升级前建议备份：
> ```bash
> cp /opt/remote-ops/backend/data/app.db /root/app.db.bak.$(date +%s)
> ```

---

## 七、卸载

```bash
systemctl disable --now remote-ops nginx
rm -f /etc/systemd/system/remote-ops.service
rm -f /etc/nginx/sites-available/remote-ops /etc/nginx/sites-enabled/remote-ops
rm -rf /opt/remote-ops
# 手机端
su -c "sh /data/adb/remoteagent/agent.sh uninstall"
```

---

## 八、常见问题

**Q：打不开页面**

1. 云厂商**安全组**是否放行 80/443
2. `systemctl status nginx remote-ops`
3. `journalctl -u remote-ops -n 50`

**Q：浏览器提示"证书不受信任"**

自签证书必然提示，点「继续前往」即可。要彻底解决需绑定域名 + Let's Encrypt：

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d 你的域名
```
然后 `PUBLIC_BASE=https://你的域名 bash install.sh` 重跑一次，让 Agent 也用正式证书。

**Q：`npm install` 卡在 sharp**

sharp 需要下载预编译二进制。国内服务器可换镜像：

```bash
cd /opt/remote-ops/backend
npm config set registry https://registry.npmmirror.com
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install
```

装不上也不影响主体功能——相册缩略图会退回直接返回原图。

**Q：手机连不上，后台一直是离线**

1. 手机上 `cat /data/adb/remoteagent/agent.log` 看日志
2. `cat /data/adb/remoteagent/config` 确认 `BASE=` 指向正确地址
3. 确认手机能访问 `PUBLIC_BASE`：`curl -k $PUBLIC_BASE/api/health`

**Q：`pm` 命令报 `Failed transaction`**

部分机器上 LSPosed / zygisk 类模块会让 Android 的 `pm`/`am` 不可用，
表现为装不了/卸不了 APK。装/卸请改用系统设置界面或 `adb install`。

**Q：二进制模式跑不了（Segmentation fault）**

二进制加载器是用 **musl** 静态编译的（不是 glibc）。如果仍失败：
1. 确认设备是 **arm64**（`uname -m`）
2. 该文件不能放在 `/sdcard`（noexec），要拷到 `/data/local/tmp` 再执行
3. 实在不行用「加密」模式（`.sh` 文件），不依赖执行权限

---

## 九、目录速查

| 路径 | 内容 |
|---|---|
| `$INSTALL_DIR/backend` | 后端代码 |
| `$INSTALL_DIR/backend/data/app.db` | 数据库（设备/项目/日志） |
| `$INSTALL_DIR/backend/data/uploads` | 上传文件缓存 |
| `$INSTALL_DIR/backend/data/photo-cache` | 相册缓存 |
| `$INSTALL_DIR/backend/assets/agent.sh` | 下发给手机的 agent |
| `$INSTALL_DIR/backend/assets/loader_a64` | 二进制加载器（arm64） |
| `$INSTALL_DIR/web` | 前端静态文件 |
| `$INSTALL_DIR/app` | 公开脚本目录（`/app/xxx.sh`） |
| `/etc/systemd/system/remote-ops.service` | 后端服务 |
| `/etc/nginx/sites-available/remote-ops` | Nginx 配置 |
| `/etc/nginx/ssl/remote-ops.crt` | 自签证书 |
