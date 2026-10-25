/**
 * Web 后台 × 真实后端 的端到端联调（Playwright + 无头 chromium）
 *
 * 前置：已部署 http://43.251.226.134，且 test/fake-agent.mjs 已连上
 * 运行：node test/ui-e2e.cjs
 */
const { chromium } = require('/opt/verify/node_modules/playwright');

const BASE = process.env.BASE || 'http://43.251.226.134';
const EXE = '/root/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell';
const OUT = '/tmp/ui';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
};

(async () => {
  /* ---------- 先用 API 核对后端数据 ---------- */
  console.log('\n== 0. 后端 API 核对 ==');
  const login = await (
    await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })
  ).json();
  const jwt = login.data?.token;
  check('管理员登录', !!jwt);

  const devs = await (await fetch(`${BASE}/api/devices?keyword=联调`, { headers: { Authorization: `Bearer ${jwt}` } })).json();
  const dev = devs.data?.list?.[0];
  check('设备在线', dev?.online === true, JSON.stringify(dev?.online));
  check('IP 不再是 127.0.0.1（Nginx 反代修复）', dev?.ip && dev.ip !== '127.0.0.1', `ip=${dev?.ip}`);

  /* ---------- 浏览器 ---------- */
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`CONSOLE ${m.text()}`);
  });

  console.log('\n== 1. 登录 ==');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('登录页标题', (await page.title()).includes('登录'));
  await page.fill('input[placeholder="请输入管理员账号"]', 'admin');
  await page.fill('input[placeholder="请输入密码"]', 'admin123');
  await page.click('button:has-text("登录")');
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const dashText = (await page.textContent('body')) || '';
  check('进入仪表盘', dashText.includes('设备总数'));
  check('统计：设备总数', /设备总数\s*2/.test(dashText.replace(/\s+/g, ' ')), '');
  check('统计：在线设备', /在线设备\s*1/.test(dashText.replace(/\s+/g, ' ')), '');
  check('在线设备列表含测试机', dashText.includes('联调测试机'));
  await page.screenshot({ path: `${OUT}-dashboard.png`, fullPage: true });

  console.log('\n== 2. 设备列表 ==');
  await page.click('text=设备管理');
  await page.waitForTimeout(1200);
  const listText = (await page.textContent('body')) || '';
  check('列表出现设备名', listText.includes('联调测试机'));
  check('列表显示在线状态', listText.includes('在线'));
  check('列表显示设备 ID', /dev_[0-9a-f]{8}/.test(listText));
  await page.screenshot({ path: `${OUT}-devices.png`, fullPage: true });

  console.log('\n== 3. 设备详情 ==');
  await page.click('text=联调测试机');
  await page.waitForTimeout(1500);
  const detail = (await page.textContent('body')) || '';
  check('进入详情页', page.url().includes('/devices/dev_'));
  check('型号正确', detail.includes('OnePlus PLR110'));
  check('安卓版本正确', detail.includes('Android 16'));
  check('电量正确', /76\s*%/.test(detail));
  check('Root 授权已显示', detail.includes('已授权'));

  console.log('\n== 4. 远程截图（真实 WS 往返） ==');
  await page.click('button:has-text("截图预览")');
  let imgSrc = '';
  try {
    await page.waitForSelector('.n-modal img, .n-dialog img', { timeout: 8000 });
    imgSrc = await page.getAttribute('.n-modal img, .n-dialog img', 'src');
  } catch (e) {
    console.log('    截图弹窗未出现:', e.message.split('\n')[0]);
  }
  check('截图弹窗显示图片', String(imgSrc).startsWith('data:image/png'), String(imgSrc).slice(0, 40));
  await page.screenshot({ path: `${OUT}-screenshot.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  console.log('\n== 5. 自定义 Shell 命令 ==');
  await page.fill('textarea', 'df -h');
  await page.click('button:has-text("执行命令")');
  await page.waitForTimeout(2500);
  const afterShell = (await page.textContent('body')) || '';
  check('Shell 结果回显 stdout', afterShell.includes('47G'), '');
  await page.screenshot({ path: `${OUT}-shell.png`, fullPage: true });

  console.log('\n== 6. 全局操作日志 ==');
  await page.click('text=操作日志');
  await page.waitForTimeout(1500);
  const logText = (await page.textContent('body')) || '';
  check('日志页出现 shell 记录', logText.includes('df -h'));
  check('日志页出现截图记录', logText.includes('截图'));
  check('日志记录操作人', logText.includes('admin'));
  await page.screenshot({ path: `${OUT}-logs.png`, fullPage: true });

  console.log('\n== 7. 命令模板 ==');
  await page.click('text=命令模板');
  await page.waitForTimeout(1200);
  const tplText = (await page.textContent('body')) || '';
  check('模板页可访问', tplText.includes('模板') || tplText.includes('命令'));

  console.log('\n== 8. 深色模式 ==');
  // 顶部导航里的深浅色切换按钮：按 title/aria-label 找，找不到就尝试图标按钮
  let darkOk = false;
  for (const sel of ['button[title*="深色"]', 'button[aria-label*="深色"]', 'button[title*="主题"]', 'button:has-text("深")']) {
    const el = await page.$(sel);
    if (el) {
      await el.click();
      await page.waitForTimeout(800);
      darkOk = true;
      break;
    }
  }
  if (!darkOk) {
    // 兜底：遍历所有按钮找带 moon 类名或 title 的
    const btns = await page.$$('header button, .n-layout-header button');
    for (const b of btns) {
      const t = ((await b.getAttribute('title')) || '') + ((await b.getAttribute('aria-label')) || '');
      if (/深|dark|moon|主题/.test(t)) {
        await b.click();
        darkOk = true;
        await page.waitForTimeout(800);
        break;
      }
    }
  }
  const darkState = await page.evaluate(() => ({
    ls: localStorage.getItem('dsha_dark'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
  check('找到并点击深浅色切换', darkOk, JSON.stringify(darkState));
  check('深色状态已持久化或背景变深', darkState.ls === '1' || darkState.bodyBg !== 'rgb(255, 255, 255)', JSON.stringify(darkState));
  await page.screenshot({ path: `${OUT}-dark.png`, fullPage: true });
  // 切回浅色
  if (darkOk) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
  }

  console.log('\n== 9. 移动端适配 ==');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE}/devices`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const mobileText = (await page.textContent('body')) || '';
  check('移动端设备页可渲染', mobileText.includes('联调测试机'));
  // 抽屉：找汉堡按钮
  const hamburger = await page.$('button:has-text("menu"), .n-layout-header button, header button');
  const hasNavBtn = !!hamburger;
  check('移动端存在菜单触发器', hasNavBtn);
  await page.screenshot({ path: `${OUT}-mobile.png`, fullPage: true });

  console.log('\n== 10. 控制台错误 ==');
  check('全流程无 JS 错误', errors.length === 0, JSON.stringify(errors.slice(0, 4)));

  await browser.close();
  console.log(`\n===== 联调结果：${failures === 0 ? '全部通过 ✅' : `${failures} 项失败 ❌`} =====`);
  console.log('截图已保存到 /tmp/ui-*.png');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
