import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * Vite 配置
 *
 * 两个关键决策：
 * 1. 手动分包 —— 把 CodeMirror 核心与 Vue 拆开，便于分析体积来源。
 * 2. 关闭 sourcemap 生产输出 —— 源码即源码，不泄露也不增大包体。
 */
export default defineConfig(({ mode }) => ({
  plugins: [vue()],

  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  // Tauri 在 dev 下期望固定端口，端口被占会直接报错而非自动顺延
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
    // 门禁测试通过 http://localhost:5173/tests/fixtures/harness.html 拉取自验证页。
    // Vite 默认只允许服务 public/ 与根目录下的静态资源，fixtures 被排除时会 404，
    // 导致自验证用例以「页面加载失败」结束 —— 那不是有效的失败，会误导排查方向。
    fs: { allow: ['.'] },
  },

  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    reportCompressedSize: true,
    // 编辑器是一个包，压缩前大约 570 kB。再涨一截才警告。
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // CodeMirror 和 Lezer 会互相引用。拆成两个 chunk 会在生产包里
        // 形成环，启动时抛出 “Cannot access before initialization”，
        // 页面停在空的主题底色上。编辑器代码仍单独成包，只是不再对拆。
        manualChunks(id) {
          if (id.includes('node_modules/@codemirror/') || id.includes('node_modules/@lezer/')) {
            return 'editor'
          }
        },
      },
    },
  },

  // 语言包全部走动态 import，避免打进主 chunk
  optimizeDeps: { exclude: ['@codemirror/lang-*'] },

  define: {
    __DEV__: mode !== 'production',
  },
}))
