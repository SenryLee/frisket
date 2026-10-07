import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright 配置 —— CLS / IME 门禁
 *
 * ## 为什么必须双引擎
 *
 * M0 的核心目的是**证伪项目的技术假设**，其中一条是「在 macOS 上用 WebKit 跑
 * 中文输入没问题」。但 Playwright 默认只跑 Chromium，而 macOS 上的 Tauri
 * WKWebView 用的是 WebKit。Chromium 通过不代表 WebKit 通过 —— 尤其 IME：
 * CodeMirror 6 在 6.39.6 / 6.39.7 / 6.39.8 连续修了三个 IME 相关 bug，
 * 说明这块是活跃风险区，两个引擎的实现差异必须被门禁覆盖到。
 *
 * 因此这里显式声明两个 project，而不是只留 chromium。
 *
 * ## 为什么跑 dev server 而不是 preview
 *
 * 门禁要断言的是「编辑器在开发态下的布局与输入行为」。preview 是构建产物，
 * vite 的手动分包与 define替换都可能改变 DOM 结构与 CSS 注入顺序，
 * 用它跑门禁等于测了一个和开发者日常所见不一致的产物。
 *
 * 端口 5173 与 vite.config.ts 的 strictPort: 5173 对齐。
 */
export default defineConfig({
  testDir: './tests/e2e',

  // 门禁的意义在于「稳定地不通过」。重试会把真实的 IME 丢字问题
  // 变成偶发绿，掩盖风险。所以 retries 只在 CI 里给 1 次，
  // 且下面每个 project 的 maxFailures 会阻止「第一次失败就当噪音放过」。
  retries: process.env.CI ? 1 : 0,
  maxFailures: 1,

  // layout-shift 是按文档累计的全局指标。多个 worker 同时开页面虽然互不干扰，
  // 但 CPU 争抢会改变渲染时序，让 CLS 数值变得不稳定 —— 门禁最怕这种噪声。
  // 强制单线程串行，用时间换确定性。
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,

  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  // 失败时保留 trace 与视频，用来判断「是布局真的抖了，还是探针装晚了」。
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // WebKit 是 macOS 的真实引擎，也是 IME 门禁的主要防线。
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})