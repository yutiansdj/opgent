# 远程安卓设备运维平台 —— 接口契约 v1

三端唯一事实来源（Web 后台 / Node 后端 / 安卓 Agent 都按本文实现）。

- 后端监听：`http://0.0.0.0:8787`
- HTTP 前缀：`/api`
- 鉴权：除 `/api/auth/login` 外，全部要求请求头 `Authorization: Bearer <JWT>`
- 统一 JSON 返回：
  - 成功：`{"ok":true,"data":<any>}`
  - 失败：`{"ok":false,"error":{"code":"...","message":"..."}}`
  - HTTP 状态码同步（400/401/403/404/409/500）
- 时间一律为 **ISO8601 字符串**（如 `2025-01-01T12:00:00.000Z`），前端自行格式化。

## 0. 角色与权限

`role`: `super` | `op`

权限点 `permissions`（字符串数组），页面级判权用这 7 个：

| key | 含义 |
|---|---|
| `dashboard` | 仪表盘 |
| `devices` | 设备管理 |
| `templates` | 命令模板 |
| `tasks` | 批量任务 |
| `logs` | 操作日志 |
| `users` | 用户管理（仅 super） |
| `settings` | 系统设置 |

`super` 默认拥有全部权限且不可被剥夺 `users`。`op` 由超管勾选分配。

## 1. 认证

### POST /api/auth/login
```json
// req
{"username":"admin","password":"admin123"}
// res.data
{"token":"eyJ...","expiresAt":"ISO","user":{"id":1,"username":"admin","role":"super","permissions":["dashboard","devices","templates","tasks","logs","users","settings"]}}
```
失败：401 `{"code":"BAD_CREDENTIALS","message":"账号或密码错误"}`；禁用账号 403 `ACCOUNT_DISABLED`。

### GET /api/auth/me → `user`
### POST /api/auth/logout → `{"ok":true}`
### POST /api/auth/password
```json
{"oldPassword":"x","newPassword":"y"}   // newPassword 长度>=6
```
→ `{"ok":true}`

## 2. 仪表盘

### GET /api/dashboard/overview
```json
{
  "devices":{"total":3,"online":2,"offline":1},
  "logChart":[{"date":"01-01","count":12}],   // 近7天，按天
  "recentLogs":[{"id":1,"username":"admin","deviceName":"奶奶的手机","command":"点亮屏幕","status":"success","createdAt":"ISO"}],
  "todayCommands": 45
}
```

## 3. 设备

Device 对象：
```json
{
  "id":"dev_xxx","name":"奶奶的手机","token":"dt_xxx",
  "model":"OnePlus PLR110","androidVersion":"16","rootStatus":"granted",
  "ip":"10.0.0.8","battery":50,"network":"wifi",
  "online":true,"lastSeenAt":"ISO","note":"客厅","createdAt":"ISO",
  "deviceUid":"android_id 或序列号"
}
```

- `GET /api/devices?page=1&pageSize=10&keyword=&online=` → `{"list":[...],"total":n,"page":1,"pageSize":10}`
  - `keyword` 模糊匹配 name/model/id；`online` 传 `1`/`0` 可选
- `GET /api/devices/:id` → Device
- `PATCH /api/devices/:id` body `{name?,note?}` → Device
- `DELETE /api/devices/:id` → `{"ok":true}`

### 3.1 下发指令（同步等待 agent 结果，最长 35s）
`POST /api/devices/:id/command`
```json
{"type":"shell","params":{"command":"ls /sdcard"}}
```
`type` 取值与 params：

| type | params | 说明 |
|---|---|---|
| `screen_on` | `{}` | 点亮屏幕 |
| `screen_off` | `{}` | 熄屏 |
| `reboot` | `{}` | 重启（立即返回 accepted，不等结果） |
| `shutdown` | `{}` | 关机（同上） |
| `shell` | `{"command":"..."}` | 自定义 shell，需要 root |
| `screenshot` | `{}` | 截图，返回 `data.image` = base64 PNG |
| `camera` | `{"facing":"front"\|"back"}` | 远程拍照，返回 `data.image` = `data:image/jpeg;base64,...`；只有 App 版 Agent 支持 |
| `open_app` | `{"packageName":"com.tencent.mm"}` | 打开应用 |
| `uninstall_app` | `{"packageName":"..."}` | 卸载应用 |

响应 `data`：
```json
{"requestId":"r_xxx","status":"success|failed|timeout","stdout":"...","stderr":"...",
 "exitCode":0,"durationMs":123,"image":"data:image/png;base64,...", "accepted":false}
```
- 设备离线：409 `{"code":"DEVICE_OFFLINE"}`
- 超时：`status:"timeout"`（HTTP 200，便于前端统一处理）

### 3.2 文件
- `POST /api/devices/:id/upload`（`multipart/form-data`：`file`、`targetPath`）→ `{"ok":true,"path":"/sdcard/x.apk","size":123}`
  - 后端存文件 → 通过 WS 通知 agent 拉取 → agent 下载并写入 `targetPath`
- `POST /api/devices/:id/install_apk`（`multipart/form-data`：`file`）→ `{"stdout":"","stderr":"","status":"success"}`
- `GET /api/devices/:id/download?path=/sdcard/a.log` → `{"fileId":"f_xxx","name":"a.log","size":1024}`
  - 机制：后端下发 `{"type":"command","cmd":"download","params":{"path":"..."}}`；
    agent 用 **`POST /api/files/upload?token=<deviceToken>`**（multipart，字段 `file`）把文件回传到后端，
    拿到 `fileId` 后在 `result` 里带回；后端据此返回上面的 JSON。
  - 随后 `GET /api/files/:fileId/download` 返回二进制（此接口同样需要 Bearer）
- **Agent 上传接口**：`POST /api/files/upload?token=<deviceToken>`（`multipart/form-data` 字段 `file`）
  → `{"ok":true,"data":{"fileId":"f_x","name":"a.log","size":123}}`
- `GET /api/devices/:id/logs?page&pageSize` → 该设备的日志分页（结构同 §6）

- `POST /api/devices/register`（无需管理员 JWT，用于首次接入）
  ```json
  {"deviceUid":"xxx","name":"奶奶的手机","token":"dt_可选"}
  ```
  → Device（token 不存在则新建）

## 4. 命令模板

Template：`{"id":"t_x","name":"查看存储","command":"df -h","description":"","createdBy":"admin","createdAt":"ISO"}`

- `GET /api/templates` → `{"list":[...]}`（不分页）
- `POST /api/templates` `{name,command,description}`
- `PUT /api/templates/:id`
- `DELETE /api/templates/:id`
- `POST /api/templates/:id/run` `{"deviceIds":["dev_1"]}` → 等价于创建批量任务，返回 `{"taskId":"b_x"}`

## 5. 批量任务

- `POST /api/tasks`
  ```json
  {"deviceIds":["dev_1","dev_2"],"type":"shell","params":{"command":"df -h"},"name":"可选"}
  ```
  → `{"taskId":"b_x"}`
- `GET /api/tasks?page&pageSize` →
  ```json
  {"list":[{"id":"b_x","name":"批量 shell","type":"shell","command":"df -h",
    "status":"running|done","total":2,"done":2,"success":2,"failed":0,"createdAt":"ISO"}],"total":1}
  ```
- `GET /api/tasks/:id` → 上述对象 + `items:[{"deviceId","deviceName","status":"pending|running|success|failed|timeout","result":"stdout+stderr 文本","finishedAt":"ISO"}]`

## 6. 全局操作日志

- `GET /api/logs?page&pageSize&keyword&deviceId&username&start&end`
  - `start`/`end` 为 ISO 或 `YYYY-MM-DD`
  → `{"list":[LogItem],"total":n,"page":1,"pageSize":10}`
- LogItem：
  ```json
  {"id":1,"username":"admin","deviceId":"dev_1","deviceName":"奶奶的手机",
   "type":"shell","command":"ls /sdcard","result":"stdout/stderr",
   "status":"success|failed|timeout","durationMs":12,"createdAt":"ISO"}
  ```
- `GET /api/logs/export?<同筛选>` → `text/csv`，带 `Content-Disposition: attachment`

## 7. 用户管理（仅 super）

- `GET /api/users` → `{"list":[{id,username,role,permissions,enabled,createdAt,lastLoginAt}]}`
- `POST /api/users` `{username,password,role,permissions}` → user
- `PUT /api/users/:id` `{password?,role?,permissions?,enabled?}` → user
- `DELETE /api/users/:id`（不可删自己、不可删最后一个 super）

## 8. 系统设置

- `GET /api/settings` →
  ```json
  {"siteName":"远程安卓设备运维平台","apiBase":"","logRetentionDays":30,"allowRegister":false}
  ```
- `PUT /api/settings` 同结构（部分字段可只传变更项）→ 完整对象

## 9. WebSocket（Agent 专用）

URL：`ws://<host>/ws/agent?token=<deviceToken>`

连接建立后 agent 必须立即发一条 `hello`：
```json
{"type":"hello","device":{"deviceUid":"xxx","model":"...","androidVersion":"16","rootStatus":"granted","battery":50,"network":"wifi","ip":"..."}}
```

心跳（默认 15s，可配）：
```json
{"type":"heartbeat","device":{"battery":50,"network":"wifi","model":"...","androidVersion":"16","rootStatus":"granted","ip":"..."}}
```

后端下发指令：
```json
{"type":"command","requestId":"r_x","cmd":"shell","params":{"command":"ls"}}
```

Agent 回传结果：
```json
{"type":"result","requestId":"r_x","ok":true,"stdout":"...","stderr":"...","exitCode":0,"durationMs":12,"image":"base64-png 可选","fileId":"可选"}
```

后端下发文件拉取通知（upload / install_apk 用）：
```json
{"type":"pull_file","requestId":"r_x","fileId":"f_x","targetPath":"/sdcard/a.apk","mode":"save|install"}
```
Agent 下载：`GET /api/files/:fileId/raw?token=<deviceToken>`（此接口用 token 而非 JWT）
→ 二进制。完成后回 `result`。

后端心跳判定：`lastSeenAt` 超过 **60s** 视为离线。

## 10. 错误码表

`BAD_CREDENTIALS` `ACCOUNT_DISABLED` `UNAUTHORIZED` `FORBIDDEN` `NOT_FOUND`
`DEVICE_OFFLINE` `VALIDATION_ERROR` `INTERNAL_ERROR` `TOO_MANY_REQUESTS`
