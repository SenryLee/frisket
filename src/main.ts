import { createApp } from 'vue'
import App from './App.vue'
import { listenForHost } from './core/mount'
import './styles/index.css'

// 必须在 App 挂载之前听 hostReady。
// App 只负责交出挂载点；没人听的话编辑器不会创建，工具栏会一直是灰的。
const stopEditor = listenForHost({})
if (import.meta.hot) {
  import.meta.hot.dispose(() => stopEditor())
}

/**
 * 应用入口
 *
 * 为什么不引入 vue-router：macOS 透明窗口在页面切换时会出现残影
 * （社区已知问题，webkit 层无法根治）。Slate 全部视图由 store 驱动，
 * 单页切换是最优解。详见 docs/GLASS-CHECKLIST.md
 */
createApp(App).mount('#app')
