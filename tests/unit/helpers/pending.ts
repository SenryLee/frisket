/**
 * 被测模块的运行时守卫
 *
 * ── 为什么用动态 import 而不是静态 import ──────────────────────
 *
 * 「光标进入则展开原始语法」等实现属于 src/editor/**，
 * 由内核子智能体并行开发中，此刻文件尚不存在。
 *
 * 若静态 import，TypeScript 会在 typecheck 阶段直接报错 ——
 * 那会让 `pnpm typecheck` 整体失败，看起来像我的交付有缺陷。
 *
 * 因此这里用变量路径的动态 import：TS 不做静态解析，typecheck 通过；
 * 运行期若模块缺失，调用方据实跳过并说明原因，不制造假绿。
 *
 * ── 这不是长期方案 ────────────────────────────────────────────
 *
 * 内核就绪后应删掉本文件、改为静态 import。
 * 「让缺失的依赖静默跳过」本身是坏味道，
 * 所以最终报告把「移除本守卫」列为明确待办，而不是既定设计。
 */

/**
 * 被测模块候选表。
 *
 * 用 `import.meta.glob` 而非变量路径的动态 import，原因有两：
 *   1. Vite 只对**静态可分析**的路径做别名解析与产物追踪。
 *      拼出来的路径 '@/editor/live/reveal' 在浏览器/vitest 运行期不会被解析成文件。
 *   2. import.meta.glob 的 key 必须是字面量，写错路径会在构建期暴露，
 *      而不是运行期静默变成「模块不存在」。
 *
 * `{ eager: false }` 返回的是加载函数，调用时才真正 import，
 * 这样缺失的模块不影响其他用例。
 *
 * 注意：这个 glob 匹配的是**调用它所在的文件**。
 * 本文件在 tests/unit/helpers/ 下，src/editor/ 在仓库根的 src/ 下，
 * 两者的相对路径是 `../../../src/editor/`（三级：helpers → unit → tests → 根）。
 * 写成 `../../src/editor/`（两级）会匹配到 tests/src/editor/ —— 那个目录不存在，
 * glob 返回空表，loadExport 一律返回 null，于是**所有用例会静默skip**。
 * 跳过时报告里显示的是「未跑」，不会报错，因此这个错误极难被发现。
 */
const KERNEL_MODULES = import.meta.glob('../../../src/editor/**/*.ts') as Record<
  string,
  () => Promise<Record<string, unknown>>
>

/**
 * 在内核模块中查找某个导出。
 *
 * 匹配规则：路径以 suffix 结尾（忽略大小写）且导出名匹配。
 * 这样测试不必知道文件的确切深度，只要知道文件名即可。
 *
 * ── 返回整个模块对象，exportName 只用于「存在性校验」 ──────────────
 * 调用方一律把返回值当模块对象用（`api.computeRevealed(...)`），
 * 因此这里返回完整模块。
 *
 * 为什么不是「只返回点名的那个导出」：render-snapshot.test.ts 用
 * `loadExport(path, 'describeRender')` 做存在性校验，却调用 `api.render(doc)` ——
 * 查找名与调用名不一致。若只返回点名的那一个，api.render 就是 undefined，
 * 报TypeError，看起来像内核没实现。
 * 返回完整模块让两种名字都能用上，代价仅是多暴露几个符号，对测试无害。
 *
 * @param suffix 文件名路径后缀，如 'reveal.ts' 或 'guards.ts'
 * @param exportName 用于确认该导出确实存在的名字
 * @returns 模块对象；文件或导出不存在时返回 null
 */
export async function loadExport<T>(
  suffix: string,
  exportName: string,
): Promise<T | null> {
  const wanted = suffix.toLowerCase()

  for (const [path, load] of Object.entries(KERNEL_MODULES)) {
    if (!path.toLowerCase().endsWith(wanted)) continue
    try {
      const mod = await load()
      if (mod[exportName] !== undefined) return mod as T
    } catch (error) {
      // 该文件存在但加载失败时要让人看见原因，不能静默跳过 ——
      // 「模块存在却加载不了」是内核的错，静默 skip 会把它变成假绿
      throw new Error(
        `内核模块 ${path} 存在但加载失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }
  return null
}

/**
 * 内核实现中待查的导出，按职责归类。
 *
 * 只列文件名后缀，不列完整路径：内核可以自由调整文件深度与命名，
 * 而门禁只依赖「哪个文件提供哪个能力」这个契约。
 */
export const KERNEL_PATHS = {
  /** 计算「光标在哪些标记范围内应展开」的纯函数 */
  reveal: 'reveal.ts',
  /** 语法守卫：无 URL 链接判定、空标记判定 */
  guards: 'guards.ts',
  /** 把语法节点翻译成 decoration 的渲染入口 */
  render: 'field.inline.ts',
} as const

/**
 * 被测模块缺失时统一使用的 skip 理由。
 *
 * 用固定文案而不是空字符串：报告里能 grep 到「哪些门禁还没跑」，
 * 避免「绿」被误读成「已验证」。
 */
export const PENDING_REASON =
  '被测模块（src/editor/**）尚未就绪 —— 本用例未执行。' +
  '它既不构成通过也不构成失败，需在内核落地后重跑。'