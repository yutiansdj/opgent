# 远程安卓设备运维平台 · Web 管理后台

Vue 3 + Vite + NaiveUI 实现的管理后台前端，所有数据均通过真实 HTTP 接口获取，接口契约见
`../docs/API.md`。

## 技术栈

- Vue 3（`<script setup>`）+ Vite
- NaiveUI（主要 UI 组件库，全局注册）
- Pinia（登录态 / 主题 / 站点配置）
- Vue Router（全部页面路由懒加载）
- axios（统一封装、JWT 注入、`{ok,data}` 解包、401 自动登出）
- TailwindCSS（关闭 `preflight`，避免与 NaiveUI 样式冲突；用于间距与响应式布局）

## 开发与构建

```bash
npm install
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 生产构建，产物在 dist/
```

开发服务器已配置代理：`/api` 与 `/ws` → `http://127.0.0.1:8787`。

### 环境说明（重要）

当前工作目录 `/sdcard` 是 Android 的 FUSE 挂载（**noexec、且不允许创建软链接**），
npm 在这个目录里安装依赖时会因为无法执行 esbuild / 无法 dlopen rollup 原生模块而失败。
因此本项目的生产构建是在一个可执行的镜像目录中完成的：

```bash
# 在可执行目录（如 /root/web-build）放置本目录源码 + node_modules 后执行：
NODE_OPTIONS=--max-old-space-size=1536 node node_modules/vite/bin/vite.js build
# 再把 dist/ 拷贝回本目录
```

在普通 Linux 开发机 / 服务器上直接 `npm install && npm run build` 即可，无需上述绕行。

## 配置

- `.env`：`VITE_API_BASE`（后端地址，留空表示同源/代理）、`VITE_SITE_NAME`
- 运行时可在「系统设置 → 后端接口地址」覆盖 `VITE_API_BASE`，保存在 `localStorage`
  的 `dsha_api_base`，立即生效；填主机端口即可，不要带 `/api`。

## 目录结构

```
src/
├── api/            # 按模块拆分的接口封装（auth/dashboard/devices/templates/tasks/logs/users/settings）
├── components/     # AppIcon、PageTable（表格+分页骨架）、SearchBar、Pagination、StatCard、BarChart
├── composables/    # useIsMobile 响应式断点
├── layouts/        # MainLayout：顶栏、通知、深浅色、头像菜单、分组侧边栏/移动端抽屉
├── router/         # 路由与守卫（登录校验、页面级权限）
├── stores/         # auth（JWT/用户/权限）、app（深浅色/折叠/站点名）
├── styles/         # Tailwind 入口与全局样式
├── utils/          # request（axios）、auth 存储、下载、格式化、校验、权限常量
└── views/          # Login / Dashboard / Devices / DeviceDetail / Templates / Tasks / Logs / Users / Settings / 403 / 404
```

## 权限

权限点：`dashboard` `devices` `templates` `tasks` `logs` `users` `settings`。
`super` 拥有全部权限；其余账号按 `user.permissions` 过滤侧边菜单并做路由级拦截，无权限统一进入 403 页。
