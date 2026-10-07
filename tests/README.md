# tests/ —— Frisket 质量门禁

本目录是 M0 的止损线。用自动化测试**验证或证伪**项目的技术假设：
行高与 IME 这两条压不下来，整个项目没有继续的意义。

## 实测状态（2026-10，Chromium 1208 + WebKit 26.0）

| 门禁 | 文件 | 阈值 | chromium | webkit |
|---|---|---|---|---|
| **行高恒定（主门禁）** | `e2e/line-height-probe.spec.ts` | 标记显隐不改变行高 | 3/3 | 3/3 |
| CLS（辅助） | `e2e/cls-probe.spec.ts` | 错误实现必须测出偏移 | 3/3 | skip（引擎不支持） |
| 语料完整性 | `unit/corpus-integrity.test.ts` | 76+60 条自洽 | 10/10（node） | — |
| 元素级 CLS | `e2e/cls.spec.ts` | 10 次进出 < 0.01 | 等测试桥 | 等测试桥 |
| IME 零丢字 | `e2e/ime.spec.ts` | 三场景零丢字 | 等测试桥 | 等测试桥 |
| 大文档帧率 | `e2e/perf.spec.ts` | 5000 行滚动 ≥ 55fps | 等测试桥 | 等测试桥 |
| 渲染快照 | `unit/render-snapshot.test.ts` | CommonMark 76 + GFM 60 | 等 `describeRender` | — |

探针自验证的实测数值（harness 是故意写错的 block widget 实现）：

- 错误实现：**行高变化恰好 20.00px**，7 行全部一致
- 正确实现：**0.000px**，零漂移

## 常用命令

```bash
pnpm test          # 单元测试
pnpm test:gate     # CLS + IME 两道门禁
pnpm typecheck     # 类型检查（noUnusedLocals 等严格选项）

# 首次准备
npx playwright install chromium webkit
node tests/fixtures/gen-large.mjs   # 生成 5000 行性能文档
```

## 读测试结果前必读

**「绿」不等于「验过了」。** 请按下面三类理解结果：

1. `line-height-probe.spec.ts` / `cls-probe.spec.ts` / `corpus-integrity.test.ts`
   —— **真跑过，且不依赖被测代码**。
   绿了说明**工具有效、语料自洽**，不代表编辑器行为正确（那需要内核就绪后另跑）。
2. 其余用例在内核就绪前是 **skip**（不是 pass），报告里显示为 skipped。
   看到 skip 请当作「没跑」。
3. 若 `window.__slate` 测试桥未挂载，CLS / IME / perf 会**显式抛错**而非跳过 ——
   因为「无法运行」被误读成「通过」是最危险的失败模式。

## 三个必须知道的口径问题

### 1. 行高是主门禁，CLS 是辅助指标（实测确认）

**WebKit 26.0 实测不支持 `PerformanceObserver` 的 `layout-shift`**：
`supportedEntryTypes` 里没有该类型，探针 `supported=false`。
MDN 兼容性表标注 Safari 全版本「No support」是**准确的**。

macOS Tauri 用的正是 WKWebView —— Frisket 唯一的首发平台上，CLS 分数**根本采不到**。
用一个采不到的指标当主门禁是自欺。

因此主门禁是**行高恒定**（`src/test-utils/line-height.ts`，用 `getBoundingClientRect` 测，
不依赖任何性能 API）。它也更有诊断力：CLS = 0.008 无法指导修复，
而「「粗体」展开 49.59px / 折叠 29.59px」能直接指出是哪个语法元素在抖。

CLS 保留为 chromium 上的辅助指标 —— 它能反映滚动条跳动等更广的视觉抖动，
这是行高探针覆盖不到的。

### 2. `hadRecentInput` 过滤会让 CLS 恒等于 0

`LayoutShift.hadRecentInput` 为 true 的偏移（用户输入后 500ms 内）会被标准 CLS 口径排除。
而本项目的偏移**全部由光标移动诱发**，会被整条滤掉。

所以 `readCls()` 返回两个数：`total`（含输入诱发）与 `totalExcludingRecentInput`（标准口径）。
详见 `src/test-utils/cls.ts` 文件头。

### 3. WebKit 上没有 CDP

`Input.imeSetComposition` 是 Chromium 专属。macOS 上的 Tauri WKWebView 用 WebKit，
所以 IME 门禁在 WebKit 上走**合成 CompositionEvent** 路径。

差异：合成路径不覆盖浏览器原生 IME 的候选窗与按键协商。
「组合期间装饰不得改动文档」这条丢字主路径仍被覆盖，IME 细节不被覆盖。

## 一个连自验证都骗过的坑（已修，值得记下）

harness.html 最初每次 render 都 `replaceChildren()` 重建全部 DOM。
结果：**行高探针测到 20px 位移，CLS 探针却测到 0**。

原因：`layout-shift` 只统计「上一帧存在、这一帧移动了」的元素。
新建的节点在上一帧没有「原位置」，因此**永远不产生 layout-shift**。

这说明 CLS 分数不只是「跨引擎不可用」，它还会**静默地把真实位移报成 0** ——
如果当时没同时做行高对照，我会以为探针坏了，而不去查自己的 harness。

CodeMirror 的真实行为正是复用 DOM、只改 class 与 decoration 范围，
所以 harness 现在也改成复用节点。这个坑记在这里，因为任何自建 harness 都可能踩。

## 目录

```
tests/
├── e2e/
│   ├── line-height-probe.spec.ts  行高探针自验证（主门禁，不依赖内核）
│   ├── cls-probe.spec.ts          CLS 探针自验证（仅 chromium）
│   ├── cls.spec.ts                元素级 CLS 门禁
│   ├── ime.spec.ts                门禁：IME 零丢字
│   └── perf.spec.ts               门禁：大文档帧率
├── unit/
│   ├── corpus-integrity.test.ts   语料自洽性（不依赖内核）
│   ├── render-snapshot.test.ts    CommonMark 76 + GFM 60 渲染快照
│   ├── reveal.test.ts             光标进入展开状态机
│   ├── link-degradation.test.ts   无 URL 链接必须退化（竞品缺陷）
│   ├── empty-marker.test.ts       空标记必须可见（渐进披露）
│   └── helpers/pending.ts         被测模块未就绪时的运行时守卫
└── fixtures/
    ├── syntax.md                  全语法测试文档
    ├── gen-large.mjs              5000 行性能文档生成器
    ├── harness.html               探针自验证页（故意写错）
    ├── corpus-commonmark.ts       76 条 CommonMark 语料
    └── corpus-gfm.ts              60 条 GFM 语料
```

## 待办（内核就绪后必做）

1. 删除 `tests/unit/helpers/pending.ts`，把动态 import 改为静态 import。
   守卫本身是坏味道，只应作为并行期的临时措施存在。
2. 首次运行 `pnpm test -u` 生成渲染快照，然后**人工 review** 快照内容。
   快照缺失时 `render-snapshot.test.ts` 会显式失败，防止把可能错误的输出固化成基准。
3. 校准语料的 `lineCount`（渲染后行数）。目前是按规范推算的估计值，未经运行验证。