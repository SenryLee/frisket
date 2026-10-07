import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Vitest 配置 —— 单元测试
 *
 * 为什么 unit 与 e2e 分开跑：单元测试默认跑在 node 环境（快、无浏览器），
 * 而 CLS / IME 门禁必须跑在真实浏览器里 —— layout-shift 与 IME 都是浏览器
 * 原生行为，jsdom 根本没有 layout-shift 实现，在它里面模拟出来的 CLS 数字
 * 毫无意义。混在一起会诱使人写出「在 jsdom 里假装有门禁」的假测试。
 *
 *需要 DOM 的用例（CodeMirror 编辑状态）在文件顶部用
 * `// @vitest-environment jsdom` 单独声明，不用 environmentMatchGlobs ——
 * 后者在 Vitest 3 已废弃，且行为随版本漂移。
 *
 * ── 关于「快照缺失即失败」 ─────────────────────────────────────
 *
 * 想要「快照不存在时失败而非自动写入」，本来可以写
 * `snapshotOptions: { updateSnapshot: 'none' }`。
 * 实测（vitest 3.2.4）该字段**不是合法的 UserConfig 字段**：
 * 它只存在于内部的 ResolvedConfig 里，写在配置中会报 TS2353。
 * 用户可配置的等价项是 CLI 的 `--update=false`。
 *
 * 因此这里不写这个字段，改为在 render-snapshot.test.ts 里用
 * `expect(file).toExist()` 之类的显式断言守住同一意图 ——
 * 把「快照缺失要报错」变成用例自己的责任，而不是依赖配置项的隐式行为。
 * 配置能被静默忽略，断言不能。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // 明确排除 e2e。这批用例依赖 Playwright 的 page 对象与真实浏览器。
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],

    // 渲染快照要稳定，测试之间不能有共享可变状态。
    // isolate 默认为 true，显式写出是为了让「顺序敏感」的失败可被定位。
    isolate: true,
    pool: 'threads',

    reporters: ['default'],
  },
})