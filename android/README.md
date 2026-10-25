# 远程运维 Agent（Android 客户端）

远程安卓设备运维平台的原生 Agent，包名 `com.dsha.remoteagent`，应用名「远程运维 Agent」。
Kotlin + 传统 View + Material 3 + ViewBinding；OkHttp WebSocket；kotlinx-coroutines；SQLite 本地日志。

## 构建

```bash
source /opt/android-sdk/env.sh
cd /sdcard/dsha/remote-ops/android
gradle assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

- compileSdk / targetSdk = 36，minSdk = 31（Android 12 ~ 16）
- `gradle.properties` 保留本机 aapt2 qemu 包装路径与 1536m 内存配置
- 依赖全部命中 `/opt/gradle-home` 缓存（appcompat / material / constraintlayout /
  recyclerview / fragment-ktx / coroutines / okhttp）

## 代码结构

```
com.dsha.remoteagent
├── App.kt                    全局配置 / 日志库
├── MainActivity.kt           4 页底部导航容器
├── data/                     配置（SharedPreferences）、SQLite 日志、设备信息
├── root/RootShell.kt         su -c 执行、stdout/stderr 双线程、超时
├── daemon/DaemonInstaller.kt 守护脚本安装 / 启停 / 卸载
├── net/BackendApi.kt         注册、文件上传/下载
├── net/AgentWebSocketClient.kt 长连接、hello、心跳、指令分发、指数退避重连
├── service/AgentService.kt   前台服务（specialUse）、网络监听
├── service/CommandExecutor.kt 指令实现
├── service/BootReceiver.kt   开机自启
└── ui/                       主页 / 日志 / 设置 / 权限
```

## 协议

严格按 `docs/API.md` §9 与 §3.2：

- WS：`ws://<host>/ws/agent?token=<deviceToken>`
- 连上发 `hello`；每 N 秒（默认 15s）发 `heartbeat`
- 收 `command` / `pull_file`，执行后回 `result`
- 文件回传：`download` 指令 → `POST /api/files/upload?token=...`（multipart 字段 `file`）
- 文件下发：`GET /api/files/:fileId/raw?token=...`

支持指令：`screen_on`、`screen_off`、`reboot`、`shutdown`、`shell`、`screenshot`、
`camera`（前置/后置拍照，Camera2）、`open_app`、`uninstall_app`、`download`，
以及 WS 消息 `pull_file`（save / install）。

### 相机权限

远程拍照用的是 **App 自己的相机权限**（不是 root）：装好后打开一次 App，系统会弹
相机授权，允许即可；也可以在「设置 → 应用 → 远程运维 Agent → 权限」里手动给。
被拒绝时远程拍照会返回“没有相机权限”，其它功能不受影响。

## 守护脚本

安装到设备（需 Root）：

| 路径 | 作用 |
|---|---|
| `/data/adb/remoteagent/daemon.sh` | 每 8s 检查 `AgentService` 记录，失活用 `am start-foreground-service -n com.dsha.remoteagent/.service.AgentService` 拉起（pidfile 防多实例） |
| `/data/adb/remoteagent/guard.sh` | 每 10s 检查 daemon.sh，失活则重启（双层守护） |
| `/data/adb/service.d/remoteagent.sh` | 开机自启，`nohup sh /data/adb/remoteagent/guard.sh &` |

App 主页「启动守护」= 安装 + 启动 guard；「停止守护」「卸载守护脚本」在主页下半部分。

## 使用

1. 打开 App，在「权限」页授予通知、关闭电池优化、授予 Root。
2. 首次启动会用安装时写入的默认后端地址连接；如需更换，在「设置」页修改并保存（留空则继续使用默认服务器）。
3. 回到「主页」启动前台服务，或点击「启动守护」由 root 常驻。
4. 后端设备列表出现该设备后即可下发指令。

## 注意事项

- 需要 Root 才能执行 shell / 截图 / 文件读写 / 守护脚本；无 Root 时服务仍可连接并上报状态。
- 本地日志最多保留最近 300 条展示（DB 不自动清理，可在日志页清空）。
- 高危操作（重启 / 关机）在 App 本地触发时会二次确认；后端下发的同类指令按契约直接执行。
