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
    // 体积门禁：超过阈值时构建失败而非静默通过
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks: {
          'editor-codemirror': [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/commands',
            '@codemirror/language',
            '@codemirror/search',
          ],
          'editor-markdown': ['@codemirror/lang-markdown', '@lezer/highlight'],
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
