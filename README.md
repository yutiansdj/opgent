# 远程安卓设备运维平台

一套自建的远程安卓设备运维系统：**Vue3 运维后台 + Node 后端 + 安卓 Agent（App / 纯 shell 两种）**，
用于异地协助、运维 Android 12 ~ 16 的设备（典型场景：帮家里老人操作手机、检查手机状态）。

> ⚠️ **合规提示**
> 本系统仅可用于**你本人拥有、或已获得设备所有者明确授权**的设备。
> 未经同意远程查看/操作他人设备，可能触犯隐私与相关法律，请自行承担使用责任。

---

## 一、能做什么

**Web 后台（浏览器，手机也能开）**

| 模块 | 说明 |
|---|---|
| 登录 / 权限 | JWT 会话；超级管理员 + 普通运维两级；7 个可勾选权限点 |
| 仪表盘 | 在线/离线统计、7 天指令量图表、最近操作、快捷入口 |
| 设备管理 | 搜索筛选分页、设备详情、备注、删除记录 |
| 远程指令 | 点亮/熄屏、重启、关机、自定义 Shell、截图预览、打开/卸载应用 |
| 文件管理 | 浏览目录、新建/重命名/删除、上传文件到手机、从手机下载、APK 安装 |
| 应用管理 | 应用列表（含图标、版本、APK 路径）、批量卸载 |
| 相册 | 按目录浏览照片、缩略图、原图查看与下载 |
| 远程触控 | 点按 / 滑动 / 按键 / 文本输入，配合截图实时操作 |
| 通知推送 | 给手机发一条通知并自动下拉通知栏（老人一眼能看到） |
| 远程拍照 | 前置 / 后置摄像头拍一张照片回传（需 App 版 Agent） |
| 命令模板 | 增删改 + 一键批量下发 |
| 批量任务 | 多设备下发、进度与逐设备结果 |
| 日志 | 全局筛选/搜索/导出 CSV、按保留天数自动清理 |
| 项目管理 | 上传脚本、每项目独立 token、一键注入手机、查看运行结果 |
| 脚本加密 | 自研置换表加密 + 二进制载荷两种模式 |
| 设备共享 | 把某台设备按只读/可控共享给其他账号 |
| 多语言对接 | C++ / Java / Kotlin / Python / Go / Node / C# 接入样例 |

**安卓 Agent**

- 前台 Service 常驻，WebSocket 指数退避重连、网络恢复重连、心跳
- root 守护：`daemon.sh` + `guard.sh` 双层守护 + `/data/adb/service.d` 开机自启
- 纯 shell 版 Agent：不装 App 也能用（root 即可），覆盖除相机以外的全部指令
- App 版 Agent：支持相机拍照、更稳的通知与前台服务保活

## 二、目录结构

```
remote-ops/
├── install.sh              # 一键安装脚本（服务器上 root 执行）
├── INSTALL.md              # 安装细节 / 手动部署 / 常见问题
├── README.md               # 本文件
├── docs/API.md             # 三端唯一接口契约（改接口先改这里）
├── backend/                # Node 后端（Express + ws + node:sqlite，零原生依赖）
│   ├── src/server.js       # 入口：HTTP + WebSocket + 静态托管
│   ├── src/routes/*.js     # 各业务路由
│   ├── src/hub.js          # WS 连接池 + 指令请求/应答关联
│   ├── src/shell.js        # 纯 shell Agent 的长轮询通道
│   ├── src/exec.js         # 指令执行 + 日志落库的统一出口
│   ├── src/batch.js        # 批量任务调度
│   ├── assets/agent.sh     # 纯 shell 版 Agent（下发到手机的那份）
│   └── test/e2e.mjs        # 端到端自测（模拟 Agent）
├── web/                    # Vue3 + NaiveUI + Pinia + Tailwind 运维后台
├── android/                # 安卓 App 版 Agent（Kotlin + Camera2）
├── deploy/                 # deploy.sh / nginx.conf / remote-ops.service
└── agent-app/              # 预编译的 App 版 Agent（debug 包）
```

## 三、环境要求

| 项 | 要求 |
|---|---|
| 服务器 | Debian/Ubuntu（全新机器即可），root 权限，80/443 端口可访问 |
| Node | 18+（`install.sh` 会自动装 Node 20/24 LTS） |
| 数据库 | 不需要，用 Node 内置 `node:sqlite` |
| 手机端 | Android 12 ~ 16；shell 版需要 root（KernelSU / Magisk） |
| 浏览器 | Chrome / Edge / Safari 现代版本 |

## 四、一键安装

把压缩包上传到服务器（或用 `scp` 传），然后：

```bash
unzip remote-ops-*.zip
cd remote-ops
bash install.sh
```

脚本会依次完成：

1. 检查并安装系统依赖（nginx / openssl / curl / ca-certificates）
2. 没装 Node 就自动下载安装 Node LTS
3. 把后端、前端、Agent 脚本拷到 `/opt/remote-ops`
4. `npm install --omit=dev` 安装后端依赖
5. 生成 10 年有效的自签证书（`/etc/nginx/ssl/`）
6. 写入 systemd 服务并启动后端
7. 写入 Nginx 配置（HTTP + HTTPS + WebSocket 反代）
8. 健康检查，打印访问地址与默认账号

装完浏览器打开 `http://<服务器地址>/` 即可。

### 常用可选参数

```bash
PUBLIC_BASE=https://你的域名   # 对外地址（默认用本机公网 IP）
HTTP_PORT=80                  # HTTP 端口
HTTPS_PORT=443                # HTTPS 端口
INSTALL_DIR=/opt/remote-ops   # 安装目录
SKIP_CERT=1                   # 不自签证书（已有证书时）
SKIP_SYSTEMD=1                # 只拷文件，不装服务（调试用）
```

示例：

```bash
PUBLIC_BASE=https://你的域名 bash install.sh
```

`install.sh` 是**幂等**的，升级时直接重跑即可（数据库会保留）。

## 五、第一次使用

1. 浏览器打开后台，用安装日志里打印的默认管理员账号登录
2. **立刻到「系统设置」改密码**
3. 到「用户管理」建普通运维账号，按需勾权限
4. 到「项目管理」建项目，拿到项目 token，下载注入脚本
5. 把脚本发到手机上执行，设备就会自动出现在「设备管理」里

## 六、接入一台手机

### 方式一：纯 shell Agent（不装 App，推荐先用这个）

手机需要 root（KernelSU / Magisk 均可）。把 `backend/assets/agent.sh` 传到手机
（例如放到 `Download/`），然后：

```bash
su
sh /sdcard/Download/agent.sh install
```

- 安装位置：`/data/adb/remoteagent/`，日志 `agent.log`
- 管理命令：`sh agent.sh status` / `stop` / `uninstall`
- 服务器地址写在 `/data/adb/remoteagent/config`，一般不用改

### 方式二：App 版 Agent（要拍照就用这个）

把 `agent-app/` 里的 APK 传到手机安装，打开后点「启动」，按提示给通知权限和
**相机权限**。App 版除了 shell 版的全部能力，还能：

- 远程拍照（前置/后置，Camera2，拍一帧就释放相机）
- 更稳的前台服务和通知通道

> shell 版和 App 版可以同时装，会显示成两条设备记录，按需使用。
> 拍照只在 App 那条上面可用。

## 七、配置与数据

| 内容 | 位置 |
|---|---|
| 后端代码 | `/opt/remote-ops/backend` |
| 前端静态 | `/opt/remote-ops/web` |
| 数据库 | `/opt/remote-ops/backend/data/app.db` |
| 上传文件 | `/opt/remote-ops/backend/data/uploads` |
| Agent 脚本 | `/opt/remote-ops/backend/assets/agent.sh` |
| 服务单元 | `/etc/systemd/system/remote-ops.service` |
| Nginx 配置 | `/etc/nginx/sites-available/remote-ops` |

常用运维命令：

```bash
systemctl status remote-ops      # 看状态
systemctl restart remote-ops     # 重启后端
journalctl -u remote-ops -f      # 看日志
nginx -t && systemctl reload nginx
```

## 八、安全须知

- 默认账号密码务必第一时间修改；普通账号按最小权限分配
- 证书是自签的，浏览器会提示风险，点继续即可；有域名建议换正式证书
- 设备 token 等同于设备身份，泄露即可被下发指令，注意保管
- 截图/照片都是按需单次回传，服务器默认不落盘
- 公网部署建议再加一层：只放行自己的 IP、或套一层反向代理/白名单

## 九、升级与卸载

升级（保留数据）：

```bash
# 解压新包后，在原目录重跑即可
bash install.sh
```

卸载：

```bash
systemctl disable --now remote-ops
rm -f /etc/systemd/system/remote-ops.service
rm -f /etc/nginx/sites-available/remote-ops /etc/nginx/sites-enabled/remote-ops
systemctl restart nginx
rm -rf /opt/remote-ops          # 数据在 /opt/remote-ops/backend/data，删前先备份
```

手机端卸载（shell 版）：

```bash
su
sh /sdcard/Download/agent.sh uninstall
```

## 十、常见问题

**Q：后台能打开，但设备一直离线？**
先确认手机能访问服务器（有些网络会拦非常规端口），再看 `/data/adb/remoteagent/agent.log`
里的报错；`su` 下执行 `sh agent.sh status` 会打印当前状态与最近的日志。

**Q：截图失败 / 提示 screencap 未产出文件？**
常见于安全保护页面（支付、密码输入）或 root 未授权。换一个页面再试。

**Q：发通知没反应？**
部分机型（尤其装了 hook system_server 的模块）会拒绝 root 发通知，返回
`Failed transaction`。后台会回读系统通知列表校验，发不出去会直接报错。
需要稳定送达时用 App 版 Agent。

**Q：远程拍照报「需要 App 版 Agent」？**
相机在 Android 12+ 必须由应用身份调用，纯 shell 做不到，装 App 版即可。

**Q：`pm install` 报 Failed transaction？**
某些 ROM/模块环境下包管理服务不可用，可先用「上传文件到手机」把 APK 传到
`/sdcard/Download/`，再在手机上手动安装。

**Q：手机重启后 Agent 没起来？**
shell 版靠 `/data/adb/service.d` 自启，确认该目录存在且脚本有执行权限；
App 版需要给「自启动」和「后台运行」权限，部分国产 ROM 还要加电池白名单。

**Q：忘记管理员密码？**

在服务器上直接改库（把 `新密码` 换成你要的，`admin` 是账号）：

```bash
cd /opt/remote-ops/backend
node -e "const c=require('node:crypto');const s=c.randomBytes(16).toString('hex');
const h=c.scryptSync('新密码',s,64).toString('hex');
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/app.db');
db.prepare('UPDATE users SET password_hash=? WHERE username=?').run('scrypt$'+s+'$'+h,'admin');
console.log('已重置');"
```

改完不用重启，直接登录即可。

实在不行：停服 → 备份 `data/app.db` → 删掉它 → 重启服务，会重新生成默认管理员
（设备和日志会一起丢，删之前务必先备份）。

---

## 附：二次开发

- 前端：`cd web && npm install --no-bin-links && node node_modules/vite/bin/vite.js build`
- 后端：改完直接 `systemctl restart remote-ops`（Node 无需编译）
- 安卓：`cd android && ./gradlew assembleDebug`（或系统 gradle），产物在
  `android/app/build/outputs/apk/debug/`
- 接口约定：先改 `docs/API.md`，再三端对齐
- 回归测试：`cd backend && node test/e2e.mjs`（会起一个模拟 Agent 跑完整链路）
